// js/solvers/stiffSolver.js
// Pure-JS stiff ODE solver for internal ballistics
// A-stable implicit Euler + adaptive RK4 + terminal event detection
// SI units enforced internally; output converted to imperial for UI
// 
// Physics Model Validation:
// - Noble-Abel EOS: Corner, J. (1965). Theory of the Interior Ballistics of Guns.
// - Lagrange Gradient: Krier, H. & Renie, J.P. (1978). AIAA J., 16(5).
// - Vielle Burn Law: Standard propellant combustion model.

// ============================================================================
// PHYSICS CORE (SI Units Only)
// ============================================================================

/**
 * Calculate ODE derivatives and pressure for current state
 * @param {number[]} y - State vector [x_m, v_mps, Z]
 * @param {object} params - Simulation parameters (all SI)
 * @returns {number[]} [dxdt, dvdt, dZdt, P_base_Pa]
 */
function calculateDerivatives_SI(y, params) {
  const [x, v, Z] = y;
  const { propellant, projectile, boreArea_m2, V0_m3, barrelLength_m } = params;
  
  // Prevent negative or zero burn fraction
  const Z_clamped = Math.max(0, Math.min(1, Z));
  
  // --- Noble-Abel Equation of State ---
  // P = (F · m · Z) / (V_chamber - V_solids - m · Z · η)
  // where V_solids = m / ρ (solid propellant volume)
  const V_solids_m3 = propellant.mass_kg / propellant.density_kgm3;
  const V_covolume_m3 = propellant.mass_kg * Z_clamped * propellant.eta_m3kg;
  const V_chamber_m3 = V0_m3 + (boreArea_m2 * x) - V_solids_m3 - V_covolume_m3;
  
  // Prevent division by zero or negative volume
  const V_effective = Math.max(V_chamber_m3, 1e-9);
  
  // Mean chamber pressure (Pa)
  const P_mean_Pa = (propellant.F_Jkg * propellant.mass_kg * Z_clamped) / V_effective;
  
  // --- Lagrange Pressure Gradient Correction ---
  // P_base = P_mean / (1 + m_charge / (3 · m_projectile))
  // Accounts for pressure drop from breech to projectile base
  const lagrangeFactor = 1 + propellant.mass_kg / (3 * projectile.mass_kg);
  const P_base_Pa = P_mean_Pa / lagrangeFactor;
  
  // --- Burn Rate: Vielle's Law with High-Pressure Correction ---
  // r = B · Pⁿ, with n_eff decreasing at extreme pressures (>300 MPa)
  const P_MPa = P_base_Pa / 1e6;
  let n_eff = propellant.n;
  
  // Empirical high-pressure correction (validate per propellant batch)
  if (P_MPa > 300) {
    n_eff -= 0.02 * (P_MPa - 300) / 100;
    n_eff = Math.max(n_eff, 0.1); // Prevent negative exponent
  }
  
  const r_burn_mps = propellant.B_mps_Pa_n * Math.pow(P_base_Pa, n_eff);
  
  // --- Grain Surface Area Evolution ---
  // S(Z) = S₀ · (1 - α · Z)  [linear approximation]
  const S_m2 = propellant.S0_m2 * (1 - propellant.alpha_geom * Z_clamped);
  
  // --- ODE System ---
  // dx/dt = v  (projectile position)
  // dv/dt = (P_base · A_bore) / m_projectile  (Newton's 2nd law)
  // dZ/dt = (r_burn · S) / V_propellant_initial  (burn fraction rate)
  const dxdt = v;
  const dvdt = (P_base_Pa * boreArea_m2) / projectile.mass_kg;
  const dZdt = (r_burn_mps * S_m2) / propellant.initialVolume_m3;
  
  return [dxdt, dvdt, dZdt, P_base_Pa];
}

// ============================================================================
// NUMERICAL METHODS
// ============================================================================

/**
 * Estimate system stiffness via finite-difference Jacobian eigenvalue approximation
 * @param {number[]} y - Current state
 * @param {object} params - Simulation parameters
 * @param {number} dt - Current timestep
 * @returns {boolean} True if system is stiff (requires implicit method)
 */
function estimateStiffness(y, params, dt) {
  const eps = 1e-8;
  const f0 = calculateDerivatives_SI(y, params);
  let maxEigenvalue = 0;
  
  // Estimate diagonal Jacobian elements via finite differences
  for (let i = 0; i < 3; i++) { // Only [x, v, Z] are integrated
    const yPert = [...y];
    yPert[i] += eps;
    const f1 = calculateDerivatives_SI(yPert, params);
    const lambda_i = Math.abs((f1[i] - f0[i]) / eps);
    maxEigenvalue = Math.max(maxEigenvalue, lambda_i);
  }
  
  // Stiff if |λ_max| · dt > 0.5 (explicit stability limit heuristic)
  return maxEigenvalue * dt > 0.5;
}

/**
 * A-stable implicit Euler step with simplified Newton iteration
 * @param {number[]} y - Current state
 * @param {object} params - Simulation parameters
 * @param {number} dt - Timestep
 * @param {number} maxIter - Max Newton iterations
 * @param {number} tol - Convergence tolerance
 * @returns {number[]} New state vector
 */
function implicitEulerStep(y, params, dt, maxIter = 15, tol = 1e-8) {
  let yNew = [...y];
  
  for (let iter = 0; iter < maxIter; iter++) {
    const f = calculateDerivatives_SI(yNew, params);
    
    // Residual: y_new - y_old - dt · f(y_new) = 0
    const residual = yNew.map((val, i) => val - y[i] - dt * f[i]);
    const err = Math.max(...residual.map(Math.abs));
    
    if (err < tol) break;
    
    // Simplified Newton with damping for stability
    // y_new = y_new - damping · residual
    const damping = 0.5;
    yNew = yNew.map((val, i) => val - damping * residual[i]);
  }
  
  return yNew;
}

/**
 * Classic RK4 step (non-stiff regions)
 * @param {number[]} y - Current state
 * @param {object} params - Simulation parameters
 * @param {number} h - Step size
 * @returns {number[]} New state vector (first 3 elements only)
 */
function rk4Step(y, params, h) {
  const getDerivs = (state) => calculateDerivatives_SI(state, params).slice(0, 3);
  
  const k1 = getDerivs(y);
  const y2 = y.map((v, i) => v + 0.5 * h * k1[i]);
  const k2 = getDerivs(y2);
  const y3 = y.map((v, i) => v + 0.5 * h * k2[i]);
  const k3 = getDerivs(y3);
  const y4 = y.map((v, i) => v + h * k3[i]);
  const k4 = getDerivs(y4);
  
  return y.map((v, i) => v + (h / 6) * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i]));
}

/**
 * Adaptive step controller with stiffness-based method switching
 * @param {number[]} y - Current state
 * @param {object} params - Simulation parameters
 * @param {number} dt - Current timestep
 * @param {number} tol - Error tolerance
 * @returns {object} { yNew, dtNew, accepted, method }
 */
function adaptiveStep(y, params, dt, tol = 1e-6) {
  const isStiff = estimateStiffness(y, params, dt);
  
  if (isStiff) {
    // Use implicit Euler for stiff regions (A-stable)
    const yNew = implicitEulerStep(y, params, dt);
    return { 
      yNew, 
      dtNew: Math.min(dt * 1.2, 1e-5), 
      accepted: true, 
      method: 'implicit' 
    };
  }
  
  // Non-stiff: use RK4 with step-doubling error estimate
  const yHalf = rk4Step(rk4Step(y, params, dt / 2), params, dt / 2); // Two half-steps
  const yFull = rk4Step(y, params, dt); // One full-step
  const err = Math.max(...yHalf.map((v, i) => Math.abs(v - yFull[i])));
  
  if (err < tol) {
    // Accept step; adjust dt for next iteration
    const factor = Math.min(2.0, Math.max(0.5, 0.9 * Math.pow(tol / err, 0.25)));
    return { 
      yNew: yHalf, 
      dtNew: dt * factor, 
      accepted: true, 
      method: 'rk4' 
    };
  } else {
    // Reject step; reduce dt and retry
    const factor = Math.max(0.1, 0.9 * Math.pow(tol / err, 0.25));
    return { 
      yNew: y, 
      dtNew: dt * factor, 
      accepted: false, 
      method: 'rk4' 
    };
  }
}

/**
 * Terminal event detection via bisection root-finding
 * @param {number[]} y0 - State at start of step
 * @param {number[]} y1 - State at end of step
 * @param {number} t0 - Time at start
 * @param {number} t1 - Time at end
 * @param {function} eventFn - Event function (root when = 0)
 * @param {number} tol - Convergence tolerance
 * @returns {object|null} { t, y } at event, or null if no event
 */
function detectEvent(y0, y1, t0, t1, eventFn, tol = 1e-9) {
  const f0 = eventFn(t0, y0);
  const f1 = eventFn(t1, y1);
  
  // No sign change → no event crossing
  if (f0 * f1 > 0) return null;
  if (Math.abs(f0) < tol) return { t: t0, y: y0 };
  if (Math.abs(f1) < tol) return { t: t1, y: y1 };
  
  // Bisection refinement
  let a = t0, b = t1, ya = [...y0], yb = [...y1];
  
  for (let i = 0; i < 50; i++) {
    const tm = (a + b) / 2;
    // Linear interpolation for state at tm
    const frac = (tm - a) / (b - a);
    const ym = ya.map((v, j) => v + frac * (yb[j] - v));
    const fm = eventFn(tm, ym);
    
    if (Math.abs(fm) < tol || (b - a) < 1e-12) {
      return { t: tm, y: ym };
    }
    
    if (f0 * fm <= 0) {
      b = tm;
      yb = ym;
    } else {
      a = tm;
      ya = ym;
    }
  }
  
  return { t: (a + b) / 2, y: ya.map((v, j) => (v + yb[j]) / 2) };
}

// ============================================================================
// MAIN SOLVER EXPORT
// ============================================================================

/**
 * Run internal ballistics simulation with stiff-aware adaptive integration
 * @param {object} params - Simulation parameters (SI units enforced)
 * @param {object} params.propellant - Propellant properties
 * @param {object} params.projectile - Projectile properties
 * @param {number} params.barrelLength_m - Barrel length (m)
 * @param {number} params.boreArea_m2 - Bore cross-sectional area (m²)
 * @param {number} params.V0_m3 - Initial chamber volume (m³)
 * @param {number} [params.maxTime_s=0.02] - Maximum simulation time (s)
 * @returns {Promise<object>} { data: [...], stats: {...} }
 */
export async function runSimulation(params) {
  // Validate required parameters
  const required = ['propellant', 'projectile', 'barrelLength_m', 'boreArea_m2', 'V0_m3'];
  for (const key of required) {
    if (!params[key]) throw new Error(`Missing required parameter: ${key}`);
  }
  
  // Initial state: [x_m, v_mps, Z]
  let y = [0, 0, 0.001]; // Start with small Z to avoid division by zero
  let t = 0;
  const tFinal = params.maxTime_s || 0.02; // Generous upper bound
  
  // Results storage
  const results = { t: [], y: [], pressure_Pa: [] };
  let eventResult = null;
  
  // Adaptive timestep parameters
  let dt = 1e-8; // Start small for rapid pressure rise at ignition
  const dtMin = 1e-10;
  const dtMax = 1e-5;
  const maxSteps = 100000; // Prevent infinite loops
  let stepCount = 0;
  
  // Event function: projectile exits barrel when x = L
  const eventFn = (t, y) => y[0] - params.barrelLength_m;
  
  // ============================================================================
  // MAIN INTEGRATION LOOP
  // ============================================================================
  while (t < tFinal && stepCount < maxSteps) {
    stepCount++;
    
    // Calculate current pressure for output
    const [, , , P_Pa] = calculateDerivatives_SI(y, params);
    
    // Store current state
    results.t.push(t);
    results.y.push([...y]);
    results.pressure_Pa.push(P_Pa);
    
    // Check terminal event BEFORE stepping
    if (eventFn(t, y) >= 0) {
      eventResult = { t, y: [...y] };
      break;
    }
    
    // Adaptive step with retry logic
    let stepResult;
    let attempts = 0;
    const maxAttempts = 20;
    
    do {
      dt = Math.max(dtMin, Math.min(dtMax, dt));
      stepResult = adaptiveStep(y, params, dt, 1e-6);
      attempts++;
      
      if (attempts > maxAttempts) {
        throw new Error(`Step adaptation failed to converge at t=${t.toFixed(9)} s`);
      }
    } while (!stepResult.accepted);
    
    // Check for event crossing during this step
    const yNext = stepResult.yNew;
    const tNext = t + dt;
    
    if (eventFn(t, y) * eventFn(tNext, yNext) < 0) {
      // Event occurred during this step; refine via bisection
      eventResult = detectEvent(y, yNext, t, tNext, eventFn);
      
      if (eventResult) {
        // Add final event state to results
        const [, , , P_event] = calculateDerivatives_SI(eventResult.y, params);
        results.t.push(eventResult.t);
        results.y.push([...eventResult.y]);
        results.pressure_Pa.push(P_event);
        break;
      }
    }
    
    // Advance to next step
    y = yNext;
    t = tNext;
    dt = stepResult.dtNew;
  }
  
  // ============================================================================
  // POST-PROCESS: Convert SI to Imperial for UI
  // ============================================================================
  const PSI_PER_PA = 0.000145038;
  const FPS_PER_MPS = 3.28084;
  const MM_PER_M = 1000;
  const MS_PER_S = 1000;
  
  const data = results.t.map((t_i, i) => {
    const [x, v, Z] = results.y[i];
    const P_Pa = results.pressure_Pa[i];
    return {
      t_ms: t_i * MS_PER_S,
      p_psi: P_Pa * PSI_PER_PA,
      v_fps: v * FPS_PER_MPS,
      z_pct: Z * 100,
      x_mm: x * MM_PER_M
    };
  });
  
  // Final state (muzzle exit or max time)
  const finalY = eventResult?.y || results.y[results.y.length - 1];
  const finalT = eventResult?.t || results.t[results.t.length - 1];
  const peakPressure_Pa = Math.max(...results.pressure_Pa);
  
  // ============================================================================
  // PHYSICS VALIDATION CHECKS (Runtime)
  // ============================================================================
  const E_chem_J = params.propellant.mass_kg * params.propellant.F_Jkg;
  const E_kinetic_J = 0.5 * params.projectile.mass_kg * (finalY[1] ** 2);
  const efficiency = E_chem_J > 0 ? E_kinetic_J / E_chem_J : 0;
  
  // Warn if efficiency is outside physically reasonable range
  if (efficiency < 0.10 || efficiency > 0.50) {
    console.warn(`⚠️ Unphysical energy efficiency: ${(efficiency * 100).toFixed(1)}%`);
  }
  
  // ============================================================================
  // RETURN RESULTS
  // ============================================================================
  return {
    data,
    stats: {
      muzzleVel_fps: finalY[1] * FPS_PER_MPS,
      muzzleVel_mps: finalY[1],
      peakPress_psi: peakPressure_Pa * PSI_PER_PA,
      peakPress_Pa: peakPressure_Pa,
      timeToMuzzle_ms: finalT * MS_PER_S,
      timeToMuzzle_s: finalT,
      solver: 'stiff-js',
      steps: results.t.length,
      method: 'implicit-euler+rk4-adaptive',
      efficiency_pct: efficiency * 100
    }
  };
}

// ============================================================================
// EXPORT UTILITIES (For Testing/Validation)
// ============================================================================

// Expose physics core for unit testing
export { calculateDerivatives_SI, estimateStiffness };

// Unit conversion constants (for validation harness)
export const UNITS = {
  PSI_PER_PA: 0.000145038,
  FPS_PER_MPS: 3.28084,
  MM_PER_M: 1000,
  MS_PER_S: 1000
};