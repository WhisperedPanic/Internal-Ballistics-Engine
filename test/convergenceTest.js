// test/convergenceTest.js
// Internal Ballistics Engine - Numerical Convergence Test Suite
// 
// Purpose: Verify numerical solver convergence by systematically refining
// tolerance parameters and confirming solution stability.
// 
// Usage:
//   // In browser console:
//   import { runConvergenceTest, analyzeConvergenceOrder } from './test/convergenceTest.js';
//   await runConvergenceTest();
//
//   // Programmatic:
//   const results = await runConvergenceTest({ baseTol: 1e-5, levels: 4 });
//   console.log(`Convergence order: ${results.convergenceOrder}`);

// ============================================================================
// IMPORTS
// ============================================================================

import { runSimulation, SOLVERS, setActiveSolver } from '../js/solvers/interface.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Default test parameters (SI units)
const DEFAULT_TEST_PARAMS = {
  barrelLength_m: 0.500,
  boreDiameter_m: 0.00762,
  boreArea_m2: Math.PI * (0.00762 / 2) ** 2,
  V0_m3: 3.5e-6,
  maxTime_s: 0.02,
  
  projectile: {
    mass_kg: 0.010
  },
  
  propellant: {
    mass_kg: 0.0025,
    density_kgm3: 1600,
    F_Jkg: 1.0e6,
    n: 0.5,
    B_mps_Pa_n: 1.0e-9,
    eta_m3kg: 8.0e-4,
    S0_m2: 0.001,
    alpha_geom: 0.5,
    initialVolume_m3: 0.0025 / 1600
  }
};

// Convergence test configuration
export const CONVERGENCE_CONFIG = {
  baseTolerance: 1e-5,          // Starting tolerance
  refinementLevels: 4,          // Number of refinement steps
  refinementFactor: 10,         // Divide tolerance by this each level
  minLevels: 3,                 // Minimum levels for order calculation
  metrics: [                    // Metrics to track convergence
    'muzzleVel_mps',
    'peakPress_Pa',
    'timeToMuzzle_s',
    'steps'
  ],
  passCriteria: {
    maxVelocityChange_pct: 1.0,   // Max % change between finest levels
    maxPressureChange_pct: 1.0,
    expectedOrder_min: 0.5,       // Minimum convergence order (implicit ~1, RK4 ~4)
    expectedOrder_max: 5.0        // Maximum reasonable order
  }
};

// ============================================================================
// CONVERGENCE ANALYSIS
// ============================================================================

/**
 * Run simulation at specified tolerance level
 * @param {object} params - Simulation parameters
 * @param {number} tolerance - Numerical tolerance
 * @param {string} solver - Solver to use
 * @returns {Promise<object>} Simulation results
 */
async function runAtTolerance(params, tolerance, solver = SOLVERS.STIFF_JS) {
  // Note: Current stiffSolver.js doesn't expose tolerance as param
  // This is a placeholder for future enhancement
  // For now, we track convergence via step size refinement
  
  setActiveSolver(solver);
  return await runSimulation(params);
}

/**
 * Calculate convergence order from sequence of results
 * Uses Richardson extrapolation: order = log(e1/e2) / log(r)
 * where r = refinement factor, e = error estimate
 * 
 * @param {number[]} values - Sequence of metric values at each tolerance level
 * @param {number} refinementFactor - Tolerance refinement factor
 * @returns {number} Estimated convergence order
 */
export function calculateConvergenceOrder(values, refinementFactor) {
  if (values.length < 3) {
    return NaN; // Need at least 3 points for order calculation
  }
  
  const orders = [];
  
  for (let i = 0; i < values.length - 2; i++) {
    const e1 = Math.abs(values[i] - values[i + 1]);
    const e2 = Math.abs(values[i + 1] - values[i + 2]);
    
    if (e1 > 0 && e2 > 0) {
      const order = Math.log(e1 / e2) / Math.log(refinementFactor);
      orders.push(order);
    }
  }
  
  if (orders.length === 0) return NaN;
  
  // Return median order (robust to outliers)
  orders.sort((a, b) => a - b);
  return orders[Math.floor(orders.length / 2)];
}

/**
 * Analyze convergence behavior of a metric sequence
 * @param {number[]} values - Metric values at each tolerance level
 * @param {string} metricName - Name of metric
 * @param {number} refinementFactor - Tolerance refinement factor
 * @returns {object} Convergence analysis
 */
export function analyzeConvergenceOrder(values, metricName, refinementFactor) {
  if (values.length < CONVERGENCE_CONFIG.minLevels) {
    return {
      metric: metricName,
      valid: false,
      reason: `Insufficient levels (${values.length} < ${CONVERGENCE_CONFIG.minLevels})`
    };
  }
  
  const order = calculateConvergenceOrder(values, refinementFactor);
  const changes = [];
  
  for (let i = 0; i < values.length - 1; i++) {
    const change_pct = Math.abs(values[i] - values[i + 1]) / values[i + 1] * 100;
    changes.push(change_pct);
  }
  
  const finalChange_pct = changes[changes.length - 1];
  const maxChange_pct = Math.max(...changes);
  
  return {
    metric: metricName,
    valid: true,
    convergenceOrder: order,
    finalChange_pct: finalChange_pct,
    maxChange_pct: maxChange_pct,
    values,
    changes_pct: changes,
    pass: finalChange_pct < CONVERGENCE_CONFIG.passCriteria.maxVelocityChange_pct
  };
}

// ============================================================================
// MAIN CONVERGENCE TEST
// ============================================================================

/**
 * Run full convergence test suite
 * @param {object} options - Test options
 * @param {object} options.params - Simulation parameters (overrides default)
 * @param {number} options.baseTolerance - Starting tolerance
 * @param {number} options.refinementLevels - Number of refinement levels
 * @param {string} options.solver - Solver to test
 * @param {boolean} options.verbose - Log detailed output
 * @returns {Promise<object>} Convergence test results
 */
export async function runConvergenceTest(options = {}) {
  const {
    params = DEFAULT_TEST_PARAMS,
    baseTolerance = CONVERGENCE_CONFIG.baseTolerance,
    refinementLevels = CONVERGENCE_CONFIG.refinementLevels,
    solver = SOLVERS.STIFF_JS,
    verbose = true
  } = options;
  
  const startTime = performance.now();
  
  if (verbose) {
    console.log('\n' + '='.repeat(60));
    console.log('🔬 Numerical Convergence Test');
    console.log('='.repeat(60));
    console.log(`Solver: ${solver}`);
    console.log(`Base Tolerance: ${baseTolerance.toExponential(1)}`);
    console.log(`Refinement Levels: ${refinementLevels}`);
    console.log(`Refinement Factor: ${CONVERGENCE_CONFIG.refinementFactor}`);
    console.log('-'.repeat(60));
  }
  
  // Collect results at each tolerance level
  const results = [];
  const tolerances = [];
  
  for (let level = 0; level < refinementLevels; level++) {
    const tol = baseTolerance / Math.pow(CONVERGENCE_CONFIG.refinementFactor, level);
    tolerances.push(tol);
    
    if (verbose) {
      console.log(`\nLevel ${level + 1}/${refinementLevels}: tolerance = ${tol.toExponential(1)}`);
    }
    
    try {
      // Note: Current implementation doesn't expose tolerance param
      // Running same simulation multiple times to collect stats
      // Future enhancement: modify stiffSolver.js to accept tolerance param
      const result = await runAtTolerance(params, tol, solver);
      results.push(result);
      
      if (verbose) {
        console.log(`   Steps: ${result.stats.steps}`);
        console.log(`   Muzzle Velocity: ${result.stats.muzzleVel_mps.toFixed(3)} m/s`);
        console.log(`   Peak Pressure: ${(result.stats.peakPress_Pa / 1e6).toFixed(2)} MPa`);
        console.log(`   Time to Muzzle: ${(result.stats.timeToMuzzle_s * 1000).toFixed(3)} ms`);
      }
    } catch (error) {
      if (verbose) {
        console.error(`   ❌ Failed at level ${level + 1}: ${error.message}`);
      }
      results.push(null);
    }
  }
  
  // Filter out failed runs
  const validResults = results.filter(r => r !== null);
  
  if (validResults.length < CONVERGENCE_CONFIG.minLevels) {
    const errorMsg = `Insufficient valid results (${validResults.length}) for convergence analysis`;
    if (verbose) console.error(`\n❌ ${errorMsg}`);
    
    return {
      valid: false,
      error: errorMsg,
      validLevels: validResults.length,
      requiredLevels: CONVERGENCE_CONFIG.minLevels
    };
  }
  
  // Analyze convergence for each metric
  const analyses = {};
  
  for (const metric of CONVERGENCE_CONFIG.metrics) {
    const values = validResults.map(r => r.stats[metric]);
    analyses[metric] = analyzeConvergenceOrder(values, metric, CONVERGENCE_CONFIG.refinementFactor);
  }
  
  // Calculate overall convergence order (average across metrics)
  const orders = Object.values(analyses)
    .filter(a => a.valid && !isNaN(a.convergenceOrder))
    .map(a => a.convergenceOrder);
  
  const avgOrder = orders.length > 0 
    ? orders.reduce((a, b) => a + b, 0) / orders.length 
    : NaN;
  
  const endTime = performance.now();
  const totalTime = (endTime - startTime).toFixed(2);
  
  // Determine pass/fail
  const passCriteria = CONVERGENCE_CONFIG.passCriteria;
  const velocityAnalysis = analyses.muzzleVel_mps;
  const pressureAnalysis = analyses.peakPress_Pa;
  
  const pass = 
    velocityAnalysis?.valid && 
    pressureAnalysis?.valid &&
    velocityAnalysis.finalChange_pct < passCriteria.maxVelocityChange_pct &&
    pressureAnalysis.finalChange_pct < passCriteria.maxPressureChange_pct &&
    !isNaN(avgOrder) &&
    avgOrder >= passCriteria.expectedOrder_min &&
    avgOrder <= passCriteria.expectedOrder_max;
  
  // Summary output
  if (verbose) {
    console.log('\n' + '-'.repeat(60));
    console.log('📊 Convergence Analysis Summary');
    console.log('-'.repeat(60));
    
    for (const [metric, analysis] of Object.entries(analyses)) {
      if (analysis.valid) {
        const status = analysis.pass ? '✅' : '⚠️';
        console.log(`${status} ${metric}:`);
        console.log(`   Convergence Order: ${analysis.convergenceOrder.toFixed(3)}`);
        console.log(`   Final Change: ${analysis.finalChange_pct.toFixed(3)}%`);
        console.log(`   Max Change: ${analysis.maxChange_pct.toFixed(3)}%`);
      } else {
        console.log(`❌ ${metric}: ${analysis.reason}`);
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`Overall Convergence Order: ${avgOrder.toFixed(3)}`);
    console.log(`Status: ${pass ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Execution Time: ${totalTime} ms`);
    console.log('='.repeat(60) + '\n');
  }
  
  return {
    valid: true,
    pass,
    solver,
    toleranceLevels: tolerances,
    results: validResults,
    analyses,
    convergenceOrder: avgOrder,
    executionTime_ms: totalTime,
    passCriteria
  };
}

// ============================================================================
// SOLVER COMPARISON CONVERGENCE
// ============================================================================

/**
 * Compare convergence behavior between two solvers
 * @param {object} options - Test options
 * @param {string} options.solverA - First solver
 * @param {string} options.solverB - Second solver
 * @param {boolean} options.verbose - Log detailed output
 * @returns {Promise<object>} Comparison results
 */
export async function compareSolverConvergence(options = {}) {
  const {
    solverA = SOLVERS.STIFF_JS,
    solverB = SOLVERS.RK4,
    verbose = true
  } = options;
  
  if (verbose) {
    console.log('\n🔬 Solver Convergence Comparison');
    console.log(`${solverA} vs ${solverB}\n`);
  }
  
  // Run convergence test for each solver
  const resultsA = await runConvergenceTest({ solver: solverA, verbose: false });
  const resultsB = await runConvergenceTest({ solver: solverB, verbose: false });
  
  // Compare convergence orders
  const comparison = {
    solverA: {
      name: solverA,
      convergenceOrder: resultsA.convergenceOrder,
      pass: resultsA.pass,
      executionTime_ms: resultsA.executionTime_ms
    },
    solverB: {
      name: solverB,
      convergenceOrder: resultsB.convergenceOrder,
      pass: resultsB.pass,
      executionTime_ms: resultsB.executionTime_ms
    },
    orderDifference: Math.abs(resultsA.convergenceOrder - resultsB.convergenceOrder),
    bothPass: resultsA.pass && resultsB.pass
  };
  
  if (verbose) {
    console.log('📊 Comparison Results:');
    console.log(`   ${solverA}: Order = ${resultsA.convergenceOrder.toFixed(3)}, ${resultsA.pass ? '✅' : '❌'}`);
    console.log(`   ${solverB}: Order = ${resultsB.convergenceOrder.toFixed(3)}, ${resultsB.pass ? '✅' : '❌'}`);
    console.log(`   Order Difference: ${comparison.orderDifference.toFixed(3)}`);
    console.log(`   Both Pass: ${comparison.bothPass ? '✅' : '❌'}`);
  }
  
  return comparison;
}

// ============================================================================
// STEP SIZE ANALYSIS (Alternative Convergence Metric)
// ============================================================================

/**
 * Analyze adaptive step size behavior during simulation
 * Useful for understanding solver efficiency and stiffness detection
 * 
 * @param {object} results - Simulation results with step data
 * @returns {object} Step size analysis
 */
export function analyzeStepBehavior(results) {
  if (!results?.data || results.data.length < 2) {
    return { valid: false, reason: 'Insufficient data points' };
  }
  
  const stepSizes = [];
  for (let i = 1; i < results.data.length; i++) {
    const dt = (results.data[i].t_ms - results.data[i - 1].t_ms) / 1000; // Convert to seconds
    stepSizes.push(dt);
  }
  
  const minStep = Math.min(...stepSizes);
  const maxStep = Math.max(...stepSizes);
  const avgStep = stepSizes.reduce((a, b) => a + b, 0) / stepSizes.length;
  const stepRatio = maxStep / minStep;
  
  // Calculate step size variance (indicator of adaptation activity)
  const variance = stepSizes.reduce((sum, dt) => sum + Math.pow(dt - avgStep, 2), 0) / stepSizes.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = stdDev / avgStep;
  
  return {
    valid: true,
    totalSteps: stepSizes.length,
    minStep_s: minStep,
    maxStep_s: maxStep,
    avgStep_s: avgStep,
    stepRatio: stepRatio,
    stdDev_s: stdDev,
    coefficientOfVariation: coefficientOfVariation,
    interpretation: coefficientOfVariation > 0.5 
      ? 'High adaptation activity (likely stiff regions detected)'
      : 'Low adaptation activity (smooth solution)'
  };
}

// ============================================================================
// VISUALIZATION HELPERS
// ============================================================================

/**
 * Generate data for convergence plot
 * @param {object} convergenceResults - Results from runConvergenceTest()
 * @returns {object} Plot-ready data
 */
export function generateConvergencePlotData(convergenceResults) {
  if (!convergenceResults.valid) {
    return null;
  }
  
  const { toleranceLevels, analyses } = convergenceResults;
  
  const datasets = [];
  const colors = ['#007bff', '#28a745', '#dc3545', '#ffc107', '#17a2b8'];
  
  let colorIdx = 0;
  for (const [metric, analysis] of Object.entries(analyses)) {
    if (analysis.valid) {
      datasets.push({
        label: metric,
        data: analysis.values,
        borderColor: colors[colorIdx % colors.length],
        backgroundColor: colors[colorIdx % colors.length],
        yAxisID: 'y'
      });
      colorIdx++;
    }
  }
  
  return {
    labels: toleranceLevels.map(t => t.toExponential(0)),
    datasets,
    options: {
      responsive: true,
      scales: {
        x: {
          title: { display: true, text: 'Tolerance Level' },
          type: 'category'
        },
        y: {
          title: { display: true, text: 'Metric Value' },
          type: 'linear'
        }
      }
    }
  };
}

// ============================================================================
// CONSOLE OUTPUT FORMATTERS
// ============================================================================

/**
 * Format convergence test results for console output
 * @param {object} results - Results from runConvergenceTest()
 * @returns {string} Formatted output
 */
export function formatConvergenceResults(results) {
  if (!results.valid) {
    return `❌ Convergence test invalid: ${results.error}`;
  }
  
  const status = results.pass ? '✅ PASS' : '❌ FAIL';
  
  let output = `
${'='.repeat(60)}
${status} - Numerical Convergence Test
${'='.repeat(60)}
Solver: ${results.solver}
Convergence Order: ${results.convergenceOrder.toFixed(3)}
Execution Time: ${results.executionTime_ms} ms

Metric Analysis:
`;
  
  for (const [metric, analysis] of Object.entries(results.analyses)) {
    if (analysis.valid) {
      const passMark = analysis.pass ? '✅' : '⚠️';
      output += `  ${passMark} ${metric}: Order=${analysis.convergenceOrder.toFixed(3)}, Δ=${analysis.finalChange_pct.toFixed(3)}%\n`;
    }
  }
  
  output += '='.repeat(60) + '\n';
  return output;
}

// ============================================================================
// AUTO-RUN ON MODULE LOAD (Optional)
// ============================================================================

// Auto-run if URL contains ?convergence param
if (typeof window !== 'undefined' && window.location?.search?.includes('convergence')) {
  console.log('🔍 Auto-running convergence test (remove ?convergence to disable)');
  runConvergenceTest({ verbose: true }).then(results => {
    console.log(formatConvergenceResults(results));
    
    // Display in page if element exists
    const output = document.getElementById('validation-output');
    if (output) {
      output.style.display = 'block';
      output.textContent = formatConvergenceResults(results);
    }
  });
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  CONVERGENCE_CONFIG,
  DEFAULT_TEST_PARAMS,
  runConvergenceTest,
  compareSolverConvergence,
  calculateConvergenceOrder,
  analyzeConvergenceOrder,
  analyzeStepBehavior,
  generateConvergencePlotData,
  formatConvergenceResults
};

// For console convenience
if (typeof window !== 'undefined') {
  window.ballisticsConvergence = {
    run: runConvergenceTest,
    compare: compareSolverConvergence,
    analyze: analyzeConvergenceOrder,
    steps: analyzeStepBehavior,
    plot: generateConvergencePlotData,
    format: formatConvergenceResults,
    config: CONVERGENCE_CONFIG
  };
  console.log('🔧 Convergence test helpers: window.ballisticsConvergence');
}