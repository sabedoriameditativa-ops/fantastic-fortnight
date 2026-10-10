# Adicionando conteúdo: nave, habilidade, facção

Receitas medidas no código atual. Cada passo aponta o arquivo e o teste que acusa o que faltar.

## Uma nave nova

1. **`shared/catalog.js`** — adicione a entrada com o helper `S({...})` na lista da facção: id
   (`fac_nome`), nome, classe de tamanho, custo, casco (`hp`, `dr`, `regen`), escudo, velocidade,
   armas (`weapons: [{ type, damage, salvo, cooldown, range, arc }]`), `ability`, `role` e o texto
   do códice. O custo deve seguir a curva de eficiência (dano/s por ponto cai com o tamanho;
   resistência por ponto sobe) — confira com `node tools/simulate.js --a <preset> --b <preset>`.
2. **`client/battle/render/shipDefs.js`** — a definição visual (camadas `poly`/`ring`/`cells`,
   motores, pontos de faísca para os estados de dano). `test/render/sprites.test.js` falha se uma
   nave do catálogo não tiver definição.
3. Opcional: coloque a nave num preset (`PRESETS` no catálogo), numa linha da `COUNTER_MATRIX`
   (`shared/botFleet.js`) e, se for chefe de nível, em `shared/levels.js`.
4. Rode `npm test` (`test/rules` valida ids, limites por classe e presets; `test/render` as
   definições visuais) e regenere a fixture dourada se o balanceamento mudou:
   `node test/sim/golden.test.js --update`.

## Uma habilidade nova

1. **`shared/catalog.js` → `ABILITIES`** — id, nome, `kind` (`buff`, `area`, `heal`, `spawn`,
   `dash`, `shield`, `passive`…), descrição em pt-BR, recarga, duração e parâmetros (`prm`).
2. **`shared/sim/abilities.js` → `ABILITY_REGISTRY`** — `trigger(state, ship, ctx)` (quando a IA
   deve lançar; use as consultas de `queries.js`) e `cast(state, ship, ctx)` (o efeito; emita o
   evento `cast` e, se for de área, `aoe`). Tudo determinístico: só o RNG do estado.
3. **`client/battle/effects.js` → `handleCast`** — um `case` com o efeito visual (cúpula, anel,
   partículas, raio). Sem `case`, a habilidade cai no efeito genérico do `kind`.
4. **`client/audio/recipes.js`** — existe uma receita por `kind` (`cast.<kind>`); um `kind` novo
   precisa de receita nova.
5. **`docs/SPEC.md` §3.5** — a linha da tabela de gatilhos. `test/sim/abilities.test.js` exige que
   toda habilidade não passiva seja lançada em ≥ 80 % das sementes quando o gatilho é atendido.

## Uma facção nova

Toca mais arquivos; faça nesta ordem e rode `npm test` ao fim de cada bloco.

1. **`shared/catalog.js`** — `FACTIONS[id]` (nome, `short`, cor, acento, `hull`, passiva e lore),
   8 naves com `S()`, 3 presets. Se o casco for novo, adicione a coluna em `DAMAGE_MULT` e a
   entrada em `HULL_TYPES`.
2. **`shared/sim/tables.js`** — tabelas de precisão/comportamento por facção, se a passiva precisar.
3. **`shared/botFleet.js`** — linhas e colunas da `COUNTER_MATRIX`; `tinyCapByFaction` se o limite
   de minúsculas for diferente (`shared/constants.js`).
4. **`shared/levels.js`** — níveis da campanha com a nova facção.
5. **`client/battle/render/palette.js`** (paleta de casco), **`client/battle/render/shipDefs.js`**
   (8 definições), **`client/battle/render/explosions.js`** (destroços), **`client/audio/recipes.js`**
   (`applyFlavor` do timbre), **`client/audio/music.js`** (`MOTIFS`), **`client/styles.css`**
   (`--f-<id>` e `.f-<id>`), **`client/util/ambient.js`** (naves de fundo, opcional).
6. **`README.md`** (tabela de facções) e **`docs/SPEC.md`** §1.

Verificação final: `npm run test:full`, `npm run e2e`, `node tools/simulate.js --factions --seeds 24`
(a matriz de facções deve ficar em 35–65 %) e `node test/sim/golden.test.js --update`.
