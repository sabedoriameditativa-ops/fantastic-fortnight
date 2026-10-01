# Sabedoria Meditativa

App de meditação guiada para web. Pode ser instalado no celular (Android e iPhone) como um aplicativo e funciona sem internet.

## Funcionalidades

- **Meditações guiadas** (6 sessões de 3 a 10 min) com texto na tela e narração por voz em português
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

## Atualizações

Ao alterar arquivos, aumente a versão em `sw.js` (`sabedoria-v1` → `sabedoria-v2`) para os usuários receberem a nova versão.

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html` | Telas do app |
| `styles.css` | Visual |
| `app.js` | Lógica: meditações, respiração, sons e progresso |
| `sw.js` | Funcionamento offline |
| `manifest.webmanifest` | Dados para instalar como app |
| `icons/` | Ícones |

## Ideias para gerar renda

- **Plano premium (freemium):** deixar algumas meditações grátis e liberar as demais por assinatura mensal (ex.: via Stripe, Mercado Pago ou Hotmart).
- **Narração com sua própria voz:** gravar os áudios das meditações aumenta muito o valor percebido.
- **Programas pagos:** trilhas como "21 dias contra a ansiedade" ou "Durma melhor em 7 dias".
- **Captura de e-mails:** oferecer o app grátis em troca do e-mail e divulgar cursos e mentorias.
- **Versão para empresas:** pacotes de bem-estar para equipes.
