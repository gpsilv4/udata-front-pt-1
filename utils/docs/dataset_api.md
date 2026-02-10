# Dataset API Documentation

Esta documentação descreve os endpoints e modelos de dados relacionados com `Dataset` na API do uData, conforme extraído da documentação técnica oficial do portal.

## Endpoints

### 1. Listar ou pesquisar datasets

- **URL:** `GET /datasets/`
- **Descrição:** Retorna uma lista paginada de datasets. Suporta filtragem e pesquisa avançada.
- **Parâmetros de Consulta (Query):**
  - `q` (string): Termo de pesquisa.
  - `sort` (string): Campo de ordenação. Opções: `title`, `created`, `last_update`, `reuses`, `followers`, `views`.
  - `page` (integer): Número da página (padrão: 1).
  - `page_size` (integer): Itens por página (padrão: 20).
  - `tag` (string): Filtrar por etiqueta.
  - `license` (string): Filtrar por licença.
  - `featured` (boolean): Filtrar por datasets destacados.
  - `geozone` (string): Filtrar por zona geográfica.
  - `granularity` (string): Filtrar por granularidade territorial.
  - `temporal_coverage` (string): Filtrar por cobertura temporal.
  - `organization` (string): Filtrar pelo slug da organização.
  - `owner` (string): Filtrar pelo slug do proprietário.
  - `archived` (boolean): Filtrar por estado de arquivo.
  - `deleted` (boolean): Filtrar por estado de remoção.
  - `private` (boolean): Filtrar por datasets privados.

### 2. Criar um novo dataset

- **URL:** `POST /datasets/`
- **Descrição:** Submete um novo dataset para a plataforma. Requer autenticação.

### 3. Listar emblemas (badges) disponíveis

- **URL:** `GET /datasets/badges/`
- **Descrição:** Retorna a lista de todos os emblemas disponíveis e os seus rótulos.

---

## Modelo de Dados: Dataset

O objeto Dataset representa uma coleção de recursos e os seus metadados associados.

### Campos Principais

| Campo                 | Tipo     | Descrição                                                                                                                                                                              |
| :-------------------- | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | string   | Identificador único do dataset.                                                                                                                                                        |
| `title`               | string   | Título do dataset.                                                                                                                                                                     |
| `description`         | string   | Descrição do dataset em formato Markdown.                                                                                                                                              |
| `acronym`             | string   | Acrónimo opcional.                                                                                                                                                                     |
| `slug`                | string   | Identificador amigável para URLs (permalink).                                                                                                                                          |
| `uri`                 | string   | URI da API para o dataset.                                                                                                                                                             |
| `page`                | string   | URL público da página do dataset no portal.                                                                                                                                            |
| `created_at`          | datetime | **Calculado:** Data de criação, priorizando dados de harvest ou data de criação interna.                                                                                               |
| **`last_modified`**   | datetime | **Calculado:** Data da última modificação. Prioriza `harvest.modified_at` ou `last_modified_internal` do MongoDB.                                                                      |
| **`last_update`**     | datetime | **Calculado/Agregado:** Reflete a data de modificação mais recente entre todos os recursos associados. Se não houver recursos, assume o valor de `last_modified`.                      |
| **`internal`**        | object   | **Agrupamento Virtual:** Contém metadados de controlo interno (ex: `created_at_internal`, `last_modified_internal`). No MongoDB, estes campos estão na raiz, mas a API agrupa-os aqui. |
| `frequency`           | string   | Frequência de atualização esperada (ex: `daily`, `monthly`, `unknown`).                                                                                                                |
| `frequency_date`      | datetime | Próxima data de atualização esperada.                                                                                                                                                  |
| `license`             | string   | Licença sob a qual o dataset é publicado.                                                                                                                                              |
| `organization`        | object   | Metadados da organização proprietária.                                                                                                                                                 |
| `owner`               | object   | Metadados do utilizador proprietário.                                                                                                                                                  |
| `private`             | boolean  | Indica se o dataset é privado.                                                                                                                                                         |
| `featured`            | boolean  | Indica se o dataset está em destaque.                                                                                                                                                  |
| `tags`                | array    | Lista de etiquetas/keywords.                                                                                                                                                           |
| `metrics`             | object   | Métricas de engajamento (`views`, `reuses`, `followers`).                                                                                                                              |
| `resources`           | array    | Lista de recursos (ficheiros ou links) pertencentes ao dataset.                                                                                                                        |
| `community_resources` | array    | Recursos contribuídos pela comunidade.                                                                                                                                                 |
| `spatial`             | object   | Metadados de cobertura espacial/geográfica.                                                                                                                                            |
| `temporal_coverage`   | object   | Cobertura temporal (datas de início e fim).                                                                                                                                            |
| `badges`              | array    | Lista de emblemas associados (ex: "Oficial").                                                                                                                                          |
| `extras`              | object   | Pares chave-valor para metadados adicionais não padrão.                                                                                                                                |

---

## Notas Técnicas sobre Datas

1.  **Mapeamento MongoDB vs API:** O objeto `internal` visto na API é uma construção do backend. Na base de dados MongoDB, deve procurar pelos campos `created_at_internal` e `last_modified_internal` diretamente na raiz do documento.
2.  **Dinamismo do `last_update`:** Este campo não é estático. Ele é recalculado dinamicamente agregando as datas de modificação de todos os recursos filhos, garantindo que o utilizador saiba exatamente quando houve a última alteração real no conteúdo.
