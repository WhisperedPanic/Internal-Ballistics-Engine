// js/inputHandler.js
// Internal Ballistics Engine - Input Handling & Validation Module

// ============================================================================
// CONSTANTS (Not exported inline - exported at end only)
// ============================================================================

const DEFAULT_PARAMS = {
  chargeMass_g: 2.50,
  projectileMass_g: 10.0,
  barrelLength_mm: 500,
  boreDiameter_mm: 7.62,
  chamberVolume_cm3: 3.50
};

const UNIT_CONVERSIONS = {
  g_to_kg: 0.001,
  kg_to_g: 1000,
  mm_to_m: 0.001,
  m_to_mm: 1000,
  cm_to_m: 0.01,
  cm3_to_m3: 1e-6,
  m3_to_cm3: 1e6,
  Pa_to_PSI: 0.000145038,
  PSI_to_Pa: 6894.76,
  MPa_to_Pa: 1e6,
  mps_to_fps: 3.28084,
  fps_to_mps: 0.3048
};

// ============================================================================
// INTERNAL STATE
// ============================================================================

let propellantCache = null;

// ============================================================================
// FUNCTIONS (Not exported inline - exported at end only)
// ============================================================================

async function loadPropellantData() {
  if (propellantCache) return propellantCache;
  try {
    const response = await fetch('./data/propellants.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    propellantCache = await response.json();
    return propellantCache;
  } catch (e) {
    console.error('Failed to load propellants:', e.message);
    propellantCache = [];
    return propellantCache;
  }
}

function getPropellantById(id) {
  return propellantCache?.find(p => p.id === id) || null;
}

function getDefaultParams() {
  return { ...DEFAULT_PARAMS };
}

function convertUnit(value, from, to) {
  const key = `${from}_to_${to}`;
  return UNIT_CONVERSIONS[key] ? value * UNIT_CONVERSIONS[key] : value;
}

function parseAndValidate(inputs, propellants = null) {
  const errors = [];
  
  const chargeMass_kg = parseFloat(inputs.chargeMass) * UNIT_CONVERSIONS.g_to_kg;
  const projectileMass_kg = parseFloat(inputs.projectileMass) * UNIT_CONVERSIONS.g_to_kg;
  const barrelLength_m = parseFloat(inputs.barrelLength) * UNIT_CONVERSIONS.mm_to_m;
  const boreDiameter_m = parseFloat(inputs.boreDiameter) * UNIT_CONVERSIONS.mm_to_m;
  const chamberVolume_m3 = parseFloat(inputs.chamberVolume) * UNIT_CONVERSIONS.cm3_to_m3;
  
  if (chargeMass_kg <= 0) errors.push('Charge mass must be > 0');
  if (projectileMass_kg <= 0) errors.push('Projectile mass must be > 0');
  if (barrelLength_m <= 0) errors.push('Barrel length must be > 0');
  if (boreDiameter_m <= 0) errors.push('Bore diameter must be > 0');
  if (chamberVolume_m3 <= 0) errors.push('Chamber volume must be > 0');
  
  let propellant = null;
  if (inputs.propellantId && propellants) {
    propellant = getPropellantById(inputs.propellantId);
    if (!propellant) errors.push(`Propellant "${inputs.propellantId}" not found`);
  } else if (!inputs.propellantId) {
    errors.push('Please select a propellant');
  }
  
  if (errors.length > 0) throw new Error(errors.join('\n'));
  
  return {
    barrelLength_m,
    boreDiameter_m,
    boreArea_m2: Math.PI * (boreDiameter_m / 2) ** 2,
    V0_m3: chamberVolume_m3,
    maxTime_s: 0.02,
    projectile: { mass_kg: projectileMass_kg },
    propellant: {
      mass_kg: chargeMass_kg,
      density_kgm3: propellant.density_kgm3,
      F_Jkg: propellant.F_Jkg,
      n: propellant.n,
      B_mps_Pa_n: propellant.B_mps_Pa_n,
      eta_m3kg: propellant.eta_m3kg,
      S0_m2: propellant.S0_m2,
      alpha_geom: propellant.alpha_geom,
      initialVolume_m3: chargeMass_kg / propellant.density_kgm3
    }
  };
}

function loadFormConfig(cfg) {
  if (!cfg) return;
  const map = {
    chargeMass: 'chargeMass_g',
    projectileMass: 'projectileMass_g',
    barrelLength: 'barrelLength_mm',
    boreDiameter: 'boreDiameter_mm',
    chamberVolume: 'chamberVolume_cm3'
  };
  for (const [field, key] of Object.entries(map)) {
    const el = document.getElementById(field);
    if (el && cfg[key] !== undefined) el.value = cfg[key];
  }
}

function saveFormConfig() {
  const cfg = {
    chargeMass_g: document.getElementById('charge-mass')?.value,
    projectileMass_g: document.getElementById('projectile-mass')?.value,
    barrelLength_mm: document.getElementById('barrel-length')?.value,
    boreDiameter_mm: document.getElementById('bore-diameter')?.value,
    chamberVolume_cm3: document.getElementById('chamber-volume')?.value,
    savedAt: new Date().toISOString()
  };
  try {
    localStorage.setItem('ballistics-config', JSON.stringify(cfg));
  } catch (e) {
    console.warn('Save failed:', e.message);
  }
  return cfg;
}

function loadSavedConfig() {
  try {
    const raw = localStorage.getItem('ballistics-config');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ============================================================================
// SINGLE EXPORT STATEMENT (ONLY ONE IN ENTIRE FILE)
// ============================================================================

export {
  DEFAULT_PARAMS,
  UNIT_CONVERSIONS,
  loadPropellantData,
  getPropellantById,
  getDefaultParams,
  convertUnit,
  parseAndValidate,
  loadFormConfig,
  saveFormConfig,
  loadSavedConfig
};

// ============================================================================
// CONSOLE HELPER (Not exported - window global only)
// ============================================================================

if (typeof window !== 'undefined') {
  window.ballisticsInput = {
    defaults: DEFAULT_PARAMS,
    conversions: UNIT_CONVERSIONS,
    loadPropellants: loadPropellantData,
    getPropellant: getPropellantById,
    validate: parseAndValidate,
    save: saveFormConfig,
    load: loadSavedConfig
  };
}
