const { defineConfig } = require("cypress");
const fs = require("fs");

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      console.log("Starting script");
      const cfgFile = "./cypress/udata-front-e2e.cfg";
      if (fs.existsSync(cfgFile)) {
        const cfg = fs.readFileSync(cfgFile, "utf8");
        config.env.CAPTCHETAT_CONFIGURED = cfg.includes("CAPTCHETAT_BASE_URL");
      }
      return getLocations(`${config.baseUrl}/sitemap.xml`).then((urls) => {
        config.env.URLS = urls;
        return config;
      });
    },
    baseUrl: "https://preprod.dados.gov.pt",
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
      const locs = [...xml.matchAll(`<loc>(.|\n)*?</loc>`)].map(([loc]) => {
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
