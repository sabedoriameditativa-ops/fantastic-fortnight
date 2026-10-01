# Sabedoria Meditativa

App de meditação guiada para web. Pode ser instalado no celular (Android e iPhone) como um aplicativo e funciona sem internet.

## Funcionalidades

- **Meditações guiadas** (12 sessões de 2 a 10 min: 4 grátis e 8 premium) com texto na tela e narração por voz em português
- **Jornada "Comece a meditar em 7 dias"**: o primeiro dia é grátis e os demais são premium
- **Área premium** com link de pagamento e liberação por código de acesso
- **Áudios com a sua voz**: as gravações substituem a voz sintética (veja `audio/LEIA-ME.md`)
- **Meditação livre** com duração à escolha, som de fundo e sino opcional a cada minuto
- **Exercícios de respiração** animados: Caixa 4-4-4-4, 4-7-8, Coerente 5-5 e Relaxante 4-6
- **Sons relaxantes**: chuva, oceano, vento, riacho, tigela tibetana e ruído marrom, com timer para desligar
- **Progresso**: dias seguidos, minutos totais, gráfico da semana e histórico
- Os sons são gerados pelo próprio aparelho (sem arquivos de áudio) e os dados ficam salvos no celular

## Como testar no computador

Na pasta do projeto, rode:

```bash
python3 -m http.server 8000
```

Depois abra http://localhost:8000 no navegador.

## Como publicar de graça (GitHub Pages)

1. No GitHub, abra o repositório e vá em **Settings → Pages**.
2. Em **Source**, escolha **Deploy from a branch**, selecione o branch principal e a pasta `/ (root)`.
3. Salve. Em alguns minutos o app estará em `https://<seu-usuario>.github.io/<repositorio>/`.
4. Abra esse link no celular:
   - **Android (Chrome):** toque em "Instalar app" ou no menu ⋮ → "Instalar aplicativo".
   - **iPhone (Safari):** toque em Compartilhar → "Adicionar à Tela de Início".

## Área premium: como começar a vender

1. **Crie um produto de assinatura** na Hotmart, Kiwify, Mercado Pago ou Stripe e copie o **link de pagamento**.
2. **Gere um código de acesso:** abra `ferramentas/gerar-codigo.html` no navegador (por exemplo, http://localhost:8000/ferramentas/gerar-codigo.html), clique em "Sugerir código" e depois em "Gerar".
3. **Edite o `config.js`:**
   - cole o link em `checkoutUrl`;
   - cole a linha gerada dentro de `codeHashes: [ ]`;
   - ajuste `price` e coloque seu e-mail ou link de WhatsApp em `support`.
4. **Entregue o código a quem pagar.** A maioria das plataformas permite colocar uma mensagem ou "conteúdo" na confirmação de compra. Coloque o código ali.
5. A pessoa toca em **✨ Premium → "Já assinou?"**, digita o código e o conteúdo é liberado.

**Dica para assinatura mensal:** troque o código todo mês. Gere um novo, acrescente o hash dele em `codeHashes` e envie o código novo só para quem renovou. Depois de alguns dias, apague o hash antigo: quem usava o código antigo perde o acesso.

**Importante:** este é um sistema simples, sem servidor, ideal para começar e validar a ideia. Uma pessoa com conhecimento técnico consegue contornar o bloqueio ou repassar o código para outras pessoas. Quando as vendas crescerem, o próximo passo é um login com verificação no servidor (por exemplo, com Supabase ou Firebase integrado à plataforma de pagamento).

## Como editar o conteúdo

- **Textos das meditações e da jornada:** `conteudo.js`. Para tornar uma meditação grátis ou premium, mude `premium: true`.
- **Nome, preço e pagamento:** `config.js`. O nome do app instalado no celular fica em `manifest.webmanifest`.
- **Cores:** variáveis no começo de `styles.css` (por exemplo, `--accent`).
- **Gravações com a sua voz:** siga `audio/LEIA-ME.md`.

## Atualizações

Com internet, o app sempre busca a versão mais nova dos arquivos. Ao incluir arquivos novos que precisem funcionar offline desde o primeiro uso, adicione-os à lista em `sw.js` e aumente a versão (`sabedoria-v2` → `sabedoria-v3`).

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html` | Telas do app |
| `styles.css` | Visual |
| `config.js` | Nome, preço, link de pagamento e códigos premium |
| `conteudo.js` | Textos das meditações e da jornada |
| `app.js` | Lógica: meditações, premium, jornada, respiração, sons e progresso |
| `sw.js` | Funcionamento offline |
| `manifest.webmanifest` | Dados para instalar como app |
| `icons/` | Ícones |
| `audio/` | Suas gravações (veja `audio/LEIA-ME.md`) |
| `ferramentas/gerar-codigo.html` | Gerador de códigos de acesso premium |

## Ideias para gerar renda

- **Plano premium (freemium):** já está pronto. Só falta configurar o pagamento (veja acima).
- **Narração com sua própria voz:** gravar os áudios das meditações aumenta muito o valor percebido.
- **Novas jornadas:** trilhas como "21 dias contra a ansiedade" ou "Durma melhor em 7 dias".
- **Captura de e-mails:** oferecer o app grátis em troca do e-mail e divulgar cursos e mentorias.
- **Versão para empresas:** pacotes de bem-estar para equipes.
