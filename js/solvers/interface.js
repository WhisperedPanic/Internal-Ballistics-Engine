// js/solvers/interface.js
export const SOLVERS = {
  STIFF_JS: 'stiff-js',  // NEW: pure-JS stiff solver
  RK4: 'rk4'            // EXISTING: fallback
};

let activeSolver = SOLVERS.STIFF_JS; // Default to new stiff solver

export function setActiveSolver(name) {
  if (!Object.values(SOLVERS).includes(name)) {
    throw new Error(`Unknown solver: ${name}`);
  }
  activeSolver = name;
}

export async function runSimulation(params) {
  if (activeSolver === SOLVERS.STIFF_JS) {
    const mod = await import('./stiffSolver.js');
    return await mod.runSimulation(params);
  } else {
    const mod = await import('../physicsSolver.js');
    return await mod.runSimulation(params);
  }
}

export { activeSolver };