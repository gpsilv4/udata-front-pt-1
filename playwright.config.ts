import { defineConfig, devices } from "@playwright/test";

// ─────────────────────────────────────────────────────────────────────────────
// Mapa de ambientes disponíveis
//
// Utilização:
//   TARGET_ENV=PRD npx playwright test --config playwright.config.ts
//   TARGET_ENV=PPR npx playwright test --config playwright.config.ts
//   TARGET_ENV=TST npx playwright test --config playwright.config.ts
//   TARGET_ENV=DEV npx playwright test --config playwright.config.ts
// ─────────────────────────────────────────────────────────────────────────────
const ENVIRONMENTS: Record<string, string> = {
  PRD: "https://dados.gov.pt",
  PPR: "https://preprod.dados.gov.pt",
  TST: "http://10.55.37.38",
  DEV: "http://172.31.204.12",
};

const selectedEnv = (process.env.TARGET_ENV || "PRD").toUpperCase();
const baseURL = ENVIRONMENTS[selectedEnv];

if (!baseURL) {
  const valid = Object.keys(ENVIRONMENTS).join(", ");
  throw new Error(
    `❌ Ambiente "${selectedEnv}" inválido. Opções válidas: ${valid}\n` +
      `   Exemplo: TARGET_ENV=PRD npx playwright test`,
  );
}

console.log(`\n🌐 [Playwright] Ambiente: ${selectedEnv} → ${baseURL}\n`);

export default defineConfig({
  // ─── Localização dos testes ────────────────────────────────────────────────
  testDir: "./tests/smoke",
  testMatch: "**/*.spec.ts",

  // ─── Configuração global ───────────────────────────────────────────────────
  timeout: 30_000, // 30s por teste
  expect: {
    timeout: 10_000, // 10s para assertions
  },
  fullyParallel: false, // Smoke tests sequenciais para evitar sobrecarga
  retries: 1, // 1 retry automático em falha (rede instável)
  workers: 1,

  // ─── Relatórios ───────────────────────────────────────────────────────────
  reporter: [
    ["list"], // Output no terminal
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],

  // ─── Configuração partilhada pelos projectos ───────────────────────────────
  use: {
    baseURL,

    // Simular browser real (evita bloqueios de WAF)
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",

    // Aceitar self-signed certs em ambientes de teste interno (TST/DEV)
    ignoreHTTPSErrors: true,

    // Captura de evidências em falha
    screenshot: "only-on-failure",
    video: "off",
    trace: "on-first-retry",

    // Timeouts de acção/navegação
    actionTimeout: 10_000,
    navigationTimeout: 20_000,

    // Viewport standard Desktop
    viewport: { width: 1920, height: 877 },

    // Expor o ambiente nos testes via storageState / env
    extraHTTPHeaders: {},
  },

  // ─── Projectos ────────────────────────────────────────────────────────────
  projects: [
    {
      name: `Smoke — ${selectedEnv}`,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
