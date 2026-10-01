'use strict';

/* =========================================================
 * CONFIGURAÇÃO DO SEU NEGÓCIO: edite este arquivo.
 * Veja o passo a passo no README.md, seção "Área premium".
 * ========================================================= */
const CONFIG = {
  // Nome mostrado no topo do app e na aba do navegador.
  // (O nome do app instalado fica em manifest.webmanifest.)
  appName: 'Sabedoria Meditativa',

  premium: {
    // Texto do preço mostrado na tela de assinatura.
    price: 'R$ 19,90/mês',

    // Link de pagamento criado na Hotmart, Kiwify, Mercado Pago, Stripe etc.
    // Enquanto estiver vazio, o botão "Assinar" fica desativado.
    checkoutUrl: '',

    // Códigos de acesso que você envia a quem pagou, guardados como "impressão
    // digital" (hash SHA-256) para não aparecerem no código do app.
    // Gere com a página ferramentas/gerar-codigo.html e cole aqui.
    codeHashes: [],

    // Contato para dúvidas sobre a assinatura (e-mail ou link de WhatsApp).
    support: '',
  },
};
