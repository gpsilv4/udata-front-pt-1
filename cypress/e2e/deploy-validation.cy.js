/**
 * ============================================================================
 * E2E Test Suite — Validação Core do udata-front-pt
 * ============================================================================
 *
 * Cenários prioritários após deploy em teste/produção:
 *   1. Healthcheck & Disponibilidade
 *   2. Pesquisa de Dados (Search Engine)
 *   3. Navegação de Catálogo (Datasets & Organizações)
 *   4. Internacionalização (i18n) — Textos em Português
 *   5. Persistência de Ficheiros (FS) — Broken Images Check
 *   6. Download de Recursos — Validação de acessibilidade
 *
 * Requisito: Todos os serviços devem responder em menos de 5 segundos.
 * (Nota: O timeout de teste é superior para evitar falsos negativos por latência de rede).
 *
 * NOTA: Todos os testes usam cy.visit() (browser real) em vez de cy.request()
 *       para evitar bloqueios de WAF/Firewall em ambientes de pré-produção.
 *
 * ─── Ambientes disponíveis ───────────────────────────────────────────────────
 *   PRD  → https://dados.gov.pt
 *   PRR  → https://preprod.dados.gov.pt
 *   PPR  → https://preprod.dados.gov.pt  (alias de PRR)
 *   TST  → http://10.55.37.38
 *   DEV  → http://172.31.204.12
 *
 * ─── Execução ────────────────────────────────────────────────────────────────
 *   # Ambiente PRR (default):
 *   npx cypress run --spec "cypress/e2e/deploy-validation.cy.js"
 *
 *   # Outros ambientes:
 *   CYPRESS_ENV=PRD npx cypress run --spec "cypress/e2e/deploy-validation.cy.js"
 *   CYPRESS_ENV=TST npx cypress run --spec "cypress/e2e/deploy-validation.cy.js"
 *   CYPRESS_ENV=DEV npx cypress run --spec "cypress/e2e/deploy-validation.cy.js"
 *   CYPRESS_ENV=PPR npx cypress run --spec "cypress/e2e/deploy-validation.cy.js"
 */

const RESPONSE_TIMEOUT = 10000; // 10 segundos (margem para ambientes lentos)

// ─── Informação do Ambiente ──────────────────────────────────────────────────
const TARGET_ENV = Cypress.env("TARGET_ENV") || "???";
const TARGET_URL = Cypress.env("TARGET_URL") || Cypress.config("baseUrl");

before(() => {
  cy.log(`🌐 Ambiente: ${TARGET_ENV} → ${TARGET_URL}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. HEALTHCHECK & DISPONIBILIDADE
// ─────────────────────────────────────────────────────────────────────────────
describe(`1. Healthcheck & Disponibilidade [${TARGET_ENV}]`, () => {
  it("Home Page carrega com sucesso", () => {
    cy.visit("/", {
      timeout: RESPONSE_TIMEOUT,
      failOnStatusCode: false,
    }).then(() => {
      cy.get("body", { timeout: RESPONSE_TIMEOUT }).should("be.visible");
    });
    cy.on("fail", (err) => {
      throw new Error(
        `❌ Home Page não carregou em ${TARGET_ENV} (${TARGET_URL}).\n` +
          `   CAUSA: O servidor pode estar em baixo ou inacessível.\n` +
          `   RESOLUÇÃO: Verificar se o serviço está ativo: curl -I ${TARGET_URL}\n` +
          `   Erro original: ${err.message}`,
      );
    });
  });

  it('Título contém "dados.gov" ou "uData"', () => {
    cy.visit("/", { timeout: RESPONSE_TIMEOUT });
    cy.title().then((title) => {
      expect(
        title,
        `❌ Título da página: "${title}".\n` +
          `   CAUSA: O título não contém "dados.gov" nem "uData". ` +
          `Possível página de erro ou configuração de SITE_TITLE incorreta.\n` +
          `   RESOLUÇÃO: Verificar SITE_TITLE em udata.cfg ou variáveis de ambiente.`,
      ).to.match(/dados\.gov|uData/i);
    });
  });

  it("Exibe o elemento <h1> visível", () => {
    cy.visit("/", { timeout: RESPONSE_TIMEOUT });
    cy.get("body").then(($body) => {
      const h1 = $body.find("h1");
      expect(
        h1.length,
        `❌ Nenhum <h1> encontrado na Home Page.\n` +
          `   CAUSA: O template pode não estar a renderizar corretamente ` +
          `ou o Vue/JS não inicializou.\n` +
          `   RESOLUÇÃO: Inspecionar a resposta HTML em ${TARGET_URL} e ` +
          `verificar se os assets JS estão a carregar.`,
      ).to.be.greaterThan(0);

      expect(
        h1.first().is(":visible"),
        `❌ O <h1> existe mas não está visível.\n` +
          `   CAUSA: CSS pode estar a esconder o elemento (display:none, visibility:hidden).\n` +
          `   RESOLUÇÃO: Inspecionar o <h1> no DevTools e verificar estilos aplicados.`,
      ).to.be.true;
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PESQUISA DE DADOS (Search Engine)
// ─────────────────────────────────────────────────────────────────────────────
describe(`2. Pesquisa de Dados [${TARGET_ENV}]`, () => {
  const SEARCH_SELECTOR =
    'input[type="search"], input[name="q"], input[data-cy="search-input"]';

  beforeEach(() => {
    cy.visit("/", { timeout: RESPONSE_TIMEOUT });
    cy.get("body", { timeout: RESPONSE_TIMEOUT }).should("be.visible");
  });

  it("Barra de pesquisa é visível e funcional", () => {
    cy.get("body").then(($body) => {
      const inputs = $body.find(SEARCH_SELECTOR);
      expect(
        inputs.length,
        `❌ Nenhum campo de pesquisa encontrado na Home Page.\n` +
          `   CAUSA: O componente de pesquisa Vue pode não ter renderizado ` +
          `(JS não carregou) ou o seletor mudou.\n` +
          `   RESOLUÇÃO:\n` +
          `   1. Verificar se os ficheiros JS carregam sem erros na consola.\n` +
          `   2. Inspecionar o DOM para encontrar o input de pesquisa atual.\n` +
          `   3. Atualizar o seletor no teste se necessário.`,
      ).to.be.greaterThan(0);
    });

    cy.get(SEARCH_SELECTOR, { timeout: RESPONSE_TIMEOUT })
      .first()
      .should("be.visible");
  });

  it("Digitar um termo mostra resultados", () => {
    cy.get(SEARCH_SELECTOR, { timeout: RESPONSE_TIMEOUT })
      .first()
      .type("dados");

    const RESULTS_SELECTOR =
      '[role="listbox"], [role="menu"], .search-results, .autocomplete, [id*="listbox"]';

    cy.get("body").then(($body) => {
      // Dar tempo ao autocomplete para responder
      cy.wait(2000);
      cy.get("body").then(($bodyAfter) => {
        const results = $bodyAfter.find(RESULTS_SELECTOR);
        expect(
          results.length,
          `❌ Nenhum dropdown de resultados apareceu após pesquisar "dados".\n` +
            `   CAUSA PROVÁVEL:\n` +
            `   - A API de pesquisa (Elasticsearch/search-service) pode estar em baixo.\n` +
            `   - O componente de autocomplete pode ter um seletor diferente.\n` +
            `   RESOLUÇÃO:\n` +
            `   1. Testar a API: curl "${TARGET_URL}/api/1/datasets/?q=dados"\n` +
            `   2. Verificar a consola do browser para erros de rede.\n` +
            `   3. Inspecionar o DOM para o seletor correto do dropdown.`,
        ).to.be.greaterThan(0);
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. NAVEGAÇÃO DE CATÁLOGO (Datasets & Organizações)
// ─────────────────────────────────────────────────────────────────────────────
describe(`3. Navegação de Catálogo [${TARGET_ENV}]`, () => {
  const CARD_SELECTOR =
    '.dataset-card, article, [data-cy="dataset-card"], .card';
  const ORG_CARD_SELECTOR =
    '.organization-card, article, [data-cy="organization-card"], .card';

  it("Página /datasets carrega e exibe título", () => {
    cy.visit("/datasets", { timeout: RESPONSE_TIMEOUT });
    cy.get("body").then(($body) => {
      const h1 = $body.find("h1");
      expect(
        h1.length,
        `❌ Página /datasets não tem <h1>.\n` +
          `   CAUSA: O template de listagem pode não ter renderizado.\n` +
          `   RESOLUÇÃO: Verificar se ${TARGET_URL}/datasets responde correctamente.`,
      ).to.be.greaterThan(0);
    });
  });

  it("Página /datasets exibe lista de items", () => {
    cy.visit("/datasets", { timeout: RESPONSE_TIMEOUT });
    cy.get("body").then(($body) => {
      const cards = $body.find(CARD_SELECTOR);
      expect(
        cards.length,
        `❌ Nenhum dataset card encontrado em /datasets.\n` +
          `   CAUSA:\n` +
          `   - A base de dados pode estar vazia (sem datasets).\n` +
          `   - O MongoDB pode estar inacessível.\n` +
          `   - O componente Vue pode não ter renderizado.\n` +
          `   RESOLUÇÃO:\n` +
          `   1. Verificar a API: curl "${TARGET_URL}/api/1/datasets/"\n` +
          `   2. Confirmar conectividade MongoDB.\n` +
          `   3. Verificar se existem datasets na base: udata datasets list`,
      ).to.be.greaterThan(0);
    });
  });

  it("Página /organizations carrega e exibe título", () => {
    cy.visit("/organizations", { timeout: RESPONSE_TIMEOUT });
    cy.get("h1", { timeout: RESPONSE_TIMEOUT }).should("be.visible");
  });

  it("Página /organizations exibe lista de organizações", () => {
    cy.visit("/organizations", { timeout: RESPONSE_TIMEOUT });
    cy.get("body").then(($body) => {
      const cards = $body.find(ORG_CARD_SELECTOR);
      expect(
        cards.length,
        `❌ Nenhuma organização encontrada em /organizations.\n` +
          `   CAUSA: Base de dados sem organizações ou MongoDB inacessível.\n` +
          `   RESOLUÇÃO:\n` +
          `   1. Verificar a API: curl "${TARGET_URL}/api/1/organizations/"\n` +
          `   2. Criar uma organização de teste se a base estiver vazia.`,
      ).to.be.greaterThan(0);
    });
  });

  it("Cards de datasets contêm metadados (título, descrição ou data)", () => {
    cy.visit("/datasets", { timeout: RESPONSE_TIMEOUT });
    cy.get(CARD_SELECTOR, { timeout: RESPONSE_TIMEOUT })
      .first()
      .should(($card) => {
        const text = $card.text().trim();
        expect(
          text.length,
          `❌ O primeiro card de dataset não tem conteúdo textual.\n` +
            `   CAUSA: Os metadados do dataset (título, descrição) podem estar vazios.\n` +
            `   RESOLUÇÃO: Verificar o dataset na API e garantir que tem título preenchido.`,
        ).to.be.greaterThan(0);
      });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. INTERNACIONALIZAÇÃO (i18n) — Textos em Português
// ─────────────────────────────────────────────────────────────────────────────
describe(`4. Internacionalização (i18n) [${TARGET_ENV}]`, () => {
  beforeEach(() => {
    cy.visit("/", { timeout: RESPONSE_TIMEOUT });
  });

  it('Página contém atributo lang="pt" no HTML', () => {
    cy.get("html").then(($html) => {
      const lang = $html.attr("lang") || "";
      expect(
        lang,
        `❌ Atributo lang="${lang}" não começa com "pt".\n` +
          `   CAUSA: O DEFAULT_LANGUAGE pode estar configurado para outro idioma.\n` +
          `   RESOLUÇÃO: Verificar DEFAULT_LANGUAGE em udata.cfg (deve ser "pt").`,
      ).to.match(/^pt/);
    });
  });

  it("Textos da interface estão em Português", () => {
    cy.get("body").then(($body) => {
      const bodyText = $body.text().toLowerCase();
      const ptTerms = [
        "dados",
        "pesquisar",
        "organizações",
        "conjuntos de dados",
        "reutilizações",
      ];
      const foundTerms = ptTerms.filter((term) => bodyText.includes(term));
      const missingTerms = ptTerms.filter((term) => !bodyText.includes(term));

      expect(
        foundTerms.length,
        `❌ Apenas ${foundTerms.length}/5 termos PT encontrados.\n` +
          `   Encontrados: [${foundTerms.join(", ")}]\n` +
          `   Em falta: [${missingTerms.join(", ")}]\n` +
          `   CAUSA: Ficheiros de tradução (i18n) podem estar em falta ou o idioma ` +
          `padrão não é "pt".\n` +
          `   RESOLUÇÃO:\n` +
          `   1. Verificar DEFAULT_LANGUAGE em udata.cfg.\n` +
          `   2. Verificar se os ficheiros de tradução PT estão incluídos no build.`,
      ).to.be.greaterThan(1);
    });
  });

  it("Título da página está em Português", () => {
    cy.title().then((title) => {
      expect(
        title,
        `❌ Título "${title}" não contém palavras-chave PT (dados/plataforma/abertos).\n` +
          `   CAUSA: SITE_TITLE em udata.cfg pode não estar em Português.\n` +
          `   RESOLUÇÃO: Verificar o valor de SITE_TITLE na configuração.`,
      ).to.match(/dados|plataforma|abertos/i);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. PERSISTÊNCIA DE FICHEIROS (FS) — Broken Images Check
// ─────────────────────────────────────────────────────────────────────────────
describe(`5. Persistência de Ficheiros (FS) [${TARGET_ENV}]`, () => {
  it("Home Page não tem imagens partidas", () => {
    cy.visit("/", { timeout: RESPONSE_TIMEOUT });
    cy.wait(2000);
    cy.checkBrokenImages();
  });

  it("Página /datasets não tem imagens partidas", () => {
    cy.visit("/datasets", { timeout: RESPONSE_TIMEOUT });
    cy.wait(2000);
    cy.checkBrokenImages();
  });

  it("Página /organizations não tem imagens partidas", () => {
    cy.visit("/organizations", { timeout: RESPONSE_TIMEOUT });
    cy.wait(2000);
    cy.checkBrokenImages();
  });

  it("Recursos estáticos do volume FS são servidos corretamente (/s/)", () => {
    cy.visit("/datasets", { timeout: RESPONSE_TIMEOUT });
    cy.wait(2000);

    cy.get("body").then(($body) => {
      const fsImages = $body.find('img[src*="/s/"]');

      if (fsImages.length > 0) {
        cy.wrap(fsImages).each(($img) => {
          const src = $img.attr("src");
          cy.wrap($img).should(($el) => {
            expect(
              $el[0].naturalWidth,
              `❌ Imagem FS partida: ${src}\n` +
                `   CAUSA: O ficheiro não existe no volume FS ou o path está ` +
                `incorreto.\n` +
                `   RESOLUÇÃO:\n` +
                `   1. Verificar se o ficheiro existe: ls -la $FS_ROOT/${src.replace("/s/", "")}\n` +
                `   2. Verificar a configuração FS_ROOT e FS_PREFIX em udata.cfg.\n` +
                `   3. Confirmar que o volume está montado corretamente.`,
            ).to.be.greaterThan(0);
          });
        });
      } else {
        cy.log(
          "⚠️ Nenhuma imagem com prefixo /s/ encontrada na página /datasets. " +
            "Isto pode ser normal se não existirem logos de organizações carregados.",
        );
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. DOWNLOAD DE RECURSOS
// ─────────────────────────────────────────────────────────────────────────────
describe(`6. Download de Recursos [${TARGET_ENV}]`, () => {
  it("Página de dataset contém links de download acessíveis", () => {
    // 1. Visitar a página de datasets
    cy.visit("/datasets", { timeout: RESPONSE_TIMEOUT });

    // 2. Encontrar o primeiro link para uma página de dataset e navegar
    cy.get("body").then(($body) => {
      const datasetLinks = $body.find('a[href*="/datasets/"]');
      expect(
        datasetLinks.length,
        `❌ Nenhum link para dataset encontrado em /datasets.\n` +
          `   CAUSA: A página de listagem pode estar vazia.\n` +
          `   RESOLUÇÃO: Verificar a API: curl "${TARGET_URL}/api/1/datasets/"`,
      ).to.be.greaterThan(0);
    });

    cy.get('a[href*="/datasets/"]', { timeout: RESPONSE_TIMEOUT })
      .first()
      .invoke("attr", "href")
      .then((datasetHref) => {
        cy.log(`📂 Navegando para dataset: ${datasetHref}`);
        cy.visit(datasetHref, { timeout: RESPONSE_TIMEOUT });
      });

    // 3. Aguardar que os componentes Vue renderizem os recursos
    cy.wait(3000);

    // 4. Verificar links de download.
    //    Estratégia: Tentar primeiro 'a.matomo_download' (ficheiros rastreados pelo Matomo).
    //    Se não encontrar, tentar 'a[download]' (ficheiros genéricos).
    //    A classe matomo_download é aplicada APENAS a recursos do tipo ficheiro,
    //    NÃO a URLs externos nem a serviços OGC (WMS/WFS).
    cy.get("body").then(($body) => {
      const matomoLinks = $body.find("a.matomo_download");
      const downloadLinks = $body.find("a[download]");
      const anyResourceLink = $body.find(
        "a.matomo_download, a[download], a.fr-icon-download-line, a.fr-icon-external-link-line",
      );

      if (matomoLinks.length > 0) {
        // Caso ideal: ficheiro com rastreio Matomo
        cy.wrap(matomoLinks.first()).then(($link) => {
          const href = $link.attr("href");
          expect(
            href,
            `❌ Link matomo_download encontrado mas sem href.\n` +
              `   RESOLUÇÃO: Verificar o template ResourceAccordion.vue.`,
          ).to.exist.and.not.be.empty;

          expect(
            href,
            `❌ href "${href}" não é um URL válido.\n` +
              `   CAUSA: O resource.latest pode estar mal configurado.\n` +
              `   RESOLUÇÃO: Verificar o recurso na API e o valor de "latest".`,
          ).to.match(/^https?:\/\/|^\//);

          cy.log(`✅ Link de download (matomo_download): ${href}`);
        });
      } else if (downloadLinks.length > 0) {
        // Fallback: link com atributo download
        cy.wrap(downloadLinks.first()).then(($link) => {
          const href = $link.attr("href");
          expect(href).to.exist.and.not.be.empty;
          cy.log(
            `⚠️ Link de download encontrado via a[download] (sem classe matomo_download): ${href}`,
          );
        });
      } else if (anyResourceLink.length > 0) {
        // Os recursos existem mas são todos URLs externos ou serviços OGC
        cy.log(
          `⚠️ Neste dataset, todos os recursos são URLs externos ou serviços OGC ` +
            `(nenhum ficheiro para download direto). Encontrados ${anyResourceLink.length} links de recursos.`,
        );
      } else {
        // Falha real: nenhum recurso encontrado
        throw new Error(
          `❌ Nenhum link de recurso encontrado neste dataset.\n` +
            `   CAUSA PROVÁVEL:\n` +
            `   - O dataset pode não ter recursos associados.\n` +
            `   - Os componentes Vue podem não ter renderizado (verificar JS na consola).\n` +
            `   - Em ambiente ${TARGET_ENV}, os dados podem ser diferentes de produção.\n` +
            `   RESOLUÇÃO:\n` +
            `   1. Verificar recursos do dataset na API.\n` +
            `   2. Garantir que o dataset tem pelo menos um ficheiro (não URL) para ` +
            `que a classe matomo_download seja aplicada.\n` +
            `   3. Verificar se os assets JS carregam sem erros.`,
        );
      }
    });
  });
});
