// ***********************************************
// This example commands.js shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
//
//
// -- This is a parent command --
// Cypress.Commands.add('login', (email, password) => { ... })
//
//
// -- This is a child command --
// Cypress.Commands.add('drag', { prevSubject: 'element'}, (subject, options) => { ... })
//
//
// -- This is a dual command --
// Cypress.Commands.add('dismiss', { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })

/**
 * Verifica se existem imagens partidas (broken images) na página.
 * Itera sobre todos os elementos <img> visíveis e valida naturalWidth > 0.
 * Imagens SVG inline e placeholders data: são ignorados.
 */
Cypress.Commands.add("checkBrokenImages", () => {
  cy.get("img:visible").each(($img) => {
    const src = $img.attr("src") || "";
    // Ignorar SVGs inline e data URIs
    if (src.startsWith("data:") || src.endsWith(".svg")) {
      return;
    }
    // Verificar se a imagem carregou corretamente
    cy.wrap($img).should(($el) => {
      const img = $el[0];
      expect(img.naturalWidth, `Imagem partida: ${src}`).to.be.greaterThan(0);
    });
  });
});

/**
 * Valida que o tempo de resposta de um URL está dentro do limite.
 * @param {string} url - URL a testar
 * @param {number} maxMs - Tempo máximo em milissegundos (default: 5000)
 */
Cypress.Commands.add("assertResponseTime", (url, maxMs = 5000) => {
  const start = Date.now();
  cy.request({
    url,
    failOnStatusCode: false,
    timeout: maxMs + 1000,
  }).then((response) => {
    const elapsed = Date.now() - start;
    expect(response.status, `${url} retornou status ${response.status}`).to.eq(
      200,
    );
    expect(
      elapsed,
      `${url} respondeu em ${elapsed}ms (max: ${maxMs}ms)`,
    ).to.be.lessThan(maxMs);
  });
});
