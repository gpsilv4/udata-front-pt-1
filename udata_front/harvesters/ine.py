from datetime import datetime
import requests
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode
import re
import threading
from concurrent.futures import ThreadPoolExecutor
import lxml.etree as etree
import logging
import os

from udata.models import db, Resource, License
from udata.harvest.backends.base import BaseBackend
from udata.harvest.models import HarvestItem, HarvestError
from udata.harvest.exceptions import HarvestSkipException
from .tools.harvester_utils import normalize_url_slashes
from flask import current_app

log = logging.getLogger(__name__)

PERIODICITY_MAP = {
    'anual': 'annual',
    'semestral': 'semiannual',
    'trimestral': 'quarterly',
    'mensal': 'monthly',
    'decenal': 'unknown',
    'quinzenal': 'biweekly',
    'semanal': 'weekly',
    'diário': 'daily',
    'diario': 'daily',
    'contínuo': 'continuous',
    'continuo': 'continuous',
    'irregular': 'irregular',
    'pontual': 'punctual',
    'quinquenal': 'quinquennial',
    'bienal': 'biennial',
    'trienal': 'triennial',
    'não periódica': 'irregular',
    'nao periodica': 'irregular',
}

VALID_FREQUENCIES = [
    'unknown', 'punctual', 'continuous', 'hourly', 'fourTimesADay', 'threeTimesADay',
    'semidaily', 'daily', 'fourTimesAWeek', 'threeTimesAWeek', 'semiweekly', 'weekly',
    'biweekly', 'threeTimesAMonth', 'semimonthly', 'monthly', 'bimonthly', 'quarterly',
    'threeTimesAYear', 'semiannual', 'annual', 'biennial', 'triennial', 'quinquennial', 'irregular'
]


class INEBackend(BaseBackend):
    display_name = 'Instituto nacional de estatística'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.session = requests.Session()
        self._indicator_cache = {}
        self._catalog_extras = {}
        self._lock = threading.Lock()

    def _get_text(self, node):
        if node is None:
            return ''
        return "".join(node.itertext()).strip()

    def _parse_xml(self, content):
        if not content:
            return None
        if isinstance(content, str):
            content = content.encode('utf-8')

        # Strip leading non-XML text if any
        if not content.strip().startswith(b'<'):
             content = re.sub(rb'^[^<]+', b'', content).strip()

        try:
            return etree.fromstring(content)
        except Exception as e:
            log.error(f"Error parsing XML: {e}")
            return None

    def process_dataset(self, remote_id, **kwargs):
        """Process dataset data without saving to MongoDB.
        Returns (HarvestItem, Dataset) tuple for later batch saving.
        """
        item = HarvestItem(status="started", started=datetime.utcnow(), remote_id=remote_id)
        dataset = None

        try:
            if not remote_id:
                raise HarvestSkipException("missing identifier")

            dataset = self.inner_process_dataset(item, **kwargs)

            dataset.harvest = self.update_dataset_harvest_info(dataset.harvest, item.remote_id)
            dataset.archived = None

            # Only validate during dryrun, don't save yet
            if self.dryrun:
                dataset.validate()
            
            item.dataset = dataset
            item.status = "done"
        except HarvestSkipException as e:
            item.status = "skipped"
            item.errors.append(HarvestError(message=str(e)))
        except Exception as e:
            item.status = "failed"
            import traceback
            item.errors.append(HarvestError(message=str(e), details=traceback.format_exc()))
        finally:
            item.ended = datetime.utcnow()
        
        return (item, dataset)

    def inner_harvest(self):
        try:
            from ineDatasets import datasetIds
        except ImportError:
            datasetIds = set([])

        print(f"Fetching catalog from {self.source.url}")
        try:
            # Increase timeout and use session
            req = self.session.get(self.source.url, timeout=600)
            req.raise_for_status()
        except requests.RequestException as e:
            print(f"Error fetching catalog: {e}")
            return

        doc = self._parse_xml(req.content)
        if doc is None:
            return

        # Pre-populate cache to avoid re-fetching in inner_process_dataset
        self._indicator_cache = {}
        for propNode in doc.xpath('//indicator'):
            currentId = propNode.get('id')
            if currentId:
                self._indicator_cache[str(currentId)] = propNode
                datasetIds.add(currentId)

        # Store catalog-level info
        self._catalog_extras = {}
        lang_nodes = doc.xpath('//language')
        if lang_nodes:
            self._catalog_extras['language'] = self._get_text(lang_nodes[0])
            
        extract_nodes = doc.xpath('//extraction_date')
        if extract_nodes:
            self._catalog_extras['extraction_date'] = self._get_text(extract_nodes[0])

        print(f"Found {len(datasetIds)} indicators to process")
        
        # Parallel processing
        workers = 50  # High parallelism for data processing (no DB writes here)
        try:
            # Try to get workers from config if available
            config_workers = self.get_extra_config_value('workers')
            if config_workers:
                workers = int(config_workers)
        except:
            pass
            
        print(f"Starting ThreadPoolExecutor with {workers} workers for parallel data processing")
        app = current_app._get_current_object()

        from concurrent.futures import as_completed
        
        results = []  # Collect all (item, dataset) tuples

        def process_with_context(dsId):
            with app.app_context():
                return self.process_dataset(dsId)

        with ThreadPoolExecutor(max_workers=workers) as executor:
            # Submit all tasks
            futures = {executor.submit(process_with_context, dsId): dsId for dsId in datasetIds}
            
            # Collect results as they finish
            for future in as_completed(futures):
                results.append(future.result())
                if len(results) % 50 == 0:
                    print(f"Processed {len(results)}/{len(datasetIds)} datasets (data ready, pending save)...")

        # Now save datasets sequentially (avoid MongoDB contention)
        print(f"Saving {len(results)} datasets to MongoDB...")
        saved_count = 0
        for item, dataset in results:
            if dataset and item.status == "done" and not self.dryrun:
                try:
                    dataset.save()
                    saved_count += 1
                    if saved_count % 50 == 0:
                        print(f"Saved {saved_count} datasets...")
                except Exception as e:
                    item.status = "failed"
                    import traceback
                    item.errors.append(HarvestError(message=str(e), details=traceback.format_exc()))
            
            self.job.items.append(item)

        # Final save of harvest job
        self.save_job()
        print(f"Harvest complete. Total processed: {len(results)}, Saved: {saved_count}")
        print("inner_harvest() finished. Base harvest() will now run autoarchive if enabled...")

    def inner_process_dataset(self, item: HarvestItem):
        '''Return the INE datasets'''

        dataset = self.get_dataset(item.remote_id)
        target = None
        doc = None

        # Check if we already have this indicator in the cache from inner_harvest
        if hasattr(self, '_indicator_cache') and str(item.remote_id) in self._indicator_cache:
            target = self._indicator_cache[str(item.remote_id)]
            print(f'Using cached metadata for {item.remote_id}')
        else:
            # Fallback: Fetch specific data if not in cache
            base_url = self.source.url
            parsed = urlparse(base_url)
            qs = parse_qs(parsed.query)

            if 'lang' not in qs or not qs['lang']:
                qs['lang'] = ['PT']

            qs['varcd'] = [str(item.remote_id)]

            new_query = urlencode({k: v[0] for k, v in qs.items()})
            final_url = urlunparse(parsed._replace(query=new_query))

            print(f'Fetching metadata for {item.remote_id} from {final_url}')
            try:
                req = self.session.get(final_url, headers={'charset': 'utf8'}, timeout=300)
                req.raise_for_status()
                doc = self._parse_xml(req.content)
            except requests.RequestException as e:
                print(f"Error fetching metadata for {item.remote_id}: {e}")
                return dataset

            if doc:
                properties = doc.xpath('//indicator')
                for propNode in properties:
                    if propNode.get('id') == str(item.remote_id):
                        target = propNode
                        break
                if target is None:
                    target = properties[0] if properties else None

        if target is None:
            return dataset


        # 1. Title and Description
        title_node = target.xpath('./title')
        if title_node:
            dataset.title = self._get_text(title_node[0])

        desc_node = target.xpath('./description')
        if desc_node:
            dataset.description = self._get_text(desc_node[0])

        # 2. License
        dataset.license = License.guess('cc-by')

        # 3. Frequency / Periodicity
        dataset.frequency = 'unknown'
        periodicity_node = target.xpath('./periodicity')
        if periodicity_node:
            p_text = self._get_text(periodicity_node[0]).lower()
            mapped = PERIODICITY_MAP.get(p_text, 'unknown')
            if mapped in VALID_FREQUENCIES:
                dataset.frequency = mapped
            else:
                dataset.frequency = 'unknown'

        # 4. Modified Date
        update_node = target.xpath('./last_update')
        if update_node:
            u_text = self._get_text(update_node[0])
            try:
                dataset.modified = datetime.strptime(u_text, '%d-%m-%Y')
            except (ValueError, TypeError):
                pass

        # 5. Keywords and Tags
        keywordSet = set()

        # Keywords element
        for kn in target.xpath('./keywords'):
            text = self._get_text(kn)
            if text:
                parts = re.split(r'[;,/]|\s+-\s+|\s+\|\s+', text)
                for p in parts:
                    p = p.strip().strip(',')
                    if p:
                        keywordSet.add(p.lower())

        # Theme and Subtheme
        for tagname in ('theme', 'subtheme'):
            for tn in target.xpath(f'./{tagname}'):
                val = self._get_text(tn)
                if val:
                    keywordSet.add(val.lower())

        # Source and Geo level
        for tagname in ('source', 'geo_lastlevel'):
            for tn in target.xpath(f'./{tagname}'):
                val = self._get_text(tn)
                if val:
                    keywordSet.add(val.lower())

        dataset.tags = sorted(keywordSet)
        if 'ine.pt' not in dataset.tags:
            dataset.tags.append('ine.pt')

        # 6. Extras
        dataset.extras = dataset.extras or {}
        
        # Catalog level info (priority to current doc, fallback to cache)
        language = None
        extraction_date = None
        
        if doc is not None:
            lang_nodes = doc.xpath('//language')
            if lang_nodes:
                language = self._get_text(lang_nodes[0])
            extract_nodes = doc.xpath('//extraction_date')
            if extract_nodes:
                extraction_date = self._get_text(extract_nodes[0])
        
        if not language and hasattr(self, '_catalog_extras'):
            language = self._catalog_extras.get('language')
        if not extraction_date and hasattr(self, '_catalog_extras'):
            extraction_date = self._catalog_extras.get('extraction_date')
            
        if language:
            dataset.extras['ine:language'] = language
        if extraction_date:
            dataset.extras['ine:extraction_date'] = extraction_date

        # Indicator level info
        varcd_node = target.xpath('./varcd')
        if varcd_node:
            dataset.extras['ine:varcd'] = self._get_text(varcd_node[0])

        last_period = target.xpath('./last_period_available')
        if last_period:
            dataset.extras['ine:last_period_available'] = self._get_text(last_period[0])
            
        update_type = target.xpath('./update_type')
        if update_type:
            dataset.extras['ine:update_type'] = self._get_text(update_type[0])

        # 7. Resources
        dataset.resources = []

        # HTML URLs
        html_nodes = target.xpath('./html')
        if html_nodes:
            # BDD URL
            bdd_url_node = html_nodes[0].xpath('./bdd_url')
            if bdd_url_node:
                dataset.resources.append(Resource(
                    title='Página do indicador (HTML)',
                    url=self._get_text(bdd_url_node[0]),
                    type='documentation',
                    filetype='remote',
                    format='html'
                ))
            # Metainfo URL
            meta_url_node = html_nodes[0].xpath('./metainfo_url')
            if meta_url_node:
                dataset.resources.append(Resource(
                    title='Metainformação (HTML)',
                    url=self._get_text(meta_url_node[0]),
                    type='documentation',
                    filetype='remote',
                    format='html'
                ))

        # JSON URLs
        json_nodes = target.xpath('./json')
        if json_nodes:
            # JSON Dataset
            json_ds_node = json_nodes[0].xpath('./json_dataset')
            if json_ds_node:
                dataset.resources.append(Resource(
                    title='Dados do indicador (JSON)',
                    url=self._get_text(json_ds_node[0]),
                    type='main',
                    filetype='remote',
                    format='json'
                ))
            # JSON Metainfo
            json_meta_node = json_nodes[0].xpath('./json_metainfo')
            if json_meta_node:
                dataset.resources.append(Resource(
                    title='Metainformação (JSON)',
                    url=self._get_text(json_meta_node[0]),
                    type='documentation',
                    filetype='remote',
                    format='json'
                ))

        return dataset


