# Mapa de Campos: OpenDataSoft PT para uData Database

Este documento mapeia os campos obtidos do harvester `OdsBackendPT` (OpenDataSoft API) para os campos da tabela/coleção `datasets` na base de dados do uData (modelo `Dataset`).

## Fonte de Dados

**API OpenDataSoft**: Plataforma OpenDataSoft

- Endpoint: `{source_url}/api/datasets/1.0/search/`
- Protocolo: REST API JSON
- Paginação: 50 registos por página
- Parâmetros:
  - `start` - Offset de paginação
  - `rows` - Número de registos por página
  - `interopmetas` - Incluir metadados de interoperabilidade
  - `refine.{facet}` - Filtro inclusivo
  - `exclude.{facet}` - Filtro exclusivo

## Resumo do Mapeamento

| Campo Fonte (ODS API)               | Propriedade JSON                   | Campo Destino (uData `Dataset`)                          | Notas / Lógica                                     |
| :---------------------------------- | :--------------------------------- | :------------------------------------------------------- | :------------------------------------------------- |
| **Dataset**                         |                                    |                                                          |                                                    |
| `datasetid`                         | `dataset['datasetid']`             | `remote_id` (HarvestItem)                                | ID único do dataset no ODS.                        |
| `metas.title`                       | `ods_metadata['title']`            | `title`                                                  | Título do dataset.                                 |
| `metas.description`                 | `ods_metadata['description']`      | `description`                                            | Descrição (HTML parseado).                         |
| `metas.publisher`                   | `ods_metadata['publisher']`        | `organization.acronym`                                   | Cria/associa organização.                          |
| `metas.keyword`                     | `ods_metadata['keyword']`          | `tags`                                                   | Keywords (lista ou string).                        |
| `metas.theme`                       | `ods_metadata['theme']`            | `tags`                                                   | Temas (divididos por vírgula).                     |
| -                                   | -                                  | `tags`                                                   | Adiciona hostname da fonte.                        |
| `metas.license`                     | `ods_metadata['license']`          | `license`                                                | Mapeamento de licenças ODS.                        |
| -                                   | -                                  | `frequency`                                              | Fixo: `'unknown'`.                                 |
| -                                   | -                                  | `private`                                                | Fixo: `False`.                                     |
| `has_records`                       | `ods_dataset['has_records']`       | -                                                        | Validação (skip se False).                         |
| `interop_metas.inspire`             | `ods_interopmetas['inspire']`      | -                                                        | Validação (skip se presente e feature desativada). |
| `metas.modified`                    | `ods_metadata['modified']`         | `resources[].modified`, `dataset.last_modified_internal` | Data de modificação dos recursos e dataset.        |
| `metas.records_count`               | `ods_metadata['records_count']`    | -                                                        | Determina se exporta Shapefile.                    |
| **Extras**                          |                                    |                                                          |                                                    |
| -                                   | -                                  | `extras['ods:url']`                                      | URL de exploração do dataset.                      |
| -                                   | -                                  | `extras['harvest:name']`                                 | Nome da fonte de harvest.                          |
| `metas.references`                  | `ods_metadata['references']`       | `extras['ods:references']`                               | Referências do dataset.                            |
| `has_records`                       | `ods_dataset['has_records']`       | `extras['ods:has_records']`                              | Indica se tem registos.                            |
| `features`                          | `'geo' in ods_dataset['features']` | `extras['ods:geo']`                                      | Indica se tem dados geográficos.                   |
| **Resource (Exports)**              |                                    |                                                          |                                                    |
| -                                   | Download URL                       | `url`                                                    | URL de download do export.                         |
| -                                   | -                                  | `title`                                                  | "Export to {format}".                              |
| `fields`                            | `data['fields']`                   | `description`                                            | Schema dos campos.                                 |
| -                                   | -                                  | `filetype`                                               | Fixo: `'remote'`.                                  |
| -                                   | -                                  | `format`                                                 | Formato do export (csv, json, etc.).               |
| -                                   | -                                  | `mime`                                                   | MIME type do formato.                              |
| `metas.modified`                    | `ods_metadata['modified']`         | `modified`                                               | Data de modificação.                               |
| -                                   | -                                  | `extras['ods:type']`                                     | Fixo: `'api'`.                                     |
| **Resource (Extra Files)**          |                                    |                                                          |                                                    |
| `alternative_exports[].id`          | `export['id']`                     | -                                                        | ID do ficheiro extra.                              |
| `alternative_exports[].title`       | `export['title']`                  | `title`                                                  | Título do ficheiro.                                |
| `alternative_exports[].description` | `export['description']`            | `description`                                            | Descrição do ficheiro.                             |
| `alternative_exports[].mimetype`    | `export['mimetype']`               | `format` / `mime`                                        | Tipo de ficheiro.                                  |
| `alternative_exports[].url`         | `export['url']`                    | -                                                        | URL original (não usado).                          |
| -                                   | -                                  | `extras['ods:type']`                                     | `'alternative_export'` ou `'attachment'`.          |

## Detalhes Específicos

### 1. Paginação

O harvester processa datasets em lotes de 50:

```python
params = {
    'start': count,
    'rows': 50,
    'interopmetas': 'true',
}
```

### 2. Filtros

Suporta filtros configuráveis mapeados para facets ODS:

```python
FILTERS = {
    'tags': 'keyword',
    'publisher': 'publisher',
}
```

**Tipos de filtro:**

- `refine.{facet}` - Inclusivo (apenas datasets com este valor)
- `exclude.{facet}` - Exclusivo (exclui datasets com este valor)

### 3. Validações

#### 3.1 Skip se Sem Registos

```python
if not ods_dataset.get('has_records'):
    raise HarvestSkipException('Dataset has no record')
```

#### 3.2 Skip INSPIRE (Opcional)

Se a feature `inspire` não estiver ativada:

```python
if 'inspire' in ods_interopmetas and not self.has_feature('inspire'):
    raise HarvestSkipException('Dataset has INSPIRE metadata')
```

### 4. Organização

Cria automaticamente organizações se não existirem:

```python
organization_acronym = ods_metadata['publisher']
orgObj = Organization.objects(acronym=organization_acronym).first()
if orgObj:
    dataset.organization = orgObj
else:
    orgObj = Organization()
    orgObj.acronym = organization_acronym
    orgObj.name = organization_acronym
    orgObj.description = organization_acronym
    orgObj.save()
    dataset.organization = orgObj
```

### 5. Tags

#### 5.1 Keywords

Suporta lista ou string única:

```python
if isinstance(ods_metadata['keyword'], list):
    tags |= set(ods_metadata['keyword'])
else:
    tags.add(ods_metadata['keyword'])
```

#### 5.2 Themes

Temas são divididos por vírgula e convertidos para lowercase:

```python
if isinstance(ods_metadata['theme'], list):
    for theme in ods_metadata['theme']:
        tags.update([t.strip().lower() for t in theme.split(',')])
else:
    themes = ods_metadata['theme'].split(',')
    tags.update([t.strip().lower() for t in themes])
```

#### 5.3 Hostname

Adiciona o hostname da fonte:

```python
dataset.tags.append(urlparse(self.source.url).hostname)
```

### 6. Licenças

Mapeamento de licenças ODS para uData:

```python
LICENSES = {
    'Open Database License (ODbL)': 'odc-odbl',
    'Licence Ouverte (Etalab)': 'fr-lo',
    'Licence ouverte / Open Licence': 'fr-lo',
    'CC BY-SA': 'cc-by-sa',
    'Public Domain': 'other-pd'
}

dataset.license = License.guess(
    license_id,
    self.LICENSES.get(license_id),
    default=default_license
)
```

### 7. Recursos (Resources)

#### 7.1 Exports Standard

Sempre cria recursos para CSV e JSON:

```python
self.process_resources(dataset, ods_dataset, ('csv', 'json'))
```

#### 7.2 Exports Geográficos

Se o dataset tem dados geográficos:

```python
if 'geo' in ods_dataset['features']:
    exports = ['geojson']
    if ods_metadata['records_count'] <= SHAPEFILE_RECORDS_LIMIT:
        exports.append('shp')
    self.process_resources(dataset, ods_dataset, exports)
```

**Limite Shapefile:** 50.000 registos (acima disto, o export seria parcial)

#### 7.3 Formatos Suportados

```python
FORMATS = {
    'csv': ('CSV', 'csv', 'text/csv'),
    'geojson': ('GeoJSON', 'json', 'application/vnd.geo+json'),
    'json': ('JSON', 'json', 'application/json'),
    'shp': ('Shapefile', 'shp', None),
}
```

#### 7.4 URL de Download

```python
url = '{explore_url}download?format={format}&timezone=Europe/Berlin&use_labels_for_header=true'
```

#### 7.5 Descrição do Recurso

Construída a partir dos campos do dataset:

```python
def description_from_fields(fields):
    out = ''
    for field in fields:
        out += '- *{label}*: {name}[{type}]'
        if field.get('description'):
            out += ' {description}'
        out += '\n'
    return out
```

**Exemplo:**

```
- *Nome*: name[text] Nome completo
- *Idade*: age[int] Idade em anos
- *Localização*: location[geo_point_2d]
```

### 8. Ficheiros Extra

#### 8.1 Alternative Exports

Ficheiros de export alternativos fornecidos pelo publisher:

```python
self.process_extra_files(dataset, ods_dataset, 'alternative_export')
```

#### 8.2 Attachments

Ficheiros anexos ao dataset:

```python
self.process_extra_files(dataset, ods_dataset, 'attachment')
```

#### 8.3 URL de Ficheiros Extra

```python
url = '{source_url}/api/datasets/1.0/{dataset_id}/{plural_type}/{file_id}'
```

### 9. Detecção de Formato e MIME Type

```python
def guess_format(mimetype, url=None):
    ext = mimetypes.guess_extension(mimetype)
    if not ext and url:
        parts = os.path.splitext(url)
        ext = parts[1] if parts[1] else None
    return ext[1:] if ext and ext.startswith('.') else ext

def guess_mimetype(mimetype, url=None):
    if mimetype in mimetypes.types_map.values():
        return mimetype
    elif url:
        mime, encoding = mimetypes.guess_type(url)
        return mime
```

## Exemplo de Mapeamento

### Resposta ODS API (simplificado)

```json
{
  "nhits": 150,
  "datasets": [
    {
      "datasetid": "dados-covid-19",
      "has_records": true,
      "features": ["geo"],
      "metas": {
        "title": "Dados COVID-19 Portugal",
        "description": "<p>Dados diários sobre COVID-19</p>",
        "publisher": "dgs",
        "keyword": ["covid", "saúde", "epidemiologia"],
        "theme": "Saúde, Sociedade",
        "license": "Licence Ouverte (Etalab)",
        "modified": "2024-01-15T10:30:00Z",
        "records_count": 1500,
        "references": "https://covid19.min-saude.pt"
      },
      "fields": [
        { "name": "data", "label": "Data", "type": "date" },
        {
          "name": "casos",
          "label": "Casos",
          "type": "int",
          "description": "Número de casos"
        }
      ]
    }
  ]
}
```

### Dataset uData resultante

```python
dataset.title = "Dados COVID-19 Portugal"
dataset.description = "Dados diários sobre COVID-19"
dataset.organization = Organization(acronym="dgs", name="dgs")
dataset.tags = ["covid", "saúde", "epidemiologia", "saúde", "sociedade", "example.opendatasoft.com"]
dataset.license = License('fr-lo')
dataset.frequency = 'unknown'
dataset.private = False

dataset.extras = {
    'ods:url': 'https://example.opendatasoft.com/explore/dataset/dados-covid-19/',
    'harvest:name': 'Nome da Fonte ODS',
    'ods:references': 'https://covid19.min-saude.pt',
    'ods:has_records': True,
    'ods:geo': True
}

dataset.resources = [
    # Exports standard
    Resource(
        title="Export to CSV",
        url="https://example.opendatasoft.com/explore/dataset/dados-covid-19/download?format=csv&...",
        description="- *Data*: data[date]\n- *Casos*: casos[int] Número de casos\n",
        filetype="remote",
        format="csv",
        mime="text/csv",
        modified=datetime(2024, 1, 15, 10, 30, 0),
        extras={'ods:type': 'api'}
    ),
    Resource(
        title="Export to JSON",
        url="https://example.opendatasoft.com/explore/dataset/dados-covid-19/download?format=json&...",
        description="- *Data*: data[date]\n- *Casos*: casos[int] Número de casos\n",
        filetype="remote",
        format="json",
        mime="application/json",
        modified=datetime(2024, 1, 15, 10, 30, 0),
        extras={'ods:type': 'api'}
    ),
    # Exports geográficos (porque 'geo' in features)
    Resource(
        title="Export to GeoJSON",
        url="https://example.opendatasoft.com/explore/dataset/dados-covid-19/download?format=geojson&...",
        filetype="remote",
        format="json",
        mime="application/vnd.geo+json",
        extras={'ods:type': 'api'}
    )
    # Shapefile não incluído se records_count > 50000
]
```

## Particularidades

1. **SSL Verification**: Desativada por padrão (`verify_ssl = False`)
2. **Descrição como Schema**: A descrição dos recursos lista os campos do dataset
3. **Múltiplos tipos de recursos**: Exports API, alternative exports, attachments
4. **Limite de Shapefile**: Não exporta se mais de 50.000 registos
5. **Timezone fixo**: Usa `Europe/Berlin` nos exports
6. **Labels nos headers**: `use_labels_for_header=true` nos exports CSV
7. **Detecção automática de geo**: Cria exports geográficos se `'geo' in features`
8. **Feature INSPIRE**: Pode ser configurado para skip datasets INSPIRE
