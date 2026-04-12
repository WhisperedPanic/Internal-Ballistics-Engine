// js/solvers/interface.js - Single export, solver-agnostic
export const SOLVERS = {
  LSODA: 'lsoda',
  RK4: 'rk4'
};

let activeSolver = SOLVERS.LSODA; // Configurable via URL param or UI

export function setActiveSolver(name) {
  if (!Object.values(SOLVERS).includes(name)) throw new Error('Unknown solver');
  activeSolver = name;
}

export async function runSimulation(params) {
  // Lazy-load solver modules to keep initial bundle small
  if (activeSolver === SOLVERS.LSODA) {
    const { runSimulation: lsodaRun } = await import('./lsodaSolver.js');
    return await lsodaRun(params);
  } else {
    const { runSimulation: rk4Run } = await import('../physicsSolver.js');
    return await rk4Run(params);
  }
}

// Optional: expose for debugging/UI toggle
export { activeSolver };