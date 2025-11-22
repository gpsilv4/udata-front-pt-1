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

from udata.harvest.models import HarvestItem
from .tools.harvester_utils import normalize_url_slashes

class INEBackend(BaseBackend):
    display_name = 'Instituto nacional de estatística'

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

    def inner_harvest(self):
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
        with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
            print('A descarregar XML completo para ficheiro temporário...')
            req = requests.get(self.source.url, stream=True, timeout=300)
            req.raise_for_status() # Verifica se o download foi bem-sucedido (status 200)
            req.raw.decode_content = True
            # Copia o conteúdo da resposta HTTP (o XML) para o ficheiro temporário.
            shutil.copyfileobj(req.raw, tmp_file)
            tmp_path = tmp_file.name # Guarda o caminho do ficheiro temporário.
        
        print(f'Download concluído. A iniciar parsing de {tmp_path}...')

        try:
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
            
            # Processa os datasets extraídos em paralelo para melhor performance.
            # Usa ThreadPoolExecutor para processar múltiplos datasets simultaneamente.
            # IMPORTANTE: Número limitado de workers (3) para evitar contenção no MongoDB.
            # Mais workers podem causar erros de chave duplicada e degradação de performance.
            max_workers = 2  # Número de threads paralelas (balanceado entre velocidade e estabilidade)
            
            # Obtém referência à aplicação Flask antes de criar as threads
            # para que possamos propagar o contexto para cada thread
            app = current_app._get_current_object()
            
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
                    except Exception as e:
                        print(f'Erro ao processar dataset {dataset_id}: {e}')
                        # Continua processando os restantes datasets
            
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

    def inner_process_dataset(self, item: HarvestItem, **kwargs):
        # Função para processar um dataset individual (item de harvest).
        # Sobrescreve o método da classe BaseBackend.
        
        dataset = self.get_dataset(item.remote_id) # Obtém ou cria o objeto Dataset no udata.
        
        # Define valores por defeito para o dataset.
        dataset.license = License.guess('cc-by') # Licença Creative Commons Atribuição.
        dataset.resources = [] # Inicializa a lista de recursos.
        dataset.frequency = 'unknown' # Define a frequência como desconhecida por defeito.

        # Verificar se os metadados foram passados via kwargs (otimização "Parse Once").
        if 'tags' in kwargs:
            # Temos metadados! Aplica os metadados extraídos previamente no inner_harvest.
            print(f'A processar metadados para {item.remote_id} (em cache)')
            dataset.tags = kwargs['tags']
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
            return dataset

        # Fallback: Se os metadados não foram fornecidos (kwargs vazios),
        # é necessário fazer download individual do XML para obter as informações.
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

        # Faz a requisição HTTP para a URL específica do dataset.
        req = requests.get(final_url, headers={'charset': 'utf8'}, stream=True)
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
            dataset.tags = metadata.get('tags', [])
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