# Entrega e validação — 8 de outubro de 2026

Trabalho sobre `fcf996de936426ec278510246f578de4cd21193f`, em
`codex/frota-estelar-evolucao`. A referência remota foi conferida antes das
alterações. Os outros projetos não foram alterados. A pré-versão Windows é
distribuída a partir dessa branch; não há merge na `main` ou deploy público do servidor.

## Implementado

- Correções reproduzidas de credenciais de reconexão, correlação de pedidos,
  prontidão após mudanças de orçamento e reconexões concorrentes. O servidor
  rejeita WebSocket de outra origem antes de autenticar cookies ou tokens.
- Correções de dano acima da vida restante, recuo repetitivo, cura durante
  disrupção, feixes contra Fase, proteção circular entre suportes e colisões
  direcionais após teleporte. Objetivos desarmados não geram ameaça fictícia.
- Biblioteca local com vários modelos, nomes, cópias, comparação e reutilização;
  formação, posição e prioridade tática; tutorial e relatório da batalha.
- Campanha com escolta, defesa, sobrevivência e ondas. Personalidades e composições
  variadas; recursos separados da inteligência dos bots. Papéis de equipe no
  multiplayer comunicam intenção, sem bônus de atributos.
- Concílio Astral com três classes de frota e habilidades gravitacionais. Catálogo
  total: cinco facções, 35 classes de frota e cinco especiais pilotáveis.
- Piloto opcional com movimento, mira, tiro direcional, habilidade e remapeamento.
  Custa 200 pontos do orçamento de combate. Pausa, foco perdido e desconexão
  devolvem o controle à IA; a frota continua automática. O servidor valida o
  multiplayer e reproduz os comandos das partidas individuais verificadas.
- SQLite persistente, identidade privada por navegador, histórico, pontos,
  desbloqueios permanentes e perda leve por inatividade. Resultados e compras são
  idempotentes. Migração preserva dados antigos; progresso local importado não
  concede pontos. As regras estão em [PROFILES.md](PROFILES.md).
- Arte procedural, iluminação, propulsores, danos e efeitos; qualidade ajustável,
  redução de efeitos/movimento e alto contraste. HUD estável, chat preservado,
  câmera e teclado corrigidos, incluindo enquadramento inicial em telas estreitas.
- Falas originais por facção, legendas, frequência e volume; síntese opcional usa
  somente voz portuguesa instalada localmente. Nenhum asset comprado ou serviço
  pago de voz foi adicionado.

## Execução

Node.js 24 ou superior é obrigatório, inclusive para `node:sqlite`:

```bash
npm ci
npm start
```

O banco fica em `frota-estelar-data/profiles.sqlite`, ao lado do checkout, ou no
diretório indicado por `FE_DATA_DIR`. Preserve essa pasta em reinícios e backups.
Perfis pertencem ao servidor e ao cookie do navegador; não são contas globais e
não há recuperação após apagar o cookie. Biblioteca e preferências continuam
locais. Consulte o README para execução em desktop e configuração de HTTPS.

## Validação reproduzível

Execute os comandos sequencialmente, sem outras medições pesadas concorrentes:

```bash
npm test
CHROMIUM_PATH=/usr/bin/chromium npm run e2e
CHROMIUM_PATH=/usr/bin/chromium npm run e2e:ui
CHROMIUM_PATH=/usr/bin/chromium npm run e2e:features
node tools/balance.js --seeds=8 --budget=1500
CHROMIUM_PATH=/usr/bin/chromium node tools/benchmark-browser.js
```

A máquina de validação usou Node 24.19.0, npm 11.9.0, Playwright 1.56.1 e Chromium
Debian 151. O navegador é selecionado pela opção pública `executablePath`. O
Chromium distribuído com Playwright não foi instalado após recusas de download
pela política de rede. Os runners usam bancos temporários.

As regressões têm cobertura de simulação, protocolo, cliente, interface e
persistência. A verificação de perfil inclui reabertura do SQLite, atualização de
schema antigo, recompensas duplicadas, compras, inatividade, replays pilotados,
rejeição de comandos inválidos, concorrência e limites de verificações caras.

| Verificação | Resultado |
| --- | --- |
| `npm test` | 394 testes aprovados, zero falhas, cancelamentos ou testes ignorados; 33,5 s |
| `npm run e2e` | 4/4: batalha individual, multiplayer com dois navegadores, orçamento e áudio; 46,3 s |
| `npm run e2e:features` | 6/6: biblioteca, tutorial, opções, piloto, campanha e histórico persistente |
| `npm run e2e:ui` | 5/5: câmera, remoção por teclado, chat, HUD e enquadramento móvel |
| Instalação reproduzível | `npm ci` com lockfile, consulta SQLite em memória e abertura de página no Chromium aprovadas |
| Inicialização normal | `npm start`; `/health`, HTML, módulos, CSS e criação/leitura do perfil por cookie aprovados |

## Medições e limites

São amostras desta máquina; não constituem garantia de desempenho ou equilíbrio
para qualquer frota, dispositivo ou conexão.

| Medição | Resultado observado |
| --- | --- |
| Astral, 1.500 pontos, dois modelos contra oito adversários, oito sementes e ambos os lados | 117 vitórias em 256 partidas (45,7%), sem empates; 58 pela esquerda e 59 pela direita |
| Modelos Astral | Órbita 50/128 (39,1%); Baluarte 67/128 (52,3%) |
| Servidor 6v6 com 12 clientes e 480 naves | 600 ticks a 20 Hz em 30,333 s; 300 quadros; zero erros e descartes; CPU de 5,454 s; atraso do event loop p99 de 17 ms |
| Volume de quadros nesse teste | 3.416.411 bytes de JSON por cliente sem interrupção, antes de compressão e cabeçalhos de transporte |
| Simulação completa 6v6 com 12 pilotos manuais | 340 naves compradas, pico de 389; 1.773 ticks em 2,695 s; média de 1,48 ms/tick e p95 de 4,08 ms |
| Navegador, batalha 6v6 no Worker, um humano e 11 bots | 30,03 s observados; 36,13 FPS; 20,02 ticks/s; 199 a 61 naves |
| Renderização dessa amostra | 1440×900, DPR 1, qualidade alta, SwiftShader por software; tempo de quadro p95 de 33,4 ms; média do indicador suavizado de desenho de 3,78 ms |

A amostra Astral é um ajuste inicial. Alguns confrontos individuais têm vantagens
fortes; a média agregada não demonstra a aprovação de toda a matriz de critérios
do SPEC. Os testes de espelho verificam regressões, mas não substituem uma análise
estatística extensa de todas as composições.

O teste de rede usa 12 conexões WebSocket reais contra o servidor local, com
reconexão concorrente e comparação de quadros/resultados. É distinto da medição
visual, que usa um navegador com bots. Não foram medidos 12 navegadores simultâneos,
rede WAN ou dispositivos móveis físicos. Não há alegação de 60 FPS.

O áudio do jogo foi testado em navegador. A seleção de voz local tem testes, mas
não houve avaliação auditiva de uma voz portuguesa instalada neste ambiente.
O launcher Windows foi atualizado para Node 24, mas não executado em Windows.
O histórico privado do Claude e os patches no caminho Windows informado não
estavam acessíveis; as correções foram reproduzidas no checkout disponível.

Os agentes de implementação foram configurados com GPT-6 Astra e esforço `ultra`.
Não há mecanismo disponível para alterar ou confirmar o modelo da sessão
principal por dentro da tarefa.

## Ambiente de nuvem

A instalação e a inicialização foram verificadas na máquina atual. O rascunho do
ambiente foi salvo com `install_script` e `start_skill` para Node 24, SQLite,
Chromium, persistência, comandos de testes e verificações HTTP. O serviço confirmou
`status: saved` e `requires_publish: true`. Salvar esse rascunho não
publica uma nova imagem: a publicação deve ser concluída nas configurações do
ambiente, pois esta sessão só oferece ferramentas de leitura e gravação do
rascunho. Não foi validada a restauração em uma tarefa nova.
