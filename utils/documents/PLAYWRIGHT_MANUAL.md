# Guia de Execução — Playwright Smoke Tests

Este documento descreve as diversas formas de executar os testes de fumo (smoke tests) do projecto, os ambientes disponíveis e onde encontrar os resultados.

## 1. Comandos de Execução (NPM)

Existem atalhos configurados no `package.json` para facilitar a execução nos diferentes ambientes:

| Ambiente                  | Comando                  | Descrição                                               |
| :------------------------ | :----------------------- | :------------------------------------------------------ |
| **Produção (PRD)**        | `npm run test:smoke`     | Executa em https://dados.gov.pt                         |
| **Pré-produção (PPR)**    | `npm run test:smoke:ppr` | Executa em https://preprod.dados.gov.pt                 |
| **Teste (TST)**           | `npm run test:smoke:tst` | Executa no ambiente interno de testes                   |
| **Desenvolvimento (DEV)** | `npm run test:smoke:dev` | Executa no ambiente de desenvolvimento                  |
| **Modo Gráfico (UI)**     | `npm run test:smoke:ui`  | Abre a interface visual do Playwright (PRD por defeito) |

---

## 2. Modo Gráfico e Debug

Para depurar testes ou ver a execução passo-a-passo:

### Interface UI (Recomendado)

Abre uma janela interactiva onde pode ver o DOM, logs de rede e snapshots de cada passo.

```bash
# Para Produção
npm run test:smoke:ui

# Para outro ambiente (ex: TST)
TARGET_ENV=TST npx playwright test --ui
```

### Visualizar Relatório HTML

Após a execução dos testes, pode abrir o relatório detalhado gerado:

```bash
npx playwright show-report
```

---

## 3. Estrutura de Resultados e Artifacts

Os resultados dos testes são guardados em duas diretorias principais:

| Diretoria            | Conteúdo                                                                                                                      |
| :------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| `playwright-report/` | Contém o **Relatório HTML** completo. Abra o `index.html` para ver os resultados.                                             |
| `test-results/`      | Contém os **Artifacts** de cada teste que falhou:                                                                             |
|                      | - `test-failed-1.png`: Captura de ecrã (Screenshot) no momento do erro.                                                       |
|                      | - `trace.zip`: Gravação detalhada (Trace) que pode ser aberta no report ou via `npx playwright show-trace path/to/trace.zip`. |

> **Nota:** Estas diretorias estão ignoradas no `.git` para evitar poluir o repositório.

---

## 4. Variáveis de Ambiente Úteis

Pode customizar a execução passando variáveis de ambiente antes do comando:

- `TARGET_ENV`: Define o ambiente (`PRD`, `PPR`, `TST`, `DEV`).
- `TEST_RESET_EMAIL`: Define o email usado no teste de recuperação de password.
  - _Exemplo:_ `TEST_RESET_EMAIL=meu-email@teste.pt npm run test:smoke`

---

## 5. Exemplos Avançados

**Executar apenas um ficheiro específico em TST:**

```bash
TARGET_ENV=TST npx playwright test tests/smoke/smoke-post-deploy.spec.ts
```

**Executar um teste específico pelo nome (ex: apenas Search):**

```bash
npm run test:smoke -- -g "Pesquisa"
```
