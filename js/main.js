// js/main.js
// Internal Ballistics Engine - Main Orchestrator
// Wires: inputHandler → solver (via interface) → outputRenderer
// 
// Architecture:
//   User Input → inputHandler.parseAndValidate() → SI params
//   SI params → runSimulation() → { data, stats }
//   Results → outputRenderer.render() → Charts + DOM
//
// Solver abstraction via js/solvers/interface.js
// - Default: stiffSolver.js (implicit Euler + adaptive RK4)
// - Fallback: physicsSolver.js (explicit RK4)
// - Toggle: UI dropdown or URL param (?solver=rk4)

// ============================================================================
// IMPORTS
// ============================================================================

import { 
  runSimulation, 
  setActiveSolver, 
  SOLVERS,
  getActiveSolver,
  populateSolverSelect,
  bindSolverSelect,
  compareSolvers
} from './solvers/interface.js';

import { 
  parseAndValidate, 
  getDefaultParams,
  loadPropellantData
} from './inputHandler.js';

// js/main.js - Update imports to match fixed exports
import { 
  render, 
  renderStats, 
  clearResults
  // Removed: plotPressure, plotVelocity, plotBurnFraction (not needed)
} from './outputRenderer.js';


// ============================================================================
// DOM ELEMENT REFERENCES
// ============================================================================

const DOM = {
  // Form inputs
  form: null,
  propellantSelect: null,
  chargeMassInput: null,
  projectileMassInput: null,
  barrelLengthInput: null,
  boreDiameterInput: null,
  chamberVolumeInput: null,
  
  // Solver controls
  solverSelect: null,
  compareButton: null,
  
  // Action buttons
  simulateButton: null,
  resetButton: null,
  exportButton: null,
  
  // Output containers
  resultsContainer: null,
  statsContainer: null,
  chartsContainer: null,
  
  // Status/feedback
  statusMessage: null,
  loadingIndicator: null
};

// ============================================================================
// STATE
// ============================================================================

const state = {
  isRunning: false,
  lastResults: null,
  lastParams: null,
  propellantData: null
};

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize DOM references and event listeners
 * Called once on DOMContentLoaded
 */
function init() {
  console.log('🚀 Internal Ballistics Engine initializing...');
  
  // Cache DOM elements
  cacheDOMElements();
  
  // Validate DOM elements exist
  if (!validateDOMElements()) {
    console.error('❌ Required DOM elements not found. Check index.html');
    return;
  }
  
  // Load propellant database
  loadPropellantData()
    .then(data => {
      state.propellantData = data;
      populatePropellantSelect(data);
      console.log(`✓ Loaded ${data.length} propellant definitions`);
    })
    .catch(err => {
      console.error('⚠️ Failed to load propellant data:', err.message);
      showStatus('Warning: Propellant data not loaded. Using defaults.', 'warning');
    });
  
  // Initialize solver toggle UI
  initSolverToggle();
  
  // Bind event listeners
  bindEventListeners();
  
  // Load default values into form
  loadDefaultParams();
  
  console.log('✓ Initialization complete. Ready for simulation.');
  showStatus('Ready. Select propellant and configure parameters.', 'success');
}

/**
 * Cache all DOM element references
 */
function cacheDOMElements() {
  DOM.form = document.getElementById('simulation-form');
  DOM.propellantSelect = document.getElementById('propellant-select');
  DOM.chargeMassInput = document.getElementById('charge-mass');
  DOM.projectileMassInput = document.getElementById('projectile-mass');
  DOM.barrelLengthInput = document.getElementById('barrel-length');
  DOM.boreDiameterInput = document.getElementById('bore-diameter');
  DOM.chamberVolumeInput = document.getElementById('chamber-volume');
  
  DOM.solverSelect = document.getElementById('solver-select');
  DOM.compareButton = document.getElementById('compare-solvers-btn');
  
  DOM.simulateButton = document.getElementById('simulate-btn');
  DOM.resetButton = document.getElementById('reset-btn');
  DOM.exportButton = document.getElementById('export-btn');
  
  DOM.resultsContainer = document.getElementById('results-container');
  DOM.statsContainer = document.getElementById('stats-container');
  DOM.chartsContainer = document.getElementById('charts-container');
  
  DOM.statusMessage = document.getElementById('status-message');
  DOM.loadingIndicator = document.getElementById('loading-indicator');
}

/**
 * Validate all required DOM elements exist
 * @returns {boolean} True if all elements found
 */
function validateDOMElements() {
  const required = [
    'form', 'propellantSelect', 'simulateButton', 
    'resultsContainer', 'statsContainer', 'chartsContainer'
  ];
  
  for (const key of required) {
    if (!DOM[key]) {
      console.error(`Missing DOM element: ${key}`);
      return false;
    }
  }
  return true;
}

/**
 * Initialize solver selection UI
 */
function initSolverToggle() {
  if (DOM.solverSelect) {
    populateSolverSelect(DOM.solverSelect);
    bindSolverSelect(DOM.solverSelect);
    console.log('✓ Solver toggle initialized');
  }
  
  if (DOM.compareButton) {
    DOM.compareButton.addEventListener('click', handleCompareSolvers);
    console.log('✓ Solver comparison button bound');
  }
}

/**
 * Populate propellant dropdown from loaded data
 * @param {Array} propellants - Array of propellant definitions
 */
function populatePropellantSelect(propellants) {
  if (!DOM.propellantSelect) return;
  
  DOM.propellantSelect.innerHTML = '<option value="">Select propellant...</option>';
  
  for (const prop of propellants) {
    const option = document.createElement('option');
    option.value = prop.id;
    option.textContent = prop.name;
    option.dataset.index = propellants.indexOf(prop);
    DOM.propellantSelect.appendChild(option);
  }
}

/**
 * Load default parameters into form inputs
 */
function loadDefaultParams() {
  const defaults = getDefaultParams();
  
  if (DOM.chargeMassInput && defaults.chargeMass_g) {
    DOM.chargeMassInput.value = defaults.chargeMass_g;
  }
  if (DOM.projectileMassInput && defaults.projectileMass_g) {
    DOM.projectileMassInput.value = defaults.projectileMass_g;
  }
  if (DOM.barrelLengthInput && defaults.barrelLength_mm) {
    DOM.barrelLengthInput.value = defaults.barrelLength_mm;
  }
  if (DOM.boreDiameterInput && defaults.boreDiameter_mm) {
    DOM.boreDiameterInput.value = defaults.boreDiameter_mm;
  }
  if (DOM.chamberVolumeInput && defaults.chamberVolume_cm3) {
    DOM.chamberVolumeInput.value = defaults.chamberVolume_cm3;
  }
}

/**
 * Bind all event listeners
 */
function bindEventListeners() {
  // Form submission
  if (DOM.form) {
    DOM.form.addEventListener('submit', handleSimulate);
  }
  
  // Simulate button
  if (DOM.simulateButton) {
    DOM.simulateButton.addEventListener('click', handleSimulate);
  }
  
  // Reset button
  if (DOM.resetButton) {
    DOM.resetButton.addEventListener('click', handleReset);
  }
  
  // Export button
  if (DOM.exportButton) {
    DOM.exportButton.addEventListener('click', handleExport);
  }
  
  // Propellant selection auto-fills parameters
  if (DOM.propellantSelect) {
    DOM.propellantSelect.addEventListener('change', handlePropellantSelect);
  }
  
  // Keyboard shortcut (Ctrl/Cmd + Enter to simulate)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSimulate(e);
    }
  });
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle simulation form submission
 * @param {Event} e - Submit event
 */
async function handleSimulate(e) {
  if (e) e.preventDefault();
  
  if (state.isRunning) {
    showStatus('Simulation already running. Please wait.', 'warning');
    return;
  }
  
  try {
    // Set running state
    state.isRunning = true;
    setLoadingState(true);
    clearResults();
    
    // Gather form inputs
    const formInputs = gatherFormInputs();
    
    // Validate and convert to SI params
    showStatus('Validating inputs...', 'info');
    const params = parseAndValidate(formInputs, state.propellantData);
    state.lastParams = params;
    
    // Run simulation
    showStatus('Running simulation...', 'info');
    const startTime = performance.now();
    const results = await runSimulation(params);
    const endTime = performance.now();
    
    // Store results
    state.lastResults = results;
    
    // Render output
    showStatus('Rendering results...', 'info');
    render(results);
    renderStats(results.stats);
    
    // Final status
    const solveTime = (endTime - startTime).toFixed(2);
    showStatus(
      `✓ Simulation complete in ${solveTime} ms | ` +
      `Peak: ${results.stats.peakPress_psi.toFixed(0)} PSI | ` +
      `Muzzle: ${results.stats.muzzleVel_fps.toFixed(0)} FPS`,
      'success'
    );
    
    console.log('📊 Simulation Results:', results.stats);
    
  } catch (error) {
    console.error('❌ Simulation failed:', error);
    showStatus(`Error: ${error.message}`, 'error');
    clearResults();
  } finally {
    state.isRunning = false;
    setLoadingState(false);
  }
}

/**
 * Handle solver comparison (cross-validation)
 * @param {Event} e - Click event
 */
async function handleCompareSolvers(e) {
  if (e) e.preventDefault();
  
  if (state.isRunning) {
    showStatus('Simulation already running. Please wait.', 'warning');
    return;
  }
  
  try {
    state.isRunning = true;
    setLoadingState(true);
    showStatus('Running solver comparison...', 'info');
    
    // Gather and validate inputs
    const formInputs = gatherFormInputs();
    const params = parseAndValidate(formInputs, state.propellantData);
    
    // Run comparison
    const comparison = await compareSolvers(params, SOLVERS.STIFF_JS, SOLVERS.RK4);
    
    // Render comparison results
    renderStats({
      ...comparison.resultsA.stats,
      comparison: comparison.comparison
    });
    
    // Show comparison summary
    const pass = comparison.comparison.overall ? '✓ PASS' : '✗ FAIL';
    const velDiff = comparison.comparison.muzzleVel.delta_pct.toFixed(2);
    const pressDiff = comparison.comparison.peakPressure.delta_pct.toFixed(2);
    
    showStatus(
      `Solver Comparison ${pass} | ` +
      `Velocity Δ: ${velDiff}% | ` +
      `Pressure Δ: ${pressDiff}%`,
      comparison.comparison.overall ? 'success' : 'warning'
    );
    
    console.log('🔬 Comparison Results:', comparison.comparison);
    
  } catch (error) {
    console.error('❌ Comparison failed:', error);
    showStatus(`Error: ${error.message}`, 'error');
  } finally {
    state.isRunning = false;
    setLoadingState(false);
  }
}

/**
 * Handle propellant selection change
 * @param {Event} e - Change event
 */
function handlePropellantSelect(e) {
  const selectedIndex = e.target.selectedOptions[0]?.dataset?.index;
  
  if (selectedIndex !== undefined && state.propellantData) {
    const propellant = state.propellantData[selectedIndex];
    console.log(`✓ Propellant selected: ${propellant.name}`);
    // Could auto-fill propellant-specific defaults here
  }
}

/**
 * Handle reset button click
 * @param {Event} e - Click event
 */
function handleReset(e) {
  if (e) e.preventDefault();
  
  loadDefaultParams();
  clearResults();
  showStatus('Form reset to defaults.', 'info');
  state.lastResults = null;
  state.lastParams = null;
}

/**
 * Handle export button click
 * @param {Event} e - Click event
 */
function handleExport(e) {
  if (e) e.preventDefault();
  
  if (!state.lastResults) {
    showStatus('No results to export. Run a simulation first.', 'warning');
    return;
  }
  
  exportResults(state.lastResults, state.lastParams);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Gather all form input values
 * @returns {object} Form input values (raw, unvalidated)
 */
function gatherFormInputs() {
  return {
    propellantId: DOM.propellantSelect?.value || '',
    chargeMass: DOM.chargeMassInput?.value || '',
    chargeMassUnit: 'g', // Default unit
    projectileMass: DOM.projectileMassInput?.value || '',
    projectileMassUnit: 'g',
    barrelLength: DOM.barrelLengthInput?.value || '',
    barrelLengthUnit: 'mm',
    boreDiameter: DOM.boreDiameterInput?.value || '',
    boreDiameterUnit: 'mm',
    chamberVolume: DOM.chamberVolumeInput?.value || '',
    chamberVolumeUnit: 'cm3'
  };
}

/**
 * Set loading state (disable buttons, show spinner)
 * @param {boolean} isLoading - Loading state
 */
function setLoadingState(isLoading) {
  if (DOM.simulateButton) {
    DOM.simulateButton.disabled = isLoading;
  }
  if (DOM.compareButton) {
    DOM.compareButton.disabled = isLoading;
  }
  if (DOM.loadingIndicator) {
    DOM.loadingIndicator.style.display = isLoading ? 'block' : 'none';
  }
}

/**
 * Show status message to user
 * @param {string} message - Status message
 * @param {string} type - 'success' | 'error' | 'warning' | 'info'
 */
function showStatus(message, type = 'info') {
  if (DOM.statusMessage) {
    DOM.statusMessage.textContent = message;
    DOM.statusMessage.className = `status-message status-${type}`;
  }
  console.log(`[${type.toUpperCase()}] ${message}`);
}

/**
 * Export results to CSV file
 * @param {object} results - Simulation results
 * @param {object} params - Simulation parameters
 */
function exportResults(results, params) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `ballistics-${timestamp}.csv`;
  
  // Build CSV content
  const headers = ['t_ms', 'p_psi', 'v_fps', 'z_pct', 'x_mm'];
  const rows = results.data.map(row => 
    headers.map(h => row[h]).join(',')
  );
  
  const csvContent = [
    `# Internal Ballistics Simulation Export`,
    `# Timestamp: ${timestamp}`,
    `# Solver: ${results.stats.solver}`,
    `# Muzzle Velocity: ${results.stats.muzzleVel_fps.toFixed(2)} FPS`,
    `# Peak Pressure: ${results.stats.peakPress_psi.toFixed(2)} PSI`,
    `# Time to Muzzle: ${results.stats.timeToMuzzle_ms.toFixed(2)} ms`,
    ``,
    headers.join(','),
    ...rows
  ].join('\n');
  
  // Trigger download
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showStatus(`✓ Results exported to ${filename}`, 'success');
}

// ============================================================================
// DEBUG / VALIDATION HELPERS (Console Access)
// ============================================================================

// Expose helpers for console debugging
window.ballisticsDebug = {
  getState: () => state,
  getResults: () => state.lastResults,
  getParams: () => state.lastParams,
  getSolver: () => getActiveSolver(),
  setSolver: (name) => setActiveSolver(name),
  rerun: async () => {
    if (state.lastParams) {
      return await runSimulation(state.lastParams);
    }
    console.warn('No previous params. Run a simulation first.');
  }
};

console.log('🔧 Debug helpers available: window.ballisticsDebug');

// ============================================================================
// DOM READY INITIALIZATION
// ============================================================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ============================================================================
// EXPORTS (For Testing)
// ============================================================================

export { init, handleSimulate, handleReset, exportResults, gatherFormInputs };
