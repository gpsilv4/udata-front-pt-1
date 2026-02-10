# Mapeamento: Interface (display.html) vs Base de Dados (MongoDB)

Este documento descreve a relação entre os campos visualizados na página de detalhes do dataset (`display.html`) e os campos correspondentes na coleção `dataset` da base de dados MongoDB do uData.

## 1. Informação Principal e Cabeçalho

| Campo na Interface | Variável no Template  | Campo no MongoDB (Coleção `dataset`) | Observações                             |
| :----------------- | :-------------------- | :----------------------------------- | :-------------------------------------- |
| Título do Dataset  | `dataset.title`       | `title`                              |                                         |
| Acrónimo           | `dataset.acronym`     | `acronym`                            | Opcional                                |
| Descrição          | `dataset.description` | `description`                        | Conteúdo em formato Markdown            |
| Tag "Rascunho"     | `dataset.private`     | `private`                            | Booleano                                |
| Tag "Eliminado"    | `dataset.deleted`     | `deleted`                            | Data/hora de eliminação (null se ativo) |
| Tag "Arquivado"    | `dataset.archived`    | `archived`                           | Booleano                                |

## 2. Produtor e Atribuições (Sidebar)

| Campo na Interface     | Variável no Template     | Campo no MongoDB (Coleção `dataset`)     | Observações                                             |
| :--------------------- | :----------------------- | :--------------------------------------- | :------------------------------------------------------ |
| Produtor (Nome/Logo)   | `dataset.organization`   | `organization`                           | DBRef para a coleção `organization`                     |
| Autor (Nome/Logo)      | `dataset.owner`          | `owner`                                  | DBRef para a coleção `user`                             |
| Atribuições            | `dataset.contact_points` | `contact_points`                         | Lista de Contactos (pode ser referência ou embebido)    |
| Última atualização     | `dataset.last_update`    | `resources.last_modified_internal` (máx) | Calculado dinamicamente com base nos recursos           |
| Data de Modificação    | `dataset.last_modified`  | `last_modified_internal`                 | Campo `last_modified_internal` ou `harvest.modified_at` |
| Licença                | `dataset.license`        | `license`                                | Slug/ID da licença (referência interna)                 |
| Pontuação de Qualidade | `dataset.quality`        | `quality`                                | Objeto de métricas de qualidade                         |

## 3. Navegação (Tabs)

| Tab                    | Variável de Contagem                    | Origem dos Dados                                           |
| :--------------------- | :-------------------------------------- | :--------------------------------------------------------- |
| Ficheiros              | `dataset.resources \| length`           | Campo `resources` (lista de objetos embebidos)             |
| Reutilizações          | `total_reuses`                          | Consulta à coleção `reuse` onde o dataset ID está presente |
| Discussões             | `dataset.metrics.discussions`           | Agregado no objeto `metrics`                               |
| Recursos da Comunidade | `dataset.community_resources \| length` | Campo `community_resources` (lista de objetos embebidos)   |

## 4. Separador "Informação" (Metadados Detalhados)

| Campo na Interface | Variável no Template        | Campo no MongoDB (Coleção `dataset`)        | Observações                                             |
| :----------------- | :-------------------------- | :------------------------------------------ | :------------------------------------------------------ |
| Etiquetas (Tags)   | `dataset.tags`              | `tags`                                      | Array de strings                                        |
| Identificador (ID) | `dataset.id`                | `_id`                                       | Identificador único (ObjectId)                          |
| Fonte Remota       | `external_source(dataset)`  | `extras.remote_url` ou `harvest.remote_url` | Geralmente extraído de `extras` ou metadados de harvest |
| Criação            | `dataset.created_at`        | `created_at_internal`                       | Data de criação original (pode ser do harvest)          |
| Frequência         | `dataset.frequency`         | `frequency`                                 | Slug da frequência (ex: `daily`, `monthly`)             |
| Cobertura Temporal | `dataset.temporal_coverage` | `temporal_coverage`                         | Objeto com `start` e `end`                              |
| Cobertura Espacial | `dataset.spatial`           | `spatial`                                   | Contém `zones`, `geom` (GeoJSON) e `granularity`        |
| Esquema de Dados   | `resource.schema`           | `resources.schema`                          | Metadados de validação aplicados aos recursos           |
| Extras             | `dataset.extras`            | `extras`                                    | Dicionário de metadados arbitrários (Key/Value)         |
| Dados de Harvest   | `dataset.harvest`           | `harvest`                                   | Metadados técnicos do processo de colheita              |

---

## Notas Técnicas

1.  **Campos `_internal`:** Muitos campos de data (como criação e modificação) possuem o sufixo `_internal` no MongoDB para distinguir a data real da fonte (origem) da data de registo no portal.
2.  **Coleções Relacionadas:**
    - `organization`: Onde residem os detalhes do produtor.
    - `user`: Onde residem os detalhes do autor/proprietário.
    - `reuse`: Coleção separada vinculada pelo ID do dataset.
    - `discussion`: Coleção separada que gere os tópicos de conversa.
3.  **Campos Dinâmicos:** Campos como `last_update` não existem fisicamente como um único campo no MongoDB; são o resultado de agregações ou lógicas de backend (como encontrar a data mais recente entre todos os recursos do dataset).
