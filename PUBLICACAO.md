# Publicação: Fourteen Tides / Quinzena Fantástica

Guia para publicar o jogo no **itch.io** (primeiro) e na **CrazyGames** (depois). Tem os textos da loja prontos
para colar, em inglês e em português, a lista de qual imagem vai em cada campo, o passo a passo de cada portal e as
listas de conferência.

**Sobre as fontes.** As regras dos portais vêm de uma pesquisa feita no **início de outubro de 2026** (4/10/2026),
nas páginas oficiais citadas em cada item. Os marcadores abaixo seguem essa pesquisa:

- **[NÃO OFICIAL]**: vem de post de comunidade, de guia de terceiros ou do código do portal de desenvolvedor da
  CrazyGames, e não da documentação.
- **[INCERTO]**: a documentação não diz. É uma suposição razoável, mas confira no formulário.

Os portais mudam os formulários sem aviso. Se algo aqui não bater com a tela que você está vendo, vale o que a tela
mostra.

---

## 1. Resumo

| | |
|---|---|
| Nome em português | **Quinzena Fantástica** (subtítulo: *Catorze noites no farol da Ilha Perdida*) |
| Nome em inglês (final) | **Fourteen Tides** (subtítulo: *Fourteen nights at the lighthouse of the Lost Isle*) |
| Gênero | roguelite de sobrevivência em arena, visto de cima: você só se move e as armas disparam sozinhas |
| Duração | 14 noites; as 12 noites com relógio somam 696 s (≈ 11,6 min), e as noites 7 e 14 só acabam quando o chefe cai |
| Idiomas | inglês e português (Brasil). Abre no idioma do navegador (`pt…` → português, qualquer outro → inglês) e tem o botão “English” / “Português” no título e na pausa |
| Entradas | teclado, mouse e toque (joystick virtual ao arrastar). Paisagem e retrato, computador e celular |
| Rede | nenhuma requisição externa: sem SDK, sem anúncios, sem links, fontes dentro do pacote |
| Salvamento | `localStorage`, chave `quinzena-fantastica:v1`: recorde (pontos e noite), som e idioma |
| Tela cheia | o jogo não tem botão próprio; quem oferece é o portal |

### O pacote (ZIP)

```bash
npm test          # confere o jogo antes de empacotar
npm run pacote    # gera dist/quinzena-fantastica.zip
```

O mesmo ZIP serve para os dois portais. Saída de `npm run pacote` em 4/10/2026:

```text
dist/quinzena-fantastica.zip: 228,488 bytes (223.1 KB), 10 files (434,082 bytes uncompressed)
```

| Arquivo no ZIP | Tamanho | Compactado | Método |
|---|---:|---:|---|
| `index.html` (na raiz) | 13.200 | 3.228 | deflate |
| `style.css` | 34.574 | 8.949 | deflate |
| `game.js` | 229.223 | 62.875 | deflate |
| `fonts/alegreya-sans-500-latin.woff2` | 23.928 | 23.928 | stored |
| `fonts/alegreya-sans-500-latin-ext.woff2` | 21.500 | 21.500 | stored |
| `fonts/alegreya-sans-700-latin.woff2` | 23.976 | 23.976 | stored |
| `fonts/alegreya-sans-700-latin-ext.woff2` | 21.868 | 21.868 | stored |
| `fonts/im-fell-english-sc-400-latin.woff2` | 56.956 | 56.896 | deflate |
| `fonts/OFL-AlegreyaSans.txt` | 4.405 | 1.965 | deflate |
| `fonts/OFL-IMFellEnglishSC.txt` | 4.452 | 1.983 | deflate |

Tamanhos em bytes. O script reimprime esses números a cada execução: confira-os de novo antes de enviar, porque
qualquer mudança no jogo muda o ZIP. O caminho mais longo, `fonts/alegreya-sans-700-latin-ext.woff2`, tem
39 caracteres.

**Limites dos portais × este pacote**

| Limite | CrazyGames | itch.io | Este jogo |
|---|---|---|---|
| Tamanho total | ≤ 250 MB; sem SDK, o total conta como download inicial: ≤ 50 MB, e ≤ 20 MB para a home de celular ([technical](https://docs.crazygames.com/requirements/technical/)) | ≤ 500 MB descompactado, ≤ 200 MB por arquivo ([html5](https://itch.io/docs/creators/html5)) | 0,43 MB descompactado |
| Arquivos | ≤ 1500 | ≤ 1.000 | 10 |
| Caminhos | só relativos | relativos, `index.html` na raiz, maiúsculas/minúsculas exatas, nome com caminho ≤ 240 caracteres | ok (validado por `tools/pacote.mjs`) |

### As imagens e os vídeos

Tudo em `publicacao/`, gerado a partir do próprio jogo:

```bash
npm run midia                                  # tudo, cerca de 4,5 min
node tools/midia.mjs --only covers,shots       # só alguns grupos: covers, shots, phone, videos
node tools/midia.mjs --out /tmp/midia --keep-temp
```

Precisa do Playwright com Chromium (o mesmo dos testes, nada é baixado) e de `ffmpeg`/`ffprobe` no PATH. No fim, o
script confere cada arquivo (tamanho exato em pixels, PNG ≤ 2,5 MB, vídeo H.264 yuv420p sem faixa de áudio, de 15 a
20 s, ≤ 50 MB e com *fast start*) e sai com código 1 se algo falhar.

Como as cenas são feitas (isto importa para a regra de “vídeo não enganoso” da CrazyGames):

- **Capturas e vídeos:** partidas reais com semente fixa, jogadas desde a noite 1 por um dos robôs de
  `tools/balance-bots.js`, em modo deus, em velocidade real (30 fps, 2 passos de simulação por quadro). No modo deus o
  faroleiro não sofre dano nenhum, por isso a barra de vida aparece cheia em todas as capturas e nos vídeos. Nível,
  abates, pontos e armas no HUD são os que aquela partida alcançou.
- **Capas (key art):** cena montada sem HUD (noite escolhida, armas concedidas e criaturas extras) e composta com
  brilho, vinheta e o título na fonte IM Fell English SC. A CrazyGames pede exatamente isso: arte, e não uma captura
  crua ([game-covers](https://docs.crazygames.com/requirements/game-covers/)).
- O título em inglês das capas está fixo em `tools/midia.mjs` (`TITLE`), além de `STRINGS.en.gameTitle` no
  `game.js`. Se um dia mudar, mude nos dois lugares e rode `npm run midia` de novo.

| Arquivo (`publicacao/…`) | Pixels | Tamanho | Uso |
|---|---|---:|---|
| `crazygames/cover-landscape-1920x1080.png` | 1920×1080 | 1,84 MB | CrazyGames: capa paisagem 16:9 |
| `crazygames/cover-portrait-800x1200.png` | 800×1200 | 0,97 MB | CrazyGames: capa retrato 2:3 |
| `crazygames/cover-square-800x800.png` | 800×800 | 0,69 MB | CrazyGames: capa quadrada 1:1 |
| `crazygames/preview-landscape-1920x1080.mp4` | 1920×1080 | 5,03 MB | CrazyGames: vídeo paisagem, 17,9 s |
| `crazygames/preview-portrait-1080x1620.mp4` | 1080×1620 | 5,02 MB | CrazyGames: vídeo retrato, 17,9 s |
| `itch/cover-630x500.png` | 630×500 | 0,37 MB | itch: Cover image (título + subtítulo) |
| `itch/embed-background-960x540.png` | 960×540 | 0,46 MB | itch: fundo atrás do botão Play (sem texto) |
| `screenshots/en/01-early-night-1920x1080.png` | 1920×1080 | 1,32 MB | noite 3, ao lado do farol, com caranguejos e águas-vivas |
| `screenshots/en/02-mid-game-build-1920x1080.png` | 1920×1080 | 1,39 MB | noite 11, nível 17, cinco âncoras, facho, arpão |
| `screenshots/en/03-level-up-1920x1080.png` | 1920×1080 | 1,05 MB | “Reached Level 13”, três cartas |
| `screenshots/en/04-crab-king-1920x1080.png` | 1920×1080 | 1,20 MB | noite 7, investida do Crab King |
| `screenshots/en/05-tide-leviathan-1920x1080.png` | 1920×1080 | 1,27 MB | noite 14, Tide Leviathan enfurecido |
| `screenshots/en/phone-01-joystick-780x1688.png` | 780×1688 | 0,76 MB | celular: noite 10, joystick virtual |
| `screenshots/en/phone-02-tide-leviathan-780x1688.png` | 780×1688 | 1,13 MB | celular: luta com o Leviatã |
| `screenshots/pt/01-melhoria-1920x1080.png` | 1920×1080 | 1,05 MB | “Subiu para o nível 13” |
| `screenshots/pt/02-caranguejo-rei-1920x1080.png` | 1920×1080 | 1,38 MB | “Noite 7/14”, Caranguejo-Rei |

`publicacao/` não entra no ZIP do jogo.

---

## 2. Textos da loja

Os textos estão em blocos para copiar. Os títulos de seção dentro dos blocos (*How to Play…*, *Features*…) são
linhas simples: no itch.io, selecione cada um e aplique **Header 2** (é o que o itch recomenda,
[getting-started](https://itch.io/docs/creators/getting-started)). Os textos não têm nenhum link.

Troque `<YOUR NAME>` / `<SEU NOME>` e `<YOUR CONTACT>` / `<SEU CONTATO>` antes de colar.

| Bloco | itch.io (campo *Description*) | CrazyGames |
|---|---|---|
| A. Descrição (gancho, como jogar, destaques) | sim, 1º | campo *description*, 1º |
| B. Controles | sim, 2º | campo *controls* (separado) |
| C. Créditos | sim, 3º | campo *description*, 2º |
| D. Contato | sim, 4º | não |

### 2.1 Frase curta (*short description* / tagline)

Limite de 120 caracteres no itch **[NÃO OFICIAL]**: é a mensagem de validação (“expected text between 1 and 120
characters”) citada num post de 2020 no fórum do itch (tópico 1108972, respondido pelo admin leafo). Contagens feitas
com Python (`len`).

| | Texto | Caracteres |
|---|---|---:|
| EN | `Hold the lighthouse for 14 nights as glowing sea creatures crawl ashore. Just move: your weapons fire on their own.` | 115 |
| PT | `Defenda o farol por 14 noites enquanto criaturas luminosas sobem do mar. Você só se move: as armas disparam sozinhas.` | 117 |

### 2.2 Bloco A: descrição

**EN**

```text
Fourteen Tides is a top-down survival roguelite for the browser. You are the keeper of the lighthouse on the Lost Isle, and every night glowing creatures rise from the sea and crawl toward your light. Hold out for fourteen nights. On nights 7 and 14, something far bigger comes out of the waves.

How to Play Fourteen Tides
- Just move: your weapons fire on their own.
- Defeated creatures drop embers. Collect them to level up, then choose one of three upgrades.
- The lighthouse beam sweeps the island and slows down the creatures it lights up. With the Fresnel Lens, it also burns the ones near the tower.
- Each night lasts a little longer than the last, and each dawn restores 30% of your health.
- On nights 7 and 14, dawn only comes when the boss falls: first the Crab King, then the Tide Leviathan.
- Your score counts creatures defeated, embers collected, nights survived and bosses defeated.

Features
- 14 nights and 2 bosses: the Crab King and the Tide Leviathan
- 5 weapons, up to four at a time: Spark, Fresnel Lens, Burning Lantern, Spinning Anchors and Harpoon
- 7 passive upgrades: Sailor’s Boots, Reinforced Hull, Keeper’s Lungs, Ember Magnet, Long Wick, Dry Powder and Hourglass. Every upgrade goes up to level 5.
- Crabs, jellyfish, moray eels, pufferfish and ink squids, plus golden creatures from night 10 that are far tougher than the rest
- Keyboard, mouse or touch; landscape or portrait; desktop or phone
- English and Brazilian Portuguese, switchable at any time
- Your high score (points and night reached) is saved in your browser
- No ads, no sign-up, no external links: the game makes no network requests
```

**PT**

```text
Quinzena Fantástica é um roguelite de sobrevivência visto de cima, para jogar no navegador. Você cuida do farol da Ilha Perdida, e toda noite criaturas luminosas sobem do mar e rastejam até a sua luz. Resista às catorze noites. Nas noites 7 e 14, algo muito maior sai das ondas.

Como jogar Quinzena Fantástica
- Você só precisa se mover: suas armas disparam sozinhas.
- Criaturas derrotadas deixam brasas. Recolha-as para subir de nível e escolher uma entre três melhorias.
- O facho do farol varre a ilha e desacelera as criaturas que ilumina. Com a Lente de Fresnel, ele também queima as que estão perto da torre.
- Cada noite dura um pouco mais que a anterior, e a cada amanhecer você recupera 30% da vida.
- Nas noites 7 e 14, o amanhecer só chega quando o chefe cai: primeiro o Caranguejo-Rei, depois o Leviatã das Marés.
- A pontuação soma criaturas derrotadas, brasas recolhidas, noites sobrevividas e chefes vencidos.

Destaques
- 14 noites e 2 chefes: o Caranguejo-Rei e o Leviatã das Marés
- 5 armas, até quatro por vez: Faísca, Lente de Fresnel, Lanterna Ardente, Âncoras Giratórias e Arpão
- 7 melhorias passivas: Botas de Marinheiro, Casco Reforçado, Pulmões de Faroleiro, Ímã de Brasas, Pavio Longo, Pólvora Seca e Ampulheta. Cada melhoria vai até o nível 5.
- Caranguejos, águas-vivas, moreias, baiacus e lulas-tinteiras, além de criaturas douradas, bem mais resistentes, a partir da noite 10
- Teclado, mouse ou toque; paisagem ou retrato; computador ou celular
- Em português e em inglês, com troca a qualquer momento
- O recorde (pontos e noite alcançada) fica salvo no navegador
- Sem anúncios, sem cadastro, sem links externos: o jogo não faz nenhuma requisição de rede
```

### 2.3 Bloco B: controles

No estilo “teclas *to* ação”, uma ação por linha, como nas páginas da CrazyGames (ex.: “WASD or arrow keys to
drive”, [Smash Karts](https://www.crazygames.com/game/smash-karts)).

- **Pausa:** o jogo pausa com `P` **ou** `Esc`, mas na CrazyGames o `Esc` sai da tela cheia (“Escape closes
  fullscreen”, [quality](https://docs.crazygames.com/requirements/quality/)). Por isso a lista publicada cita só o
  `P`. No itch, se quiser, escreva “P or Esc to pause and resume”.
- **AZERTY:** o movimento usa a posição física das teclas (`KeyboardEvent.code`), então ZQSD funciona sozinho num
  teclado francês, como a CrazyGames recomenda. `P` e `M` seguem a letra digitada.

**EN**

```text
Controls
- WASD or arrow keys to move (ZQSD on AZERTY keyboards)
- Drag anywhere (mouse or touch) to move with the virtual joystick
- P to pause and resume
- M to turn sound on or off
- 1, 2 or 3 to pick an upgrade (or arrow keys + Enter)
- Enter or Space to start the next night
- Tap a card, or the pause and sound buttons at the top, on touch screens
- “Português” button (title screen or pause menu) to switch the language to Portuguese
```

**PT**

```text
Controles
- WASD ou setas para mover (ZQSD em teclados AZERTY)
- Arraste em qualquer lugar (mouse ou toque) para mover com o joystick virtual
- P para pausar e continuar
- M para ligar ou desligar o som
- 1, 2 ou 3 para escolher a melhoria (ou setas + Enter)
- Enter ou Espaço para começar a próxima noite
- Toque na carta, ou nos botões de pausa e de som no alto da tela, no celular
- Botão “English” (tela inicial ou pausa) para mudar o idioma para inglês
```

### 2.4 Bloco C: créditos

A primeira linha descreve como o jogo foi feito (veja a seção 3.6). O itch pede que geração por IA fique clara na
descrição ([quality-guidelines](https://itch.io/docs/creators/quality-guidelines)). Ajuste a redação como preferir.

**EN**

```text
Credits
- Made by <YOUR NAME> with Claude Code, Anthropic’s AI coding tool. The game’s code, text and graphics were generated with it; the graphics are drawn in code, and the sound is synthesized in the browser.
- Fonts: IM Fell English SC by Igino Marini and Alegreya Sans by The Alegreya Sans Project Authors, both under the SIL Open Font License 1.1. The license files ship with the game, in the fonts folder.
```

**PT**

```text
Créditos
- Feito por <SEU NOME> com o Claude Code, a ferramenta de programação com IA da Anthropic. O código, os textos e os gráficos do jogo foram gerados com ela; os gráficos são desenhados por código, e o som é sintetizado no navegador.
- Fontes: IM Fell English SC, de Igino Marini, e Alegreya Sans, de The Alegreya Sans Project Authors, ambas sob a SIL Open Font License 1.1. Os arquivos de licença acompanham o jogo, na pasta fonts.
```

### 2.5 Bloco D: contato (só itch.io)

```text
Contact
<YOUR CONTACT>
```

```text
Contato
<SEU CONTATO>
```

O itch pede “Make sure to add contact information”
([getting-started](https://itch.io/docs/creators/getting-started)).

### 2.6 Gênero e tags

- **itch.io:** gênero **Action**. O itch aceita até 10 tags e pede que o nome do jogo ou o seu nome não sejam usados
  como tag ([getting-started](https://itch.io/docs/creators/getting-started),
  [quality-guidelines](https://itch.io/docs/creators/quality-guidelines)). Sugestão (10):
  `roguelite`, `survival`, `top-down`, `arena`, `survivors-like`, `boss-battle`, `singleplayer`, `lighthouse`,
  `ocean`, `monsters`.
- **CrazyGames:** o formulário tem categoria e tags (`categoryId`, `tagIds`) escolhidas em listas que só aparecem
  com login **[NÃO OFICIAL]**. Escolha uma categoria de ação e as tags da lista mais próximas das sugestões acima.

---

## 3. itch.io: passo a passo

Fontes principais: [HTML5 games](https://itch.io/docs/creators/html5),
[getting-started](https://itch.io/docs/creators/getting-started),
[quality-guidelines](https://itch.io/docs/creators/quality-guidelines),
[getting-indexed](https://itch.io/docs/creators/getting-indexed).

> Uma página nova nasce privada (“Newly created pages are private by default”). Na **primeira** publicação, ela
> entra uma única vez na lista *Most Recent* (“It can not be put on the top of the Most Recent page again”).
> Monte e teste tudo com a página privada e só publique quando estiver pronta.

### 3.1 Projeto

| Campo | Valor |
|---|---|
| Title | `Fourteen Tides` |
| Short description | frase curta EN da seção 2.1 |
| Classification | Game |
| Kind of project | **HTML** |
| Uploads | `dist/quinzena-fantastica.zip` (só ZIP: “.rar, .tar.gz, and .7z are not supported”) |
| Depois do upload | marque *This file will be played in the browser* **[NÃO OFICIAL]**: o rótulo vem do guia do GDevelop (https://wiki.gdevelop.io/gdevelop5/publishing/publishing-to-itch-io/) |
| Plataformas | **não** marque Windows, Linux, macOS ou Android: “Do not select a platform … unless you have a program that runs directly on the respective operating system” |
| Description | blocos A + B + C + D (EN). Se quiser uma página bilíngue, cole depois os mesmos blocos em PT |
| Genre / Tags | seção 2.6 |

### 3.2 Embed (opções do jogo no navegador)

| Opção | Valor | Por quê |
|---|---|---|
| Modo | **Embed in page** | “You provide the dimensions of the viewport” |
| Viewport | **960 × 540** | 16:9 que ocupa exatamente a coluna padrão de 960 px (`#inner_column (default width: 960px)`, [css-guide](https://itch.io/docs/creators/css-guide)). O tamanho máximo permitido não está documentado **[INCERTO]** |
| Mobile friendly | **ligado** | o jogo se ajusta ao tamanho da tela e aceita toque. No celular, o itch sempre abre em tela cheia (“Click to launch in fullscreen mode regardless…”). O post oficial de 2017 pede que só se marque isso se o jogo foi testado em celular ([mobile](https://itch.io/updates/better-support-for-mobile-html-games-more)): veja a seção 6.2 |
| Orientação (celular) | teste no aparelho | o post de 2017 diz que o itch trava a orientação “based on the dimension of the game”. Um seletor Default/Landscape/Portrait é relatado pela comunidade **[NÃO OFICIAL]** (https://itch.io/t/3177029/html-game-orientation-inconsistent-and-locked-on-mobile) |
| Fullscreen button | **ligado** | botão do itch, por cima da página. O jogo não tem botão próprio |
| Scrollbars | **desligado** | o jogo ocupa o quadro inteiro (“They are hidden by default”) |
| Click to play | **ligado** (padrão) | com início automático, “audio may be muted on some browsers” |
| Background Image | `publicacao/itch/embed-background-960x540.png` | “A image that takes up the size of the viewport that sits behind the Play button” |

### 3.3 Metadados

Fonte: [getting-indexed](https://itch.io/docs/creators/getting-indexed) e
[quality-guidelines](https://itch.io/docs/creators/quality-guidelines).

- **Languages:** English e Portuguese (Brazil, se a lista tiver a variante). O jogo inclui as duas traduções, que é
  a condição do itch: “only select a language if your project explicitly includes a translation”.
- **Inputs:** Keyboard, Mouse, Touchscreen.
- **Accessibility:** marque só o que for verdade. Fatos do jogo: dá para jogar só com o teclado; botões e HUD têm
  nomes acessíveis (`aria-label`); o som desliga com `M`.
- **Multiplayer:** nenhum.

### 3.4 Preço

“Currently all HTML5 games on itch.io are set up to only take payments as donations”
([html5](https://itch.io/docs/creators/html5)). A escolha é sua: não cobrar nada ou aceitar doações. Para quem
**vende** o primeiro projeto numa conta nova, a página entra numa fila de revisão
([getting-indexed](https://itch.io/docs/creators/getting-indexed)); se isso vale para doações, a pesquisa não
verificou **[INCERTO]**.

### 3.5 Imagens: o que vai onde

| Campo no itch | Arquivo | Observação |
|---|---|---|
| Cover image | `publicacao/itch/cover-630x500.png` | proporção 315:250, tamanho recomendado 630×500 ([getting-started](https://itch.io/docs/creators/getting-started)). Sem capa, a página não é indexada ([getting-indexed](https://itch.io/docs/creators/getting-indexed)) |
| Screenshots (3 a 5) | `screenshots/en/02-mid-game-build…`, `03-level-up…`, `04-crab-king…`, `05-tide-leviathan…`, `phone-01-joystick…` | “recommended to upload between 3 and 5”. Reservas: `en/01-early-night…`, `en/phone-02-tide-leviathan…`, e `pt/*` se a página for em português |
| Embed background | `publicacao/itch/embed-background-960x540.png` | seção 3.2 |
| Banner | nenhum (opcional) | substitui o título acima da descrição ([design](https://itch.io/docs/creators/design)) |
| Trailer | opcional | só link do YouTube, Vimeo ou SketchFab ([design](https://itch.io/docs/creators/design)). Dá para subir `crazygames/preview-landscape-1920x1080.mp4` no YouTube e colar o link |

- Em páginas HTML5, o itch esconde a coluna de capturas por padrão (“single column mode that hides the screenshot
  column”). Para mostrá-las: *Edit theme* → Layout → Screenshots → **Sidebar**
  ([design](https://itch.io/docs/creators/design)). Mesmo escondidas, o itch usa as capturas em outras partes do site.
- Limite de cerca de 3 MB por imagem **[NÃO OFICIAL]** (guia da comunidade, https://hedgiespresso.itch.io/itch-page-image-templates).
  A maior imagem daqui tem 1,84 MB.

### 3.6 Divulgação de IA (*AI Disclosure*)

O itch pede: “We ask that you accurately tag your project if it contains materials produced by generative AI by
utilizing the AI Disclosure section on your project's edit page”, e também que a geração por IA fique “clearly
stated in your project description” ([quality-guidelines](https://itch.io/docs/creators/quality-guidelines)).

Os fatos, para você decidir como marcar:

| Parte | Como foi feita |
|---|---|
| Código (`game.js`, `index.html`, `style.css`) | gerado com o Claude Code (IA generativa), a partir das suas instruções e escolhas |
| Textos do jogo (PT e EN) e textos desta loja | gerados com o Claude Code |
| Gráficos do jogo | desenhados em tempo real por código (canvas) gerado com o Claude Code. O ZIP não tem nenhum arquivo de imagem |
| Capas, capturas e vídeos | renderizados a partir do próprio jogo por `tools/midia.mjs`, também escrito com o Claude Code. Nenhum gerador de imagem foi usado |
| Som | sintetizado em tempo real por código (Web Audio) gerado com o Claude Code. O ZIP não tem nenhum arquivo de áudio |
| Fontes | não são IA: IM Fell English SC e Alegreya Sans, do Google Fonts, sob a SIL OFL 1.1 |

A marcação no formulário é decisão sua. Este guia não escolhe por você.

### 3.7 Publicar

1. Salve com a página ainda privada e abra a prévia.
2. Jogue uma noite inteira no computador: clique em Play, use teclado e mouse, pause com `P`, desligue o som com `M`,
   troque o idioma, use o botão de tela cheia do itch.
3. Abra a prévia num celular de verdade (seção 6.2).
4. Só então torne a página pública.

---

## 4. CrazyGames: passo a passo

Fontes principais: [docs.crazygames.com](https://docs.crazygames.com/),
[requirements/intro](https://docs.crazygames.com/requirements/intro/),
[technical](https://docs.crazygames.com/requirements/technical/),
[gameplay](https://docs.crazygames.com/requirements/gameplay/),
[game-covers](https://docs.crazygames.com/requirements/game-covers/),
[quality](https://docs.crazygames.com/requirements/quality/), [FAQ](https://docs.crazygames.com/faq/). O envio é
feito em https://developer.crazygames.com/ (precisa de login).

### 4.1 Basic Launch sem SDK

| | |
|---|---|
| O que é | o primeiro estágio. “A game in Basic Launch allows you to go live without needing to customize your game for CrazyGames. The CrazyGames SDK is optional and monetization is not available.” ([intro](https://docs.crazygames.com/requirements/intro/)) |
| Público e duração | “limited audience for a temporary period of 7 to 21 days” |
| Quando acaba | depois de pelo menos 7 dias no ar **e** 500 partidas; se não chegar a 500, acaba sozinho aos 21 dias ([docs](https://docs.crazygames.com/)) |
| O que decide a promoção | “average playtime, conversion to gameplay, and retention” ([docs](https://docs.crazygames.com/)) |
| Referências | “10+ minutes of average play time”; “10-15% Day 1 Retention”; “convert 80%+ of players, load in under 10 seconds, and have a build size below 20 MB”. Conversão = jogar pelo menos 1 minuto depois de começar ([basic-launch-metrics](https://docs.crazygames.com/resources/basic-launch-metrics/)) |
| Anúncios | nenhum: “Ads are not allowed in Basic Launch” ([technical](https://docs.crazygames.com/requirements/technical/)) |

Este jogo entra assim: **sem SDK**, sem anúncios, com 0,43 MB no total (bem abaixo dos 20 MB da home de celular).

### 4.2 O que enviar

- O portal envia cada arquivo com o seu caminho. A FAQ fala em arrastar pastas (“Just drag the Build and
  StreamingAssets folder in the upload area”, exemplo de Unity). **[INCERTO]** se o `.zip` é aceito como está.
- Plano: descompacte o mesmo ZIP do itch e arraste o **conteúdo** da pasta, com `index.html` no nível de cima.

  ```bash
  unzip dist/quinzena-fantastica.zip -d dist/crazygames    # no Windows: botão direito → Extrair tudo
  ```

  A pasta tem: `index.html`, `style.css`, `game.js` e `fonts/` (7 arquivos). Se o portal aceitar o `.zip` direto,
  envie o ZIP.

### 4.3 Capas e vídeos

As três capas e os dois vídeos são obrigatórios ([game-covers](https://docs.crazygames.com/requirements/game-covers/)).

| Campo | Arquivo | Regra | Este arquivo |
|---|---|---|---|
| Capa paisagem 16:9 | `publicacao/crazygames/cover-landscape-1920x1080.png` | 1920×1080 | ok |
| Capa retrato 2:3 | `publicacao/crazygames/cover-portrait-800x1200.png` | 800×1200 | ok |
| Capa quadrada 1:1 | `publicacao/crazygames/cover-square-800x800.png` | 800×800 | ok |
| Vídeo paisagem | `publicacao/crazygames/preview-landscape-1920x1080.mp4` | 1080p 16:9 | 1920×1080 |
| Vídeo retrato | `publicacao/crazygames/preview-portrait-1080x1620.mp4` | “1080p - 2:3” | 1080×1620 **[INCERTO]**: a doc não dá os pixels |

O que as regras pedem e o que os arquivos têm:

| Regra | Situação |
|---|---|
| Capas: só o título escrito; sem borda, ícones, logos de loja, “New” ou “Play” | só “Fourteen Tides”, sem subtítulo |
| Capas: visual coerente entre as três; não é captura crua; fonte estilizada | mesma key art nas três, título em IM Fell English SC (a OFL permite usar a fonte em imagens) |
| Capas: formato e tamanho máximo do arquivo | não informados **[INCERTO]**: PNG no tamanho exato |
| Vídeo: 15 a 20 s (cortado em 20 s), ≤ 50 MB | 17,9 s; 5,0 MB cada |
| Vídeo: sem som | sem faixa de áudio |
| Vídeo: abre na capa estática | 1 s de capa, depois transição de 0,4 s para o jogo |
| Vídeo: sem acelerar (“We automatically speed up the video slightly”) | velocidade real, 30 fps |
| Vídeo: sem tarjas pretas, cursor do mouse, “Play Now”, ícones | gravado no tamanho final; capturas sem cursor; nenhum texto promocional |
| Vídeo: representa o jogo, sem enganar | partidas reais (seção 1, “Como as cenas são feitas”); só a vida fica sempre cheia, por causa do modo deus |
| Vídeo: contêiner/codec | não informado **[INCERTO]**: MP4 H.264 High, yuv420p, BT.709, *fast start*, como os exemplos da doc |

### 4.4 Formulário

Os nomes e valores abaixo vêm do esquema GraphQL dentro do código público do portal (bundle v2.133), e não da
documentação **[NÃO OFICIAL]**. Os rótulos reais só aparecem com login.

| Campo (nome interno) | Valor sugerido | Base |
|---|---|---|
| `gameName` (≤ 40) | `Fourteen Tides` (14 caracteres) | |
| `description` (≤ 10.000) | blocos A + C em inglês (cerca de 2.050 caracteres) | seção 4.5 |
| `controls` (≤ 5.000) | bloco B em inglês (440 caracteres) | seção 4.5 |
| `orientation` | **BOTH** | “The website will make sure your game can be played only in those orientations … you don't need to implement any orientation lock logic” ([technical](https://docs.crazygames.com/requirements/technical/)). O jogo funciona nas duas |
| `fullscreen` | **SUPPORTED** | “Fullscreen mode is automatically provided by CrazyGames. Custom in-game fullscreen buttons are prohibited” ([gameplay](https://docs.crazygames.com/requirements/gameplay/)). O jogo não tem botão próprio e ocupa qualquer tamanho de quadro |
| `apsDetail.progressType` (salvamento) | **LOCALSTORAGE** | “The APS system automatically backs up and restores the localStorage … there is no implementation required from your side” ([aps](https://docs.crazygames.com/other/aps/)) |
| `isIOSFriendly`, `isAndroidFriendly` | sim, depois de testar em aparelho (seção 6.2) | |
| `isChromebookFriendly` | só se você testar | “Games will be disabled on Chromium OS if they do not work smoothly on a 4GB RAM device” |
| `platformAudioMuteSupported` | não | o mudo da plataforma (`muteAudio`) depende do SDK; sem SDK o jogo só tem o seu próprio `M` **[INCERTO]** quanto ao sentido exato do campo |
| `hasIAP`, `hasLeaderboard` | não | |
| `steamStoreLink`, `appStoreLink`, `playStoreLink`, `iframeLink` | vazios | os arquivos são enviados direto |
| `allowEmbed` | decisão sua | sentido não documentado **[INCERTO]** |

### 4.5 Descrição e controles

- **Descrição:** blocos A + C em **inglês** (seção 2). As páginas da CrazyGames usam um parágrafo curto de abertura e
  depois a seção “How to Play &lt;Game&gt;” ([Smash Karts](https://www.crazygames.com/game/smash-karts)); o bloco A já
  segue esse formato. A CrazyGames pode editar o texto estendido na página publicada.
- **Controles:** bloco B em inglês, com `P` como tecla de pausa.
- **Português:** o site parece ter páginas traduzidas (há `pt_BR` no esquema), mas **[INCERTO]** se o desenvolvedor pode
  enviar a descrição em português. Se houver o campo, use os blocos PT.
- Limites de 10.000 e 5.000 caracteres: **[NÃO OFICIAL]** (seção 4.4).

### 4.6 Regras de conteúdo e QA que se aplicam

| Regra (fonte) | Situação deste jogo |
|---|---|
| Público a partir de 13 anos: “Your game must be PEGI 12 compliant”; não pode ser voltado a crianças ([gameplay](https://docs.crazygames.com/requirements/gameplay/), [FAQ](https://docs.crazygames.com/faq/)) | criaturas do mar luminosas, sem sangue nem conteúdo sexual |
| “The game must have English localization”; traduções “accurate and of high quality”; usar o idioma do usuário e, na falta, inglês | inglês completo. Sem SDK, o jogo usa o idioma do navegador (`pt…` → português, outros → inglês) |
| Sem promoção cruzada: “should not include cross-promotions”; “App Store links are never allowed in-game” | o jogo não tem nenhum link (nenhum `<a href>`, nenhuma URL `http(s)` no código) |
| Sem anúncios externos (“Only ads served through our SDK are allowed”) | nenhum anúncio |
| Originalidade de nome e conteúdo; não ser confundido com outro jogo ([quality](https://docs.crazygames.com/requirements/quality/)) | título próprio, sem “Fortnight” |
| Teclas reservadas: “Escape closes fullscreen”, “Ctrl / Cmd + W closes the tab” | controles publicados citam `P` para pausar |
| Funcionar em Chrome e Edge; jogos ruins no Safari são desligados nesse navegador | testado só em Chromium; Safari na seção 6 |
| Física igual a 144/165 Hz | passo fixo de 1/60 s com acumulador |
| `user-select: none` no `body`; áreas seguras no app da CrazyGames | já no `style.css` (`env(safe-area-inset-*)`, `viewport-fit=cover`) |
| Legível com devicePixelRatio 1 nos quadros 907×510, 1216×684, 1077×606, 821×462, 1366×768, 1920×1080, 1536×864, 1280×720, 800×450 e 1080×607 | `tests/iframe.mjs` confere que título, Como jogar e pausa cabem sem rolagem nesses tamanhos e também em quadros pequenos (640×360 e 360×640 com toque, 390×844 e 500×700 com mouse), e que o HUD nunca aparece meio coberto pela pausa ou pela melhoria (noites 1, 7 e 14); a legibilidade em 800×450 e 821×462 é para olhar à mão |
| “Show the user how to control the game with a keyboard overlay or mouse gestures” | tela Como jogar e a dica da noite 1 (“WASD or arrow keys to move” / “Drag anywhere to move”) |

### 4.7 Full Launch depois (trabalho futuro, não feito)

Não se pede o Full Launch: a passagem depende das métricas do Basic Launch (“Progression to the Full Launch stage is
based on key engagement metrics”). Se o jogo for selecionado: “Once your
game has been selected for Full Launch, you are required to comply to all integration requirements listed below,
including the CrazyGames SDK” ([intro](https://docs.crazygames.com/requirements/intro/)). **Nada disto está
implementado.**

O que o SDK exige:

| Requisito (fonte) | No jogo, seria |
|---|---|
| Carregar `https://sdk.crazygames.com/crazygames-sdk-v3.js` no `<head>` e chamar `await window.CrazyGames.SDK.init()` ([sdk/intro](https://docs.crazygames.com/sdk/intro/)) | um script externo (veja abaixo) |
| `gameplayStart()` ao começar ou retomar; `gameplayStop()` a cada pausa, sem chamar quando a aba perde o foco ([sdk/game](https://docs.crazygames.com/sdk/game/)) | start: noite começa, volta da pausa, volta das cartas. Stop: pausa, cartas de melhoria, amanhecer, fim de jogo, vitória, menu |
| `muteAudio` respeitado (“A Full Implementation requires muteAudio support”) | o mudo do portal acima do `M` do jogo |
| Progresso pelo módulo Data (limite de 1 MB) ou pelo APS ([sdk/data](https://docs.crazygames.com/sdk/data/), [aps](https://docs.crazygames.com/other/aps/)) | o APS já cobre o `localStorage` |
| Idioma pelo `locale` do SDK ([sdk/user](https://docs.crazygames.com/sdk/user/)) | trocar `navigator.language` por `SDK.user.systemInfo.locale` só na CrazyGames |
| Entrar no jogo de imediato, ou com no máximo 1 clique ([gameplay](https://docs.crazygames.com/requirements/gameplay/)) | hoje: tela de título e 1 clique em Start |
| Opcional: `happytime()` em conquistas, como vencer um chefe | ao derrotar o Caranguejo-Rei e o Leviatã |

**Por que precisa de um build separado.** O SDK é um script carregado de outro domínio. O jogo de hoje tem a regra
de zero requisições de rede: `tests/network.mjs` reprova qualquer requisição que não seja `file:` (ou da própria
origem), e `tools/pacote.mjs` recusa qualquer referência `http:`/`https:` no HTML, CSS e JS do pacote. Então o Full
Launch pede uma variante só para a CrazyGames (por exemplo, uma opção do `pacote` que acrescenta o script e um
adaptador, com um teste de rede próprio que libere só `sdk.crazygames.com`), mantendo o ZIP do itch sem rede.
Nenhum desses itens mexe no equilíbrio: a simulação com semente tem de continuar idêntica à de `edaa14c`.

---

## 5. Checklist final

### Antes de qualquer portal

- [ ] `npm test` passa (smoke, language, iframe, network, package).
- [ ] `npm run pacote` gerou `dist/quinzena-fantastica.zip` com 10 arquivos e `index.html` na raiz.
- [ ] Se o visual mudou: `npm run midia` termina sem erro.
- [ ] `<YOUR NAME>` / `<SEU NOME>` e `<YOUR CONTACT>` / `<SEU CONTATO>` trocados nos textos.
- [ ] Decidiu como marcar a divulgação de IA e revisou a linha de créditos (seção 3.6).

### itch.io

- [ ] Projeto: Title “Fourteen Tides”, Classification Game, Kind **HTML**.
- [ ] Short description EN (115 caracteres) colada.
- [ ] ZIP enviado e marcado para jogar no navegador.
- [ ] Nenhuma plataforma de desktop/Android marcada.
- [ ] Embed in page, **960 × 540**, Mobile friendly ligado, Fullscreen button ligado, Scrollbars desligado, Click to
      play ligado.
- [ ] Background Image: `itch/embed-background-960x540.png`.
- [ ] Cover image: `itch/cover-630x500.png`.
- [ ] 3 a 5 screenshots enviadas (seção 3.5); tema com Screenshots em Sidebar, se quiser mostrá-las.
- [ ] Description: blocos A + B + C + D, com os títulos em Header 2.
- [ ] Genre Action e até 10 tags, sem o nome do jogo.
- [ ] Metadata: idiomas inglês e português; entradas teclado, mouse e toque.
- [ ] Pricing escolhido (sem pagamento ou doações).
- [ ] AI Disclosure preenchido.
- [ ] Prévia testada no computador e num celular de verdade, inclusive a orientação (seção 6.2).
- [ ] Página tornada pública.

### CrazyGames

- [ ] Arquivos enviados com `index.html` no nível de cima (pasta descompactada, ou o ZIP se o portal aceitar).
- [ ] Nome “Fourteen Tides”.
- [ ] Descrição: blocos A + C em inglês.
- [ ] Controles: bloco B em inglês, com `P` para pausar.
- [ ] Capas 16:9, 2:3 e 1:1 nos campos certos.
- [ ] Vídeos paisagem e retrato nos campos certos.
- [ ] Orientação BOTH; tela cheia pelo portal (sem botão no jogo); salvamento LocalStorage/APS.
- [ ] iOS/Android marcados só depois do teste em aparelho; Chromebook só se testado.
- [ ] Sem IAP, sem leaderboard, sem links de loja.
- [ ] Categoria e tags escolhidas.
- [ ] Depois de publicado: acompanhe o tempo médio de jogo, a conversão e a retenção durante os 7 a 21 dias.

---

## 6. Pontos a confirmar

### 6.1 Incertezas da pesquisa (início de outubro de 2026)

| Ponto | Situação | O que fazer |
|---|---|---|
| CrazyGames aceita `.zip`? | **[INCERTO]** | tente o ZIP; se recusar, envie a pasta descompactada |
| Formato e tamanho máximo das capas da CrazyGames | **[INCERTO]**: a doc não diz | PNG no tamanho exato; se recusar, exporte em JPG no mesmo tamanho |
| Pixels do vídeo retrato “1080p - 2:3” | **[INCERTO]**: assumido 1080×1620 | conferir se o portal reclama |
| Contêiner/codec dos vídeos | **[INCERTO]**: assumido MP4/H.264 | idem |
| Limites de texto (nome 40, descrição 10.000, controles 5.000) e opções do formulário | **[NÃO OFICIAL]**: código do portal, bundle v2.133 | conferir os rótulos ao logar |
| Descrição em português na CrazyGames | **[INCERTO]** | ver se o formulário tem campo por idioma |
| Rótulo “This file will be played in the browser” no itch | **[NÃO OFICIAL]**: guia do GDevelop | procurar a opção equivalente no upload |
| Short description do itch ≤ 120 | **[NÃO OFICIAL]**: post de 2020 | as duas frases já cabem |
| Seletor de orientação do itch (Default/Landscape/Portrait) | **[NÃO OFICIAL]**: posts da comunidade | testar no celular (6.2) |
| Tamanho máximo do embed no itch | **[INCERTO]** | 960×540 casa com a coluna documentada |
| Limites de imagem do itch (3 MB, banner 960 px, captura 347 px na lateral) e upload até 1 GB | **[NÃO OFICIAL]** | as imagens daqui têm no máximo 1,84 MB |
| Doações contam como “venda” para a fila de revisão do itch | **[INCERTO]** | só importa se aceitar doações |

### 6.2 Testes em celulares reais

Os testes automáticos rodam no Chromium com telas simuladas (390×844 e 844×390), e não em aparelhos. Antes de marcar
*Mobile friendly* no itch e iOS/Android na CrazyGames, teste num **iPhone (Safari)** e num **Android (Chrome)**:

- [ ] **Som no iOS.** A CrazyGames exige retomar o áudio “within a valid user-initiated gesture, such as a touchend
      or click event” ([technical](https://docs.crazygames.com/requirements/technical/)). O código atual liga o som no
      `pointerdown` e também no `touchend` e no `click`. Confirme que o som começa depois do primeiro toque, e que
      volta depois de trocar de aba ou de app.
- [ ] **Orientação no itch.** O itch abre o jogo em tela cheia no celular e pode travar a orientação pela proporção
      do embed (960×540 é paisagem). Veja se o celular fica preso em paisagem. O jogo funciona nas duas; se quiser
      liberar o retrato, procure o seletor de orientação **[NÃO OFICIAL]**.
- [ ] **Orientação na CrazyGames** (BOTH): girar o aparelho no meio da noite mantém o jogo inteiro na tela.
- [ ] Joystick: arrastar faz andar e não rola nem recarrega a página.
- [ ] HUD e botões de pausa e som fora do entalhe (*notch*), inclusive no app da CrazyGames
      ([crazygames-app](https://docs.crazygames.com/resources/crazygames-app/)).
- [ ] Trocar de app pausa o jogo; tocar nas cartas escolhe a melhoria; o botão de idioma funciona.
- [ ] O recorde fica salvo ao recarregar. O salvamento é por portal: itch, CrazyGames e o arquivo local não se
      enxergam. No itch, todos os jogos HTML dividem o mesmo `localStorage` (`html-classic.itch.zone`,
      [aviso do itch](https://itch.io/t/3099694/notice-for-html-game-devs-upcoming-change-to-cdn-domain)); o jogo
      usa só a sua chave e nunca apaga as dos outros.
- [ ] Se possível, Safari no Mac e um Chromebook de 4 GB (a CrazyGames desliga o jogo por navegador ou sistema se
      ele não rodar bem).

### 6.3 Joystick por arraste e *pointer lock*

A página [mouse-control](https://docs.crazygames.com/resources/mouse-control/) da CrazyGames diz que, em jogos vistos
de cima em que o personagem “moves based on mouse gestures”, o jogo tem de travar o mouse na área do jogo (*pointer
lock*) e ter uma tecla para soltá-lo. A mesma página diz que o jogo “could also add WASD/Arrow keys”.

- Neste jogo, o controle principal no computador é o **teclado** (WASD/setas). O mouse só move enquanto o botão está
  pressionado e arrastado, como o joystick de toque. O jogo não usa *pointer lock*.
- **[INCERTO]** se o QA da CrazyGames classifica esse arraste como “movimento por gestos do mouse”.
- Por isso os textos apresentam o teclado primeiro e o arraste como “mouse or touch”.
- Se o QA pedir *pointer lock*, há duas saídas, ambas fora do equilíbrio do jogo: explicar que o teclado é o controle
  do computador, ou mudar a entrada na versão da CrazyGames (travar o mouse com uma tecla para soltar, ou desligar o
  arraste com mouse no computador). Nenhuma das duas está feita.
