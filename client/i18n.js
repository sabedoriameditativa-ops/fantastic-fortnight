// All UI strings (pt-BR). Code identifiers stay in English; everything the
// player reads comes from here. `fmt()` fills `{name}` placeholders and
// `errorMessage()` maps server / fleet error codes to friendly text.

export const T = {
  app: {
    title: 'Frota Estelar',
    tagline: 'Monte sua frota. Deixe a batalha com a IA.',
    version: 'protótipo',
    loading: 'Carregando…',
    back: 'Voltar',
    confirm: 'Confirmar',
    cancel: 'Cancelar',
    close: 'Fechar',
    yes: 'Sim',
    no: 'Não',
    copy: 'Copiar',
    copied: 'Copiado!',
    copyFailed: 'Não foi possível copiar. Selecione o texto manualmente.',
    points: 'pts',
    pointsLong: 'pontos',
    ships: 'naves',
    ship: 'nave',
    team: ['Time Azul', 'Time Laranja'],
    teamShort: ['Azul', 'Laranja'],
    you: 'você',
    bot: 'Bot',
    host: 'anfitrião',
    unknown: '—',
    errorTitle: 'Algo deu errado',
    unexpectedError: 'Ocorreu um erro inesperado. Veja o console para detalhes.',
    offline: 'Sem conexão',
    optional: 'opcional',
  },

  menu: {
    single: 'Um jogador',
    multi: 'Multijogador',
    codex: 'Galeria de naves',
    howto: 'Como jogar',
    options: 'Opções',
    nameLabel: 'Seu nome',
    namePlaceholder: 'Comandante',
    nameHint: 'Usado nas partidas (até 16 caracteres).',
    progress: 'Progresso: nível {level} em {difficulty}',
    noProgress: 'Nenhum nível concluído ainda.',
    footer: 'Jogo de estratégia espacial com batalhas automáticas · 4 facções · 32 naves',
  },

  sp: {
    title: 'Um jogador',
    subtitle: 'Escolha o nível, a dificuldade e o formato da batalha.',
    level: 'Nível',
    levelCleared: 'Concluído',
    levelLocked: 'Bloqueado',
    endless: 'Além do Fim',
    endlessHint: 'Níveis infinitos: o inimigo cresce a cada onda.',
    customLevel: 'Onda',
    difficulty: 'Dificuldade do inimigo',
    teamSize: 'Formato',
    teamSizeHint: 'Em formatos maiores, seus aliados são bots.',
    allyDifficulty: 'Dificuldade dos aliados',
    allies: 'Seus aliados: {n} bot(s) · {difficulty}',
    noAllies: 'Sem aliados: você contra o inimigo.',
    enemyBudget: 'Orçamento inimigo',
    yourBudget: 'Seu orçamento',
    enemyFaction: 'Facção inimiga',
    randomFaction: 'Aleatória',
    boss: 'Chefe garantido: {name}',
    builder: { random: 'frota aleatória', preset: 'frota predefinida', counter: 'frota de contra-ataque' },
    build: 'Montar frota →',
    quickPlay: 'Jogar com a última frota',
    // {pct} = |budgetMul − 1| in percent, filled by difficultyDescription() from AI_PROFILES
    diffDesc: {
      facil: 'Bots lentos e desorganizados. Orçamento inimigo reduzido em {pct}%.',
      normal: 'Bots competentes com frotas predefinidas.',
      dificil: 'Bots coordenados que montam frotas contra a sua, com {pct}% a mais de orçamento.',
      especialista: 'Bots perfeitos com {pct}% a mais de orçamento. Boa sorte.',
    },
    diffDescSameBudget: { facil: 'Bots lentos e desorganizados.', dificil: 'Bots coordenados que montam frotas contra a sua.', especialista: 'Bots perfeitos. Boa sorte.' },
  },

  builder: {
    title: 'Montar frota',
    enemy: 'Inimigo',
    strongVs: 'Forte contra este casco:',
    weakVs: 'Fraco:',
    vsEnemyHull: 'contra o casco inimigo',
    enemyHint: 'Os chips de arma de cada nave ficam verdes ou vermelhos conforme o casco inimigo.',
    abilityOf: 'Habilidade: {name}',
    subtitleSp: 'Nível {level} · {levelName} · {difficulty}',
    subtitleMp: 'Sala {code} · orçamento {budget} pts',
    faction: 'Facção',
    lore: 'Sobre a facção',
    passive: 'Passiva',
    roster: 'Naves disponíveis',
    budget: 'Orçamento',
    budgetValue: '{cost} / {budget} pts',
    shipsCount: 'Naves: {count} / {max}',
    remaining: 'Restam {n} pts',
    over: 'Excede em {n} pts',
    presets: 'Predefinições',
    autocomplete: 'Autocompletar',
    autocompleteHint: 'Preenche o orçamento restante com naves da facção.',
    clear: 'Limpar',
    summary: 'Sua frota',
    emptyFleet: 'Nenhuma nave. Clique nas naves ou escolha uma predefinição.',
    composition: 'Composição',
    totalEhp: 'Resistência',
    totalDps: 'Poder de fogo',
    confirmSp: 'Confirmar e lutar',
    confirmMp: 'Enviar frota',
    cost: 'Custo',
    max: 'máx. {n}',
    hull: 'Casco',
    shield: 'Escudo',
    dps: 'Dano/s',
    speed: 'Velocidade',
    range: 'Alcance',
    noShield: 'sem escudo',
    weapons: 'Armas',
    ability: 'Habilidade',
    add: 'Adicionar {name}',
    remove: 'Remover {name}',
    role: {
      diver: 'Mergulhadora', brawler: 'Combatente', kiter: 'Artilheira', striker: 'Atacante',
      escort: 'Escolta', support: 'Apoio', carrier: 'Porta-naves', anchor: 'Âncora',
    },
    sizeClass: { tiny: 'Minúscula', small: 'Pequena', medium: 'Média', large: 'Grande', capital: 'Capital', mothership: 'Nave-mãe' },
    sizeShort: { tiny: 'min', small: 'peq', medium: 'méd', large: 'gra', capital: 'cap', mothership: 'mãe' },
    warnUnspent: 'Você ainda tem {n} pts sem usar.',
    valid: 'Frota válida',
    factionChanged: 'Facção alterada. A frota anterior ficou guardada.',
    presetApplied: 'Predefinição "{name}" aplicada.',
    cleared: 'Frota limpa.',
    autocompleted: 'Frota completada com {n} nave(s).',
    capReached: 'Limite de {cap} nave(s) {size} atingido.',
    budgetReached: 'Orçamento insuficiente para {name}.',
    fleetSent: 'Frota enviada ✓',
    hint: 'Clique no cartão para adicionar · botões − / + ajustam a quantidade',
  },

  fleetErr: {
    FLEET_BAD_SHAPE: 'Frota inválida.',
    FLEET_UNKNOWN_FACTION: 'Facção desconhecida.',
    FLEET_UNKNOWN_CLASS: 'Classe de nave desconhecida: {cls}.',
    FLEET_WRONG_FACTION: 'Todas as naves devem ser da mesma facção.',
    FLEET_OVER_BUDGET: 'Frota ultrapassa o orçamento em {over} pts.',
    FLEET_SHIP_COUNT_MIN: 'A frota precisa de pelo menos {min} nave.',
    FLEET_SHIP_COUNT_MAX: 'A frota pode ter no máximo {max} naves.',
    FLEET_CLASS_CAP: 'Limite de {cap} nave(s) {size} por frota (você tem {count}).',
  },

  mp: {
    title: 'Multijogador',
    subtitle: 'Crie uma sala ou entre com um código de 4 letras.',
    connecting: 'Conectando ao servidor…',
    connected: 'Conectado como {name}',
    create: 'Criar sala',
    createTitle: 'Nova sala',
    join: 'Entrar',
    joinTitle: 'Entrar com código',
    codePlaceholder: 'CÓDIGO',
    codeHint: '4 letras ou números (sem 0, 1, I, O).',
    teamSize: 'Formato',
    budget: 'Orçamento',
    budgetDesc: { escaramuca: 'Escaramuça · 800 pts', padrao: 'Padrão · 1500 pts', guerra_total: 'Guerra Total · 2500 pts' },
    serverUnavailable: 'Não foi possível conectar ao servidor multijogador. Verifique se o servidor está rodando (npm start).',
    reconnecting: 'Reconectando…',
    connectionLost: 'Conexão perdida.',
    needName: 'Digite um nome antes de jogar online.',
    nameTitle: 'Como quer ser chamado?',
    namePlaceholder: 'Seu nome de comandante',
    nameOk: 'Continuar',
    nameRandom: 'Sortear nome',
    nameHint: 'O nome aparece na sala, na batalha e nos resultados. Até 20 caracteres.',
  },

  lobby: {
    title: 'Sala {code}',
    copyCode: 'Copiar código',
    copyLink: 'Copiar link',
    linkCopied: 'Link copiado! Envie para seus amigos.',
    codeCopied: 'Código copiado!',
    latency: '{ms} ms',
    teamSize: 'Formato',
    budget: 'Orçamento',
    botDifficulty: 'Bots',
    slotEmpty: 'Vaga livre',
    slotJoin: 'Entrar aqui',
    addBot: '+ Bot',
    removeBot: 'Remover bot',
    fleetReady: 'frota pronta',
    fleetMissing: 'sem frota',
    ready: 'Pronto',
    notReady: 'Aguardando',
    disconnected: 'desconectado',
    hostMark: 'anfitrião',
    yourFleet: 'Sua frota',
    noFleet: 'Você ainda não montou uma frota.',
    buildFleet: 'Montar frota',
    editFleet: 'Editar frota',
    readyBtn: 'Pronto',
    unreadyBtn: 'Cancelar pronto',
    start: 'Iniciar batalha',
    fillBots: 'Preencher vagas vazias com bots',
    waitingHost: 'Aguardando o anfitrião iniciar…',
    leave: 'Sair da sala',
    chat: 'Chat',
    chatPlaceholder: 'Mensagem…',
    send: 'Enviar',
    spectators: 'Espectadores',
    spectating: 'Você está assistindo. Clique em uma vaga livre para jogar.',
    countdown: 'A batalha começa em {s}…',
    countdownGo: 'COMBATE!',
    missing: 'Faltam: {list}',
    missingFleet: '{name} (sem frota)',
    missingReady: '{name} (não está pronto)',
    missingSlots: 'vagas vazias',
    phase: { lobby: 'Sala', countdown: 'Contagem', battle: 'Em batalha', results: 'Resultados' },
    youMoved: 'Você mudou de vaga.',
    kicked: 'Você foi removido da sala.',
    roomClosed: 'A sala foi encerrada.',
    left: 'Você saiu da sala.',
    botName: 'Bot {n}',
    anyFaction: 'Facção aleatória',
    hostOnly: 'Somente o anfitrião pode alterar.',
    rematchPending: 'Revanche: {n}/{total} votos',
    battleInProgress: 'Batalha em andamento — você entrará como espectador até o fim.',
  },

  battle: {
    preparing: 'Preparando batalha…',
    vs: 'VS',
    begin: 'Começar',
    skip: 'Pular',
    go: 'COMBATE',
    timer: '{time} / {max}',
    speed: 'Velocidade',
    pause: 'Pausar',
    resume: 'Continuar',
    paused: 'PAUSADO',
    live: 'AO VIVO',
    reconnecting: 'Reconectando…',
    lost: 'Conexão perdida',
    reconnect: 'Reconectar',
    suddenDeath: 'MORTE SÚBITA',
    suddenDeathHint: 'Sem regeneração · dano crescente',
    engage: 'CONTATO',
    names: 'Nomes',
    grid: 'Grade',
    cameraAuto: 'Câmera auto',
    cameraFree: 'Câmera livre',
    autoStart: 'Começa automaticamente em {n} s',
    counterHint: 'Eficaz contra este casco',
    sound: 'Som',
    quit: 'Sair',
    quitConfirm: 'Abandonar a batalha?',
    alive: '{alive}/{total}',
    hull: 'Casco',
    shield: 'Escudo',
    log: 'Registro',
    victory: 'VITÓRIA DO {team}',
    victoryYours: 'VITÓRIA!',
    defeat: 'DERROTA',
    draw: 'EMPATE',
    reason: { elimination: 'Eliminação total', timeout: 'Tempo esgotado', draw: 'Empate' },
    ev: {
      engage: 'As frotas entraram em contato!',
      suddenDeath: 'Morte súbita: regeneração desligada, dano crescente.',
      die: '{ship} de {owner} destruída por {killer}',
      dieNoKiller: '{ship} de {owner} foi destruída',
      cast: '{ship} de {owner} ativou {ability}',
      sbreak: 'Escudo de {ship} ({owner}) rompido',
      spawn: '{owner} lançou {n}× {ship}',
      end: 'Fim da batalha',
      ownerYou: 'você',
    },
    tooltipFlags: { untargetable: 'intocável', disrupted: 'interrompida', boosted: 'impulso', retreating: 'recuando', casting: 'carregando', latched: 'agarrada' },
  },

  results: {
    title: 'Resultados',
    winner: 'Vitória do {team}',
    draw: 'Empate',
    youWon: 'Você venceu!',
    youLost: 'Você perdeu.',
    reasonElim: 'Todas as naves inimigas foram destruídas.',
    reasonElimLost: 'Todas as suas naves foram destruídas.',
    reasonElimNeutral: 'Um dos lados foi completamente destruído.',
    reasonTimeout: 'Tempo esgotado — vence quem manteve mais valor de frota.',
    reasonTimeoutDmg: 'Tempo esgotado — desempate por dano causado.',
    reasonDraw: 'Nenhum dos lados conseguiu se impor.',
    duration: 'Duração: {time}',
    levelCleared: 'Nível {level} concluído em {difficulty}!',
    player: 'Jogador',
    faction: 'Facção',
    ships: 'Naves',
    dealt: 'Dano causado',
    taken: 'Dano recebido',
    kills: 'Abates',
    healing: 'Cura',
    value: 'Valor restante',
    mvp: 'Nave destaque',
    mvpDesc: '{ship} de {owner} · {dmg} de dano',
    playAgain: 'Jogar de novo',
    playAgainHint: 'Mesma frota, nova semente',
    nextLevel: 'Próximo nível',
    editFleet: 'Editar frota',
    menu: 'Menu',
    rematch: 'Revanche',
    rematchVotes: 'Revanche ({n}/{total})',
    leave: 'Sair da sala',
    seed: 'Semente: {seed}',
  },

  codex: {
    title: 'Galeria de naves',
    subtitle: '32 naves em 4 facções. Clique em uma nave para ver a ficha completa.',
    all: 'Todas',
    stats: 'Atributos',
    hp: 'Casco',
    shield: 'Escudo',
    regen: 'Regeneração',
    dr: 'Redução de dano',
    speed: 'Velocidade',
    turn: 'Giro',
    cost: 'Custo',
    size: 'Classe',
    role: 'Função',
    hullType: 'Tipo de casco',
    weapons: 'Armas',
    weapon: { damage: 'Dano', salvo: 'Salva', cooldown: 'Recarga', range: 'Alcance', speed: 'Velocidade', aoe: 'Área', dot: 'Dano contínuo', pd: 'Defesa de ponto', charge: 'Carga', chain: 'Cadeia', contact: 'Contato', hitscan: 'instantâneo', minTarget: 'Alvo mínimo', homing: 'Guiado' },
    ability: 'Habilidade',
    cooldown: 'Recarga {s} s',
    duration: 'Duração {s} s',
    passive: 'Passiva da facção',
    spawnable: 'Também pode ser lançada por outras naves',
    unitU: 'u',
    unitUs: 'u/s',
    unitDeg: '°/s',
    perSec: '/s',
    shieldDetail: '{cap} (regen {regen}/s após {delay} s)',
    kind: { buff: 'Reforço', aura: 'Aura', spawn: 'Lançamento', area: 'Área', teleport: 'Teleporte', heal: 'Cura', latch: 'Agarrar', buff_ally: 'Reforço aliado', passive: 'Passiva' },
  },

  howto: {
    title: 'Como jogar',
    controlsTitle: 'Controles na batalha',
    controls: [
      ['Espaço', 'começar / pausar e continuar (um jogador)'],
      ['1 · 2 · 4', 'velocidade ×1, ×2, ×4 (um jogador; no multijogador o tempo é do servidor)'],
      ['N', 'mostrar ou ocultar os nomes das naves'],
      ['G', 'grade da arena'],
      ['C', 'voltar à câmera automática'],
      ['Esc', 'sair da batalha'],
      ['Roda · arrastar · pinça', 'zoom e deslocamento da câmera (ela fica livre até você voltar à automática)'],
      ['Clique ou toque numa nave', 'seguir a nave; duplo clique ou duplo toque volta à câmera automática'],
    ],
    steps: [
      { title: '1. Escolha uma facção', text: 'Cada facção tem 8 naves, um tipo de casco e uma passiva. Terranos são blindados e disciplinados; Vorrax regeneram e vêm em número; Lúmen têm escudos enormes e cascos frágeis; Ferrix se reconstroem e atravessam blindagens.' },
      { title: '2. Monte a frota dentro do orçamento', text: 'Cada nave custa pontos. O orçamento padrão é 1500. Há limites por classe de tamanho (1 nave-mãe, 2 capitais, 4 grandes, 12 médias, 24 pequenas, 24 minúsculas — 32 para Vorrax) e no máximo 40 naves. Use as predefinições como ponto de partida.' },
      { title: '3. A batalha é automática', text: 'As naves escolhem alvos, se posicionam e usam habilidades sozinhas. Você assiste, acelera o tempo (x2, x4) e aprende o que funciona. Vence quem destruir todas as naves compradas do inimigo.' },
      { title: '4. Morte súbita e tempo', text: 'Aos 150 s a regeneração desliga e o dano cresce 20% a cada 15 s. Aos 240 s a batalha termina: vence quem tiver mais valor de frota restante; se a diferença for de até 2%, vence quem causou mais dano.' },
      { title: '5. Tipos de dano importam', text: 'Lasers derretem escudos e cascos orgânicos; cinéticos e torpedos castigam blindagem e cristal; plasma e bioácido corroem nanitos; pulsos iônicos apagam escudos e interrompem regeneração.' },
      { title: '6. Multijogador', text: 'Crie uma sala, envie o código (ou o link) aos amigos, montem as frotas em segredo e marquem "Pronto". Vagas vazias podem ser preenchidas por bots. O servidor simula e todos assistem à mesma batalha.' },
    ],
    damageTitle: 'Multiplicadores de dano (arma × defesa)',
    damageHint: 'Valores maiores que 1 significam dano extra; menores que 1, dano reduzido.',
    hullTypes: 'Tipos de casco',
    vsShield: 'Escudo',
    sizesTitle: 'Classes de tamanho e limites por frota',
  },

  options: {
    title: 'Opções',
    audio: 'Áudio',
    master: 'Volume geral',
    music: 'Música',
    sfx: 'Efeitos',
    ui: 'Interface',
    mute: 'Silenciar tudo',
    video: 'Vídeo',
    reducedMotion: 'Reduzir movimento',
    reducedMotionDesc: 'Desliga tremores de câmera, scanlines e transições.',
    rmAuto: 'Seguir o sistema',
    rmOn: 'Ligado',
    rmOff: 'Desligado',
    quality: 'Qualidade dos efeitos',
    qAuto: 'Automática',
    qLow: 'Baixa',
    qMedium: 'Média',
    qHigh: 'Alta',
    showNames: 'Mostrar nomes das naves na batalha',
    grid: 'Mostrar grade tática',
    gameplay: 'Jogo',
    name: 'Nome do jogador',
    resetProgress: 'Apagar progresso',
    resetConfirm: 'Apagar todo o progresso do modo Um jogador?',
    resetDone: 'Progresso apagado.',
    saved: 'Opções salvas.',
    audioNote: 'O áudio é ativado após o primeiro clique ou tecla.',
  },

  err: {
    BAD_MESSAGE: 'Mensagem inválida enviada ao servidor.',
    BAD_NAME: 'Nome inválido. Use de 1 a 16 caracteres.',
    VERSION_MISMATCH: 'Versão do jogo diferente da do servidor. Recarregue a página.',
    RATE_LIMITED: 'Calma! Muitas mensagens em pouco tempo.',
    ROOM_NOT_FOUND: 'Sala não encontrada. Confira o código.',
    ROOM_FULL: 'A sala está cheia.',
    ROOM_MAINTENANCE: 'O servidor vai reiniciar em instantes. Tente criar a sala novamente daqui a pouco.',
    ROOM_ADDRESS_LIMIT: 'Já existem salas demais abertas a partir do seu endereço. Feche uma sala antes de criar outra.',
    ROOM_LIMIT: 'O servidor atingiu o limite de salas. Tente novamente mais tarde.',
    NOT_HOST: 'Somente o anfitrião pode fazer isso.',
    WRONG_PHASE: 'Essa ação não é possível nesta fase da sala.',
    BAD_TEAM_SIZE: 'Formato de time inválido.',
    BAD_BUDGET: 'Orçamento inválido.',
    SLOT_TAKEN: 'Essa vaga já está ocupada.',
    SLOT_INVALID: 'Vaga inválida.',
    FLEET_INVALID: 'A frota foi recusada pelo servidor: {detail}',
    FLEET_MISSING: 'Monte uma frota antes de ficar pronto.',
    NOT_ALL_READY: 'Nem todos estão prontos. {detail}',
    COUNTDOWN_ABORTED: 'Contagem cancelada: alguém saiu ou cancelou o pronto.',
    NOT_IN_ROOM: 'Você não está em uma sala.',
    TIMEOUT: 'O servidor não respondeu a tempo.',
    DISCONNECTED: 'Conexão com o servidor perdida.',
    CONNECT_FAILED: 'Não foi possível conectar ao servidor.',
    NOT_CONNECTED: 'Você não está conectado.',
    UNKNOWN: 'Erro desconhecido ({code}).',
  },

  difficulty: { facil: 'Fácil', normal: 'Normal', dificil: 'Difícil', especialista: 'Especialista' },
  hullType: { armored: 'Blindado', organic: 'Orgânico', crystalline: 'Cristalino', nanite: 'Nanítico' },
};

/**
 * Fill `{key}` placeholders.
 * @param {string} s
 * @param {Record<string, any>} [params]
 * @returns {string}
 */
export function fmt(s, params) {
  if (!params) return s;
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k])));
}

/**
 * Human message for a server / fleet / client error code.
 * @param {string} code
 * @param {any} [detail]
 * @returns {string}
 */
export function errorMessage(code, detail) {
  if (isFleetCode(code)) return fleetErrorMessage(code, detail);
  // the server also answers ROOM_FULL when it cannot create another room (detail 'server' | 'codes')
  if (code === 'ROOM_FULL' && (detail === 'server' || detail === 'codes')) return T.err.ROOM_LIMIT;
  if (code === 'ROOM_FULL' && detail === 'address') return T.err.ROOM_ADDRESS_LIMIT;
  if (code === 'ROOM_FULL' && detail === 'maintenance') return T.err.ROOM_MAINTENANCE;
  const s = T.err[code];
  if (!s) return fmt(T.err.UNKNOWN, { code: code || '?' });
  let d = '';
  if (detail !== undefined && detail !== null) {
    if (typeof detail === 'string') d = detail;
    else if (detail.missing && Array.isArray(detail.missing)) d = fmt(T.lobby.missing, { list: detail.missing.map(missingLabel).join(', ') });
    else if (isFleetCode(detail.code)) d = fleetErrorMessage(detail.code, detail.detail);
    else if (detail.code) d = String(detail.code);
    else d = '';
  }
  return fmt(s, { detail: d }).replace(/\s+$/, '');
}

/** Fleet validation codes (shared/fleet.js FLEET_ERR); FLEET_SHIP_COUNT is rendered through its _MIN/_MAX variants. */
function isFleetCode(code) {
  return !!code && (code === 'FLEET_SHIP_COUNT' || T.fleetErr[code] !== undefined);
}

function missingLabel(m) {
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object') {
    // the server reports { team, slot, reason } (reason: empty | disconnected | no_fleet | not_ready)
    const name = m.name || m.playerId || m.id || (Number.isInteger(m.team) && Number.isInteger(m.slot)
      ? `${T.app.teamShort[m.team] || m.team} · vaga ${m.slot + 1}` : '?');
    const reason = m.reason;
    if (reason === 'no_fleet' || reason === 'fleet' || m.hasFleet === false) return fmt(T.lobby.missingFleet, { name });
    if (reason === 'not_ready' || reason === 'ready' || m.ready === false) return fmt(T.lobby.missingReady, { name });
    if (reason === 'empty' || reason === 'slots' || m.empty) return `${name} (${T.lobby.slotEmpty.toLowerCase()})`;
    if (reason === 'disconnected') return `${name} (${T.lobby.disconnected})`;
    return name;
  }
  return String(m);
}

/**
 * Message for a fleet validation failure (codes from shared/fleet.js).
 * @param {string} code
 * @param {any} [detail]
 * @returns {string}
 */
export function fleetErrorMessage(code, detail) {
  const d = detail || {};
  if (code === 'FLEET_OVER_BUDGET') return fmt(T.fleetErr.FLEET_OVER_BUDGET, { over: Math.max(0, (d.cost || 0) - (d.budget || 0)) });
  if (code === 'FLEET_SHIP_COUNT') {
    if ((d.count || 0) < (d.min || 1)) return fmt(T.fleetErr.FLEET_SHIP_COUNT_MIN, { min: d.min || 1 });
    return fmt(T.fleetErr.FLEET_SHIP_COUNT_MAX, { max: d.max || 40 });
  }
  if (code === 'FLEET_CLASS_CAP') {
    const size = T.builder.sizeClass[d.sizeClass] ? T.builder.sizeClass[d.sizeClass].toLowerCase() : d.sizeClass || '';
    return fmt(T.fleetErr.FLEET_CLASS_CAP, { cap: d.cap, size, count: d.count });
  }
  const s = T.fleetErr[code];
  return s ? fmt(s, d) : fmt(T.err.UNKNOWN, { code });
}

/** Difficulty display name. */
/**
 * Difficulty blurb for the single-player setup. The budget percentage is derived
 * from the AI profile's `budgetMul` (shared/aiProfiles.js) so the text cannot drift.
 * @param {string} id
 * @param {number} [budgetMul]  AI_PROFILES[id].budgetMul (1 = same budget as the player)
 */
export function difficultyDescription(id, budgetMul) {
  const tpl = T.sp.diffDesc[id];
  if (!tpl) return '';
  const mul = Number.isFinite(budgetMul) ? budgetMul : 1;
  const pct = Math.round(Math.abs(mul - 1) * 100);
  if (pct === 0 && /\{pct\}/.test(tpl)) return T.sp.diffDescSameBudget[id] || tpl.replace(/\s*\S*\{pct\}[^.]*\.?/, '').trim();
  return fmt(tpl, { pct });
}

export function difficultyName(id) {
  return T.difficulty[id] || id || '';
}
