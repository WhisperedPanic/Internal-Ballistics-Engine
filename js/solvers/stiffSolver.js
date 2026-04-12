// js/solvers/stiffSolver.js
// Internal Ballistics Engine - Pure-JS Stiff ODE Solver
// SI units internal, imperial output for UI

// ============================================================================
// PHYSICS CORE
// ============================================================================

function calculateDerivatives_SI(y, params) {
  const [x, v, Z] = y;
  const { propellant, projectile, boreArea_m2, V0_m3, barrelLength_m } = params;
  
  const Z_clamped = Math.max(0.001, Math.min(1, Z));
  
  const V_solids_m3 = propellant.mass_kg / propellant.density_kgm3;
  const V_covolume_m3 = propellant.mass_kg * Z_clamped * propellant.eta_m3kg;
  const V_gas_m3 = V0_m3 + (boreArea_m2 * x) - V_solids_m3 - V_covolume_m3;
  const V_effective = Math.max(V_gas_m3, 1e-8);
  
  const P_mean_Pa = (propellant.F_Jkg * propellant.mass_kg * Z_clamped) / V_effective;
  
  const lagrangeFactor = 1 + propellant.mass_kg / (3 * projectile.mass_kg);
  const P_base_Pa = P_mean_Pa / lagrangeFactor;
  
  // IGNITION MODEL
  const P_ignition_Pa = 5e6;
  const P_effective_Pa = P_base_Pa + (Z_clamped < 0.01 ? P_ignition_Pa : 0);
  
  // BURN RATE (Vielle's Law) - CONVERT TO MPa
  const P_MPa = P_effective_Pa / 1e6;
  let n_eff = propellant.n;
  if (P_MPa > 300) {
    n_eff = Math.max(0.1, n_eff - 0.02 * (P_MPa - 300) / 100);
  }
  
  // SURFACE AREA MULTIPLIER
  const surfaceMultiplier = 10;
  
  // BURN RATE SCALING - Database B values are 1e6 too small
  // Typical propellant: B ~ 1e-4 m/s/MPa^n, database has ~1e-10
  const B_SCALE_FACTOR = 1e6;
  
  const r_burn_mps = Math.max(
    propellant.B_mps_Pa_n * B_SCALE_FACTOR * Math.pow(P_MPa, n_eff),
    0.01
  );
  
  const S_m2 = (propellant.S0_m2 * surfaceMultiplier) * Math.max(0.01, (1 - propellant.alpha_geom * Z_clamped));
  
  // ODEs
  const dxdt = v;
  const dvdt = (P_effective_Pa * boreArea_m2) / projectile.mass_kg;
  const dZdt = (r_burn_mps * S_m2) / propellant.initialVolume_m3;
  
  return [dxdt, dvdt, dZdt, P_effective_Pa];
}

// ============================================================================
// NUMERICAL METHODS
// ============================================================================

function estimateStiffness(y, params, dt) {
  const eps = 1e-8;
  const f0 = calculateDerivatives_SI(y, params);
  let maxEigenvalue = 0;
  
  for (let i = 0; i < 3; i++) {
    const yPert = [...y];
    yPert[i] += eps;
    const f1 = calculateDerivatives_SI(yPert, params);
    maxEigenvalue = Math.max(maxEigenvalue, Math.abs((f1[i] - f0[i]) / eps));
  }
  
  return maxEigenvalue * dt > 0.5;
}

function implicitEulerStep(y, params, dt, maxIter = 25, tol = 1e-9) {
  let yNew = [...y];
  
  for (let iter = 0; iter < maxIter; iter++) {
    const f = calculateDerivatives_SI(yNew, params);
    const residual = yNew.map((val, i) => val - y[i] - dt * f[i]);
    const err = Math.max(...residual.map(Math.abs));
    
    if (err < tol) break;
    
    const damping = iter < 5 ? 0.3 : (iter < 10 ? 0.5 : 0.7);
    yNew = yNew.map((val, i) => val - damping * residual[i]);
  }
  
  return yNew;
}

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

function adaptiveStep(y, params, dt, tol = 1e-6) {
  const isStiff = estimateStiffness(y, params, dt);
  
  if (isStiff) {
    const dtImplicit = Math.min(dt, 1e-7);
    const yNew = implicitEulerStep(y, params, dtImplicit);
    return { 
      yNew, 
      dtNew: Math.min(dtImplicit * 1.1, 5e-7), 
      accepted: true, 
      method: 'implicit' 
    };
  }
  
  try {
    const yHalf = rk4Step(rk4Step(y, params, dt / 2), params, dt / 2);
    const yFull = rk4Step(y, params, dt);
    const err = Math.max(...yHalf.map((v, i) => Math.abs(v - yFull[i])));
    
    if (err < tol) {
      const factor = Math.min(1.5, Math.max(0.5, 0.9 * Math.pow(tol / err, 0.2)));
      return { yNew: yHalf, dtNew: dt * factor, accepted: true, method: 'rk4' };
    } else {
      const factor = Math.max(0.2, 0.8 * Math.pow(tol / err, 0.25));
      return { yNew: y, dtNew: dt * factor, accepted: false, method: 'rk4' };
    }
  } catch (e) {
    const yNew = implicitEulerStep(y, params, dt);
    return { yNew, dtNew: dt * 0.5, accepted: true, method: 'implicit-fallback' };
  }
}

function detectEvent(y0, y1, t0, t1, eventFn, tol = 1e-9) {
  const f0 = eventFn(t0, y0);
  const f1 = eventFn(t1, y1);
  
  if (f0 * f1 > 0) return null;
  if (Math.abs(f0) < tol) return { t: t0, y: y0 };
  if (Math.abs(f1) < tol) return { t: t1, y: y1 };
  
  let a = t0, b = t1, ya = [...y0], yb = [...y1];
  
  for (let i = 0; i < 50; i++) {
    const tm = (a + b) / 2;
    const frac = (tm - a) / (b - a);
    const ym = ya.map((v, j) => v + frac * (yb[j] - v));
    const fm = eventFn(tm, ym);
    
    if (Math.abs(fm) < tol || (b - a) < 1e-12) return { t: tm, y: ym };
    
    if (f0 * fm <= 0) { b = tm; yb = ym; }
    else { a = tm; ya = ym; }
  }
  
  return { t: (a + b) / 2, y: ya.map((v, j) => (v + yb[j]) / 2) };
}

// ============================================================================
// MAIN SOLVER
// ============================================================================

async function runSimulation(params) {
  const required = ['propellant', 'projectile', 'barrelLength_m', 'boreArea_m2', 'V0_m3'];
  for (const key of required) {
    if (!params[key]) throw new Error(`Missing: ${key}`);
  }
  
  let y = [0, 0, 0.001];
  let t = 0;
  const tFinal = params.maxTime_s || 0.02;
  
  const results = { t: [], y: [], pressure_Pa: [] };
  let eventResult = null;
  
  let dt = 1e-9;
  const dtMin = 1e-11;
  const dtMax = 5e-7;
  const maxSteps = 100000;
  let stepCount = 0;
  
  const eventFn = (t, y) => y[0] - params.barrelLength_m;
  
  while (t < tFinal && stepCount < maxSteps) {
    stepCount++;
    
    const Z_clamped = Math.max(0.001, Math.min(1, y[2]));
    const [, , , P_Pa] = calculateDerivatives_SI(y, params);
    
    results.t.push(t);
    results.y.push([...y]);
    results.pressure_Pa.push(P_Pa);
    
    if (y[0] >= params.barrelLength_m) {
      eventResult = { t, y: [...y] };
      break;
    }
    
    let stepResult;
    let attempts = 0;
    
    do {
      dt = Math.max(dtMin, Math.min(dtMax, dt));
      
      const currentTol = Z_clamped < 0.05 ? 1e-7 : 1e-6;
      
      stepResult = adaptiveStep(y, params, dt, currentTol);
      attempts++;
      
      if (attempts > 20) {
        dt = dt * 0.3;
        if (dt < dtMin) {
          console.warn(`Step adaptation struggling at Z=${Z_clamped.toFixed(3)}, forcing dt=${dtMin}`);
          const yNew = implicitEulerStep(y, params, dtMin, 30, 1e-10);
          stepResult = { yNew, dtNew: dtMin, accepted: true, method: 'forced' };
          break;
        }
      }
    } while (!stepResult.accepted);
    
    const yNext = stepResult.yNew;
    const tNext = t + dt;
    
    if (eventFn(t, y) * eventFn(tNext, yNext) < 0) {
      eventResult = detectEvent(y, yNext, t, tNext, eventFn);
      if (eventResult) {
        const [, , , P_event] = calculateDerivatives_SI(eventResult.y, params);
        results.t.push(eventResult.t);
        results.y.push([...eventResult.y]);
        results.pressure_Pa.push(P_event);
        break;
      }
    }
    
    y = yNext;
    t = tNext;
    dt = stepResult.dtNew;
  }
  
  if (stepCount >= maxSteps) {
    console.warn(`⚠️ Max steps (${maxSteps}) reached.`);
  }
  
  // Post-process
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
  
  const finalY = eventResult?.y || results.y[results.y.length - 1];
  const finalT = eventResult?.t || results.t[results.t.length - 1];
  const peakPressure_Pa = Math.max(...results.pressure_Pa);
  
  // Energy check
  const E_chem_J = params.propellant.mass_kg * params.propellant.F_Jkg;
  const E_kinetic_J = 0.5 * params.projectile.mass_kg * (finalY[1] ** 2);
  const efficiency = E_chem_J > 0 ? E_kinetic_J / E_chem_J : 0;
  
  if (efficiency < 0.10 || efficiency > 0.50) {
    console.warn(`⚠️ Unphysical energy efficiency: ${(efficiency * 100).toFixed(1)}%`);
  }
  
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
// CONSTANTS
// ============================================================================

const UNITS = {
  PSI_PER_PA: 0.000145038,
  FPS_PER_MPS: 3.28084,
  MM_PER_M: 1000,
  MS_PER_S: 1000
};

// ============================================================================
// SINGLE EXPORT BLOCK
// ============================================================================

export {
  runSimulation,
  calculateDerivatives_SI,
  estimateStiffness,
  UNITS
};

// ============================================================================
// CONSOLE HELPER
// ============================================================================

if (typeof window !== 'undefined') {
  window.ballisticsStiffSolver = {
    run: runSimulation,
    derivatives: calculateDerivatives_SI,
    stiffness: estimateStiffness,
    units: UNITS
  };
}
