const { defineConfig } = require("cypress");
const fs = require("fs");

// ─────────────────────────────────────────────────────────────────────────────
// Mapa de ambientes disponíveis
// Utilização: CYPRESS_ENV=PRD npx cypress run --spec "cypress/e2e/deploy-validation.cy.js"
// ─────────────────────────────────────────────────────────────────────────────
const ENVIRONMENTS = {
  PRD: "https://dados.gov.pt",
  PPR: "https://preprod.dados.gov.pt",
  TST: "http://10.55.37.38",
  DEV: "http://172.31.204.12",
};

const selectedEnv = (process.env.CYPRESS_ENV || "PRD").toUpperCase();
const baseUrl = ENVIRONMENTS[selectedEnv];

if (!baseUrl) {
  const valid = Object.keys(ENVIRONMENTS).join(", ");
  throw new Error(
    `❌ Ambiente "${selectedEnv}" inválido. Opções válidas: ${valid}\n` +
      `   Exemplo: CYPRESS_ENV=PRD npx cypress run`,
  );
}

console.log(`\n🌐 Ambiente selecionado: ${selectedEnv} → ${baseUrl}\n`);

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      console.log("Starting script");
      const cfgFile = "./cypress/udata-front-e2e.cfg";
      if (fs.existsSync(cfgFile)) {
        const cfg = fs.readFileSync(cfgFile, "utf8");
        config.env.CAPTCHETAT_CONFIGURED = cfg.includes("CAPTCHETAT_BASE_URL");
      }

      // Expor o nome do ambiente para os testes
      config.env.TARGET_ENV = selectedEnv;
      config.env.TARGET_URL = baseUrl;

      return getLocations(`${config.baseUrl}/sitemap.xml`).then((urls) => {
        config.env.URLS = urls;
        return config;
      });
    },
    baseUrl,
    numTestsKeptInMemory: 10,
    viewportWidth: 1920,
    viewportHeight: 877,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },

  component: {
    devServer: {
      framework: "vue",
      bundler: "vite",
    },
  },
});

const axios = require("axios").default;

/**
 * Loads Sitemap and extracts urls
 * @param {string} url
 * @returns {Promise<Array<string>>}
 */
const getLocations = (url) => {
  console.log(`Getting locations from ${url}`);
  return axios
    .get(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/xml",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    })
    .then((res) => res.data)
    .then((xml) => {
      const locs = [...xml.matchAll(`<loc>(.|\\n)*?</loc>`)].map(([loc]) => {
        const url = loc.replace("<loc>", "").replace("</loc>", "");
        const path = new URL(url).pathname; // Extract only the path
        return path;
      });
      console.log(`Found ${locs.length} locations`);
      return locs;
    })
    .catch((err) => {
      console.warn(`Failed to load sitemap from ${url}: ${err.message}`);
      console.warn("Continuing with default locations ['/']");
      return ["/"];
    });
};
