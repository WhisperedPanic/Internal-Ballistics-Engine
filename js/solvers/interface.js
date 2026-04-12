// js/solvers/interface.js
// Unified solver API with runtime toggle for cross-validation
// Lazy-loads solver modules to minimize initial bundle size
// 
// Usage:
//   import { runSimulation, setActiveSolver, SOLVERS, getActiveSolver } from './solvers/interface.js';
//   
//   // Set solver (default: STIFF_JS)
//   setActiveSolver(SOLVERS.STIFF_JS);
//   
//   // Run simulation
//   const results = await runSimulation(params);

// ============================================================================
// SOLVER ENUMS
// ============================================================================

export const SOLVERS = {
  /**
   * Pure-JS stiff solver (implicit Euler + adaptive RK4)
   * Default recommendation for most internal ballistics cases
   */
  STIFF_JS: 'stiff-js',
  
  /**
   * Explicit RK4 fallback (existing physicsSolver.js)
   * Use for cross-validation or non-stiff propellant cases
   */
  RK4: 'rk4'
};

// ============================================================================
// INTERNAL STATE
// ============================================================================

let activeSolver = SOLVERS.STIFF_JS;

// Cache loaded solver modules to avoid re-importing
const solverCache = new Map();

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Set the active solver for subsequent runSimulation() calls
 * @param {string} name - Solver name from SOLVERS enum
 * @throws {Error} If solver name is not recognized
 */
export function setActiveSolver(name) {
  if (!Object.values(SOLVERS).includes(name)) {
    const valid = Object.values(SOLVERS).join(', ');
    throw new Error(`Unknown solver: "${name}". Valid options: ${valid}`);
  }
  activeSolver = name;
  console.log(`✓ Solver switched to: ${name}`);
}

/**
 * Get the currently active solver name
 * @returns {string} Active solver name from SOLVERS enum
 */
export function getActiveSolver() {
  return activeSolver;
}

/**
 * Get list of all available solvers
 * @returns {string[]} Array of solver names
 */
export function getAvailableSolvers() {
  return Object.values(SOLVERS);
}

/**
 * Run internal ballistics simulation with active solver
 * @param {object} params - Simulation parameters (SI units enforced by inputHandler)
 * @param {object} params.propellant - Propellant properties
 * @param {object} params.projectile - Projectile properties
 * @param {number} params.barrelLength_m - Barrel length (m)
 * @param {number} params.boreArea_m2 - Bore cross-sectional area (m²)
 * @param {number} params.V0_m3 - Initial chamber volume (m³)
 * @param {number} [params.maxTime_s=0.02] - Maximum simulation time (s)
 * @returns {Promise<object>} {  [...], stats: {...} }
 * 
 * Output format (matches existing outputRenderer.js expectations):
 *   results.data[] = { t_ms, p_psi, v_fps, z_pct, x_mm }
 *   results.stats = { muzzleVel_fps, peakPress_psi, timeToMuzzle_ms, solver, ... }
 */
export async function runSimulation(params) {
  const startTime = performance.now();
  
  try {
    // Lazy-load and cache solver module
    let solverModule = solverCache.get(activeSolver);
    
    if (!solverModule) {
      solverModule = await loadSolverModule(activeSolver);
      solverCache.set(activeSolver, solverModule);
    }
    
    // Validate solver has required export
    if (typeof solverModule.runSimulation !== 'function') {
      throw new Error(`Solver "${activeSolver}" missing runSimulation() export`);
    }
    
    // Execute solver
    const results = await solverModule.runSimulation(params);
    
    // Add timing metadata
    const endTime = performance.now();
    results.stats.solveTime_ms = endTime - startTime;
    results.stats.solver = activeSolver;
    
    console.log(`✓ Simulation complete: ${results.stats.steps} steps in ${results.stats.solveTime_ms.toFixed(2)} ms`);
    
    return results;
    
  } catch (error) {
    console.error(`✗ Solver "${activeSolver}" failed:`, error.message);
    
    // Auto-fallback to RK4 if stiff solver fails (safety net)
    if (activeSolver === SOLVERS.STIFF_JS) {
      console.warn('⚠️ Auto-falling back to RK4 solver...');
      setActiveSolver(SOLVERS.RK4);
      
      try {
        const fallbackResults = await runSimulation(params); // Recursive retry
        fallbackResults.stats.fallbackFrom = SOLVERS.STIFF_JS;
        return fallbackResults;
      } catch (fallbackError) {
        throw new Error(`All solvers failed: ${error.message} → ${fallbackError.message}`);
      }
    }
    
    throw error;
  }
}

/**
 * Compare two solvers on same inputs for validation
 * @param {object} params - Simulation parameters
 * @param {string} solverA - First solver name
 * @param {string} solverB - Second solver name
 * @returns {Promise<object>} { resultsA, resultsB, comparison }
 */
export async function compareSolvers(params, solverA = SOLVERS.STIFF_JS, solverB = SOLVERS.RK4) {
  console.log(`🔬 Comparing solvers: ${solverA} vs ${solverB}`);
  
  // Run solver A
  setActiveSolver(solverA);
  const resultsA = await runSimulation(params);
  
  // Run solver B
  setActiveSolver(solverB);
  const resultsB = await runSimulation(params);
  
  // Restore original solver
  setActiveSolver(solverA);
  
  // Calculate comparison metrics
  const deltaVel = Math.abs(resultsA.stats.muzzleVel_fps - resultsB.stats.muzzleVel_fps);
  const deltaPress = Math.abs(resultsA.stats.peakPress_psi - resultsB.stats.peakPress_psi);
  const deltaSteps = Math.abs(resultsA.stats.steps - resultsB.stats.steps);
  const deltaVel_pct = (deltaVel / resultsA.stats.muzzleVel_fps) * 100;
  const deltaPress_pct = (deltaPress / resultsA.stats.peakPress_psi) * 100;
  
  const comparison = {
    muzzleVel: {
      solverA: resultsA.stats.muzzleVel_fps,
      solverB: resultsB.stats.muzzleVel_fps,
      delta: deltaVel,
      delta_pct: deltaVel_pct,
      pass: deltaVel_pct < 2.0 // <2% difference = pass
    },
    peakPressure: {
      solverA: resultsA.stats.peakPress_psi,
      solverB: resultsB.stats.peakPress_psi,
      delta: deltaPress,
      delta_pct: deltaPress_pct,
      pass: deltaPress_pct < 2.0
    },
    steps: {
      solverA: resultsA.stats.steps,
      solverB: resultsB.stats.steps,
      delta: deltaSteps
    },
    solveTime: {
      solverA: resultsA.stats.solveTime_ms,
      solverB: resultsB.stats.solveTime_ms
    },
    overall: deltaVel_pct < 2.0 && deltaPress_pct < 2.0
  };
  
  console.log('📊 Solver Comparison Results:', comparison);
  
  return { resultsA, resultsB, comparison };
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Load solver module by name (lazy import)
 * @param {string} name - Solver name from SOLVERS enum
 * @returns {Promise<object>} Solver module with runSimulation() export
 */
async function loadSolverModule(name) {
  switch (name) {
    case SOLVERS.STIFF_JS:
      return await import('./stiffSolver.js');
    
    case SOLVERS.RK4:
      return await import('../physicsSolver.js');
    
    default:
      throw new Error(`No module mapping for solver: ${name}`);
  }
}

/**
 * Reset solver cache (useful for testing hot-reloads)
 */
export function clearSolverCache() {
  solverCache.clear();
  console.log('✓ Solver cache cleared');
}

// ============================================================================
// UI INTEGRATION HELPERS
// ============================================================================

/**
 * Populate a <select> element with available solvers
 * @param {HTMLSelectElement} selectElement - DOM select element
 * @param {string} [activeValue] - Pre-select this solver
 */
export function populateSolverSelect(selectElement, activeValue = activeSolver) {
  if (!selectElement || selectElement.tagName !== 'SELECT') {
    throw new Error('Must provide a valid HTMLSelectElement');
  }
  
  selectElement.innerHTML = '';
  
  for (const [key, value] of Object.entries(SOLVERS)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = key.replace('_', ' ').toLowerCase();
    option.selected = (value === activeValue);
    selectElement.appendChild(option);
  }
  
  console.log(`✓ Populated solver select with ${Object.keys(SOLVERS).length} options`);
}

/**
 * Bind solver select to setActiveSolver()
 * @param {HTMLSelectElement} selectElement - DOM select element
 */
export function bindSolverSelect(selectElement) {
  if (!selectElement || selectElement.tagName !== 'SELECT') {
    throw new Error('Must provide a valid HTMLSelectElement');
  }
  
  selectElement.addEventListener('change', (e) => {
    setActiveSolver(e.target.value);
    console.log(`✓ User switched solver to: ${e.target.value}`);
  });
  
  // Initialize to current active solver
  selectElement.value = activeSolver;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Log solver availability on module load
console.log(`🔧 Solver interface loaded. Available: ${Object.values(SOLVERS).join(', ')}`);
console.log(`🎯 Default solver: ${activeSolver}`);

// Optional: Check URL params for solver override (e.g., ?solver=rk4)
if (typeof window !== 'undefined' && window.location?.search) {
  const urlParams = new URLSearchParams(window.location.search);
  const solverParam = urlParams.get('solver');
  
  if (solverParam && Object.values(SOLVERS).includes(solverParam)) {
    setActiveSolver(solverParam);
    console.log(`📍 Solver overridden via URL param: ${solverParam}`);
  }
}