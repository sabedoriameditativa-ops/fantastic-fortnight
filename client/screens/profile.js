import { h, button, clear, add } from '../util/dom.js';
import { num } from '../util/format.js';
import { errorMessage, difficultyName } from '../i18n.js';
import { DIFFICULTIES } from '/shared/constants.js';

function mountLocalProgress(root, ctx) {
  const rows = DIFFICULTIES.map(difficulty => {
    const saved = ctx.state.progress[difficulty]?.cleared;
    const cleared = Array.isArray(saved) ? [...new Set(saved.filter(level => Number.isInteger(level) && level > 0))] : [];
    return h('tr', h('td', difficultyName(difficulty)), h('td.n', String(cleared.length)), h('td.n', cleared.length ? String(cleared.reduce((max, level) => Math.max(max, level), 0)) : '—'));
  });
  root.appendChild(h('div.screen.narrow', { test: 'local-progress' },
    h('div.screen-head', h('h1', 'Progresso local'), button('Voltar', { test: 'back', onClick: () => ctx.go('menu') })),
    h('div.stack',
      h('div.panel.stack', h('h2', 'Salvo neste navegador'),
        h('p', 'Níveis concluídos, biblioteca de frotas e preferências ficam salvos neste navegador. Use o mesmo navegador e endereço para continuar.'),
        h('p.small.muted', 'Eles não são sincronizados com outros navegadores, dispositivos ou sites. Apagar os dados do site também apaga esse progresso.'),
        h('div.row.gap.wrap',
          button('Biblioteca de frotas', { test: 'local-fleets', onClick: () => ctx.go('fleetBuilder', { mode: 'sp', fleet: ctx.state.lastFleet }) }),
          button('Preferências', { test: 'local-options', onClick: () => ctx.go('options') }))),
      h('div.panel.table-wrap', h('h2', 'Campanha'),
        h('table.table', { test: 'local-progress-table' }, h('thead', h('tr', h('th', 'Dificuldade'), h('th.n', 'Níveis concluídos'), h('th.n', 'Maior nível'))), h('tbody', rows)),
        button('Jogar campanha', { test: 'local-campaign', primary: true, onClick: () => ctx.go('spSetup') })),
      h('div.panel', h('h2', 'Conteúdo do treino local'),
        h('p', 'As cinco facções, suas naves e os pilotos especiais estão disponíveis para experimentar. O orçamento e os limites da frota continuam valendo.'),
        h('p.small.muted', 'Esta versão não oferece perfil de servidor, histórico verificado, pontos ou desbloqueios online.')))));
  return { unmount() {} };
}

export function mount(root, props, ctx) {
  if (ctx.isStatic) return mountLocalProgress(root, ctx);
  let disposed = false, busy = false;
  const body = h('div.stack', { test: 'profile-content' }, h('p', 'Carregando perfil…'));
  root.appendChild(h('div.screen.narrow', h('div.screen-head', h('h1', 'Perfil do comandante'),
    button('Voltar', { test: 'back', onClick: () => ctx.go('menu') })),
    h('p.small.muted', 'Este perfil é persistido neste servidor e reconhecido pelo navegador. Não é uma conta entre dispositivos; apagar os cookies perde o vínculo. Suas frotas e o progresso antigo continuam guardados localmente.'), body));
  const render = p => {
    if (!p || disposed) return;
    clear(body);
    const policy = p.policy || {};
    add(body,
      h('div.panel', h('h2', `${num(p.points)} pontos`), h('p.small', `Total conquistado: ${num(p.lifetimePoints || 0)}.`),
        h('p.small', { test: 'inactivity-policy', text: p.inactivity?.warning || 'Consulte as regras de inatividade do servidor.' }),
        h('p.tiny.muted', `Uma partida válida rende ${policy.participation ?? 8} pontos de participação, até ${policy.performanceCap ?? 6} de desempenho e ${policy.victory ?? 14} de vitória. Derrotas têm perda líquida de pelo menos ${policy.minimumDefeatLoss ?? 2}; desempenho baixo pode descontar mais ${policy.poorPerformanceLoss ?? 2}. Limites diários: +${policy.dailyGainCap ?? 180} / −${policy.dailyLossCap ?? 30}.`),
        h('p.tiny.muted', 'A contribuição inclui dano efetivo e reparos em relação ao seu time. Apenas resultados verificados recebem pontos; repetir o envio não repete a recompensa. Inatividade mede dias sem concluir partidas, nunca ausência de teclas na batalha automática.')),
      h('div.panel.stack', h('h2', 'Desbloqueios permanentes'),
        (p.unlockCatalog || []).map(item => {
          const unlocked = p.unlocks?.includes(item.id);
          const required = Array.isArray(item.requires) ? item.requires : item.requires ? [item.requires] : [];
          const missing = required.filter(id => !p.unlocks?.includes(id));
          return h('div.library-row', h('div', h('b', { text: item.name }), h('p.tiny.muted', { text: item.description })),
            button(unlocked ? 'Desbloqueado' : missing.length ? 'Requer facção' : `${item.cost} pontos`, { test: `unlock-${item.id}`, disabled: busy || unlocked || missing.length > 0 || p.points < item.cost, onClick: async () => {
              if (busy) return; busy = true; render(p);
              try { const next = await ctx.profile.unlock(item.id); busy = false; render(next); }
              catch (e) { busy = false; ctx.toast(errorMessage(e.code || 'UNKNOWN'), 'error'); render(ctx.profile.snapshot || p); }
            } }));
        })),
      h('div.panel.table-wrap', h('h2', 'Histórico verificado'),
        p.history?.length ? h('table.table', h('thead', h('tr', h('th', 'Data'), h('th', 'Modo'), h('th', 'Resultado'), h('th.n', 'Pontos'))),
          h('tbody', p.history.slice(0, 30).map(entry => h('tr',
            h('td', new Date(entry.at).toLocaleDateString('pt-BR')), h('td', entry.mode || '—'),
            h('td', ({ win: 'Vitória', loss: 'Derrota', draw: 'Empate', unrated: 'Sem pontuação' })[entry.outcome] || entry.outcome || '—'),
            h('td.n', `${entry.delta > 0 ? '+' : ''}${entry.delta || 0}`)))))
          : h('p.small.muted', 'Conclua uma partida verificada para iniciar seu histórico.')),
    );
  };
  const off = ctx.profile.subscribe(render);
  ctx.profile.ensure().then(async () => { await ctx.profile.migrateLegacy(ctx.state.progress); render(await ctx.profile.refresh()); }).catch(e => {
    if (disposed) return;
    clear(body); add(body, h('div.panel', h('p', 'O perfil do servidor está indisponível. As frotas e o treino local continuam disponíveis.'),
      h('p.small.muted', { text: e.message || 'Tente novamente mais tarde.' }), button('Tentar novamente', { onClick: () => ctx.go('profile') })));
  });
  return { unmount() { disposed = true; off(); } };
}
