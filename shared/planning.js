// Bounded, serializable pre-battle orders shared by the editor and simulation.
export const FORMATIONS = Object.freeze({ balanced: 'Equilibrada', wedge: 'Cunha', line: 'Linha', screen: 'Tela de proteção' });
export const POSITIONS = Object.freeze({ front: 'Avançada', center: 'Central', rear: 'Recuada' });
export const PRIORITIES = Object.freeze({ balanced: 'Adaptativa', weakest: 'Finalizar avariadas', support: 'Suportes e porta-naves', capital: 'Naves capitais' });
export function normalizePlanning(plan) {
  return {
    formation: Object.hasOwn(FORMATIONS, plan?.formation) ? plan.formation : 'balanced',
    position: Object.hasOwn(POSITIONS, plan?.position) ? plan.position : 'center',
    priority: Object.hasOwn(PRIORITIES, plan?.priority) ? plan.priority : 'balanced',
  };
}

export function priorityBonus(plan, target) {
  switch (plan?.priority) {
    case 'weakest': return 1.4 * (1 - (target.hp + target.shield) / (target.hpMax + target.shieldMax));
    case 'support': return ['support', 'carrier'].includes(target.role) ? 1.2 : 0;
    case 'capital': return target.sizeIdx >= 4 ? 1.2 : 0;
    default: return 0;
  }
}
