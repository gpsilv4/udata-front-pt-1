from udata.models import db, Resource, License
from udata.harvest.backends.base import BaseBackend
from datetime import datetime
import xml.etree.ElementTree as ET
import requests
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode
import re
import tempfile
import shutil
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import current_app
import time

from udata.harvest.models import HarvestItem
from .tools.harvester_utils import normalize_url_slashes

class INEBackend(BaseBackend):
    display_name = 'Instituto nacional de estatística'
    
    # Configurações de retry
    MAX_RETRIES = 5
    INITIAL_RETRY_DELAY = 2  # segundos
    MAX_RETRY_DELAY = 60  # segundos
    TIMEOUT_CONNECT = 15  # segundos (connect timeout)
    TIMEOUT_READ = 300  # segundos (read timeout)
    
    # Lista de Indicator IDs que são High Value Datasets (HVD)
    # Estes datasets devem ter as tags 'estatisticas' e 'hvd' adicionadas
    # Lista de Indicator IDs que são High Value Datasets (HVD)
    # Estes datasets devem ter as tags 'estatisticas' e 'hvd' adicionadas
    # Preenchido dinamicamente em inner_harvest
    HVD_INDICATOR_IDS = set()
    
    def __init__(self, *args, **kwargs):
        """Inicialização com otimização de save_job.
        
        O BaseBackend chama save_job() 2x por dataset, causando overhead O(n²)
        porque o Job cresce e fica cada vez mais lento de salvar.
        
        Solução: Salvar apenas a cada N datasets (batch).
        """
        super().__init__(*args, **kwargs)
        
        # Configuração do batching
        self._save_job_counter = 0
        self._save_job_interval = 10  # Salva a cada 10 datasets
        self._original_save_job = super().save_job  # Guarda referência ao método original
        self._last_save_count = 0
        
        print(f"[OPTIMIZATION] save_job batching ativado (intervalo: {self._save_job_interval})")
        print(f"[OPTIMIZATION] Retry logic ativado (max {self.MAX_RETRIES} tentativas com backoff exponencial)")
    
    def save_job(self):
        """Override de save_job para batching inteligente.
        
        Em vez de salvar o Job a cada dataset (2x!), salva apenas a cada N datasets.
        Isto elimina o overhead O(n²) onde saves ficam progressivamente mais lentos.
        """
        self._save_job_counter += 1
        
        # Salva apenas a cada N calls
        if self._save_job_counter % self._save_job_interval == 0:
            items_count = len(self.job.items) if hasattr(self, 'job') and self.job else 0
            print(f"[BATCH_SAVE] Salvando Job (call #{self._save_job_counter}, {items_count} items)...")
            self._original_save_job()
            self._last_save_count = items_count
        # Caso contrário, skip silenciosamente
    
    def _make_request_with_retry(self, url, headers=None, stream=True, **kwargs):
        """Faz requisição HTTP com retry automático e backoff exponencial.
        
        Recupera de erros de conexão transientes (SSL, connection reset, timeouts).
        
        Args:
            url: URL para fazer download
            headers: Headers HTTP opcionais
            stream: Se True, retorna response em stream
            **kwargs: Argumentos adicionais para requests.get()
            
        Returns:
            Response object do requests
            
        Raises:
            requests.exceptions.RequestException: Se falhar após todas as tentativas
        """
        if headers is None:
            headers = {}
        
        # Define timeout se não fornecido
        if 'timeout' not in kwargs:
            kwargs['timeout'] = (self.TIMEOUT_CONNECT, self.TIMEOUT_READ)
        
        last_exception = None
        retry_delay = self.INITIAL_RETRY_DELAY
        
        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                print(f'[RETRY] Tentativa {attempt}/{self.MAX_RETRIES} para {url}...')
                response = requests.get(url, headers=headers, stream=stream, **kwargs)
                response.raise_for_status()
                print(f'[RETRY] Sucesso na tentativa {attempt}')
                return response
                
            except (requests.exceptions.ConnectionError,
                    requests.exceptions.Timeout,
                    requests.exceptions.ChunkedEncodingError,
                    ConnectionResetError,
                    ConnectionAbortedError) as e:
                
                last_exception = e
                
                if attempt < self.MAX_RETRIES:
                    # Calcula delay com backoff exponencial + jitter
                    import random
                    jitter = random.uniform(0, 0.1 * retry_delay)
                    wait_time = min(retry_delay + jitter, self.MAX_RETRY_DELAY)
                    
                    print(f'[RETRY] Erro na tentativa {attempt}: {type(e).__name__}: {str(e)[:100]}')
                    print(f'[RETRY] Aguardando {wait_time:.1f}s antes de tentar novamente...')
                    time.sleep(wait_time)
                    
                    # Aumenta o delay para a próxima tentativa (backoff exponencial)
                    retry_delay = min(retry_delay * 2, self.MAX_RETRY_DELAY)
                else:
                    print(f'[RETRY] Falha na tentativa final {attempt}: {type(e).__name__}')
                    raise
            
            except requests.exceptions.RequestException as e:
                # Outros erros não são retentáveis
                print(f'[RETRY] Erro não-retentável: {type(e).__name__}: {str(e)[:100]}')
                raise
        
        # Este código nunca deve ser alcançado, mas por segurança:
        if last_exception:
            raise last_exception
        raise requests.exceptions.RequestException("Falha desconhecida na requisição")

    def _process_dataset_with_context(self, app, dataset_id, **metadata):
        """Wrapper para processar dataset dentro do contexto da aplicação Flask.
        
        Necessário para threads criadas por ThreadPoolExecutor terem acesso a
        current_app e outros contextos Flask.
        
        Args:
            app: Instância da aplicação Flask
            dataset_id: ID do dataset a processar
            **metadata: Metadados do dataset
        """
        with app.app_context():
            return self.process_dataset(dataset_id, **metadata)
    
    def get_dataset(self, remote_id):
        """Override para otimizar performance desabilitando validação automática.
        
        A validação é cara (queries adicionais, checks) e redundante pois
        já controlamos os dados que inserimos. Desabilitar melhora a velocidade.
        """
        dataset = super().get_dataset(remote_id)
        
        # Guarda o método save original
        original_save = dataset.save
        
        # Cria wrapper que chama save com validate=False
        def save_without_validation(*args, **kwargs):
            # Força validate=False para melhor performance
            kwargs['validate'] = False
            print(f'[DEBUG] Salvando dataset {remote_id} com validate=False')
            return original_save(*args, **kwargs)
        
        # Substitui o método save do dataset
        dataset.save = save_without_validation
        
        return dataset
    
    def _process_dataset_with_context(self, app, dataset_id, **metadata):
        """Wrapper com timing detalhado para diagnóstico."""
        import time
        
        overall_start = time.time()
        timings = {}
        
        with app.app_context():
            # Timing: process_dataset call (inclui tudo do BaseBackend)
            t1 = time.time()
            result = self.process_dataset(dataset_id, **metadata)
            timings['process_dataset_total'] = time.time() - t1
            
        overall_time = time.time() - overall_start
        timings['overall'] = overall_time
        
        # Log detalhado se demorar mais de 2s
        if overall_time > 2.0:
            timing_str = ', '.join([f"{k}={v:.2f}s" for k, v in timings.items()])
            print(f'[SLOW] Dataset {dataset_id}: {timing_str}')
            
        return result
    
    def _fetch_hvd_ids(self):
        """Fetch HVD Indicator IDs from INE XML endpoint."""
        url = "https://www.ine.pt/ine/xml_indic_hvd.jsp?opc=3&lang=PT"
        print(f"[HVD] Fetching HVD IDs from {url}...")
        try:
            # Use existing retry logic
            response = self._make_request_with_retry(url, timeout=30)
            
            # Parse XML
            root = ET.fromstring(response.content)
            ids = set()
            for indicator in root.findall('.//indicator'):
                if 'id' in indicator.attrib:
                    ids.add(indicator.attrib['id'])
            
            print(f"[HVD] Loaded {len(ids)} HVD IDs")
            return ids
        except Exception as e:
            print(f"[HVD] Error fetching HVD IDs: {e}")
            return set()

    def inner_harvest(self):
        import time
        from datetime import datetime
        
        # Carrega IDs HVD dinamicamente no início do harvest
        self.HVD_INDICATOR_IDS = self._fetch_hvd_ids()
        
        harvest_start = time.time()
        print(f"\n{'='*70}")
        print(f"[PERFORMANCE] Início do harvest: {datetime.now()}")
        print(f"{'='*70}\n")
        
        # Função principal para executar o processo de harvest de todos os datasets.
        # Sobrescreve o método da classe BaseBackend.
        
        try:
            # Tenta importar uma lista pré-existente de IDs de datasets (datasetIds)
            # de um módulo chamado ineDatasets.
            from ineDatasets import datasetIds
        except ImportError:
            # Se o módulo não existir, inicializa datasetIds como um set vazio.
            datasetIds = set([])

        # Download para ficheiro temporário para evitar IncompleteRead/Timeouts durante o parsing.
        # O parsing XML em fluxo da rede pode ser interrompido por timeouts.
        
        download_start = time.time()
        print('[PERFORMANCE] A iniciar download do XML...')
        with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
            print('A descarregar XML completo para ficheiro temporário...')
            # Usa retry logic para download com recuperação automática de falhas de conexão
            req = self._make_request_with_retry(self.source.url, stream=True)
            req.raise_for_status() # Verifica se o download foi bem-sucedido (status 200)
            req.raw.decode_content = True
            # Copia o conteúdo da resposta HTTP (o XML) para o ficheiro temporário.
            shutil.copyfileobj(req.raw, tmp_file)
            tmp_path = tmp_file.name # Guarda o caminho do ficheiro temporário.
        # tmp_path = '/tmp/ine.xml' # teste ficheiro local
        download_time = time.time() - download_start
        print(f'[PERFORMANCE] Download concluído em {download_time:.1f}s')
        print(f'Download concluído. A iniciar parsing de {tmp_path}...')

        try:
            parse_start = time.time()
            # Inicia o parsing XML em fluxo (iterparse) a partir do ficheiro temporário.
            # events=('end',) aciona o evento quando a tag final de um elemento é encontrada.
            context = ET.iterparse(tmp_path, events=('end',))
            
            processed_ids = set() # Set para rastrear IDs de datasets processados a partir do XML.
            extracted_items = [] # Lista para armazenar tuplos de (ID, metadados) para processamento posterior.

            for event, elem in context:
                # Itera sobre os elementos à medida que são analisados.
                if elem.tag == 'indicator':
                    # Verifica se o elemento é um indicador (que representa um dataset).
                    if 'id' in elem.attrib:
                        currentId = elem.attrib['id'] # Obtém o ID do indicador/dataset.
                        datasetIds.add(currentId) # Adiciona o ID ao conjunto geral (inclui novos e existentes).
                        
                        # Extrai metadados do elemento 'indicator' imediatamente.
                        metadata = self._extract_metadata(elem)
                        
                        # Guardar o ID e os metadados para processamento posterior.
                        # Isto permite que o parsing XML termine antes de iniciar as requisições
                        # de processamento, evitando bloqueios.
                        extracted_items.append((currentId, metadata))
                        processed_ids.add(currentId) # Marca o ID como processado a partir do XML.
                    
                    # Limpar o elemento para libertar memória imediatamente após o processamento.
                    # Crucial para parsing de ficheiros XML grandes.
                    elem.clear()
            
            parse_time = time.time() - parse_start
            print(f'[PERFORMANCE] Parsing concluído em {parse_time:.1f}s')
            print(f'[PERFORMANCE] Extraídos {len(extracted_items)} datasets do XML')
            
            # Processa os datasets extraídos em paralelo para melhor performance.
            # Usa ThreadPoolExecutor para processar múltiplos datasets simultaneamente.
            # Limitado a 6 workers devido ao overhead do BaseBackend (logging, etc).
            # save_job batching eliminou O(n²), então podemos usar mais workers.
            max_workers = 2  # Balanceado entre performance e estabilidade
            
            # Obtém referência à aplicação Flask antes de criar as threads
            # para que possamos propagar o contexto para cada thread
            app = current_app._get_current_object()
            
            process_start = time.time()
            processed_count = 0
            checkpoint_interval = 10
            
            print(f'A processar {len(extracted_items)} datasets em paralelo (max {max_workers} workers)...')
            
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                # Submete todas as tarefas de processamento com contexto Flask
                futures = {
                    executor.submit(self._process_dataset_with_context, app, currentId, **metadata): currentId
                    for currentId, metadata in extracted_items
                }
                
                # Aguarda conclusão e trata erros individuais
                for future in as_completed(futures):
                    dataset_id = futures[future]
                    try:
                        future.result()  # Levanta exceção se o processamento falhou
                        processed_count += 1
                        
                        # Checkpoint periódico
                        if processed_count % checkpoint_interval == 0:
                            elapsed = time.time() - process_start
                            rate = processed_count / elapsed if elapsed > 0 else 0
                            remaining = (len(extracted_items) - processed_count) / rate if rate > 0 else 0
                            print(f'[CHECKPOINT] {processed_count}/{len(extracted_items)} '
                                  f'({processed_count/len(extracted_items)*100:.1f}%) - '
                                  f'Taxa: {rate:.2f} ds/s - '
                                  f'ETA: {remaining/60:.1f}min')
                    except Exception as e:
                        print(f'Erro ao processar dataset {dataset_id}: {e}')
                        # Continua processando os restantes datasets
            
            process_time = time.time() - process_start
            print(f'[PERFORMANCE] Processamento concluído em {process_time:.1f}s ({process_time/60:.1f}min)')
            
            # Processa quaisquer IDs restantes em datasetIds que NÃO estavam no XML atual.
            # (Útil para datasets que possam ter sido removidos do XML principal,
            # mas ainda existem na lista de IDs pré-existente).
            remaining_ids = [dsId for dsId in datasetIds if dsId not in processed_ids]
            
            if remaining_ids:
                print(f'A processar {len(remaining_ids)} datasets restantes em paralelo...')
                with ThreadPoolExecutor(max_workers=max_workers) as executor:
                    futures = {
                        executor.submit(self._process_dataset_with_context, app, dsId): dsId
                        for dsId in remaining_ids
                    }
                    
                    for future in as_completed(futures):
                        dataset_id = futures[future]
                        try:
                            future.result()
                        except Exception as e:
                            print(f'Erro ao processar dataset restante {dataset_id}: {e}')

        finally:
            # Garantir que o Job é salvo no final (pode haver datasets não salvos do último batch)
            if hasattr(self, 'job') and self.job:
                items_count = len(self.job.items)
                print(f"\n[FINAL_SAVE] Salvando estado final do Job ({items_count} items)...")
                self._original_save_job()  # Força save final
                
            harvest_total_time = time.time() - harvest_start
            print(f"\n{'='*70}")
            print(f"[PERFORMANCE] Harvest concluído!")
            print(f"{'='*70}")
            print(f"Tempo total: {harvest_total_time:.1f}s ({harvest_total_time/60:.1f}min / {harvest_total_time/3600:.1f}h)")
            if hasattr(self, 'job') and self.job:
                total_items = len(self.job.items)
                skipped = sum(1 for item in self.job.items if item.status == 'skipped')
                processed = sum(1 for item in self.job.items if item.status == 'done')
                failed = sum(1 for item in self.job.items if item.status == 'failed')
                
                print(f"Total de items processados: {total_items}")
                print(f"  ├─ Processados: {processed} ({processed/total_items*100:.1f}%)")
                print(f"  ├─ Pulados (sem mudanças): {skipped} ({skipped/total_items*100:.1f}%)")
                print(f"  └─ Falhas: {failed} ({failed/total_items*100:.1f}%)")
            print(f"{'='*70}\n")
            
            # Bloco finally garante que o ficheiro temporário é apagado, mesmo em caso de erro.
            if os.path.exists(tmp_path):
                os.remove(tmp_path)


    def _extract_metadata(self, elem):
        # Método auxiliar (privado) para extrair o título, descrição e tags de um elemento XML 'indicator'.
        
        metadata = {}
        
        # Extrai o título se o elemento 'title' existir.
        if elem.find('title') is not None:
            metadata['title'] = elem.find('title').text

        # Extrai a descrição
        description = ''
        if elem.find('description') is not None:
            description = elem.find('description').text or ''

        # Extrai URL adicional do HTML (bdd_url) e anexa à descrição
        html_node = elem.find('html')
        if html_node is not None:
            bdd_url = html_node.find('bdd_url')
            if bdd_url is not None and bdd_url.text:
                description += "\n " + bdd_url.text
        
        if description:
            metadata['description'] = description

        # Extrai recursos do JSON
        resources_data = []
        json_node = elem.find('json')
        if json_node is not None:
            # json_dataset
            json_dataset = json_node.find('json_dataset')
            if json_dataset is not None and json_dataset.text:
                resources_data.append({
                    'title': 'Dataset json url',
                    'description': 'Dataset em formato json',
                    'url': normalize_url_slashes(json_dataset.text),
                    'filetype': 'remote',
                    'format': 'json'
                })
            # json_metainfo
            json_metainfo = json_node.find('json_metainfo')
            if json_metainfo is not None and json_metainfo.text:
                resources_data.append({
                    'title': 'Json metainfo url',
                    'description': 'Metainfo em formato json',
                    'url': normalize_url_slashes(json_metainfo.text),
                    'filetype': 'remote',
                    'format': 'json'
                })
        
        metadata['resources'] = resources_data
        
        # Extrair metadados dos recursos para comparação (detecção de mudanças)
        # IMPORTANTE: Strip de espaços pois XML pode ter espaços mas MongoDB não
        # NÃO verificamos filesize (requer HTTP request extra, muito lento)
        # Mas verificamos: URL, título, descrição, formato
        metadata['resource_urls'] = [r['url'].strip() for r in resources_data]
        metadata['resource_metadata'] = [
            {
                'url': r['url'].strip(),
                'title': r['title'],
                'description': r['description'],
                'format': r['format']
            }
            for r in resources_data
        ]

        keywords = set() # Set para armazenar keywords únicas (tags).
        
        # Extrai keywords de elementos 'keywords'.
        for kn in elem.findall('keywords'):
            text = kn.text or ''
            if text:
                # Divide o texto das keywords usando vários separadores (;, /, -, |).
                parts = re.split(r'[;,/]|\\s+\\-\\s+|\\s+\\|\\s+', text)
                for p in parts:
                    p = p.strip().strip(',')
                    if p:
                        keywords.add(p.lower()) # Adiciona ao set em minúsculas.
        
        # Extrai temas e subtemas de elementos 'theme' e 'subtheme'.
        for tagname in ('theme', 'subtheme'):
            for tn in elem.findall(tagname):
                val = tn.text
                if val:
                    val = val.strip()
                    if val:
                        keywords.add(val.lower()) # Adiciona ao set em minúsculas.
        
        # Armazena as keywords únicas e ordenadas como 'tags' no dicionário de metadados.
        metadata['tags'] = sorted(keywords)
        
        return metadata
    
    def _normalize_tag(self, tag):
        """Normaliza uma tag para comparar com o formato salvo no MongoDB.
        
        Aplica as mesmas transformações que o MongoDB/udata faz ao salvar:
        1. Remove acentos: índice -> indice, preços -> precos
        2. Remove caracteres especiais: 2021) -> 2021, (teste) -> teste
        3. Remove pontuação: n.º -> n-o, etc.
        4. Substitui espaços por hífens: mercado de trabalho -> mercado-de-trabalho
        5. Lowercase (já feito na extração)
        """
        import unicodedata
        import re
        
        # Remover espaços no início e fim PRIMEIRO
        # Evita: " tag" → "-tag" ou "tag " → "tag-"
        tag = tag.strip()
        
        # Primeiro, substituições explícitas para casos especiais
        # Ordinais º ª podem não decompor corretamente com NFD
        tag = tag.replace('º', 'o').replace('ª', 'a')
        
        # Superscripts: ² ³ → 2 3 (m² → m2)
        tag = tag.replace('²', '2').replace('³', '3').replace('¹', '1')
        
        # Símbolos de moeda: € $ £ → eur usd gbp
        tag = tag.replace('€', 'eur').replace('$', 'usd').replace('£', 'gbp')
        
        # Remove acentos (normalização NFD + remoção de diacríticos)
        # NFD decompõe caracteres acentuados em base + acento separado
        # Categoria 'Mn' (Mark, nonspacing) inclui TODOS os acentos: áéíóú àèìòù âêîôû ãõñ ç etc.
        # índice → indice, preços → precos, comércio → comercio
        nfd = unicodedata.normalize('NFD', tag)
        tag_no_accents = ''.join(char for char in nfd if unicodedata.category(char) != 'Mn')
        
        # Remove caracteres especiais: ), (, etc.
        # 2021) -> 2021, (teste) -> teste
        tag_no_special = re.sub(r'[()\[\]{}]', '', tag_no_accents)
        
        # Remove pontuação (exceto ponto que vira hífen)
        # n.o -> n-o (ponto vira hífen)
        # Primeiro substitui pontos por hífens
        tag_dots_to_hyphen = tag_no_special.replace('.', '-')
        # Depois remove outra pontuação
        tag_no_punct = re.sub(r'[,;:!?"\'`]', '', tag_dots_to_hyphen)
        
        # Substitui espaços por hífens
        tag_normalized = tag_no_punct.replace(' ', '-')
        
        return tag_normalized
    
    def _has_changed(self, dataset, new_metadata, remote_id=None):
        """Verifica se o dataset mudou comparando com os novos metadados.
        
        Retorna True se o dataset é novo ou se algum campo mudou.
        Retorna False se o dataset existe e está idêntico.
        
        Args:
            dataset: Objeto Dataset do MongoDB
            new_metadata: Metadados extraídos do XML
            remote_id: ID remoto do dataset (para verificar lista HVD)
        """
        # Dataset novo sempre processa
        if not dataset.id:
            print(f'[CHANGE_DEBUG] {dataset.slug or "?"}: NOVO (sem ID)')
            return True
        
        # Comparar título
        old_title = dataset.title or ''
        new_title = new_metadata.get('title', '')
        if old_title != new_title:
            print(f'[CHANGE_DEBUG] {dataset.slug}: Título mudou')
            print(f'  Antigo: "{old_title[:50]}..."')
            print(f'  Novo:   "{new_title[:50]}..."')
            return True
        
        # Comparar descrição
        current_desc = dataset.description or ''
        new_desc = new_metadata.get('description', '')
        if current_desc != new_desc:
            print(f'[CHANGE_DEBUG] {dataset.slug}: Descrição mudou (len: {len(current_desc)} -> {len(new_desc)})')
            return True
        
        # Comparar tags (como sets)
        # IMPORTANTE: Tags precisam ser normalizadas para comparar corretamente
        # - Tags do XML têm espaços e acentos: "mercado de trabalho", "índice"
        # - Tags no MongoDB são: "mercado-de-trabalho", "indice" (sem acentos, hífens)
        # - Sempre adiciona "ine-pt" ao salvar
        current_tags = set(dataset.tags or [])
        
        # Normalizar tags novas (remover acentos, espaços -> hífens, adicionar ine-pt)
        raw_tags = new_metadata.get('tags', [])
        normalized_new_tags = set()
        for tag in raw_tags:
            normalized_tag = self._normalize_tag(tag)
            normalized_new_tags.add(normalized_tag)
        
        # Adicionar 'ine-pt' que é sempre adicionado durante o save
        if 'ine-pt' not in normalized_new_tags:
            normalized_new_tags.add('ine-pt')
        
        # Adicionar tags HVD se o dataset estiver na lista HVD
        # (para comparar corretamente com o que será salvo)
        if remote_id and remote_id in self.HVD_INDICATOR_IDS:
            normalized_new_tags.add('estatisticas')
            normalized_new_tags.add('hvd')
        
        if current_tags != normalized_new_tags:
            added = normalized_new_tags - current_tags
            removed = current_tags - normalized_new_tags
            print(f'[CHANGE_DEBUG] {dataset.slug}: Tags mudaram')
            if added:
                print(f'  Adicionadas: {list(added)[:3]}')
            if removed:
                print(f'  Removidas: {list(removed)[:3]}')
            return True
        
        # Comparar recursos (URLs e metadados)
        # Verifica se URLs mudaram OU se metadados dos recursos mudaram
        current_urls = {r.url for r in dataset.resources}
        new_urls = set(new_metadata.get('resource_urls', []))
        
        if current_urls != new_urls:
            added = new_urls - current_urls
            removed = current_urls - new_urls
            print(f'[CHANGE_DEBUG] {dataset.slug}: URLs dos recursos mudaram')
            if added:
                print(f'  Adicionadas: {list(added)[:2]}')
            if removed:
                print(f'  Removidas: {list(removed)[:2]}')
            return True
        
        # Comparar metadados dos recursos (título, descrição, formato)
        # Cria assinatura dos recursos para comparação
        current_resource_sig = {
            (r.url, r.title or '', r.description or '', r.format or '')
            for r in dataset.resources
        }
        new_resource_sig = {
            (rm['url'], rm['title'], rm['description'], rm['format'])
            for rm in new_metadata.get('resource_metadata', [])
        }
        
        if current_resource_sig != new_resource_sig:
            print(f'[CHANGE_DEBUG] {dataset.slug}: Metadados dos recursos mudaram')
            print(f'  (título, descrição ou formato diferente)')
            return True
        
        # Sem mudanças detectadas
        print(f'[CHANGE_DEBUG] {dataset.slug}: SEM MUDANÇAS!')
        return False

    def inner_process_dataset(self, item: HarvestItem, **kwargs):
        import time
        from udata.harvest.exceptions import HarvestSkipException
        
        timings = {}
        method_start = time.time()
        
        # Função para processar um dataset individual (item de harvest).
        # Sobrescreve o método da classe BaseBackend.
        
        # Rastreamento para diagnóstico
        if not hasattr(self, '_cached_count'):
            self._cached_count = 0
            self._fallback_count = 0
            self._skip_count = 0  # Contador de datasets pulados
        
        # Timing: get_dataset
        t1 = time.time()
        dataset = self.get_dataset(item.remote_id)
        timings['get_dataset'] = time.time() - t1
        
        # ====== DETECÇÃO DE MUDANÇAS (Harvest Incremental) ======
        # Verificar se dataset já existe e se mudou
        if 'tags' in kwargs:  # Só compara se temos metadados do XML
            if not self._has_changed(dataset, kwargs, item.remote_id):
                # Dataset existe e não mudou - SKIP!
                self._skip_count += 1
                if self._skip_count <= 5:  # Log apenas os primeiros 5 skips
                    print(f'[SKIP] Dataset {item.remote_id} (sem mudanças, skip #{self._skip_count})')
                raise HarvestSkipException("sem mudanças nos metadados")
        
        # Timing: população de dados
        t2 = time.time()
        # Define valores por defeito para o dataset.
        dataset.license = License.guess('cc-by') # Licença Creative Commons Atribuição.
        dataset.resources = [] # Inicializa a lista de recursos.
        dataset.frequency = 'unknown' # Define a frequência como desconhecida por defeito.
        timings['populate_defaults'] = time.time() - t2

        # Verificar se os metadados foram passados via kwargs (otimização "Parse Once").
        if 'tags' in kwargs:
            self._cached_count += 1
            # Temos metadados! Aplica os metadados extraídos previamente no inner_harvest.
            if self._cached_count <= 5:  # Log apenas os primeiros 5
                print(f'[CACHED] Dataset {item.remote_id} (cache #{self._cached_count})')
            print(f'A processar metadados para {item.remote_id} (em cache)')
            # Define tags: APENAS do XML + 'ine-pt' (nada mais!)
            xml_tags = kwargs['tags'] or []
            dataset.tags = xml_tags + ['ine-pt'] if 'ine-pt' not in xml_tags else xml_tags
            
            # Adicionar tags HVD se o indicator ID estiver na lista
            if item.remote_id in self.HVD_INDICATOR_IDS:
                if 'estatisticas' not in dataset.tags:
                    dataset.tags.append('estatisticas')
                if 'hvd' not in dataset.tags:
                    dataset.tags.append('hvd')
            
            if 'title' in kwargs:
                dataset.title = kwargs['title']
            if 'description' in kwargs:
                dataset.description = kwargs['description']
            
            if 'resources' in kwargs:
                for res_data in kwargs['resources']:
                    dataset.resources.append(Resource(**res_data))
            
            # Garante que a tag 'ine.pt' está presente.
            if 'ine.pt' not in dataset.tags:
                dataset.tags.append('ine.pt')
            
            timings['total_method'] = time.time() - method_start
            
            # Log se demorou mais de 1s
            if timings['total_method'] > 1.0:
                timing_str = ', '.join([f"{k}={v:.3f}s" for k, v in sorted(timings.items())])
                print(f'[TIMING] inner_process {item.remote_id}: {timing_str}')
            
            return dataset

        # Fallback: Se os metadados não foram fornecidos (kwargs vazios),
        # é necessário fazer download individual do XML para obter as informações.
        self._fallback_count += 1
        print(f'[FALLBACK] Dataset {item.remote_id} requer download (fallback #{self._fallback_count})')
        print(f'A obter metadados para {item.remote_id} (a fazer download)')
        
        base_url = self.source.url # URL base do endpoint XML.
        parsed = urlparse(base_url)
        qs = parse_qs(parsed.query) # Analisa a string de query existente.

        # Garante que o parâmetro 'lang' é 'PT'.
        if 'lang' not in qs or not qs['lang']:
            qs['lang'] = ['PT']

        # Adiciona ou atualiza o parâmetro 'varcd' com o ID do dataset.
        qs['varcd'] = [str(item.remote_id)]

        # Reconstrói a string de query e a URL final com o ID do dataset.
        new_query = urlencode({k: v[0] for k, v in qs.items()})
        final_url = urlunparse(parsed._replace(query=new_query))

        # Faz a requisição HTTP para a URL específica do dataset com retry logic.
        req = self._make_request_with_retry(final_url, headers={'charset': 'utf8'}, stream=True)
        req.raw.decode_content = True

        target = None # Variável para armazenar o elemento 'indicator' encontrado.
        
        # Análise em fluxo para encontrar apenas o indicador específico.
        context = ET.iterparse(req.raw, events=('end',))
        for event, elem in context:
            if elem.tag == 'indicator':
                if elem.get('id') == str(item.remote_id):
                    # Encontrou o indicador, guarda o elemento e interrompe a iteração.
                    target = elem
                    break
                else:
                    # Limpa outros elementos 'indicator' para libertar memória.
                    elem.clear()
        
        # Se o elemento 'indicator' foi encontrado (target não é None).
        if target:
            # Extrai os metadados do elemento.
            metadata = self._extract_metadata(target)
            # Define tags: APENAS do XML + 'ine-pt' (nada mais!)
            xml_tags = metadata.get('tags', [])
            dataset.tags = xml_tags + ['ine-pt'] if 'ine-pt' not in xml_tags else xml_tags
            
            # Adicionar tags HVD se o indicator ID estiver na lista
            if item.remote_id in self.HVD_INDICATOR_IDS:
                if 'estatisticas' not in dataset.tags:
                    dataset.tags.append('estatisticas')
                if 'hvd' not in dataset.tags:
                    dataset.tags.append('hvd')
            
            if 'title' in metadata:
                dataset.title = metadata['title']
            if 'description' in metadata:
                dataset.description = metadata['description']
            
            if 'resources' in metadata:
                for res_data in metadata['resources']:
                    dataset.resources.append(Resource(**res_data))
            target.clear() # Limpa o elemento target após a extração.
        else:
            dataset.tags = [] # Se não encontrou, define tags como vazias.

        # Garante que a tag 'ine.pt' está presente.
        if 'ine.pt' not in dataset.tags:
            dataset.tags.append('ine.pt')

        return dataset