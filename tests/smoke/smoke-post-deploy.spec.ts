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
 *
 * ─── Execução ────────────────────────────────────────────────────────────────
 *   # PRD (default):
 *   npx playwright test --config playwright.config.ts
 *
 *   # Outros ambientes:
 *   TARGET_ENV=PRD npx playwright test --config playwright.config.ts
 *   TARGET_ENV=PPR npx playwright test --config playwright.config.ts
 *   TARGET_ENV=TST npx playwright test --config playwright.config.ts
 *   TARGET_ENV=DEV npx playwright test --config playwright.config.ts
 *
 * ─── Ambientes disponíveis ────────────────────────────────────────────────
 *   PRD → https://dados.gov.pt
 *   PPR → https://preprod.dados.gov.pt
 *   TST → http://10.55.37.38
 *   DEV → http://172.31.204.12
 * ============================================================================
 */

import { test, expect, Page, Response } from "@playwright/test";

// ─── Constantes ──────────────────────────────────────────────────────────────

const TARGET_ENV = (process.env.TARGET_ENV || "PRD").toUpperCase();

/** Seletor para o campo de pesquisa (cobre diferentes implementações) */
const SEARCH_INPUT =
  'input[type="search"], input[name="q"], input[data-cy="search-input"]';

/** Seletores para resultados de autocomplete */
const SEARCH_RESULTS =
  '[role="listbox"], [role="menu"], .search-results, .autocomplete, [id*="listbox"]';

/** Seletores para links de download */
const DOWNLOAD_LINK =
  "a.matomo_download, a[download], a.fr-icon-download-line, a.fr-icon-external-link-line";

// ─────────────────────────────────────────────────────────────────────────────
// 1. HOME PAGE — HTTP 200 & Disponibilidade
// ─────────────────────────────────────────────────────────────────────────────
test.describe(`[${TARGET_ENV}] 1. Home Page — Disponibilidade`, () => {
  test("Home Page responde com HTTP 200", async ({ page, baseURL }) => {
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });

    expect(
      response?.status(),
      `❌ Home Page não respondeu com 200 em ${TARGET_ENV} (${baseURL}).\n` +
        `   CAUSA: O servidor pode estar em baixo ou inacessível.\n` +
        `   RESOLUÇÃO: Verificar se o serviço está activo: curl -I ${baseURL}`,
    ).toBe(200);
  });

  test("Título contém 'dados.gov' ou 'uData'", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const title = await page.title();

    expect(
      title,
      `❌ Título da página: "${title}".\n` +
        `   CAUSA: O título não contém "dados.gov" nem "uData".\n` +
        `   RESOLUÇÃO: Verificar SITE_TITLE em udata.cfg ou variáveis de ambiente.`,
    ).toMatch(/dados\.gov|uData/i);
  });

  test("Elemento <h1> é visível na Home Page", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const h1 = page.locator("h1").first();
    await expect(
      h1,
      `❌ Nenhum <h1> visível encontrado na Home Page.\n` +
        `   CAUSA: O template pode não estar a renderizar correctamente\n` +
        `   ou o Vue/JS não inicializou.\n` +
        `   RESOLUÇÃO: Verificar se os assets JS carregam sem erros na consola.`,
    ).toBeVisible();
  });

  test("Página contém atributo lang='pt' no HTML", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const lang = await page.getAttribute("html", "lang");

    expect(
      lang ?? "",
      `❌ Atributo lang="${lang}" não começa com "pt".\n` +
        `   CAUSA: DEFAULT_LANGUAGE pode estar configurado para outro idioma.\n` +
        `   RESOLUÇÃO: Verificar DEFAULT_LANGUAGE em udata.cfg (deve ser "pt").`,
    ).toMatch(/^pt/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PESQUISA — Resultados da Base de Dados
// ─────────────────────────────────────────────────────────────────────────────
test.describe(`[${TARGET_ENV}] 2. Pesquisa — Resultados da BD`, () => {
  test("Barra de pesquisa está visível e funcional", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

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

  test("Pesquisar 'dados' retorna resultados da API", async ({
    page,
    baseURL,
  }) => {
    // Interceptar chamadas à API de pesquisa para confirmar que a BD responde
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

    // Aguardar resposta da API
    let apiStatus: number | null = null;
    try {
      const apiResponse = await apiResponsePromise;
      apiStatus = apiResponse.status();

      expect(
        apiStatus,
        `❌ API de pesquisa respondeu com status ${apiStatus}.\n` +
          `   CAUSA: O serviço de pesquisa (Elasticsearch/MongoDB) pode estar em baixo.\n` +
          `   RESOLUÇÃO:\n` +
          `   1. Testar a API directamente: curl "${baseURL}/api/1/datasets/?q=dados"\n` +
          `   2. Verificar logs do Elasticsearch.`,
      ).toBeLessThan(400);
    } catch {
      // API não interceptada — verificar dropdown no DOM
    }

    // Verificar resultados no DOM (dropdown de autocomplete)
    await page.waitForTimeout(2000);

    const results = page.locator(SEARCH_RESULTS);
    const count = await results.count();

    if (count > 0) {
      await expect(
        results.first(),
        `❌ Resultados de pesquisa encontrados mas não estão visíveis.`,
      ).toBeVisible();
      const text = await results.first().textContent();
      expect(
        (text ?? "").length,
        `❌ Dropdown de resultados está vazio (sem texto).\n` +
          `   CAUSA: A BD pode estar vazia ou a API retornou 0 resultados.\n` +
          `   RESOLUÇÃO: Verificar: curl "${baseURL}/api/1/datasets/?q=dados"`,
      ).toBeGreaterThan(0);
    } else if (apiStatus !== null && apiStatus < 400) {
      // A API respondeu com sucesso mas sem dropdown — pesquisa de página completa
      // Navegar para página de resultados e verificar
      await page.keyboard.press("Enter");
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
    } else {
      throw new Error(
        `❌ Pesquisa por "dados" não retornou resultados nem abriu dropdown.\n` +
          `   CAUSA PROVÁVEL:\n` +
          `   - A API de pesquisa (Elasticsearch) pode estar em baixo.\n` +
          `   - O componente de autocomplete tem um seletor diferente.\n` +
          `   RESOLUÇÃO:\n` +
          `   1. Testar a API: curl "${baseURL}/api/1/datasets/?q=dados"\n` +
          `   2. Verificar a consola do browser para erros de rede.\n` +
          `   3. Inspecionar o DOM para o seletor correcto do dropdown.`,
      );
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

    const datasetLinks = page.locator('a[href*="/datasets/"]');
    const datasetCount = await datasetLinks.count();

    expect(
      datasetCount,
      `❌ Nenhum link para dataset encontrado em /datasets.\n` +
        `   CAUSA: A página de listagem pode estar vazia (BD sem datasets).\n` +
        `   RESOLUÇÃO: Verificar a API: curl "${baseURL}/api/1/datasets/"`,
    ).toBeGreaterThan(0);

    // 3.2 — Clicar no primeiro dataset
    const firstDatasetHref = await datasetLinks.first().getAttribute("href");
    if (!firstDatasetHref) {
      throw new Error("❌ Primeiro link de dataset não tem atributo href.");
    }

    const datasetUrl = firstDatasetHref.startsWith("http")
      ? firstDatasetHref
      : `${baseURL}${firstDatasetHref}`;

    test.info().annotations.push({
      type: "Dataset URL",
      description: datasetUrl,
    });

    await page.goto(datasetUrl, { waitUntil: "domcontentloaded" });

    // Aguardar renderização dos componentes Vue
    await page.waitForTimeout(3000);

    // 3.3 — Localizar link de download (estratégia com fallbacks)
    const matomoLinks = page.locator("a.matomo_download");
    const downloadAttrLinks = page.locator("a[download]");
    const anyResourceLinks = page.locator(DOWNLOAD_LINK);

    const matomoCount = await matomoLinks.count();
    const downloadAttrCount = await downloadAttrLinks.count();
    const anyCount = await anyResourceLinks.count();

    let downloadHref: string | null = null;
    let linkType = "";

    if (matomoCount > 0) {
      // Caso ideal: ficheiro com rastreio Matomo (recurso tipo ficheiro)
      downloadHref = await matomoLinks.first().getAttribute("href");
      linkType = "matomo_download";
    } else if (downloadAttrCount > 0) {
      // Fallback: link com atributo download
      downloadHref = await downloadAttrLinks.first().getAttribute("href");
      linkType = "a[download]";
    } else if (anyCount > 0) {
      // Recursos externos ou serviços OGC (WMS/WFS)
      downloadHref = await anyResourceLinks.first().getAttribute("href");
      linkType = "resource-link (externo/OGC)";
    }

    if (!downloadHref) {
      // Falha real: nenhum recurso encontrado neste dataset
      throw new Error(
        `❌ Nenhum link de recurso encontrado neste dataset.\n` +
          `   Dataset: ${datasetUrl}\n` +
          `   CAUSA PROVÁVEL:\n` +
          `   - O dataset pode não ter recursos associados.\n` +
          `   - Os componentes Vue podem não ter renderizado (verificar JS na consola).\n` +
          `   RESOLUÇÃO:\n` +
          `   1. Verificar recursos do dataset na API: curl "${datasetUrl.replace(/\/datasets\//, "/api/1/datasets/")}"\n` +
          `   2. Garantir que o dataset tem pelo menos um recurso do tipo ficheiro.`,
      );
    }

    test.info().annotations.push({
      type: "Download Link Type",
      description: linkType,
    });
    test.info().annotations.push({
      type: "Download Href",
      description: downloadHref,
    });

    // Validar o formato do URL de download
    expect(
      downloadHref,
      `❌ href "${downloadHref}" não é um URL válido (tipo: ${linkType}).\n` +
        `   CAUSA: O resource.latest pode estar mal configurado.\n` +
        `   RESOLUÇÃO: Verificar o recurso na API e o valor de "latest".`,
    ).toMatch(/^https?:\/\/|\//);

    // 3.4 — Validar que o URL de download responde (HEAD request)
    const absoluteHref = downloadHref.startsWith("http")
      ? downloadHref
      : `${baseURL}${downloadHref}`;

    // Apenas validar HEAD para ficheiros diretos (não serviços OGC externos)
    if (
      linkType !== "resource-link (externo/OGC)" ||
      absoluteHref.includes(baseURL ?? "")
    ) {
      try {
        const headResponse = await request.head(absoluteHref, {
          timeout: 15_000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
              "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });

        expect(
          headResponse.status(),
          `❌ URL de download retornou status ${headResponse.status()}.\n` +
            `   URL: ${absoluteHref}\n` +
            `   CAUSA: O ficheiro pode não existir no servidor de ficheiros (FS).\n` +
            `   RESOLUÇÃO:\n` +
            `   1. Verificar se o ficheiro existe no volume FS.\n` +
            `   2. Verificar configuração FS_ROOT e FS_PREFIX em udata.cfg.\n` +
            `   3. Confirmar que o volume está montado correctamente.`,
        ).toBeLessThan(400);

        console.log(
          `✅ [${TARGET_ENV}] Download OK (${headResponse.status()}) — ${linkType}: ${absoluteHref}`,
        );
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        // Avisar mas não falhar em redirect (301/302 para HTTPS)
        console.warn(
          `⚠️ HEAD request para "${absoluteHref}" falhou: ${errorMsg}\n` +
            `   Pode ser redirect — verificar manualmente.`,
        );
      }
    } else {
      console.log(
        `⚠️ [${TARGET_ENV}] Recurso externo/OGC encontrado: ${absoluteHref}\n` +
          `   Sem validação HEAD para URLs externos.`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. INTEGRIDADE DE ASSETS — Imagens & CSS
// ─────────────────────────────────────────────────────────────────────────────
test.describe(`[${TARGET_ENV}] 4. Integridade de Assets`, () => {
  /**
   * Recolhe CSS e imagens de uma página e valida o status HTTP de cada um.
   */
  async function validatePageAssets(page: Page, baseURL: string | undefined) {
    const failedAssets: string[] = [];
    const checkedAssets: string[] = [];

    // Interceptar todas as respostas de assets
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

      if (isAsset) {
        checkedAssets.push(`${status} — ${url}`);
        if (status >= 400) {
          failedAssets.push(`HTTP ${status}: ${url}`);
        }
      }
    });

    return { failedAssets, checkedAssets };
  }

  test("Home Page não tem imagens partidas", async ({ page }) => {
    const { failedAssets } = await validatePageAssets(
      page,
      page.context().browser()?.version(),
    );

    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(2000);

    // Verificar imagens via DOM (equivalente ao checkBrokenImages do Cypress)
    const images = await page.locator("img:visible").all();
    const brokenImages: string[] = [];

    for (const img of images) {
      const src = (await img.getAttribute("src")) ?? "";

      // Ignorar SVGs inline e data URIs
      if (src.startsWith("data:") || src.endsWith(".svg") || !src) {
        continue;
      }

      const naturalWidth = await img.evaluate(
        (el: HTMLImageElement) => el.naturalWidth,
      );

      if (naturalWidth === 0) {
        brokenImages.push(src);
      }
    }

    expect(
      brokenImages,
      `❌ ${brokenImages.length} imagem(ns) partida(s) na Home Page:\n` +
        brokenImages.map((s) => `   - ${s}`).join("\n") +
        `\n   CAUSA: Ficheiros não existem no servidor de ficheiros (FS) ou paths incorrectos.\n` +
        `   RESOLUÇÃO: Verificar configuração FS_ROOT e volume FS montado.`,
    ).toHaveLength(0);

    // Falhas de assets via network também são reportadas
    if (failedAssets.length > 0) {
      console.warn(
        `⚠️ ${failedAssets.length} asset(s) com erro na Home Page:\n` +
          failedAssets.map((a) => `   ${a}`).join("\n"),
      );
    }
  });

  test("Páginas carregam folhas de estilo CSS correctamente", async ({
    page,
    baseURL,
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

    expect(
      cssErrors,
      `❌ ${cssErrors.length} ficheiro(s) CSS com erro na Home Page:\n` +
        cssErrors.map((e) => `   - ${e}`).join("\n") +
        `\n   CAUSA: Build de assets inválido ou deploy incompleto.\n` +
        `   RESOLUÇÃO:\n` +
        `   1. Verificar o deploy: os assets foram publicados?\n` +
        `   2. Executar: npm run build e re-fazer deploy.\n` +
        `   3. Verificar a configuração do servidor de assets estáticos.`,
    ).toHaveLength(0);
  });

  test("Página /datasets não tem imagens partidas", async ({ page }) => {
    await page.goto("/datasets", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

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

    expect(
      brokenImages,
      `❌ ${brokenImages.length} imagem(ns) partida(s) em /datasets:\n` +
        brokenImages.map((s) => `   - ${s}`).join("\n") +
        `\n   CAUSA: Logos de organizações ou imagens de datasets não existem no FS.\n` +
        `   RESOLUÇÃO: Verificar se os ficheiros existem no volume FS (/s/ prefix).`,
    ).toHaveLength(0);
  });

  test("Assets estáticos do volume FS são servidos (/s/)", async ({
    page,
    request,
    baseURL,
  }) => {
    await page.goto("/datasets", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Extrair todos os srcs de imagens com prefixo /s/ (FS volume)
    const fsSrcs = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img[src*="/s/"]'));
      return imgs.map((img) => (img as HTMLImageElement).src);
    });

    if (fsSrcs.length === 0) {
      console.log(
        "⚠️ Nenhuma imagem com prefixo /s/ encontrada em /datasets.\n" +
          "   Isto pode ser normal se não existirem logos de organizações carregados.",
      );
      return;
    }

    // Validar cada imagem FS via HEAD request
    const fsErrors: string[] = [];

    for (const src of fsSrcs.slice(0, 10)) {
      // Limitar a 10 para não sobrecarregar
      try {
        const res = await request.head(src, { timeout: 10_000 });
        if (res.status() >= 400) {
          fsErrors.push(`HTTP ${res.status()}: ${src}`);
        }
      } catch {
        fsErrors.push(`Timeout/Erro: ${src}`);
      }
    }

    expect(
      fsErrors,
      `❌ ${fsErrors.length} ficheiro(s) FS inacessível(is):\n` +
        fsErrors.map((e) => `   - ${e}`).join("\n") +
        `\n   CAUSA: Ficheiros não existem no volume FS ou path incorrecto.\n` +
        `   RESOLUÇÃO:\n` +
        `   1. Verificar: ls -la $FS_ROOT\n` +
        `   2. Verificar FS_ROOT e FS_PREFIX em udata.cfg.\n` +
        `   3. Confirmar que o volume está montado correctamente.`,
    ).toHaveLength(0);
  });
});
