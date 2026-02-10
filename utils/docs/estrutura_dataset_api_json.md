# Estrutura do Dataset no JSON da API vs MongoDB

Esta documentação explica a discrepância entre os dados retornados pela API (e.g., `GET /api/1/datasets/...`) e a estrutura de dados armazenada no MongoDB para o uData.

## O Campo `internal`

No retorno JSON da API, existe um objeto chamado `internal` que agrupa metadados de controlo. No entanto, se consultar a base de dados MongoDB diretamente, este objeto **não existe**.

### 1. Na Base de Dados (MongoDB)

No MongoDB, os dados "internos" não estão dentro de um objeto chamado `internal`. Eles estão gravados diretamente na raiz do documento (no caso do dataset) ou na raiz de cada objeto de recurso, com nomes específicos que terminam em `_internal`.

Os campos mais comuns que o MongoDB guarda são:

- `created_at_internal`
- `last_modified_internal`

### 2. No Response da API

A API do uData (baseada em Flask-RESTX) agrupa estes campos num único objeto virtual chamado `internal`. Isto é feito na camada de serialização (schemas) para organizar a resposta e facilitar o consumo por parte do frontend.

#### Exemplo de Mapeamento:

| JSON API (`internal`)             | MongoDB (Campo Real)     |
| :-------------------------------- | :----------------------- |
| `internal.created_at_internal`    | `created_at_internal`    |
| `internal.last_modified_internal` | `last_modified_internal` |

---

## Por que esta distinção existe?

O uData separa os metadados para distinguir o que é gestão do portal do que é informação da fonte original:

- **Datas "Públicas" (`created_at`, `last_modified`):** Datas calculadas ou geridas pelo portal uData.
- **Datas "Internas" (`_internal`):** Datas que vêm da fonte original (através dos Harvesters). Elas representam quando os dados foram efetivamente criados ou alterados na origem (por exemplo, num CKAN externo).

## Campos Calculados: `last_modified` e `last_update`

Além do objeto `internal`, existem campos como `last_modified` (na raiz) e `last_update` que aparecem na API mas podem não existir de forma fixa no MongoDB.

### 1. `last_modified` (O Campo Inteligente)

Este campo é uma **propriedade dinâmica** calculada pelo uData. Ele tenta sempre mostrar a data de modificação mais relevante.

- **Lógica de Cálculo:**
  1.  Se o dataset for fruto de uma harvest (Harvest), usa o campo `harvest.modified_at`.
  2.  Caso contrário, utiliza o valor do campo `last_modified_internal`.
- **No MongoDB:** Deve procurar por `last_modified_internal` ou inspecionar o objeto `harvest`.

### 2. `last_update` (O Campo Agregado)

O `last_update` é o campo mais "virtual" de todos. Ele representa a data em que o dataset recebeu dados novos pela última vez, tendo em conta todos os seus recursos.

- **Lógica de Cálculo:**
  1.  O uData percorre todos os **recursos** no array `resources`.
  2.  Identifica a data `last_modified` (ou `last_modified_internal`) mais recente entre todos eles.
  3.  Se o dataset não tiver recursos, o `last_update` será igual ao `last_modified` do próprio dataset.
- **No MongoDB:** Este campo normalmente **não existe gravado**. Se precisar de o consultar via Mongo, terá de fazer uma agregação para encontrar o valor máximo dos recursos.

#### Comparação de Origens:

| Campo API       | Origem provável no MongoDB                        | Natureza            |
| :-------------- | :------------------------------------------------ | :------------------ |
| `last_modified` | `last_modified_internal` OU `harvest.modified_at` | Virtual (Calculado) |
| `last_update`   | `max(resources.last_modified_internal)`           | Virtual (Agregado)  |

---

## Como validar no MongoDB?

Para encontrar ou simular estes valores via linha de comandos:

### Validar `last_modified` (simples):

```javascript
db.dataset.findOne(
  { _id: ObjectId("67f7b690c2198a2b4801d621") },
  { last_modified_internal: 1, "harvest.modified_at": 1 },
);
```

### Simular `last_update` (agregação):

```javascript
db.dataset.aggregate([
  { $match: { _id: ObjectId("67f7b690c2198a2b4801d621") } },
  {
    $project: {
      title: 1,
      last_update_simulado: { $max: "$resources.last_modified_internal" },
    },
  },
]);
```

---

## Conclusão

A estrutura que vê na API é uma representação enriquecida dos dados. O uData faz o "trabalho pesado" de calcular e organizar estas datas no momento em que gera o JSON para garantir que o utilizador tem sempre a informação mais relevante, mesmo que os dados brutos no MongoDB estejam dispersos ou guardados com nomes técnicos (como os sufixos `_internal`).
