// js/physicsSolver.js
// Internal Ballistics Engine - RK4 Fallback Solver
// Explicit RK4 with adaptive step control + max step limit

function calculateDerivatives_SI(y, params) {
  const [x, v, Z] = y;
  const { propellant, projectile, boreArea_m2, V0_m3 } = params;
  
  const Z_clamped = Math.max(0.001, Math.min(1, Z));
  
  const V_solids_m3 = propellant.mass_kg / propellant.density_kgm3;
  const V_covolume_m3 = propellant.mass_kg * Z_clamped * propellant.eta_m3kg;
  const V_gas_m3 = V0_m3 + (boreArea_m2 * x) - V_solids_m3 - V_covolume_m3;
  const V_effective = Math.max(V_gas_m3, 1e-8);
  
  const P_mean_Pa = (propellant.F_Jkg * propellant.mass_kg * Z_clamped) / V_effective;
  const lagrangeFactor = 1 + propellant.mass_kg / (3 * projectile.mass_kg);
  const P_base_Pa = P_mean_Pa / lagrangeFactor;
  
  const P_MPa = P_base_Pa / 1e6;
  let n_eff = propellant.n;
  if (P_MPa > 300) n_eff = Math.max(0.1, n_eff - 0.02 * (P_MPa - 300) / 100);
  
  const r_burn_mps = propellant.B_mps_Pa_n * Math.pow(Math.max(P_base_Pa, 1), n_eff);
  const S_m2 = propellant.S0_m2 * Math.max(0, (1 - propellant.alpha_geom * Z_clamped));
  
  const dxdt = v;
  const dvdt = (P_base_Pa * boreArea_m2) / projectile.mass_kg;
  const dZdt = (r_burn_mps * S_m2) / propellant.initialVolume_m3;
  
  return [dxdt, dvdt, dZdt, P_base_Pa];
}

function rk4Step(y, params, dt) {
  const getDerivs = (state) => calculateDerivatives_SI(state, params).slice(0, 3);
  
  const k1 = getDerivs(y);
  const y2 = y.map((v, i) => v + 0.5 * dt * k1[i]);
  const k2 = getDerivs(y2);
  const y3 = y.map((v, i) => v + 0.5 * dt * k2[i]);
  const k3 = getDerivs(y3);
  const y4 = y.map((v, i) => v + dt * k3[i]);
  const k4 = getDerivs(y4);
  
  return y.map((v, i) => v + (dt / 6) * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i]));
}

export async function runSimulation(params) {
  const required = ['propellant', 'projectile', 'barrelLength_m', 'boreArea_m2', 'V0_m3'];
  for (const key of required) {
    if (!params[key]) throw new Error(`Missing: ${key}`);
  }
  
  let y = [0, 0, 0.001];
  let t = 0;
  const tFinal = params.maxTime_s || 0.02;
  
  const results = { t: [], y: [], pressure_Pa: [] };
  let eventResult = null;
  
  let dt = 1e-7;
  const dtMin = 1e-9;
  const dtMax = 1e-5;
  const maxSteps = 100000;  // CRITICAL: Prevents infinite loop
  let stepCount = 0;
  
  while (t < tFinal && stepCount < maxSteps) {
    stepCount++;
    
    const [, , , P_Pa] = calculateDerivatives_SI(y, params);
    
    results.t.push(t);
    results.y.push([...y]);
    results.pressure_Pa.push(P_Pa);
    
    // Check exit condition
    if (y[0] >= params.barrelLength_m) {
      eventResult = { t, y: [...y] };
      break;
    }
    
    // Adaptive step control (simplified)
    const yTest = rk4Step(y, params, dt);
    const yHalf = rk4Step(rk4Step(y, params, dt/2), params, dt/2);
    const err = Math.max(...yTest.map((v, i) => Math.abs(v - yHalf[i])));
    
    if (err < 1e-6) {
      y = yHalf;
      t += dt;
      dt = Math.min(dt * 1.2, dtMax);
    } else {
      dt = Math.max(dt * 0.5, dtMin);
      continue;  // Retry with smaller step
    }
  }
  
  if (stepCount >= maxSteps) {
    console.error(`❌ RK4: Max steps (${maxSteps}) exceeded. Check parameters.`);
    throw new Error('Solver did not converge - check input parameters');
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
  
  const E_chem_J = params.propellant.mass_kg * params.propellant.F_Jkg;
  const E_kinetic_J = 0.5 * params.projectile.mass_kg * (finalY[1] ** 2);
  const efficiency = E_chem_J > 0 ? E_kinetic_J / E_chem_J : 0;
  
  return {
    data,
    stats: {
      muzzleVel_fps: finalY[1] * FPS_PER_MPS,
      muzzleVel_mps: finalY[1],
      peakPress_psi: peakPressure_Pa * PSI_PER_PA,
      peakPress_Pa: peakPressure_Pa,
      timeToMuzzle_ms: finalT * MS_PER_S,
      timeToMuzzle_s: finalT,
      solver: 'rk4',
      steps: results.t.length,
      efficiency_pct: efficiency * 100
    }
  };
}
