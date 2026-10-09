# Frota Estelar — estado atual e propostas de melhoria

Revisão feita em outubro de 2026 sobre a versão publicada na `main` (commit `a26fb02`).
Sete frentes foram analisadas de forma independente, cada uma jogando, medindo e lendo o código:
jogabilidade e progressão, IA de batalha, UX, gráficos, áudio, multiplayer/servidor e qualidade de código.
Os números abaixo vêm de simulações sem interface (`tools/simulate.js` e scripts auxiliares), de partidas
reais rodadas com Playwright (com capturas de tela) e de leitura do código. Cada item traz a gravidade,
a evidência e o que fazer; a coluna **Status** diz o que já foi corrigido nesta rodada.

Legenda: **Grav.** gravidade (alta/média/baixa) · **Esf.** esforço (P pequeno, M médio, G grande) ·
**Impacto** para o jogador (alto/médio/baixo).

---

## Resumo executivo

**O que está bom.** O motor de combate é sólido e determinístico (0 empates, menos de 1 % de partidas no
limite de tempo, 0,5 ms por tick em 6v6), as 31 habilidades ativas disparam em jogo, não há naves ociosas
nem travadas, a interface é consistente em pt-BR com feedback claro (toasts, validação, foco visível), a
arte procedural das 32 naves é forte e o engine de áudio não estoura nem vaza vozes. O jogo funciona de
ponta a ponta no computador, no celular e na internet.

**Os dez problemas que mais importam.**

1. A campanha é um penhasco: todos os presets vencem 100 % dos níveis 1 a 5 em qualquer dificuldade e
   nenhum vence a partir do nível 13 (Normal: 8 %/0 %/0 % nos níveis 13/14/15). Causa: orçamento inimigo
   ×1,2 a ×1,5 somado ao construtor de contra-ataque.
2. Enxame de Corveta Falcão é uma estratégia degenerada: 24 Falcões + 17 Vespas vencem 46 de 48 batalhas
   contra os presets e 11 de 12 frotas de contra-ataque.
3. Vários pares de presets são massacres (0 em 40), o que torna o construtor de contra-ataque um cara ou coroa.
4. Naves sem regeneração (toda a Lúmen, Hércules) ligam e desligam o recuo a cada decisão da IA
   (251 trocas em 375 amostras), tremendo entre a linha e o ponto seguro.
5. O Cuspidor, com arco de tiro de 90°, faz o "kite" exatamente perpendicular ao alvo e fica 40 % do tempo
   sem conseguir atirar; naves de arco fixo também não atiram enquanto recuam.
6. A entrada do multijogador trava em "Conectando ao servidor…" depois de qualquer código de sala inválido.
7. O construtor de frota não diz contra quem você vai lutar nem o que funciona contra aquele casco, mesmo
   no modo um jogador, em que o inimigo é conhecido.
8. No celular em pé a arena vira uma faixa de 390×219 px (26 % da tela); a cor do time é quase invisível
   em zoom baixo e as cúpulas das auras viram uma sopa colorida em 6v6.
9. A trilha fica cerca de 12 dB abaixo dos efeitos durante o combate (praticamente inaudível), o stinger
   de vitória/derrota toca duas vezes e há 2,7 s de silêncio depois dele.
10. Não há progressão real: nenhum nível é bloqueado, não há estrelas, pontuação ou desbloqueios; o modo
    sem fim para de escalar quando bate o teto de 40 naves.

**O que esta rodada corrige.** Os itens marcados como "corrigido" nas tabelas abaixo: a curva da campanha,
o custo do Falcão e os piores pares de presets, os defeitos de comportamento da IA (recuo, kite, Véu,
larvas, flak, portadoras, naves-mãe), a entrada do multijogador, os textos de resultado, o reveal da
batalha, a ergonomia no celular (toque, barra fixa, alvos de toque, retrato), a cor do time e as auras,
a câmera livre e automática, o desempenho do fundo, e a mixagem e os defeitos do áudio.

---

## 1. Jogabilidade, balanceamento e progressão

### Estado

Medições: 1.920 batalhas na escada de níveis (12 presets × 4 dificuldades × 20 níveis, frota do jogador
controlada pela IA "especialista", como no jogo), matriz de 1.728 batalhas entre presets, duelos de classe
única com custo igual, frotas de enxame montadas à mão e partidas reais na interface.

| Métrica | Valor medido |
|---|---|
| Vitória do jogador, Normal, níveis 1–5 | 100 % (todos os presets) |
| Vitória do jogador, Normal, nível 9 / 12 / 13 / 14+ | 54 % / 29 % / 8 % / 0 % |
| Vitória do jogador, Difícil, nível 11 / 13+ | 8 % / 0 % |
| Melhor frota possível (24 Falcão + 17 Vespa) no nível 15 | 0 em 12, em todas as dificuldades |
| Falcão + Vespa contra os 12 presets (1.500 pts) | 46 vitórias em 48 |
| Pares de presets fora da faixa 20–80 % (12 sementes) | ~30 de 132 células; 14 em 0 % ou 100 % |
| Mediana da primeira morte / fim da batalha | 12 s / 60 s; 50 % das mortes até 19 s |
| Batalhas que chegam à morte súbita (150 s) | 19 em 1.920 |
| Naves nunca vantajosas em duelo | Luz Primordial 0 %, Véu 11 %, Matriz 16 %, Prometeu 14 % |

### Problemas encontrados

| Grav. | Problema | Evidência | Status |
|---|---|---|---|
| Alta | Escada de níveis em penhasco (fácil até o 5, impossível do 13) | Orçamento inimigo ×1,2/1,3/1,5 nos níveis 13–15 **e** construtor de contra-ataque, multiplicado ainda pelo `budgetMul` da dificuldade; com +10 % de orçamento o jogador já cai para 29 % | Corrigido nesta rodada (teto do orçamento efetivo, rampa na qualidade da IA, construtor por nível) |
| Alta | Enxame de Falcão domina | 0,713 de dano/s por ponto contra 0,13–0,36 das naves grandes; 100 % dos 38 duelos de classe | Corrigido nesta rodada (custo/dano do Falcão e curva de eficiência) |
| Alta | Pares de presets 0 em 40 | ter_linha × lum_coro, ter_misseis × ter_linha, fer_fabrica × lum_coro 0/40; vor_garras × vor_chuva 7/40 | Corrigido nesta rodada (ajuste dos piores pares; teste `npm run balance`) |
| Média | Níveis iniciais vazios (inimigo com 3–4 naves) | Nível 1 usa 0,5× do orçamento e o construtor aleatório gasta só 60–85 % | Corrigido nesta rodada |
| Média | Modo sem fim para de escalar no teto de 40 naves, mas a tela anuncia 7.200 pts | Inimigo gasta ~3.000 pts a partir da onda 5 em qualquer orçamento | Corrigido nesta rodada (melhoria entre classes acima do teto e valor real exibido) |
| Média | Batalhas decididas nos primeiros 20 s; morte súbita e relógio de 4:00 são conteúdo morto | 90 % das mortes até 48 s; 19 de 1.920 batalhas chegam à morte súbita | Proposto (ver P7) |
| Média | Sem progressão: nada bloqueado, sem estrelas/pontuação/desbloqueios | Todos os 15 níveis clicáveis num perfil novo; `sp.levelLocked` nunca é usado | Proposto (P2, P3) |
| Média | "Nível concluído" vale em 2v2–6v6 mesmo com 13–18 % do dano do time | Aliados Especialista + inimigo Fácil limpam a campanha | Corrigido nesta rodada (contribuição mínima e teto da dificuldade dos aliados) |
| Média | Orçamentos 800/2.500 inexistem no modo um jogador e os presets degradam neles | A 800 a nave-mãe some do preset; a 2.500 vor_mare vira 8 portadoras | Proposto (P8) |
| Baixa | Naves que nunca valem a pena (Matriz, Véu, Luz Primordial, Prometeu) | Duelos 0–16 %; dano/s por ponto 0,04–0,13 | Parcial (curva de eficiência); resto em P4 |
| Baixa | Texto do nível não bate com o inimigo em Difícil/Especialista | "Corvetas patrulham a fronteira" vira "frota de contra-ataque" | Corrigido nesta rodada (construtor explícito por nível) |
| Baixa | Critérios de balanceamento da SPEC §8 não têm teste | Só existe o teste de espelho | Corrigido nesta rodada (`tools/balance-check.js`) |

### Propostas

| Impacto | Esf. | Proposta |
|---|---|---|
| Alto | M | **Recurvar a campanha**: orçamento inimigo de 0,7× a 1,1× entre os níveis 1 e 15 (chefe de graça por cima), orçamento do jogador crescendo com os níveis concluídos ("Requisição de frota", 1.500 → 2.000), contra-ataque "leve" (melhor entre os 2 melhores, com ruído). Validar com a escada como teste. |
| Alto | M | **Estrelas, pontuação e recordes por nível**: 1–3 estrelas (vencer; vencer com ≥ 50 % da frota; vencer em menos de 60 s ou sem perder capital), pontuação = valor restante + dano − tempo, exibidas na grade de níveis, nos resultados e no menu. |
| Alto | G | **Escada de desbloqueios**: começar só com Terranos, liberar Vorrax no nível 3, Lúmen no 6, Ferrix no 9; capitais e naves-mãe por estrelas; opção "Arsenal completo" para quem já joga. |
| Alto | M | **Achatar a eficiência por custo**: dano/s por ponto caindo suavemente com o tamanho (0,8 minúscula → 0,3 nave-mãe) enquanto a resistência por ponto sobe; "taxa de enxame" (teto de 16 pequenas fora dos Vorrax). |
| Alto | P | **Inteligência sobre o inimigo** no construtor e nos resultados (parte feita nesta rodada: faixa do inimigo e chips de arma coloridos; falta a composição inimiga na derrota com dica derivada da matriz de contra-ataque). |
| Médio | P | **Contra-ataque legível e vencível**: sortear entre presets com nota ≥ 85 % da melhor, ruído de composição, nunca repetir o preset que o jogador acabou de vencer, anunciar a escolha no reveal. |
| Médio | P | **Abertura mais lenta e morte súbita real**: implantar a 10 % da largura em vez de 18 %, −20 % de dano global, morte súbita aos 120 s e fim aos 180 s (alvo: mediana 75–100 s, 10–15 % das batalhas em morte súbita), aviso "Morte súbita em 0:30" no HUD, ×2 como velocidade padrão para novatos. |
| Médio | P | **Seletor de orçamento no modo um jogador** e presets com lista "núcleo" + "complemento" para 800 e 2.500 pts. |
| Alto | G | **Modo sem fim como "run"**: naves sobreviventes continuam (reparadas a 70 %), requisição entre ondas para reforços, veterania visível do inimigo, melhor onda por dificuldade no menu. |
| Médio | P | **Separar progresso da campanha das escaramuças em equipe** e mostrar "Você causou 38 % do dano do time". |
| Médio | M | **Desafio diário com semente** e frota inimiga visível antes de montar; 3 tentativas; código compartilhável. |
| Médio | P | **Harness de balanceamento como alvo de teste** (`npm run balance`, feito nesta rodada) rodando à noite no CI. |

---

## 2. IA de batalha

### Estado

Método: harness instrumentado sobre 40+ batalhas de 12 pares de presets em "especialista" e "normal",
medindo por nave e por tick ociosidade, arma pronta sem atirar com inimigo ao alcance, usos de
habilidade por oportunidade, episódios de recuo, concentração de fogo, sobre-dano, distância à linha;
mais capturas pausadas em ×1 no cliente real.

O núcleo funciona: ociosidade abaixo de 3 %, nenhuma nave presa, mergulhadores esperam a linha fazer
contato, alocação de foco coerente, formações legíveis em ×1. Os defeitos são pontuais e reproduzíveis.

### Problemas encontrados

| Grav. | Problema | Evidência | Status |
|---|---|---|---|
| Alta | Recuo liga/desliga a cada decisão em cascos sem regeneração (Lúmen, Hércules) | Harmônico: 251 trocas em 375 amostras; 6 Harmônicos somam 288 episódios e 115 s recuando | Corrigido nesta rodada (histerese real) |
| Alta | Kite do Cuspidor exatamente perpendicular com arco de 90° | 28 % dos ticks vivos com arma pronta, inimigo ao alcance e nada atirável; mesmo arco no Véu (17–20 %) e Carrapato (16 %) | Corrigido nesta rodada |
| Média | Naves de arco fixo param de atirar ao recuar (dão as costas) | 26–47 % dos ticks de recuo com arma pronta e inimigo ao alcance sem tiro | Corrigido nesta rodada (encara o alvo para o disparo) |
| Média | Véus escolhem outros Véus como protegidos e vagam para longe da linha | 46 % dos ticks escoltando outro Véu; 26 % a mais de 700 u da linha | Corrigido nesta rodada |
| Média | Larvas recuam em vez de mergulhar; unidades geradas fogem e morrem fugindo | 101 larvas: 21 recuam, 9 mergulham, 25 morrem fugindo | Corrigido nesta rodada |
| Média | `flak_curtain` quase nunca dispara contra enxames; `overclock` nunca em Vetores comprados | 1 cortina por batalha; 3 ticks elegíveis em 1.277 | Corrigido nesta rodada (novos gatilhos) |
| Média | Armas pesadas desperdiçam tiros de 150–300 em alvos de 36–130 de vida | Aríete 7–8 de 75 tiros de railgun em larvas (≈ 770 de dano perdido) | Corrigido nesta rodada (escolha de alvo por arma) |
| Média | Colmeia-Mãe e Luz Primordial lideram a própria frota | Nave mais próxima do inimigo 51–57 % do tempo | Corrigido nesta rodada (distância de espera pela arma principal, nunca à frente da linha) |
| Média | Capitais e brigões empilham num só bolo | ≥ 5 cascos médios+ a 120 u em 32–40 % dos ticks | Parcial (faixa morta no modo "hold") |
| Baixa | Portadoras se escondem longe demais e tremem em torno de um ponto móvel | Matriz ao alcance só 4 % do tempo; velocidade oscila 25–90 u/s | Corrigido nesta rodada |
| Baixa | Mergulhadores Vorrax carregam de uma vez e 60–75 % morrem em 5 s | 15 de 20–23 mortes nos 5 s do contato | Proposto (P7) |
| Baixa | A "formação" é o layout de estacionamento espalhado pela altura da faixa | Colunas verticais a 400–500 u da nave-mãe | Proposto (P6) |

### Propostas

| Impacto | Esf. | Proposta |
|---|---|---|
| Alto | M | **Mapa de perigo por time** (grade de 200 u com dano × alcance inimigo): portadoras param no ponto menos perigoso ao alcance, kiters escolhem a tangente mais segura, a âncora não avança para célula acima da própria resistência. Resolve três defeitos com um mecanismo. |
| Alto | M | **Escolta v2: telas, não vagas**: escolta se posiciona entre o protegido e o aglomerado inimigo mais próximo (a Ártemis encontra as larvas; os Véus ficam entre a Catedral e os atacantes). |
| Alto | P | **Limite de foco por valor do alvo**: quando o dano alocado × 2 s ≥ resistência, o alvo sai do conjunto de candidatos e o segundo melhor recebe dano imediatamente (hoje 8–10 naves se empilham num casco). |
| Médio | P | **Combos de habilidade**: auras quando o choque está a ≤ 3 s; PEM encadeado com railgun/torpedo prontos; Muda/nanitas reativas pelo dano previsto, não por fração fixa. |
| Médio | P | **Recuo com papel**: recuar para o "bolso" atrás de dois aliados médios+, não para a portadora a 600 u; brigões sem regeneração e sem curandeiro não recuam. |
| Médio | M | **Formações por arquétipo** (linha, cunha, crescente) calculadas no engajamento, altura limitada a ~600 u. |
| Médio | P | **Mergulhadores inteligentes**: penalizar alvos sob flak/defesa de ponto, entrar pelo flanco (±40°), liberação escalonada, órbita a 0,8 R contra escoltas com flak. |
| Médio | P | **Regras por arma**: alta alfa escolhe o alvo que maximiza min(resistência, dano) × precisão; baixa alfa prefere alvos abaixo de 25 % ("terminar a morte", alimenta a Fome Vorrax). |
| Baixo | P | **Menos tempo morto antes do contato**: formação a 1,3× da velocidade do grupo com a âncora atrasando. |
| Baixo | P | **Estados legíveis na nave**: rastro traseiro ao recuar, marca de "ancorada" no modo torre. |
| Baixo | P | **Asserções de qualidade de comportamento no teste** (≤ 3 recuos por 30 s, < 10 % de ticks prontos sem tiro, protegido nunca é suporte, unidades geradas nunca recuam). Parte feita nesta rodada. |
| Baixo | P | **Personalidade por dificuldade** com dois novos knobs (`retreatThresholdMul`, `diverRelease`). |

---

## 3. UX, fluxo, textos e acessibilidade

### Estado

Todas as telas foram percorridas com Playwright em 1440×900, 820×1180, 390×844 e 844×390 (~250
capturas), com medição de alvos de toque, foco e contraste. A interface é consistente, o feedback funciona
e o foco de teclado é visível em tudo. Os problemas são de informação (o jogador não sabe contra quem luta)
e de ergonomia no celular.

### Problemas encontrados

| Grav. | Problema | Evidência | Status |
|---|---|---|---|
| Alta | Entrada do multijogador trava em "Conectando ao servidor…" após sala inválida ou falha ao criar | `ensureNet()` limpa o contêiner e `renderEntry()` nunca é chamado de novo | Corrigido nesta rodada (+ caso e2e) |
| Alta | O construtor não diz o que você vai enfrentar nem o que funciona contra aquele casco | A facção inimiga some depois da tela "Um jogador"; a tabela de multiplicadores só existe em "Como jogar" | Corrigido nesta rodada (faixa do inimigo + chips de arma coloridos) |
| Alta | Batalha em celular em pé é uma faixa de 219 px; HUD colide em 640–960 px e em paisagem | Viewport {y:313, h:219} em 390×844; "SAIR" sobre "Time Azul" | Corrigido nesta rodada (arena em tela cheia, HUD reorganizado) |
| Média | No toque não dá para ler a habilidade: tocar nela compra uma nave | Tooltip só em `pointerenter`; o clique do card compra | Corrigido nesta rodada (popover de toque) |
| Média | Barra de orçamento e Confirmar ficam 2,3–3 mil px abaixo da lista no celular | `.fb-side` estático abaixo de 960 px | Corrigido nesta rodada (barra fixa compacta) |
| Média | Resultado diz "Todas as naves inimigas foram destruídas" quando você perdeu | `reasonElim` usado para qualquer eliminação | Corrigido nesta rodada |
| Média | Nome padrão aceito online: dois "Comandante" indistinguíveis | Toast avisa mas deixa continuar | Corrigido nesta rodada (nome obrigatório) |
| Média | Reveal pré-batalha some em 2,6 s, antes de dar para ler a frota inimiga | `INTRO_MS = 2600`; "Pular" existe mas não é usado | Corrigido nesta rodada (espera o "Começar"/8 s, dicas de contra-ataque) |
| Média | Contagem regressiva ilegível no celular (texto sobre o lobby) | Overlay a 75 % de opacidade | Corrigido nesta rodada |
| Baixa | Alvos de toque de 21–28 px no HUD e no construtor | Mínimo WCAG 24 px; Android/iOS 44–48 px | Corrigido nesta rodada (≥ 40 px em `pointer: coarse`) |
| Baixa | Cor de facção sem contraste (Vorrax 3,17:1) e textos truncados | "Confederação Ter…", tabela de resultados sem indicação de rolagem | Corrigido nesta rodada |
| Baixa | Naves ambiente passam por cima de botões; atalhos de teclado não documentados; `aria-label` vazio | Lúmen sobre "OPÇÕES"; 0 menções a Espaço/1/2/4 | Corrigido nesta rodada (atalhos e rótulos); naves ambiente proposto |

### Propostas

| Impacto | Esf. | Proposta |
|---|---|---|
| Alto | M | **Painel "Inimigo e contra-ataques"** completo no construtor, com "Comparar" (resistência/dano por tipo contra o orçamento inimigo). Base feita nesta rodada. |
| Alto | M | **Tutorial guiado na primeira batalha** (3 passos sobre o HUD real + 3 no construtor), "Rever tutorial" em Opções. |
| Alto | M | **Debrief pós-batalha**: perdas por classe, dano por tipo de arma contra cada casco ("seus lasers fizeram ×0,6 contra cristalino"), melhor nave de cada lado, 1–2 dicas geradas, "Ver frotas". |
| Alto | P | **Checklist de prontidão no lobby** em vez do toast tardio: cada humano com ✔/✖ frota e pronto; botão desabilitado com o primeiro item faltante como rótulo. |
| Médio | P | **Construtor pensado para celular**: barra fixa no topo, facções em fila de chips, cards de uma linha com expansão ao toque, presets roláveis. Parte feita nesta rodada. |
| Médio | M | **Modo retrato na batalha** com HUD em menu "⋯" e aviso opcional "Gire o celular". Parte feita nesta rodada. |
| Médio | P | **Tocar numa nave na batalha** abre um card (nome, dono, barras, alvo, recarga) com botão "Seguir". |
| Médio | P | **Onboarding de nome** antes do multijogador com "Sortear nome"; servidor sufixa duplicados. |
| Médio | P | **Links Galeria ↔ construtor**: ícone "Info" nos cards, "Usar em uma frota" na galeria. |
| Médio | P | **Presets com papel e etiqueta de dificuldade** e até 3 frotas salvas por facção. |
| Baixo | P | **Card "Controles"** em Como jogar e teclas nos títulos dos botões (feito nesta rodada). |
| Baixo | P | **Pular a tela de fim** com toque/Enter e "Assistir de novo" (mesma semente) nos resultados. |

---

## 4. Gráficos, efeitos, câmera e desempenho

### Estado

Método: 17 capturas do `tools/render-shots.js`, medições por passe no `render-demo.html` com 500 naves,
duas batalhas 6v6 reais (nível 1 e nível 14 Difícil, 309 naves) com rastreio de zoom, sonda de
enquadramento em 720p e viewports de celular. Em renderização por software o tempo de quadro é dominado
pelo compositor, então os custos são comparados entre passes: ~10 ms de desenho com 500 naves (naves
45 %, efeitos 25 %, fundo 12–26 %). A arte é forte; os problemas são de legibilidade e de alguns custos
evitáveis.

### Problemas encontrados

| Grav. | Problema | Evidência | Status |
|---|---|---|---|
| Alta | Cor do time ilegível abaixo de zoom ~0,7 (casco tem a cor da facção; o time é um ponto de 2 px) | A câmera automática fica em 0,35–0,75 durante todo o 6v6 | Corrigido nesta rodada (cor do time no LOD0 e aro nos buckets baixos) |
| Alta | Cúpulas de aura (raio 400–600) preenchidas viram uma sopa em 6v6 | Seis cúpulas sobrepostas aos 37 s | Corrigido nesta rodada (só anel; preenchimento só na nave seguida) |
| Alta | Celular em pé: arena de 390×219 por letterbox 16:9 fixo; em paisagem os botões cobrem a arena | `resize()` força 9/16 | Corrigido nesta rodada |
| Média | Qualidade adaptativa só olha o próprio tempo de JS; nunca liga quando o gargalo é a GPU | drawMs 8–12 ms enquanto o quadro levava 80–124 ms | Corrigido nesta rodada (intervalo do rAF) |
| Média | Trocar de bucket de zoom reconstrói ~90 sprites no mesmo quadro (47–81 ms) | Cache de 400 entradas bate o teto em batalhas longas | Parcial (aquecimento ocioso e fallback) |
| Média | Explosão de capital vira um disco opaco de fumaça e some em 1,3 s | Fumaça desenhada por cima dos destroços | Corrigido nesta rodada |
| Média | Estrelas desenhadas uma a uma por quadro: fundo custa 10× mais no zoom longe | 3,07 ms = 26 % do desenho em 6v6 | Corrigido nesta rodada (camadas em tiles) |
| Média | Câmera livre volta sozinha para automática após 6 s, sem aviso | `freeUntil = now + 6000` | Corrigido nesta rodada (fica livre até "CÂMERA AUTO"; chip "câmera livre") |
| Média | Câmera automática não enquadra 6v6 em 720p e um retardatário afasta tudo | 38 de 335 naves fora da tela; zoom caiu de 0,93 a 0,58 com a luta parada | Corrigido nesta rodada (zoom mínimo pelo mundo; bbox só de naves engajadas) |
| Baixa | Planeta pode ter a cor de uma facção e cobrir metade da arena | Lúmen lutando sobre planeta roxo | Corrigido nesta rodada |
| Baixa | Paleta Ferrix some no fundo em zoom médio | L* 12–27 contra #05070c | Corrigido nesta rodada |
| Baixa | `ctx.font` reatribuído a cada quadro com tamanho fracionário (0,3 ms); flag `quality.glow` morta | Passe de UI 2,38 ms no 6v6 | Corrigido nesta rodada |

### Propostas

| Impacto | Esf. | Proposta |
|---|---|---|
| Alto | M | **Telegrafar habilidades**: arco de carga ao redor do lançador, círculo tracejado na área alvo 0,4 s antes, nome da habilidade flutuando em pt-BR, ícone no log. |
| Alto | M | **Minimapa** (200×112) com pontos por time, efeitos de área, retângulo da câmera e clique para mover; resolve o 6v6 que não cabe na tela. |
| Alto | M | **Última morte cinematográfica**: 1,4 s em câmera lenta com aproximação, vinheta, HUD escurecido; 0,5× por 0,8 s quando uma nave-mãe morre. |
| Alto | M | **Layout de batalha para celular**: barras + relógio numa linha, log em ticker, botões de 44 px na base; barras de vida 1,5× mais grossas em dpr ≥ 2. Base feita nesta rodada. |
| Médio | P | **Marcadores de morte e dano no mundo** ligados ao log do HUD (cruz na cor do time, seta na borda se fora da tela, hover no log destaca a nave). |
| Médio | M | **Estados de dano visíveis em qualquer zoom** e fogo vivo em naves danificadas. |
| Médio | M | **Modo "ação" da câmera e atalho "seguir minha capitânia"**. |
| Médio | P | **Bolhas de escudo mais baratas e claras** (sprite radial em cache; ~0,9 ms a menos com 500 naves). |
| Médio | P | **Faixa "quem está ganhando"** por valor restante ponderado por custo (a regra real de desempate) + ticker de abates. |
| Médio | M | **Nível LOD2-lite e lote de trocas de blend** no passe de naves (naves custam 2× ao cruzar 24 px). |
| Médio | M | **Impactos e erros com sabor de facção** (ricochete cinético, respingo ácido, raios cromáticos Lúmen, arco iônico Ferrix, "clang" de blindagem). |
| Baixo | P | **Modo foto**: esconder HUD, pausar, câmera livre, salvar imagem. |

---

## 5. Áudio

### Estado

Método: `tools/audio-check.js --render` (124 efeitos renderizados, pico 0,962, sem vazamentos), três
batalhas reais a ×1 (21, 43 e 448 naves) com analisadores por barramento, sondagem do pool de vozes,
rastreio das camadas da trilha e das cenas, mais renderizações offline das transições de fim de batalha.
O engine é robusto (sem estouro no limitador, teto de vozes respeitado, configurações persistem); o que
falha é o resultado que chega ao jogador.

### Problemas encontrados

| Grav. | Problema | Evidência | Status |
|---|---|---|---|
| Alta | Stinger de vitória/derrota toca duas vezes; um tema de menu é criado e descartado a cada fim | `go('results')` troca para "menu" antes de `results.js` chamar "victory" | Corrigido nesta rodada |
| Alta | Trilha ~12 dB abaixo dos efeitos em combate | SFX RMS 0,20–0,34 vs trilha 0,05–0,08 | Corrigido nesta rodada (remix + sidechain) |
| Média | Camada L5 inalcançável; L4 só nos últimos segundos | Limiares [0, .1, .25, .45, .65, .85]; morte súbita trava em 0,66 | Corrigido nesta rodada |
| Média | 2,7 s de silêncio após o stinger de vitória; pad da derrota só aos 12 s | Render offline: 0,000 de 5,0 a 7,7 s | Corrigido nesta rodada |
| Média | `cast.area` toca 150 ms de ruído sem envelope e corta seco | Maior salto de amostra em t+0,15 em todas as facções | Corrigido nesta rodada (+ `env()` blindado) |
| Média | Com ~450 naves a mixagem vira uma parede: 68 % dos pedidos descartados, armas leves nunca soam | Pool preso em 24 vozes; morte 118 s de voz vs autocannon 0,3 s | Corrigido nesta rodada (mixagem por densidade, vagas reservadas) |
| Média | Toque: contexto criado em `pointerdown` (não conta como ativação no toque) e o ouvinte é removido na primeira vez | Mitigação documentada mas não implementada | Corrigido nesta rodada |
| Baixa | Impacto ignora a quantidade de dano; `shieldPct` nunca é passado | Tiro de defesa de ponto soa igual a railgun de 120 | Corrigido nesta rodada |
| Baixa | O gesto de ativação não é testado de verdade (Chromium com autoplay liberado) | `--autoplay-policy=no-user-gesture-required` nos testes | Corrigido nesta rodada |
| Baixa | Som duplo no botão "+" do construtor; lacunas (vender, aviso, lobby, início da batalha) | `ui.buy` + `ui.click` simultâneos | Corrigido nesta rodada |
| Baixa | Mudo/segundo plano mantém o grafo e o agendador rodando (bateria) | — | Corrigido nesta rodada |
| Baixa | Documento de design descreve o que não existe (motivo do time vencedor, retry de resume) | — | Corrigido nesta rodada |

### Propostas

| Impacto | Esf. | Proposta |
|---|---|---|
| Alto | M | **Fanfarra de início e camada "aproximação"** para os 10 s silenciosos antes do contato (hat em semicolcheias, varredura de filtro no pad). |
| Alto | M | **Remix com ducking em dois sentidos**: SFX cedem até −3 dB quando a trilha está em L3+, −6 dB durante stingers e alarme de morte súbita. Base feita nesta rodada. |
| Alto | P | **Intensidade com termo de densidade de ação** (feito nesta rodada). |
| Alto | M | **Mixagem consciente da densidade em escala**: camada "rugido de batalha", vagas reservadas, variantes de salva, +1,5 dB para as naves do jogador. Base feita nesta rodada. |
| Médio | M | **Temas completos de vitória e derrota** com resolução em ré maior usando o motivo da facção; tique de "MVP revelado". |
| Médio | P | **Impactos por tipo de dano** (clang cinético, chiado de energia, baque explosivo) e variante "crítico". Base feita nesta rodada. |
| Médio | P | **Motivos de facção como feedback**: motivo do time que está vencendo a cada 4 compassos; variante de perigo abaixo de 40 %; fragmento no lobby ao marcar "pronto". |
| Médio | M | **Timbres mais distintos por facção e tamanho** (laser Lúmen em senoides puras, railgun Ferrix com arpejo 8-bit, cuspe Vorrax com formantes) e "salva de capital". |
| Médio | P | **Robustez no celular**: elemento `<audio>` silencioso para o botão de silêncio do iOS, dica "toque para ativar o som" no botão do HUD. |
| Médio | P | **Opções de áudio**: botão "Testar" por slider, slider "Ambiente", "Som reduzido". |
| Baixo | P | **Set pieces** para morte súbita (4 compassos de transição) e morte de capital. |
| Baixo | P | **Regressão de mixagem contínua** (`audio-check --mix`) no CI. |

---

## 6. Multiplayer, servidor e escalabilidade

_(em análise — esta seção é preenchida quando a frente terminar)_

---

## 7. Qualidade de código, testes, ferramentas e documentação

_(em análise — esta seção é preenchida quando a frente terminar)_

---

## Roteiro sugerido para as próximas rodadas

1. **Progressão** (maior impacto por esforço): estrelas e pontuação por nível, bloqueio opcional de níveis,
   debrief pós-batalha com a composição inimiga, seletor de orçamento no modo um jogador.
2. **Legibilidade da batalha**: telegrafar habilidades, minimapa, última morte em câmera lenta, faixa
   "quem está ganhando", marcadores de morte no mundo.
3. **IA**: mapa de perigo e escolta por telas, limite de foco por valor, combos de habilidade, formações
   por arquétipo.
4. **Som**: fanfarra e camada de aproximação, temas completos de fim, motivos de facção como feedback.
5. **Conteúdo**: desbloqueios por facção/estrelas, modo sem fim como run, desafio diário.
