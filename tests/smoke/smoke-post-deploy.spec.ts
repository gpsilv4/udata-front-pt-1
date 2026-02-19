/**
 * ============================================================================
 * Playwright Smoke Tests — Validação Pós-Deploy em Produção (PRD)
 * ============================================================================
 *
 * Cenários cobertos:
 *   1. Home Page carrega com HTTP 200
 *   2. Pesquisa — resultados da base de dados aparecem
 *   3. Download de recurso de um dataset
 *   4. Integridade de assets (imagens e CSS)
 *   5. Redefinição de palavra-passe
 *   6. Organizações — listagem carrega e contém cards
 *   7. Reutilizações — listagem carrega e contém cards
 *   8. API REST — endpoints respondem com JSON válido
 *   9. Navegação — links internos (nav + footer) acessíveis
 *  10. Dashboard / Estatísticas — página carrega com indicadores
 *  11. Páginas estáticas — Sobre, Termos, Acessibilidade, etc.
 *  12. Formulário de Contacto — página renderiza com campos
 *
 * ─── Propagação de Erro (Bubble-Up) ─────────────────────────────────────────
 *
 *   Usa APENAS expect() (hard assert) dentro de test.step().
 *   Quando expect() falha:
 *
 *     expect() lança excepção
 *       └→ test.step() captura internamente → marca step ❌ → re-lança
 *         └→ Teste recebe excepção → teste ❌
 *
 *   Resultado: falha em 3 níveis (subitem ❌ / step ❌ / teste ❌).
 *   Zero try/catch. Zero wrappers. Zero expect.soft().
 *
 * ─── Execução ────────────────────────────────────────────────────────────────
 *   TARGET_ENV=PRD npx playwright test --config playwright.config.ts
 *   TARGET_ENV=PPR npx playwright test --config playwright.config.ts
 *   TARGET_ENV=TST npx playwright test --config playwright.config.ts
 *   TARGET_ENV=DEV npx playwright test --config playwright.config.ts
 *   TARGET_ENV=LOCAL npx playwright test --config playwright.config.ts
 *
 * ─── Ambientes ───────────────────────────────────────────────────────────────
 *   PRD → https://dados.gov.pt
 *   PPR → https://preprod.dados.gov.pt
 *   TST → http://10.55.37.38
 *   DEV → http://172.31.204.12
 *   LOCAL → http://dev.local:7000
 * ============================================================================
 */

import { test, expect, Page, Response } from "@playwright/test";

// ─── Constantes ──────────────────────────────────────────────────────────────

const TARGET_ENV = (process.env.TARGET_ENV || "PRD").toUpperCase();

const SEARCH_INPUT =
  'input[type="search"], input[name="q"], input[data-cy="search-input"]';

const SEARCH_RESULTS =
  '[role="listbox"], [role="menu"], .search-results, .autocomplete, [id*="listbox"]';

const DOWNLOAD_LINK =
  "a.matomo_download, a[download], a.fr-icon-download-line, a.fr-icon-external-link-line";

// ─────────────────────────────────────────────────────────────────────────────
// 1. HOME PAGE — HTTP 200 & Disponibilidade
// ─────────────────────────────────────────────────────────────────────────────
test.describe(`[${TARGET_ENV}] 1. Home Page — Disponibilidade`, () => {
  test("Home Page responde com HTTP 200", async ({ page, baseURL }) => {
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });

    await test.step("status HTTP deve ser 200", async () => {
      expect(
        response?.status(),
        `❌ Home Page não respondeu com 200 em ${TARGET_ENV} (${baseURL}).\n` +
          `   CAUSA: O servidor pode estar em baixo ou inacessível.\n` +
          `   RESOLUÇÃO: curl -I ${baseURL}`,
      ).toBe(200);
    });
  });

  test("Título contém 'dados.gov' ou 'uData'", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const title = await page.title();

    await test.step("título da página contém 'dados.gov' ou 'uData'", async () => {
      expect(
        title,
        `❌ Título da página: "${title}".\n` +
          `   CAUSA: O título não contém "dados.gov" nem "uData".\n` +
          `   RESOLUÇÃO: Verificar SITE_TITLE em udata.cfg ou variáveis de ambiente.`,
      ).toMatch(/dados\.gov|uData/i);
    });
  });

  test("Elemento <h1> é visível na Home Page", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await test.step("<h1> deve estar visível", async () => {
      const h1 = page.locator("h1").first();
      await expect(
        h1,
        `❌ Nenhum <h1> visível encontrado na Home Page.\n` +
          `   CAUSA: O template pode não estar a renderizar correctamente\n` +
          `   ou o Vue/JS não inicializou.\n` +
          `   RESOLUÇÃO: Verificar se os assets JS carregam sem erros na consola.`,
      ).toBeVisible();
    });
  });

  test("Página contém atributo lang='pt' no HTML", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const lang = await page.getAttribute("html", "lang");

    await test.step("atributo lang deve começar com 'pt'", async () => {
      expect(
        lang ?? "",
        `❌ Atributo lang="${lang}" não começa com "pt".\n` +
          `   CAUSA: DEFAULT_LANGUAGE pode estar configurado para outro idioma.\n` +
          `   RESOLUÇÃO: Verificar DEFAULT_LANGUAGE em udata.cfg (deve ser "pt").`,
      ).toMatch(/^pt/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PESQUISA — Resultados da Base de Dados
// ─────────────────────────────────────────────────────────────────────────────
test.describe(`[${TARGET_ENV}] 2. Pesquisa — Resultados da BD`, () => {
  test("Barra de pesquisa está visível e funcional", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await test.step("campo de pesquisa deve estar visível", async () => {
      const searchInput = page.locator(SEARCH_INPUT).first();
      await expect(
        searchInput,
        `❌ Campo de pesquisa não encontrado na Home Page.\n` +
          `   CAUSA: O componente Vue pode não ter renderizado ou o seletor mudou.\n` +
          `   RESOLUÇÃO:\n` +
          `   1. Verificar se os ficheiros JS carregam sem erros.\n` +
          `   2. Inspecionar o DOM para encontrar o input de pesquisa actual.\n` +
          `   3. Atualizar o seletor SEARCH_INPUT no teste se necessário.`,
      ).toBeVisible();
    });
  });

  test("Pesquisar 'dados' retorna resultados da API", async ({
    page,
    baseURL,
  }) => {
    const apiResponsePromise = page.waitForResponse(
      (res: Response) =>
        res.url().includes("/api/1/datasets") ||
        res.url().includes("/search") ||
        res.url().includes("/autocomplete"),
      { timeout: 10_000 },
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const searchInput = page.locator(SEARCH_INPUT).first();
    await searchInput.fill("dados");

    const apiResponse = await apiResponsePromise;
    const apiStatus = apiResponse.status();

    await test.step("API de pesquisa responde com HTTP < 400", async () => {
      expect(
        apiStatus,
        `❌ API de pesquisa respondeu com status ${apiStatus}.\n` +
          `   CAUSA: O serviço de pesquisa (Elasticsearch/MongoDB) pode estar em baixo.\n` +
          `   RESOLUÇÃO:\n` +
          `   1. Testar a API directamente: curl "${baseURL}/api/1/datasets/?q=dados"\n` +
          `   2. Verificar logs do Elasticsearch.`,
      ).toBeLessThan(400);
    });

    // Verificar resultados no DOM
    await page.waitForTimeout(2000);
    const results = page.locator(SEARCH_RESULTS);
    const count = await results.count();

    if (count > 0) {
      await test.step("dropdown de resultados deve conter texto", async () => {
        await expect(results.first()).toBeAttached();
        const text = await results.first().textContent();
        expect(
          (text ?? "").trim().length,
          `❌ Dropdown de resultados está vazio (sem texto).\n` +
            `   CAUSA: A BD pode estar vazia ou a API retornou 0 resultados.\n` +
            `   RESOLUÇÃO: curl "${baseURL}/api/1/datasets/?q=dados"`,
        ).toBeGreaterThan(0);
      });
    } else {
      await page.keyboard.press("Enter");
      await test.step("página de resultados deve conter cards de datasets", async () => {
        await page.waitForURL(/\/datasets|\/search/, { timeout: 10_000 });
        const pageCards = page.locator(
          '.dataset-card, article, [data-cy="dataset-card"], .card',
        );
        const cardCount = await pageCards.count();
        expect(
          cardCount,
          `❌ Nenhum resultado encontrado após pesquisa de "dados".\n` +
            `   CAUSA: BD pode estar vazia ou a pesquisa não está a funcionar.\n` +
            `   RESOLUÇÃO: curl "${baseURL}/api/1/datasets/?q=dados"`,
        ).toBeGreaterThan(0);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. DOWNLOAD DE RECURSOS — Validação de Acessibilidade
// ─────────────────────────────────────────────────────────────────────────────
test.describe(`[${TARGET_ENV}] 3. Download de Recurso de Dataset`, () => {
  test("Página de dataset contém link de download acessível", async ({
    page,
    baseURL,
    request,
  }) => {
    // 3.1 — Navegar para a listagem de datasets
    await page.goto("/datasets", { waitUntil: "domcontentloaded" });

    const detailHrefs: string[] = await page.evaluate(() => {
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[href*="/datasets/"]'),
      );
      return links
        .map((a) => a.getAttribute("href") ?? "")
        .filter(
          (href) =>
            /\/datasets\/[^/]+/.test(href) && !/\/datasets\/$/.test(href),
        );
    });

    let datasetUrl: string;

    if (detailHrefs.length > 0) {
      const firstHref = detailHrefs[0];
      datasetUrl = firstHref.startsWith("http")
        ? firstHref
        : `${baseURL}${firstHref}`;
    } else {
      const apiUrl = `${baseURL}/api/1/datasets/?page_size=1&sort=-created`;
      const apiResp = await request.get(apiUrl, { timeout: 10_000 });

      await test.step("API de datasets responde com HTTP < 400", async () => {
        expect(
          apiResp.status(),
          `❌ API não respondeu ao pedir datasets para o teste de download.\n` +
            `   RESOLUÇÃO: curl "${apiUrl}"`,
        ).toBeLessThan(400);
      });

      const apiData = await apiResp.json();
      const slug: string | undefined =
        apiData?.data?.[0]?.slug ?? apiData?.data?.[0]?.id;

      await test.step("API retornou pelo menos um dataset", async () => {
        expect(
          slug,
          `❌ Nenhum dataset encontrado via API (${apiUrl}).\n` +
            `   CAUSA: A base de dados pode estar vazia.`,
        ).toBeTruthy();
      });

      datasetUrl = `${baseURL}/pt/datasets/${slug}/`;
    }

    // 3.2 — Navegar para a página de detalhe do dataset
    test
      .info()
      .annotations.push({ type: "Dataset URL", description: datasetUrl });
    console.log(`📂 [${TARGET_ENV}] Navegando para dataset: ${datasetUrl}`);

    await page.goto(datasetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // 3.3 — Localizar link de download
    const matomoLinks = page.locator("a.matomo_download");
    const downloadAttrLinks = page.locator("a[download]");
    const anyResourceLinks = page.locator(DOWNLOAD_LINK);

    const matomoCount = await matomoLinks.count();
    const downloadAttrCount = await downloadAttrLinks.count();
    const anyCount = await anyResourceLinks.count();

    let downloadHref: string | null = null;
    let linkType = "";

    if (matomoCount > 0) {
      downloadHref = await matomoLinks.first().getAttribute("href");
      linkType = "matomo_download";
    } else if (downloadAttrCount > 0) {
      downloadHref = await downloadAttrLinks.first().getAttribute("href");
      linkType = "a[download]";
    } else if (anyCount > 0) {
      downloadHref = await anyResourceLinks.first().getAttribute("href");
      linkType = "resource-link (externo/OGC)";
    }

    await test.step("dataset deve ter pelo menos um link de recurso", async () => {
      expect(
        downloadHref,
        `❌ Nenhum link de recurso encontrado neste dataset.\n` +
          `   Dataset: ${datasetUrl}\n` +
          `   CAUSA PROVÁVEL:\n` +
          `   - O dataset pode não ter recursos associados.\n` +
          `   - Os componentes Vue podem não ter renderizado.\n` +
          `   RESOLUÇÃO:\n` +
          `   1. Verificar recursos na API: curl "${datasetUrl.replace(/\/datasets\//, "/api/1/datasets/")}"\n` +
          `   2. Garantir que o dataset tem pelo menos um recurso do tipo ficheiro.`,
      ).toBeTruthy();
    });

    test
      .info()
      .annotations.push({ type: "Download Link Type", description: linkType });
    test.info().annotations.push({
      type: "Download Href",
      description: downloadHref ?? "",
    });

    await test.step("link de download tem formato URL válido", async () => {
      expect(
        downloadHref,
        `❌ href "${downloadHref}" não é um URL válido (tipo: ${linkType}).\n` +
          `   CAUSA: O resource.latest pode estar mal configurado.\n` +
          `   RESOLUÇÃO: Verificar o recurso na API e o valor de "latest".`,
      ).toMatch(/^https?:\/\//);
    });

    // 3.4 — Validar HEAD request
    const absoluteHref = (downloadHref ?? "").startsWith("http")
      ? downloadHref!
      : `${baseURL}${downloadHref}`;

    if (
      linkType !== "resource-link (externo/OGC)" ||
      absoluteHref.includes(baseURL ?? "")
    ) {
      await test.step("URL de download responde com HTTP < 400", async () => {
        const headResponse = await request.head(absoluteHref, {
          timeout: 15_000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
              "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });

        const httpStatus = headResponse.status();
        expect(
          httpStatus,
          `❌ URL de download retornou status ${httpStatus}.\n` +
            `   URL: ${absoluteHref}\n` +
            `   Tipo: ${linkType}\n` +
            `   CAUSA: O ficheiro pode não existir no servidor de ficheiros (FS).\n` +
            `   RESOLUÇÃO:\n` +
            `   1. Verificar se o ficheiro existe no volume FS.\n` +
            `   2. Verificar configuração FS_ROOT e FS_PREFIX em udata.cfg.\n` +
            `   3. Confirmar que o volume está montado correctamente.`,
        ).toBeLessThan(400);
      });
    } else {
      console.log(
        `⚠️ [${TARGET_ENV}] Recurso externo/OGC sem validação HEAD: ${absoluteHref}`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. INTEGRIDADE DE ASSETS — Imagens & CSS
// ─────────────────────────────────────────────────────────────────────────────
test.describe(`[${TARGET_ENV}] 4. Integridade de Assets`, () => {
  async function collectBrokenImages(page: Page): Promise<string[]> {
    const images = await page.locator("img:visible").all();
    const brokenImages: string[] = [];

    for (const img of images) {
      const src = (await img.getAttribute("src")) ?? "";
      if (src.startsWith("data:") || src.endsWith(".svg") || !src) continue;

      const naturalWidth = await img.evaluate(
        (el: HTMLImageElement) => el.naturalWidth,
      );
      if (naturalWidth === 0) {
        brokenImages.push(src);
      }
    }

    return brokenImages;
  }

  test("Home Page não tem imagens partidas", async ({ page }) => {
    const failedAssets: string[] = [];

    page.on("response", (response: Response) => {
      const url = response.url();
      const status = response.status();
      const contentType = response.headers()["content-type"] ?? "";

      const isAsset =
        contentType.includes("text/css") ||
        contentType.includes("image/") ||
        url.endsWith(".css") ||
        url.endsWith(".png") ||
        url.endsWith(".jpg") ||
        url.endsWith(".jpeg") ||
        url.endsWith(".ico") ||
        url.endsWith(".webp");

      if (isAsset && status >= 400) {
        failedAssets.push(`HTTP ${status}: ${url}`);
      }
    });

    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(2000);

    const brokenImages = await collectBrokenImages(page);

    await test.step("nenhuma imagem visível deve estar partida", async () => {
      expect(
        brokenImages,
        `❌ ${brokenImages.length} imagem(ns) partida(s) na Home Page:\n` +
          brokenImages.map((s) => `   ❌ ${s}`).join("\n") +
          `\n   CAUSA: Ficheiros não existem no FS ou paths incorrectos.\n` +
          `   RESOLUÇÃO: Verificar configuração FS_ROOT e volume FS montado.`,
      ).toHaveLength(0);
    });

    await test.step("nenhum asset (CSS/imagem) deve ter erro HTTP", async () => {
      expect(
        failedAssets,
        `❌ ${failedAssets.length} asset(s) com erro de rede na Home Page:\n` +
          failedAssets.map((a) => `   ❌ ${a}`).join("\n") +
          `\n   CAUSA: Ficheiros CSS/JS ou imagens em falta ou caminhos inválidos.`,
      ).toHaveLength(0);
    });
  });

  test("Páginas carregam folhas de estilo CSS correctamente", async ({
    page,
  }) => {
    const cssErrors: string[] = [];

    page.on("response", (response: Response) => {
      const url = response.url();
      const contentType = response.headers()["content-type"] ?? "";

      if (
        (contentType.includes("text/css") || url.endsWith(".css")) &&
        response.status() >= 400
      ) {
        cssErrors.push(`HTTP ${response.status()}: ${url}`);
      }
    });

    await page.goto("/", { waitUntil: "load" });

    await test.step("nenhum ficheiro CSS deve retornar erro HTTP", async () => {
      expect(
        cssErrors,
        `❌ ${cssErrors.length} ficheiro(s) CSS com erro na Home Page:\n` +
          cssErrors.map((e) => `   ❌ ${e}`).join("\n") +
          `\n   CAUSA: Build de assets inválido ou deploy incompleto.\n` +
          `   RESOLUÇÃO:\n` +
          `   1. Verificar o deploy: os assets foram publicados?\n` +
          `   2. Executar: npm run build e re-fazer deploy.\n` +
          `   3. Verificar a configuração do servidor de assets estáticos.`,
      ).toHaveLength(0);
    });
  });

  test("Página /datasets não tem imagens partidas", async ({ page }) => {
    await page.goto("/datasets", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const brokenImages = await collectBrokenImages(page);

    await test.step("nenhuma imagem visível deve estar partida em /datasets", async () => {
      expect(
        brokenImages,
        `❌ ${brokenImages.length} imagem(ns) partida(s) em /datasets:\n` +
          brokenImages.map((s) => `   ❌ ${s}`).join("\n") +
          `\n   CAUSA: Logos de organizações ou imagens de datasets não existem no FS.\n` +
          `   RESOLUÇÃO: Verificar se os ficheiros existem no volume FS (/s/ prefix).`,
      ).toHaveLength(0);
    });
  });

  test("Assets estáticos do volume FS são servidos (/s/)", async ({
    page,
    request,
  }) => {
    await page.goto("/datasets", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const fsSrcs = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img[src*="/s/"]'));
      return imgs.map((img) => (img as HTMLImageElement).src);
    });

    if (fsSrcs.length === 0) {
      console.log(
        "ℹ️ Nenhuma imagem com prefixo /s/ encontrada em /datasets.\n" +
          "   Pode ser normal se não existirem logos de organizações carregados.",
      );
      return;
    }

    const fsErrors: string[] = [];
    for (const src of fsSrcs.slice(0, 10)) {
      const res = await request.head(src, { timeout: 10_000 });
      if (res.status() >= 400) {
        fsErrors.push(`HTTP ${res.status()}: ${src}`);
      }
    }

    await test.step("assets do volume FS (/s/) devem responder com HTTP < 400", async () => {
      expect(
        fsErrors,
        `❌ ${fsErrors.length} ficheiro(s) FS inacessível(is):\n` +
          fsErrors.map((e) => `   ❌ ${e}`).join("\n") +
          `\n   CAUSA: Ficheiros não existem no volume FS ou path incorrecto.\n` +
          `   RESOLUÇÃO:\n` +
          `   1. Verificar: ls -la $FS_ROOT\n` +
          `   2. Verificar FS_ROOT e FS_PREFIX em udata.cfg.\n` +
          `   3. Confirmar que o volume está montado correctamente.`,
      ).toHaveLength(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. REDEFINIÇÃO DE PALAVRA-PASSE — Fluxo Completo
// ─────────────────────────────────────────────────────────────────────────────
test.describe(`[${TARGET_ENV}] 5. Redefinição de Palavra-passe`, () => {
  const RESET_PATH = "/pt/reset/?next=%2Fpt%2Flogin%2F";
  const TEST_EMAIL = process.env.TEST_RESET_EMAIL ?? "smoke-test@dados.gov.pt";
  const SUCCESS_MSG_PATTERN =
    /instruções para redefinir|sent.*password|password.*reset|reset.*enviado|instruções.*enviadas/i;

  test("Abordagem 2 — POST de reset responde com HTTP 2xx ou 3xx", async ({
    page,
  }) => {
    await page.goto(RESET_PATH, { waitUntil: "domcontentloaded" });

    const responsePromise = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        (res.url().includes("/reset") || res.url().includes("/recover")),
      { timeout: 15_000 },
    );

    const emailInput = page.locator(
      'input[type="email"], input[name="email"], input[id*="email"]',
    );

    await test.step("preencher campo de email", async () => {
      await emailInput.first().click();
      await emailInput.first().pressSequentially(TEST_EMAIL, { delay: 30 });
      await emailInput.first().press("Tab");
    });

    await test.step("activar botão de submit (bypass reCAPTCHA)", async () => {
      await page.evaluate(() => {
        const w = window as unknown as { enableBtn?: () => void };
        if (typeof w.enableBtn === "function") w.enableBtn();
      });
    });

    const submitBtn = page
      .locator('#submit, button[type="submit"], input[type="submit"]')
      .first();

    await test.step("botão de submit deve ficar activo", async () => {
      await submitBtn.waitFor({ state: "visible", timeout: 5_000 });
      await expect(
        submitBtn,
        `❌ Botão de submit não ficou activo.\n` +
          `   CAUSA: O reCAPTCHA ou validação Vue bloqueou a submissão.\n` +
          `   RESOLUÇÃO: Verificar se enableBtn() existe na página de reset.`,
      ).toBeEnabled({ timeout: 8_000 });
    });

    await submitBtn.click();

    await test.step("POST /reset deve responder com HTTP < 400", async () => {
      const postResponse = await responsePromise;
      const postStatus = postResponse.status();
      expect(
        postStatus,
        `❌ POST para reset retornou HTTP ${postStatus} (esperado < 400).\n` +
          `   Ambiente: ${TARGET_ENV}\n` +
          `   Email usado: ${TEST_EMAIL}\n` +
          `   CAUSA PROVÁVEL:\n` +
          `   - Configuração SMTP inválida (MAIL_SERVER, MAIL_PORT).\n` +
          `   - Flask-Security não está configurado correctamente.\n` +
          `   RESOLUÇÃO:\n` +
          `   1. Verificar variáveis MAIL_* no servidor.\n` +
          `   2. Ver logs: docker logs <container> | grep -i mail`,
      ).toBeLessThan(400);
    });
  });

  test("Abordagem 1 — POST directo extrai CSRF e verifica resposta do servidor", async ({
    page,
    request,
    baseURL,
  }) => {
    const pageResp = await page.goto(RESET_PATH, {
      waitUntil: "domcontentloaded",
    });

    await test.step("página de reset carrega com HTTP < 400", async () => {
      expect(
        pageResp?.status(),
        `❌ Página de reset não carregou (HTTP ${pageResp?.status()}).\n` +
          `   RESOLUÇÃO: Verificar se o endpoint ${RESET_PATH} existe.`,
      ).toBeLessThan(400);
    });

    const csrfToken =
      (await page
        .locator('input[name="csrf_token"]')
        .first()
        .getAttribute("value")) ?? "";

    await test.step("campo de email deve estar visível na página de reset", async () => {
      await expect(
        page.locator('input[type="email"], input[name="email"]').first(),
        `❌ Campo de email não encontrado em ${RESET_PATH}.\n` +
          `   CAUSA: O template da página de reset pode ter mudado.`,
      ).toBeVisible();
    });

    console.log(
      `📧 [${TARGET_ENV}] A enviar POST de reset para: ${TEST_EMAIL}`,
    );

    const resetUrl = (baseURL ?? "").replace(/\/$/, "") + "/pt/reset/";
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const postResp = await request.post(resetUrl, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader,
        Referer: resetUrl,
      },
      data: new URLSearchParams({
        email: TEST_EMAIL,
        csrf_token: csrfToken,
        "g-recaptcha-response": "",
      }).toString(),
    });

    const postStatus = postResp.status();
    const responseBody = await postResp.text();
    const bodyOk = SUCCESS_MSG_PATTERN.test(responseBody);
    const statusOk = postStatus < 400;

    console.log(`📡 [${TARGET_ENV}] POST ${resetUrl} → HTTP ${postStatus}`);

    await test.step("POST directo deve retornar HTTP < 400 ou mensagem de confirmação", async () => {
      expect(
        statusOk || bodyOk,
        `❌ POST de reset falhou.\n` +
          `   URL: ${resetUrl}\n` +
          `   HTTP: ${postStatus}\n` +
          `   Email: ${TEST_EMAIL}\n` +
          `   CAUSA: CSRF inválido ou Flask-Security mal configurado.\n` +
          `   RESOLUÇÃO: docker logs <udata> | grep -i "reset|csrf|security"`,
      ).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ORGANIZAÇÕES — Listagem
// ─────────────────────────────────────────────────────────────────────────────
test.describe(`[${TARGET_ENV}] 6. Organizações`, () => {
  test("Página de organizações carrega e contém cards", async ({
    page,
    baseURL,
  }) => {
    const response = await page.goto("/pt/organizations/", {
      waitUntil: "domcontentloaded",
    });

    await test.step("status HTTP deve ser < 400", async () => {
      expect(
        response?.status(),
        `❌ Página de organizações não respondeu correctamente em ${TARGET_ENV} (${baseURL}/pt/organizations/).\n` +
          `   CAUSA: A rota /pt/organizations/ pode não existir ou o servidor está em baixo.\n` +
          `   RESOLUÇÃO: curl -I ${baseURL}/pt/organizations/`,
      ).toBeLessThan(400);
    });

    await test.step("listagem contém pelo menos 1 card de organização", async () => {
      await page.waitForSelector(".fr-tile", { timeout: 15_000 });
      const cards = page.locator(".fr-tile");
      const count = await cards.count();
      expect(
        count,
        `❌ Nenhum card de organização encontrado em ${TARGET_ENV}.\n` +
          `   CAUSA: A base de dados pode não ter organizações ou o template pode ter mudado.\n` +
          `   RESOLUÇÃO: Verificar /api/1/organizations/?page_size=1`,
      ).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. REUTILIZAÇÕES — Listagem
// ─────────────────────────────────────────────────────────────────────────────
test.describe(`[${TARGET_ENV}] 7. Reutilizações`, () => {
  test("Página de reutilizações carrega e contém cards", async ({
    page,
    baseURL,
  }) => {
    const response = await page.goto("/pt/reuses/", {
      waitUntil: "domcontentloaded",
    });

    await test.step("status HTTP deve ser < 400", async () => {
      expect(
        response?.status(),
        `❌ Página de reutilizações não respondeu correctamente em ${TARGET_ENV} (${baseURL}/pt/reuses/).\n` +
          `   CAUSA: A rota /pt/reuses/ pode não existir ou o servidor está em baixo.\n` +
          `   RESOLUÇÃO: curl -I ${baseURL}/pt/reuses/`,
      ).toBeLessThan(400);
    });

    await test.step("listagem contém pelo menos 1 card de reutilização", async () => {
      await page.waitForSelector("article.fr-card", { timeout: 15_000 });
      const cards = page.locator("article.fr-card");
      const count = await cards.count();
      expect(
        count,
        `❌ Nenhum card de reutilização encontrado em ${TARGET_ENV}.\n` +
          `   CAUSA: A base de dados pode não ter reutilizações ou o template mudou.\n` +
          `   RESOLUÇÃO: Verificar /api/1/reuses/?page_size=1`,
      ).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. API REST — Endpoints respondem com JSON
// ─────────────────────────────────────────────────────────────────────────────
test.describe(`[${TARGET_ENV}] 8. API REST`, () => {
  const API_ENDPOINTS = [
    { path: "/api/1/datasets/?page_size=1", name: "Datasets" },
    { path: "/api/1/organizations/?page_size=1", name: "Organizações" },
    { path: "/api/1/reuses/?page_size=1", name: "Reutilizações" },
  ];

  test("Raiz da API responde com HTTP < 400", async ({ request, baseURL }) => {
    const response = await request.get("/api/1/");
    await test.step("status HTTP deve ser < 400", async () => {
      expect(
        response.status(),
        `❌ Raiz da API não respondeu correctamente em ${TARGET_ENV}.\n` +
          `   URL: ${baseURL}/api/1/\n` +
          `   HTTP: ${response.status()}\n` +
          `   RESOLUÇÃO: curl -I ${baseURL}/api/1/`,
      ).toBeLessThan(400);
    });
  });

  for (const endpoint of API_ENDPOINTS) {
    test(`Endpoint ${endpoint.name} responde com JSON`, async ({
      request,
      baseURL,
    }) => {
      const response = await request.get(endpoint.path);

      await test.step("status HTTP deve ser < 400", async () => {
        expect(
          response.status(),
          `❌ API ${endpoint.name} não respondeu correctamente em ${TARGET_ENV}.\n` +
            `   URL: ${baseURL}${endpoint.path}\n` +
            `   HTTP: ${response.status()}\n` +
            `   RESOLUÇÃO: curl -s ${baseURL}${endpoint.path} | head -c 200`,
        ).toBeLessThan(400);
      });

      await test.step("Content-Type deve conter 'json'", async () => {
        const contentType = response.headers()["content-type"] || "";
        expect(
          contentType,
          `❌ API ${endpoint.name} não retornou JSON em ${TARGET_ENV}.\n` +
            `   Content-Type: ${contentType}\n` +
            `   CAUSA: O endpoint pode estar a devolver HTML (erro) em vez de JSON.\n` +
            `   RESOLUÇÃO: curl -sI ${baseURL}${endpoint.path} | grep content-type`,
        ).toContain("json");
      });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. NAVEGAÇÃO — Links internos (nav + footer) acessíveis
// ─────────────────────────────────────────────────────────────────────────────
test.describe(`[${TARGET_ENV}] 9. Navegação e Links Internos`, () => {
  test("Links principais da navegação estão acessíveis", async ({
    page,
    request,
    baseURL,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const NAV_PATHS = [
      "/pt/datasets/",
      "/pt/dataservices/",
      "/pt/reuses/",
      "/pt/organizations/",
    ];

    for (const path of NAV_PATHS) {
      await test.step(`HEAD ${path} responde com HTTP < 400`, async () => {
        const resp = await request.head(path);
        expect(
          resp.status(),
          `❌ Link de navegação ${path} não está acessível em ${TARGET_ENV}.\n` +
            `   HTTP: ${resp.status()}\n` +
            `   RESOLUÇÃO: curl -I ${baseURL}${path}`,
        ).toBeLessThan(400);
      });
    }
  });

  test("Links do footer estão acessíveis", async ({
    page,
    request,
    baseURL,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const FOOTER_PATHS = [
      "/pt/pages/faqs/about_dadosgov",
      "/pt/pages/faqs/terms",
      "/pt/pages/faqs/acessibilidade",
      "/pt/pages/api-tutorial",
      "/pt/dashboard/",
    ];

    for (const path of FOOTER_PATHS) {
      await test.step(`GET ${path} responde com HTTP < 400`, async () => {
        const resp = await request.get(path);
        expect(
          resp.status(),
          `❌ Link do footer ${path} não está acessível em ${TARGET_ENV}.\n` +
            `   HTTP: ${resp.status()}\n` +
            `   RESOLUÇÃO: curl -I ${baseURL}${path}`,
        ).toBeLessThan(400);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. DASHBOARD / ESTATÍSTICAS
// ─────────────────────────────────────────────────────────────────────────────
test.describe(`[${TARGET_ENV}] 10. Dashboard — Estatísticas`, () => {
  test("Página de dashboard carrega com indicadores", async ({
    page,
    baseURL,
  }) => {
    const response = await page.goto("/pt/dashboard/", {
      waitUntil: "domcontentloaded",
    });

    await test.step("status HTTP deve ser < 400", async () => {
      expect(
        response?.status(),
        `❌ Dashboard não respondeu correctamente em ${TARGET_ENV} (${baseURL}/pt/dashboard/).\n` +
          `   CAUSA: A rota /pt/dashboard/ pode não existir.\n` +
          `   RESOLUÇÃO: curl -I ${baseURL}/pt/dashboard/`,
      ).toBeLessThan(400);
    });

    await test.step("página contém pelo menos um indicador numérico", async () => {
      const body = await page.textContent("body");
      const hasNumbers = /\d+/.test(body || "");
      expect(
        hasNumbers,
        `❌ Dashboard não contém indicadores numéricos em ${TARGET_ENV}.\n` +
          `   CAUSA: Os contadores podem não estar a carregar (JS error ou API em baixo).\n` +
          `   RESOLUÇÃO: Abrir ${baseURL}/pt/dashboard/ num browser e verificar a consola.`,
      ).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. PÁGINAS ESTÁTICAS — Sobre, Termos, Acessibilidade, etc.
// ─────────────────────────────────────────────────────────────────────────────
test.describe(`[${TARGET_ENV}] 11. Páginas Estáticas`, () => {
  const STATIC_PAGES = [
    { path: "/pt/pages/faqs/about_dadosgov", label: "Sobre nós" },
    { path: "/pt/pages/faqs/terms", label: "Termos de utilização" },
    { path: "/pt/pages/faqs/acessibilidade", label: "Acessibilidade" },
    { path: "/pt/pages/api-tutorial", label: "API Tutorial" },
    { path: "/pt/pages/faqs/licenses/", label: "Licenças" },
  ];

  test("Páginas legais e informativas respondem com HTTP < 400", async ({
    request,
    baseURL,
  }) => {
    for (const pg of STATIC_PAGES) {
      await test.step(`${pg.label} (${pg.path}) responde com HTTP < 400`, async () => {
        const resp = await request.get(pg.path);
        expect(
          resp.status(),
          `❌ Página estática "${pg.label}" não acessível em ${TARGET_ENV}.\n` +
            `   URL: ${baseURL}${pg.path}\n` +
            `   HTTP: ${resp.status()}\n` +
            `   RESOLUÇÃO: curl -I ${baseURL}${pg.path}`,
        ).toBeLessThan(400);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. FORMULÁRIO DE CONTACTO
// ─────────────────────────────────────────────────────────────────────────────
test.describe(`[${TARGET_ENV}] 12. Formulário de Contacto`, () => {
  test("Página de contacto carrega com formulário", async ({
    page,
    baseURL,
  }) => {
    const response = await page.goto("/pt/contact/", {
      waitUntil: "domcontentloaded",
    });

    await test.step("status HTTP deve ser < 400", async () => {
      expect(
        response?.status(),
        `❌ Página de contacto não respondeu correctamente em ${TARGET_ENV} (${baseURL}/pt/contact/).\n` +
          `   CAUSA: A rota /pt/contact/ pode não existir.\n` +
          `   RESOLUÇÃO: curl -I ${baseURL}/pt/contact/`,
      ).toBeLessThan(400);
    });

    await test.step("formulário contém campos obrigatórios", async () => {
      const form = page.locator("form");
      const formCount = await form.count();
      expect(
        formCount,
        `❌ Nenhum formulário encontrado na página de contacto em ${TARGET_ENV}.\n` +
          `   CAUSA: A página pode não ter um <form> ou o template mudou.\n` +
          `   RESOLUÇÃO: Inspecionar ${baseURL}/pt/contact/ no browser.`,
      ).toBeGreaterThan(0);

      // Verificar presença de campos essenciais (input ou textarea)
      const inputs = page.locator("form input, form textarea, form select");
      const inputCount = await inputs.count();
      expect(
        inputCount,
        `❌ Formulário de contacto não tem campos de input em ${TARGET_ENV}.\n` +
          `   CAUSA: Os campos do formulário podem não estar a renderizar.\n` +
          `   RESOLUÇÃO: Verificar o HTML do formulário em ${baseURL}/pt/contact/`,
      ).toBeGreaterThanOrEqual(2);
    });
  });
});
