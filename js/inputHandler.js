// js/inputHandler.js
// Internal Ballistics Engine - Input Handling & Validation Module
// 
// Purpose: Parse form inputs, validate parameters, convert to SI units
// Loads propellant database from data/propellants.json

// ============================================================================
// DEFAULT PARAMETERS (SI Base)
// ============================================================================

export const DEFAULT_PARAMS = {
  chargeMass_g: 2.50,
  projectileMass_g: 10.0,
  barrelLength_mm: 500,
  boreDiameter_mm: 7.62,
  chamberVolume_cm3: 3.50
};

// ============================================================================
// PROPULSION DATABASE
// ============================================================================

let propellantCache = null;

/**
 * Load propellant database from JSON file
 * @returns {Promise<Array>} Array of propellant definitions
 */
export async function loadPropellantData() {
  if (propellantCache) {
    return propellantCache;
  }
  
  try {
    const response = await fetch('./data/propellants.json');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    propellantCache = await response.json();
    console.log(`✓ Loaded ${propellantCache.length} propellant definitions`);
    return propellantCache;
  } catch (error) {
    console.error('❌ Failed to load propellant data:', error.message);
    // Return empty array as fallback
    propellantCache = [];
    return propellantCache;
  }
}

/**
 * Get propellant definition by ID
 * @param {string} propellantId - Propellant ID from database
 * @returns {object|null} Propellant definition or null
 */
export function getPropellantById(propellantId) {
  if (!propellantCache || !propellantId) return null;
  return propellantCache.find(p => p.id === propellantId) || null;
}

// ============================================================================
// UNIT CONVERSION UTILITIES
// ============================================================================

export const UNIT_CONVERSIONS = {
  // Mass
  g_to_kg: 0.001,
  kg_to_g: 1000,
  
  // Length
  mm_to_m: 0.001,
  m_to_mm: 1000,
  cm_to_m: 0.01,
  
  // Volume
  cm3_to_m3: 1e-6,
  m3_to_cm3: 1e6,
  
  // Pressure
  Pa_to_PSI: 0.000145038,
  PSI_to_Pa: 6894.76,
  MPa_to_Pa: 1e6,
  
  // Velocity
  mps_to_fps: 3.28084,
  fps_to_mps: 0.3048
};

/**
 * Convert value between units
 * @param {number} value - Value to convert
 * @param {string} fromUnit - Source unit
 * @param {string} toUnit - Target unit
 * @returns {number} Converted value
 */
export function convertUnit(value, fromUnit, toUnit) {
  const key = `${fromUnit}_to_${toUnit}`;
  const factor = UNIT_CONVERSIONS[key];
  
  if (!factor) {
    console.warn(`⚠️ Unknown conversion: ${fromUnit} → ${toUnit}`);
    return value;
  }
  
  return value * factor;
}

// ============================================================================
// INPUT PARSING & VALIDATION
// ============================================================================

/**
 * Get default parameters for form initialization
 * @returns {object} Default parameter values
 */
export function getDefaultParams() {
  return { ...DEFAULT_PARAMS };
}

/**
 * Parse and validate form inputs, return SI params for solver
 * @param {object} formInputs - Raw form input values
 * @param {Array} propellantData - Loaded propellant database
 * @returns {object} Validated parameters in SI units
 * @throws {Error} If validation fails
 */
export function parseAndValidate(formInputs, propellantData = null) {
  const errors = [];
  const warnings = [];
  
  // --------------------------------------------------------------------------
  // Extract and convert raw inputs to SI
  // --------------------------------------------------------------------------
  
  // Charge mass (g → kg)
  const chargeMass_g = parseFloat(formInputs.chargeMass) || 0;
  const chargeMass_kg = chargeMass_g * UNIT_CONVERSIONS.g_to_kg;
  
  // Projectile mass (g → kg)
  const projectileMass_g = parseFloat(formInputs.projectileMass) || 0;
  const projectileMass_kg = projectileMass_g * UNIT_CONVERSIONS.g_to_kg;
  
  // Barrel length (mm → m)
  const barrelLength_mm = parseFloat(formInputs.barrelLength) || 0;
  const barrelLength_m = barrelLength_mm * UNIT_CONVERSIONS.mm_to_m;
  
  // Bore diameter (mm → m)
  const boreDiameter_mm = parseFloat(formInputs.boreDiameter) || 0;
  const boreDiameter_m = boreDiameter_mm * UNIT_CONVERSIONS.mm_to_m;
  
  // Chamber volume (cm³ → m³)
  const chamberVolume_cm3 = parseFloat(formInputs.chamberVolume) || 0;
  const chamberVolume_m3 = chamberVolume_cm3 * UNIT_CONVERSIONS.cm3_to_m3;
  
  // --------------------------------------------------------------------------
  // Validation checks
  // --------------------------------------------------------------------------
  
  // Charge mass
  if (chargeMass_kg <= 0) {
    errors.push('Charge mass must be greater than 0');
  } else if (chargeMass_kg > 0.1) {  // 100g max
    warnings.push(`Large charge mass (${chargeMass_g}g) - verify propellant data`);
  }
  
  // Projectile mass
  if (projectileMass_kg <= 0) {
    errors.push('Projectile mass must be greater than 0');
  } else if (projectileMass_kg > 0.5) {  // 500g max
    warnings.push(`Large projectile mass (${projectileMass_g}g) - verify parameters`);
  }
  
  // Barrel length
  if (barrelLength_m <= 0) {
    errors.push('Barrel length must be greater than 0');
  } else if (barrelLength_m > 2) {  // 2m max
    warnings.push(`Long barrel (${barrelLength_mm}mm) - verify parameters`);
  }
  
  // Bore diameter
  if (boreDiameter_m <= 0) {
    errors.push('Bore diameter must be greater than 0');
  } else if (boreDiameter_m < 0.001 || boreDiameter_m > 0.05) {
    warnings.push(`Unusual bore diameter (${boreDiameter_mm}mm) - verify parameters`);
  }
  
  // Chamber volume
  if (chamberVolume_m3 <= 0) {
    errors.push('Chamber volume must be greater than 0');
  }
  
  // Propellant selection
  let propellant = null;
  if (formInputs.propellantId && propellantData) {
    propellant = getPropellantById(formInputs.propellantId);
    if (!propellant) {
      errors.push(`Propellant "${formInputs.propellantId}" not found in database`);
    }
  } else if (!formInputs.propellantId) {
    errors.push('Please select a propellant type');
  }
  
  // --------------------------------------------------------------------------
  // Throw if critical errors
  // --------------------------------------------------------------------------
  
  if (errors.length > 0) {
    throw new Error(`Validation failed:\n${errors.join('\n')}`);
  }
  
  // Log warnings
  warnings.forEach(w => console.warn(`⚠️ ${w}`));
  
  // --------------------------------------------------------------------------
  // Build SI params object for solver
  // --------------------------------------------------------------------------
  
  const boreArea_m2 = Math.PI * (boreDiameter_m / 2) ** 2;
  
  const params = {
    // Geometry (SI)
    barrelLength_m,
    boreDiameter_m,
    boreArea_m2,
    V0_m3: chamberVolume_m3,
    maxTime_s: 0.02,  // 20ms default max
    
    // Projectile (SI)
    projectile: {
      mass_kg: projectileMass_kg
    },
    
    // Propellant (SI) - from database
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
    },
    
    // Metadata
    metadata: {
      propellantName: propellant.name,
      propellantId: propellant.id,
      inputUnits: {
        chargeMass: 'g',
        projectileMass: 'g',
        barrelLength: 'mm',
        boreDiameter: 'mm',
        chamberVolume: 'cm3'
      }
    }
  };
  
  console.log('✓ Input validation complete. SI params ready for solver.');
  return params;
}

// ============================================================================
// FORM UTILITIES
// ============================================================================

/**
 * Populate form with saved configuration
 * @param {object} config - Saved configuration object
 */
export function loadFormConfig(config) {
  if (!config) return;
  
  const mappings = {
    chargeMass: 'chargeMass_g',
    projectileMass: 'projectileMass_g',
    barrelLength: 'barrelLength_mm',
    boreDiameter: 'boreDiameter_mm',
    chamberVolume: 'chamberVolume_cm3'
  };
  
  for (const [field, configKey] of Object.entries(mappings)) {
    const input = document.getElementById(field);
    if (input && config[configKey] !== undefined) {
      input.value = config[configKey];
    }
  }
}

/**
 * Save current form configuration to localStorage
 * @returns {object} Saved configuration
 */
export function saveFormConfig() {
  const config = {
    chargeMass_g: document.getElementById('charge-mass')?.value,
    projectileMass_g: document.getElementById('projectile-mass')?.value,
    barrelLength_mm: document.getElementById('barrel-length')?.value,
    boreDiameter_mm: document.getElementById('bore-diameter')?.value,
    chamberVolume_cm3: document.getElementById('chamber-volume')?.value,
    savedAt: new Date().toISOString()
  };
  
  try {
    localStorage.setItem('ballistics-config', JSON.stringify(config));
    console.log('✓ Configuration saved to localStorage');
  } catch (e) {
    console.warn('⚠️ Failed to save configuration:', e.message);
  }
  
  return config;
}

/**
 * Load saved configuration from localStorage
 * @returns {object|null} Saved configuration or null
 */
export function loadSavedConfig() {
  try {
    const saved = localStorage.getItem('ballistics-config');
    if (saved) {
      const config = JSON.parse(saved);
      console.log('✓ Loaded saved configuration');
      return config;
    }
  } catch (e) {
    console.warn('⚠️ Failed to load saved configuration:', e.message);
  }
  return null;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  DEFAULT_PARAMS,
  UNIT_CONVERSIONS,
  getDefaultParams,
  loadPropellantData,
  getPropellantById,
  parseAndValidate,
  convertUnit,
  loadFormConfig,
  saveFormConfig,
  loadSavedConfig
};

// Console helper for debugging
if (typeof window !== 'undefined') {
  window.ballisticsInput = {
    defaults: DEFAULT_PARAMS,
    conversions: UNIT_CONVERSIONS,
    loadPropellants: loadPropellantData,
    validate: parseAndValidate,
    save: saveFormConfig,
    load: loadSavedConfig
  };
  console.log('🔧 Input handler helpers: window.ballisticsInput');
}
