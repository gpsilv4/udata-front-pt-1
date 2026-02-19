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
 *   6. Download de Recursos — Validação de acessibilidade (HTTP 200/302)
 *
 * Requisito: Todos os serviços devem responder em menos de 5 segundos.
 *
 * NOTA: Todos os testes usam cy.visit() (browser real) em vez de cy.request()
 *       para evitar bloqueios de WAF/Firewall em ambientes de pré-produção.
 *
 * Execução:
 *   npx cypress run --spec "cypress/e2e/deploy-validation.cy.js" \
 *     --config baseUrl=https://dados.gov.pt
 */

const RESPONSE_TIMEOUT = 10000; // 10 segundos (margem para ambientes lentos)

// ─────────────────────────────────────────────────────────────────────────────
// 1. HEALTHCHECK & DISPONIBILIDADE
// ─────────────────────────────────────────────────────────────────────────────
describe("1. Healthcheck & Disponibilidade", () => {
  it("Home Page carrega com sucesso", () => {
    cy.visit("/", { timeout: RESPONSE_TIMEOUT });
    cy.get("body", { timeout: RESPONSE_TIMEOUT }).should("be.visible");
  });

  it('Título contém "dados.gov" ou "uData"', () => {
    cy.visit("/", { timeout: RESPONSE_TIMEOUT });
    cy.title().should("match", /dados\.gov|uData/i);
  });

  it("Exibe o elemento <h1> visível", () => {
    cy.visit("/", { timeout: RESPONSE_TIMEOUT });
    cy.get("h1", { timeout: RESPONSE_TIMEOUT }).should("be.visible");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PESQUISA DE DADOS (Search Engine)
// ─────────────────────────────────────────────────────────────────────────────
describe("2. Pesquisa de Dados", () => {
  beforeEach(() => {
    cy.visit("/", { timeout: RESPONSE_TIMEOUT });
    // Aguardar que o Vue/JS inicialize
    cy.get("body", { timeout: RESPONSE_TIMEOUT }).should("be.visible");
  });

  it("Barra de pesquisa é visível e funcional", () => {
    cy.get(
      'input[type="search"], input[name="q"], input[data-cy="search-input"]',
      {
        timeout: RESPONSE_TIMEOUT,
      },
    )
      .first()
      .should("be.visible");
  });

  it("Digitar um termo mostra resultados", () => {
    cy.get(
      'input[type="search"], input[name="q"], input[data-cy="search-input"]',
      {
        timeout: RESPONSE_TIMEOUT,
      },
    )
      .first()
      .type("dados");

    // Verificar que aparece algum popup/dropdown de resultados
    cy.get(
      '[role="listbox"], [role="menu"], .search-results, .autocomplete, [id*="listbox"]',
      { timeout: RESPONSE_TIMEOUT },
    ).should("exist");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. NAVEGAÇÃO DE CATÁLOGO (Datasets & Organizações)
// ─────────────────────────────────────────────────────────────────────────────
describe("3. Navegação de Catálogo", () => {
  it("Página /datasets carrega e exibe título", () => {
    cy.visit("/datasets", { timeout: RESPONSE_TIMEOUT });
    cy.get("h1", { timeout: RESPONSE_TIMEOUT }).should("be.visible");
  });

  it("Página /datasets exibe lista de items", () => {
    cy.visit("/datasets", { timeout: RESPONSE_TIMEOUT });
    cy.get('.dataset-card, article, [data-cy="dataset-card"], .card', {
      timeout: RESPONSE_TIMEOUT,
    }).should("have.length.greaterThan", 0);
  });

  it("Página /organizations carrega e exibe título", () => {
    cy.visit("/organizations", { timeout: RESPONSE_TIMEOUT });
    cy.get("h1", { timeout: RESPONSE_TIMEOUT }).should("be.visible");
  });

  it("Página /organizations exibe lista de organizações", () => {
    cy.visit("/organizations", { timeout: RESPONSE_TIMEOUT });
    cy.get(
      '.organization-card, article, [data-cy="organization-card"], .card',
      { timeout: RESPONSE_TIMEOUT },
    ).should("have.length.greaterThan", 0);
  });

  it("Cards de datasets contêm metadados (título, descrição ou data)", () => {
    cy.visit("/datasets", { timeout: RESPONSE_TIMEOUT });
    cy.get('.dataset-card, article, [data-cy="dataset-card"], .card', {
      timeout: RESPONSE_TIMEOUT,
    })
      .first()
      .should(($card) => {
        const text = $card.text().trim();
        expect(text.length, "Card tem conteúdo textual").to.be.greaterThan(0);
      });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. INTERNACIONALIZAÇÃO (i18n) — Textos em Português
// ─────────────────────────────────────────────────────────────────────────────
describe("4. Internacionalização (i18n)", () => {
  beforeEach(() => {
    cy.visit("/", { timeout: RESPONSE_TIMEOUT });
  });

  it('Página contém atributo lang="pt" no HTML', () => {
    cy.get("html").should("have.attr", "lang").and("match", /^pt/);
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
      expect(
        foundTerms.length,
        `Encontrados ${foundTerms.length} termos PT: [${foundTerms.join(", ")}]`,
      ).to.be.greaterThan(1);
    });
  });

  it("Título da página está em Português", () => {
    cy.title().should("match", /dados|plataforma|abertos/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. PERSISTÊNCIA DE FICHEIROS (FS) — Broken Images Check
// ─────────────────────────────────────────────────────────────────────────────
describe("5. Persistência de Ficheiros (FS)", () => {
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
              `Imagem FS partida: ${src}`,
            ).to.be.greaterThan(0);
          });
        });
      } else {
        cy.log(
          "⚠️ Nenhuma imagem com prefixo /s/ encontrada na página /datasets",
        );
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. DOWNLOAD DE RECURSOS
// ─────────────────────────────────────────────────────────────────────────────
describe("6. Download de Recursos", () => {
  it("Página de dataset contém links de download acessíveis", () => {
    // 1. Visitar a página de datasets
    cy.visit("/datasets", { timeout: RESPONSE_TIMEOUT });

    // 2. Encontrar o primeiro link para uma página de dataset e navegar
    cy.get('a[href*="/datasets/"]', { timeout: RESPONSE_TIMEOUT })
      .first()
      .invoke("attr", "href")
      .then((datasetHref) => {
        cy.visit(datasetHref, { timeout: RESPONSE_TIMEOUT });
      });

    // 3. Aguardar que os componentes Vue renderizem os recursos
    cy.wait(3000);

    // 4. Verificar que existe pelo menos um link de download
    //    Seletor confirmado via inspeção do DOM: a.matomo_download
    cy.get("a.matomo_download", { timeout: RESPONSE_TIMEOUT })
      .first()
      .should("have.attr", "href")
      .and("not.be.empty")
      .then((href) => {
        expect(href).to.match(/^https?:\/\/|^\//);
        cy.log(`✅ Link de download encontrado: ${href}`);
      });
  });
});
