# Áudio procedural de Frota Estelar

O áudio de `client/audio/` é sintetizado com Web Audio: músicas, ruídos, reverberação e efeitos não dependem de gravações, serviços ou bibliotecas de faixas. As melodias, progressões e ritmos são escritos para o jogo. A criação do `AudioContext` continua restrita ao primeiro gesto do jogador.

## Trilhas e estrutura musical

`music.js` oferece três arranjos. A seleção altera notas, harmonia, timbre, andamento e distribuição dos ataques; não é apenas uma troca de volume.

| ID | Nome | Menu / montagem / batalha / vitória / derrota, em BPM | Identidade |
| --- | --- | --- | --- |
| `adventure` | Aventura estelar | 72 / 96 / 128 / 84 / 60 | Ré menor, respostas melódicas, baixo pulsante, bateria e viradas de toms. |
| `arcade` | Órbita arcade | 104 / 116 / 144 / 104 / 72 | Mi menor, instrumentos de pulso, baixo quadrado, síncopes e leve atraso das semicolcheias ímpares. |
| `ambient` | Nebulosa | 60 / 72 / 92 / 72 / 50 | Acordes abertos em torno de Sol, extensões de nona, sinos com parcial inarmônico, baixo e percussão espaçados. |

Menu, montagem e batalha seguem uma forma de dezesseis compassos: abertura (1–4), groove (5–8), crescimento harmônico (9–12), pausa de dois compassos (13–14) e retorno (15–16). As frases deixam a última colcheia em silêncio. O menu apresenta a melodia; a montagem acrescenta respostas e ritmo; a batalha mantém um pulso reconhecível desde o início e acrescenta camadas conforme a situação. Vitória e derrota têm introduções próprias e depois continuam em versões mais calmas do tema selecionado.

O sequenciador agenda a cada 25 ms, com lookahead de 120 ms. A música não depende da taxa de desenho. Retomar uma aba oculta não reproduz todas as notas que ficaram para trás.

### Facções

Os cinco motivos são escritos em `MOTIFS`. Selecionar uma facção solicita seu motivo no próximo compasso da montagem; a frase também reaparece ao longo do arranjo.

- Terranos: sintetizador duplo e contorno de fanfarra.
- Vorrax: triângulo filtrado, vibrato orgânico e viradas graves.
- Lúmen: senoides com quinta e oitava, brilho harmônico e reverberação.
- Ferrix: pulso quantizado e modulação rápida, com acento digital.
- Astral: sino arredondado com parcial de razão 2,756 e pequeno movimento de afinação; arcos melódicos mais abertos.

### Intensidade e transições

A intensidade combina destruição observada, tempo de combate e proporção restante de cada equipe. Seis camadas usam limiares `0, 0.1, 0.25, 0.45, 0.65, 0.85`, com histerese de `0.15`. A progressão mais tensa entra em fronteiras de quatro compassos. Na pausa estrutural, a bateria se retira mesmo quando a intensidade permanece alta.

Cenas e estilos fazem transição no compasso do tema anterior; os finais usam a próxima colcheia para responder rapidamente ao resultado. O fade continua do ganho atual, sem saltar para volume máximo. Trocas rápidas conservam no máximo dois arranjos em retirada. As vozes pertencem ao arranjo que as criou e são interrompidas e desconectadas ao descartá-lo.

## Efeitos de combate

`recipes.js` contém receitas determinísticas por seed. O adaptador `consumeEvents()` consulta armas e habilidades reais do catálogo; não inventa eventos de combate.

| Evento sonoro | Identidade |
| --- | --- |
| Canhão / autocanhão | Corpo grave e ataque mecânico; rajadas curtas para o autocanhão. |
| Laser | Ataque tonal imediato com queda rápida, seguido por um corpo filtrado. |
| Plasma | Descarga com ondulação de frequência que desacelera. |
| Railgun | Descarga imediata e cauda curta, sincronizada ao disparo. |
| Míssil / torpedo | Ignição e deslocamento; impacto separado conforme o evento de colisão. |
| `shot.pilot` | Ataque dirigido curto com timbre próprio de cada facção; armas `directional` usam esta receita. |
| `cast.boost` | Sopro de aceleração com subida tonal. |
| `cast.shield` | Dois harmônicos ascendentes de proteção. |
| `cast.gravity` | Queda grave com parcial de razão raiz de dois. |
| `cast.debuff` | Sinal curto de aprisionamento. |
| `cast.emp` | Dois pulsos elétricos distintos. |
| `cast.repair` | Sequência de três notas de reparo. |
| `cast.regrow` | Ressonância orgânica de regeneração. |

`ABILITY_SOUNDS` relaciona habilidades específicas a essas assinaturas: aceleração e overclock; sobrecargas e campos de escudo; singularidade e poço gravitacional; contenção gravitacional; pulsos EMP; nanites e reconstrução; muda Vorrax. As demais habilidades continuam usando a família definida por seu tipo. Passivas não produzem um segundo som só por emitirem `cast`.

O modificador de facção também afeta armas e explosões: saturação mecânica terrana, ressonância e vibrato Vorrax, harmônicos Lúmen, quantização Ferrix e dois filtros móveis Astral. Um mesmo ataque conserva sua função sonora, mas recebe a identidade de quem o dispara.

## Mixagem, fala e volumes

O caminho principal continua sendo:

```text
SFX -> ganho SFX -> compressor SFX -> master -> limiter -> saída
UI  -> ganho UI --------------------> master
Música -> ganho música -> filtro ---> master
Envios de música/SFX -> ganhos respectivos -> reverberação -> retorno -> master
```

Os sliders usam ganho perceptual `v²`; a música tem trim adicional de `0.8`. Os envios de reverberação têm ganhos independentes que seguem o slider de sua origem. Colocar música ou SFX em zero também silencia sua entrada no efeito, preservando apenas a cauda já existente. Mute atua no master.

| Perfil | Comportamento |
| --- | --- |
| `balanced` — Equilibrado | Relação padrão de música e combate; compressor SFX em −18 dB, razão 4. |
| `cinematic` — Cinemático | Música 6% mais presente, SFX em 94%, mais reverberação; compressor em −16 dB, razão 3. |
| `tactical` — Tático | Música em 65%, SFX preservados, reverberação em volume reduzido; compressor em −20 dB, razão 5. |

Esses fatores se multiplicam pelos sliders, sem reescrevê-los. O limiter final permanece em −3 dB, razão 20, ataque de 2 ms e liberação de 120 ms. Pads normalizam o ganho pela quantidade de notas para que acordes mais densos não fiquem automaticamente mais altos.

`setSpeechDucking(true)` reduz música para 32%, SFX para 58% e retorno de reverberação para 40%, com suavização de 45 ms. `false` restaura a mistura ao longo de 220 ms. O estado é transitório, não altera preferências salvas e respeita mute, visibilidade e mudanças dos sliders durante a fala. O filtro usado por explosões capitais é independente e continua funcionando.

A voz nativa de `speechSynthesis` não passa pelo grafo Web Audio. O controlador de falas deve compor seu volume com o master e cancelar a fala ao mutar. Ele informa início/fim/erro/cancelamento por `onSpeakingChange(active)`, que a batalha liga a `audio.setSpeechDucking(active)`.

## API e persistência

```js
import { audio } from './client/audio/index.js';

audio.init(); // dentro do gesto; idempotente
audio.setScene('menu'); // none, menu, builder, battle, victory, defeat
audio.setFactionHint('astral');
audio.setSettings({ musicTheme: 'arcade', soundProfile: 'tactical' });
audio.setVolume('music', 0.6); // master, music, sfx, ui
audio.setMuted(false);
audio.setSpeechDucking(true);
audio.getSettings();
audio.setBattleState({ aliveFrac: [0.8, 0.6], destroyedFrac: 0.3, elapsedSec: 45 });
audio.setCamera(cx, cy, halfWidth, aspect);
audio.consumeEvents(events, lookupShip);
audio.play('cast.gravity', { faction: 'astral', size: 2, seed: 42, x, y });
audio.stats();
audio.dispose();
```

`setSettings()` recebe um patch e preserva os demais campos. Aceita os quatro volumes, `muted`, `musicTheme` e `soundProfile`. Os padrões de estilo são `adventure` e `balanced`; valores desconhecidos voltam a esses padrões. As configurações funcionam antes da inicialização, sem criar nós. A chave interna continua `frotaEstelar.audio.v1`; a interface mantém suas preferências gerais em `fe.settings` e as aplica ao motor.

`MUSIC_THEMES`, `SOUND_PROFILES`, `normalizeMusicTheme()` e `normalizeSoundProfile()` são exportados por `music.js`, sem efeitos no momento de importação, para uso nas opções e na migração do armazenamento. Os dois catálogos também são reexportados por `index.js`.

## Limites e validação

- Até 24 vozes SFX ativas; eventos importantes podem substituir vozes de prioridade menor.
- Eventos equivalentes dentro de 30 ms são agrupados; ganho extra limitado a 2,2 vezes, com limites de frequência por receita.
- Sons distantes perdem ganho e agudos; eventos pouco relevantes podem ser descartados.
- Receitas e modificadores usam até 14 nós, mais dois do invólucro espacial ou três quando há filtro de distância. Fontes SFX duram no máximo quatro segundos.
- Música não usa o pool de combate. Suas notas têm duração finita, são limpas por `onended` e aparecem em `stats().music.voices/peakVoices`; os arranjos em retirada são limitados a dois.
- Os ruídos e o impulso de reverberação são gerados uma vez por contexto. Não há `Math.random`, timers próprios ou novos contextos nas receitas e no sequenciador.

A suíte `node --test test/audio/*.test.js` verifica automação válida, caminhos do grafo, cleanup, limites de vozes/nós, mapeamento de eventos reais, repetibilidade, diferenças entre arranjos/facções, forma musical completa, mudanças rápidas de estilo, migração das configurações e interação entre fala, mute, sliders e visibilidade.

A validação complementar usa `OfflineAudioContext` real no Chromium: renderiza amostras e mede pico, RMS e cauda. Os cenários exercitam todas as combinações de estilo/cena, efeitos novos nas cinco facções, combate combinado e ciclos musicais completos. Esses testes demonstram os limites nos cenários renderizados; não substituem avaliação subjetiva em alto-falantes e fones nem garantem comportamento idêntico em todos os dispositivos.
