// js/solvers/lsodaSolver.js - SI internal, matches existing output format
import init, { lsoda_solve } from './wasm/lsoda_wasm.js';

// Reuse your existing derivative logic (copy from physicsSolver.js)
// but isolate pure physics from solver mechanics
function calculateDerivatives_SI(y, params) {
  const [x, v, Z] = y;
  const { barrelLength_m, propellant, projectile, boreArea_m2 } = params;
  
  // Noble-Abel EOS (SI)
  const V_chamber = params.V0_m3 - propellant.density_kgm3 * propellant.mass_kg * propellant.eta_m3kg * Z;
  const P_mean_Pa = (propellant.F_Jkg * propellant.mass_kg * Z) / Math.max(V_chamber, 1e-9);
  const P_base_Pa = P_mean_Pa / (1 + propellant.mass_kg / (3 * projectile.mass_kg));
  
  // Burn rate: Vielle's law + optional high-P correction
  const P_MPa = P_base_Pa / 1e6;
  let n_eff = propellant.n;
  if (P_MPa > 300) n_eff -= 0.02 * (P_MPa - 300) / 100; // Validate per propellant
  const r_burn_mps = propellant.B_mps_Pa_n * Math.pow(P_base_Pa, n_eff);
  
  // Grain geometry (simplified linear)
  const S_m2 = propellant.S0_m2 * (1 - propellant.alpha_geom * Z);
  
  // ODEs
  const dxdt = v;
  const dvdt = (P_base_Pa * boreArea_m2) / projectile.mass_kg;
  const dZdt = (r_burn_mps * S_m2) / propellant.initialVolume_m3;
  
  return [dxdt, dvdt, dZdt, P_base_Pa]; // Return pressure for output tracking
}

export async function runSimulation(params) {
  await init(); // Load WASM (~1.2 MB, cached after first load)
  
  const odeFn = (t, y, dydt) => {
    const [dxdt, dvdt, dZdt, P] = calculateDerivatives_SI(y, params);
    dydt.set([dxdt, dvdt, dZdt]); // LSODA only integrates [x,v,Z]
  };
  
  // Terminal event: projectile exits barrel
  const eventFn = (t, y) => y[0] - params.barrelLength_m;
  
  const result = lsoda_solve(
    odeFn,
    [0, 0, 0.001], // y0: [x, v, Z]
    [0, 0.01],     // tSpan generous; event stops early
    { rtol: 1e-6, atol: 1e-8, maxStep: 1e-6 },
    eventFn,
    true // terminal event
  );
  
  if (result.flag !== 0) throw new Error(`LSODA error: ${result.message}`);
  
  // Post-process to match your existing output format (imperial for UI)
  const n = result.t.length;
  const data = [];
  let peakPressure_Pa = 0;
  
  for (let i = 0; i < n; i++) {
    const P_Pa = calculateDerivatives_SI(result.y.map(col => col[i]), params)[3];
    peakPressure_Pa = Math.max(peakPressure_Pa, P_Pa);
    
    data.push({
      t_ms: result.t[i] * 1000,
      p_psi: P_Pa * 0.000145038,
      v_fps: result.y[1][i] * 3.28084,
      z_pct: result.y[2][i] * 100,
      x_mm: result.y[0][i] * 1000
    });
  }
  
  return {
    data,
    stats: {
      muzzleVel_fps: result.y[1][n-1] * 3.28084,
      peakPress_psi: peakPressure_Pa * 0.000145038,
      timeToMuzzle_ms: result.t_event * 1000,
      solver: 'lsoda'
    }
  };
}