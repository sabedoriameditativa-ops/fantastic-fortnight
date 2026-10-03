# Quinzena Fantástica

*Catorze noites no farol da Ilha Perdida.*

Você é quem cuida do farol da Ilha Perdida. Durante uma quinzena inteira, toda noite,
criaturas bioluminescentes sobem do mar e rastejam até a sua luz. Sobreviva às **14 noites**:
o facho do farol varre a ilha, a sua lanterna empurra a escuridão e, nas noites 7 e 14,
algo muito maior emerge das ondas.

É um jogo de sobrevivência em arena, visto de cima, no estilo *roguelite*: você só se move,
as armas disparam sozinhas, as criaturas derrotadas deixam **brasas** (experiência) e, a cada
nível, você escolhe uma entre três melhorias.

## Como jogar

| Ação | Teclado | Toque / mouse |
|---|---|---|
| Mover | `W` `A` `S` `D` ou setas | arraste em qualquer lugar da tela (surge um joystick virtual) |
| Pausar / continuar | `P` ou `Esc` | botão de pausa no canto superior |
| Ligar / desligar o som | `M` | botão de som no canto superior |
| Escolher melhoria | `1`, `2`, `3` (ou setas + `Enter`) | toque na carta |
| Começar a próxima noite | `Enter` ou `Espaço` | botão “Começar a noite…” |

**Regras em poucas linhas**

- Suas armas disparam sozinhas: você só precisa se mover e se manter vivo.
- Recolha as brasas deixadas pelas criaturas para subir de nível e escolher melhorias.
- O facho do farol sempre desacelera as criaturas que ilumina — com a *Lente de Fresnel*, ele também queima.
- Cada noite dura um pouco mais que a anterior. Ao amanhecer, você recupera 30% da vida.
- Nas noites 7 e 14 a noite só termina quando o chefe cai: o **Caranguejo-Rei** e o **Leviatã das Marés**.

**Arsenal:** Faísca, Lente de Fresnel, Lanterna Ardente, Âncoras Giratórias e Arpão (até quatro
armas por vez), além de sete melhorias passivas — Botas de Marinheiro, Casco Reforçado,
Pulmões de Faroleiro, Ímã de Brasas, Pavio Longo, Pólvora Seca e Ampulheta.

A pontuação soma criaturas derrotadas, brasas recolhidas, noites sobrevividas e chefes vencidos.
O recorde (pontos e noite alcançada) e a preferência de som ficam salvos no navegador.

## Como rodar

Não há etapa de build nem dependências.

- **Mais simples:** abra o arquivo `index.html` no navegador (funciona direto via `file://`).
- **Com servidor local:** `npm start` (usa `npx serve .`) e acesse o endereço exibido no terminal.

Funciona no computador e no celular, em retrato ou paisagem.

## Como testar

```bash
npm test
```

O teste de fumaça (`tests/smoke.mjs`) usa o Playwright com Chromium (instalação local ou global):
abre o jogo em modo de depuração (`index.html#debug`), joga as telas principais — título,
partida, melhoria, amanhecer, chefes, vitória, fim de jogo, pausa — e confere o layout em
celular (retrato e paisagem). Para salvar capturas de tela, defina `SHOT_DIR`:

```bash
SHOT_DIR=/tmp/capturas npm test
```

Com `#debug` no endereço, o objeto `window.QF.debug` expõe atalhos como `setNight(n)`,
`skipNight()`, `godMode(true)`, `addXp(n)`, `grantUpgrade(id)` e `setTimeScale(x)`.

## Créditos

Feito com HTML5 Canvas e Web Audio, sem dependências. Fontes: *IM Fell English SC* e
*Alegreya Sans* (Google Fonts).
