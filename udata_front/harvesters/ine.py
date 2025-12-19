from datetime import datetime
from xml.dom import minidom, Node
import requests
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode
import re

from udata.models import db, Resource, License
from udata.harvest.backends.base import BaseBackend
from udata.harvest.models import HarvestItem
from .tools.harvester_utils import normalize_url_slashes

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

    def _get_text(self, node):
        if not node:
            return ''
        return ''.join([n.nodeValue or '' for n in node.childNodes
                        if n.nodeType in (Node.TEXT_NODE, Node.CDATA_SECTION_NODE)]).strip()

    def _parse_xml(self, content):
        if not content:
            return None
        if isinstance(content, bytes):
            try:
                text = content.decode('utf-8')
            except UnicodeDecodeError:
                text = content.decode('latin-1')
        else:
            text = content

        # Strip leading non-XML text (like browser warnings)
        text = text.strip()
        if not text.startswith('<'):
            text = re.sub(r'^[^<]+', '', text).strip()

        try:
            return minidom.parseString(text)
        except Exception as e:
            print(f"Error parsing XML: {e}")
            return None

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
        if not doc:
            return

        # Pre-populate cache to avoid re-fetching in inner_process_dataset
        self._indicator_cache = {}
        for propNode in doc.getElementsByTagName('indicator'):
            currentId = propNode.getAttribute('id')
            if currentId:
                self._indicator_cache[str(currentId)] = propNode
                datasetIds.add(currentId)

        # Store catalog-level info
        self._catalog_extras = {}
        lang_nodes = doc.getElementsByTagName('language')
        if lang_nodes:
            self._catalog_extras['language'] = self._get_text(lang_nodes[0])
            
        extract_nodes = doc.getElementsByTagName('extraction_date')
        if extract_nodes:
            self._catalog_extras['extraction_date'] = self._get_text(extract_nodes[0])

        print(f"Found {len(datasetIds)} indicators to process")
        for dsId in datasetIds:
            self.process_dataset(dsId)

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
                properties = doc.getElementsByTagName('indicator')
                for propNode in properties:
                    if propNode.hasAttribute('id') and str(propNode.getAttribute('id')) == str(item.remote_id):
                        target = propNode
                        break
                if not target:
                    target = properties[0] if properties else None

        if not target:
            return dataset


        # 1. Title and Description
        title_node = target.getElementsByTagName('title')
        if title_node:
            dataset.title = self._get_text(title_node[0])

        desc_node = target.getElementsByTagName('description')
        if desc_node:
            dataset.description = self._get_text(desc_node[0])

        # 2. License
        dataset.license = License.guess('cc-by')

        # 3. Frequency / Periodicity
        dataset.frequency = 'unknown'
        periodicity_node = target.getElementsByTagName('periodicity')
        if periodicity_node:
            p_text = self._get_text(periodicity_node[0]).lower()
            mapped = PERIODICITY_MAP.get(p_text, 'unknown')
            if mapped in VALID_FREQUENCIES:
                dataset.frequency = mapped
            else:
                dataset.frequency = 'unknown'

        # 4. Modified Date
        update_node = target.getElementsByTagName('last_update')
        if update_node:
            u_text = self._get_text(update_node[0])
            try:
                dataset.modified = datetime.strptime(u_text, '%d-%m-%Y')
            except (ValueError, TypeError):
                pass

        # 5. Keywords and Tags
        keywordSet = set()

        # Keywords element
        for kn in target.getElementsByTagName('keywords'):
            text = self._get_text(kn)
            if text:
                parts = re.split(r'[;,/]|\s+-\s+|\s+\|\s+', text)
                for p in parts:
                    p = p.strip().strip(',')
                    if p:
                        keywordSet.add(p.lower())

        # Theme and Subtheme
        for tagname in ('theme', 'subtheme'):
            for tn in target.getElementsByTagName(tagname):
                val = self._get_text(tn)
                if val:
                    keywordSet.add(val.lower())

        # Source and Geo level
        for tagname in ('source', 'geo_lastlevel'):
            for tn in target.getElementsByTagName(tagname):
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
        
        if doc:
            lang_nodes = doc.getElementsByTagName('language')
            if lang_nodes:
                language = self._get_text(lang_nodes[0])
            extract_nodes = doc.getElementsByTagName('extraction_date')
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
        varcd_node = target.getElementsByTagName('varcd')
        if varcd_node:
            dataset.extras['ine:varcd'] = self._get_text(varcd_node[0])

        last_period = target.getElementsByTagName('last_period_available')
        if last_period:
            dataset.extras['ine:last_period_available'] = self._get_text(last_period[0])
            
        update_type = target.getElementsByTagName('update_type')
        if update_type:
            dataset.extras['ine:update_type'] = self._get_text(update_type[0])

        # 7. Resources
        dataset.resources = []

        # HTML URLs
        html_nodes = target.getElementsByTagName('html')
        if html_nodes:
            # BDD URL
            bdd_url_node = html_nodes[0].getElementsByTagName('bdd_url')
            if bdd_url_node:
                dataset.resources.append(Resource(
                    title='Página do indicador (HTML)',
                    url=self._get_text(bdd_url_node[0]),
                    type='documentation',
                    filetype='remote',
                    format='html'
                ))
            # Metainfo URL
            meta_url_node = html_nodes[0].getElementsByTagName('metainfo_url')
            if meta_url_node:
                dataset.resources.append(Resource(
                    title='Metainformação (HTML)',
                    url=self._get_text(meta_url_node[0]),
                    type='documentation',
                    filetype='remote',
                    format='html'
                ))

        # JSON URLs
        json_nodes = target.getElementsByTagName('json')
        if json_nodes:
            # JSON Dataset
            json_ds_node = json_nodes[0].getElementsByTagName('json_dataset')
            if json_ds_node:
                dataset.resources.append(Resource(
                    title='Dados do indicador (JSON)',
                    url=self._get_text(json_ds_node[0]),
                    type='main',
                    filetype='remote',
                    format='json'
                ))
            # JSON Metainfo
            json_meta_node = json_nodes[0].getElementsByTagName('json_metainfo')
            if json_meta_node:
                dataset.resources.append(Resource(
                    title='Metainformação (JSON)',
                    url=self._get_text(json_meta_node[0]),
                    type='documentation',
                    filetype='remote',
                    format='json'
                ))

        return dataset


