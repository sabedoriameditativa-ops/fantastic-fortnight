// Shared game constants (Node + browser). No DOM, no Node APIs.

export const TICK_RATE = 20;              // simulation ticks per second
export const DT = 1 / TICK_RATE;          // seconds per tick (0.05)
export const TICK_MS = 1000 / TICK_RATE;  // 50
export const SNAPSHOT_EVERY = 2;          // network/render frame every 2 ticks (10 Hz)

export const SUDDEN_DEATH_TICK = 150 * TICK_RATE; // 150 s: regen off, damage ramps up
export const MAX_TICKS = 240 * TICK_RATE;         // 240 s hard stop, tiebreak by remaining value
export const SUDDEN_DEATH_RAMP = 0.2;             // +20% damage every 15 s after sudden death
export const SUDDEN_DEATH_RAMP_TICKS = 15 * TICK_RATE;

export const TEAM_SIZES = [1, 2, 3, 4, 5, 6];
export const TEAMS = 2;

export const BUDGETS = {
  escaramuca: { id: 'escaramuca', name: 'Escaramuça', points: 800 },
  padrao: { id: 'padrao', name: 'Padrão', points: 1500 },
  guerra_total: { id: 'guerra_total', name: 'Guerra Total', points: 2500 },
};
export const DEFAULT_BUDGET = BUDGETS.padrao.points;

export const FLEET_LIMITS = {
  maxShips: 40,         // purchased ships per player (spawned units excluded)
  minShips: 1,
  maxPerSizeClass: { mothership: 1, capital: 2, large: 4, medium: 12, small: 24, tiny: 24 },
  tinyCapByFaction: { vorrax: 32 },
};

export const DIFFICULTIES = ['facil', 'normal', 'dificil', 'especialista'];
export const DIFFICULTY_NAMES = {
  facil: 'Fácil', normal: 'Normal', dificil: 'Difícil', especialista: 'Especialista',
};

/** Arena size for a given number of players per side (16:9). */
export function worldSize(playersPerSide) {
  const p = Math.max(1, Math.min(6, playersPerSide | 0));
  const w = 2800 + 240 * (p - 1);
  return { w, h: Math.round((w * 9) / 16) };
}

export const SPAWN_X_FRACTION = 0.18;     // team 0 spawns around x = 18% of W, team 1 mirrored
export const LANE_HEIGHT_MIN = 300;       // vertical space reserved per player in the deployment

export const TEAM_COLORS = [
  { id: 0, name: 'Azul', main: '#3fb6ff', dim: '#1a5f8f', glow: '#bfe9ff' },
  { id: 1, name: 'Laranja', main: '#ff7a3d', dim: '#8f3a1a', glow: '#ffd2b8' },
];

export const PROTOCOL_VERSION = 1;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;
export const MAX_NAME_LENGTH = 16;
export const RECONNECT_GRACE_MS = 60_000;
export const COUNTDOWN_SECONDS = 5;

// Snapshot quantization
export const POS_SCALE = 10;                  // positions sent as integer tenths of a unit
export const ANGLE_STEPS = 256;               // heading sent as 0..255
export const HP_SCALE = 1000;                 // hull/shield sent as permille of max

// Ship status flags (bit positions) carried in snapshots
export const FLAG = {
  UNTARGETABLE: 1 << 0, // cloaked / phased / stealth
  DISRUPTED: 1 << 1,    // EMP / ion: regen & repair halted
  BOOSTED: 1 << 2,      // speed/fire-rate buff active
  RETREATING: 1 << 3,
  CASTING: 1 << 4,      // charging / telegraphing an ability or heavy weapon
  SHIELD_BROKEN: 1 << 5,// shield at 0 (recently broken)
  LATCHED: 1 << 6,      // leech attached / is being leeched
  STATIONARY: 1 << 7,   // turret mode / anchored
};
