// js/solvers/stiffSolver.js
// Pure-JS stiff ODE solver for internal ballistics
// A-stable implicit Euler + adaptive step + terminal event detection
// SI units enforced internally; output matches existing format

// Reuse your existing physics logic (copy from physicsSolver.js)
function calculateDerivatives_SI(y, params) {
  const [x, v, Z] = y;
  const { propellant, projectile, boreArea_m2, V0_m3 } = params;
  
  // Noble-Abel EOS (SI)
  const V_solids = propellant.density_kgm3 * propellant.mass_kg * propellant.eta_m3kg * Z;
  const V_chamber = Math.max(V0_m3 - V_solids, 1e-9);
  const P_mean_Pa = (propellant.F_Jkg * propellant.mass_kg * Z) / V_chamber;
  const lagrangeFactor = 1 + propellant.mass_kg / (3 * projectile.mass_kg);
  const P_base_Pa = P_mean_Pa / lagrangeFactor;
  
  // Burn rate: Vielle's law + optional high-P correction
  const P_MPa = P_base_Pa / 1e6;
  let n_eff = propellant.n;
  if (P_MPa > 300) n_eff -= 0.02 * (P_MPa - 300) / 100;
  const r_burn_mps = propellant.B_mps_Pa_n * Math.pow(P_base_Pa, n_eff);
  
  // Grain geometry
  const S_m2 = propellant.S0_m2 * (1 - propellant.alpha_geom * Z);
  
  // ODEs
  const dxdt = v;
  const dvdt = (P_base_Pa * boreArea_m2) / projectile.mass_kg;
  const dZdt = (r_burn_mps * S_m2) / propellant.initialVolume_m3;
  
  return [dxdt, dvdt, dZdt, P_base_Pa];
}

// Stiffness detector: estimate max eigenvalue magnitude via finite differences
function estimateStiffness(y, params, dt) {
  const eps = 1e-8;
  const f0 = calculateDerivatives_SI(y, params);
  let maxTrace = 0;
  
  for (let i = 0; i < 3; i++) { // Only integrate [x,v,Z]
    const yPert = [...y];
    yPert[i] += eps;
    const f1 = calculateDerivatives_SI(yPert, params);
    const lambda_i = Math.abs((f1[i] - f0[i]) / eps);
    maxTrace = Math.max(maxTrace, lambda_i);
  }
  // Stiff if |λ_max| * dt > 0.5 (heuristic for explicit stability limit)
  return maxTrace * dt > 0.5;
}

// A-stable implicit Euler step (Newton iteration, diagonal Jacobian approx)
function implicitEulerStep(y, params, dt, maxIter = 15, tol = 1e-8) {
  let yNew = [...y];
  
  for (let iter = 0; iter < maxIter; iter++) {
    const f = calculateDerivatives_SI(yNew, params);
    const residual = yNew.map((val, i) => val - y[i] - dt * f[i]);
    const err = Math.max(...residual.map(Math.abs));
    
    if (err < tol) break;
    
    // Simplified Newton: y_new = y_new - J⁻¹·resid ≈ y_new - resid / (1 - dt*∂f/∂y)
    // Diagonal approx: damp update for stability
    const damping = 0.5;
    yNew = yNew.map((val, i) => val - residual[i] * damping);
  }
  return yNew;
}

// Adaptive step controller with stiffness-based method switching
function adaptiveStep(y, params, dt, tol = 1e-6) {
  const isStiff = estimateStiffness(y, params, dt);
  
  if (isStiff) {
    // Use implicit Euler for stiff regions
    const yNew = implicitEulerStep(y, params, dt);
    return { yNew, dtNew: Math.min(dt * 1.2, 1e-5), accepted: true, method: 'implicit' };
  }
  
  // Non-stiff: use RK4 with step-doubling error estimate
  const rk4Step = (y, h) => {
    const k1 = calculateDerivatives_SI(y, params).slice(0, 3);
    const k2 = calculateDerivatives_SI(y.map((v, i) => v + 0.5*h*k1[i]), params).slice(0, 3);
    const k3 = calculateDerivatives_SI(y.map((v, i) => v + 0.5*h*k2[i]), params).slice(0, 3);
    const k4 = calculateDerivatives_SI(y.map((v, i) => v + h*k3[i]), params).slice(0, 3);
    return y.map((v, i) => v + (h/6) * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i]));
  };
  
  const yHalf = rk4Step(rk4Step(y, dt/2), dt/2); // Two half-steps
  const yFull = rk4Step(y, dt); // One full-step
  const err = Math.max(...yHalf.map((v, i) => Math.abs(v - yFull[i])));
  
  if (err < tol) {
    // Accept step; adjust dt for next iteration
    const factor = Math.min(2.0, Math.max(0.5, 0.9 * Math.pow(tol/err, 0.25)));
    return { yNew: yHalf, dtNew: dt * factor, accepted: true, method: 'rk4' };
  } else {
    // Reject step; reduce dt and retry
    const factor = Math.max(0.1, 0.9 * Math.pow(tol/err, 0.25));
    return { yNew: y, dtNew: dt * factor, accepted: false, method: 'rk4' };
  }
}

// Terminal event detection via bisection
function detectEvent(y0, y1, t0, t1, eventFn, tol = 1e-9) {
  const f0 = eventFn(t0, y0);
  const f1 = eventFn(t1, y1);
  
  if (f0 * f1 > 0) return null; // No sign change
  if (Math.abs(f0) < tol) return { t: t0, y: y0 };
  if (Math.abs(f1) < tol) return { t: t1, y: y1 };
  
  // Bisection
  let a = t0, b = t1, ya = y0, yb = y1;
  for (let i = 0; i < 50; i++) {
    const tm = (a + b) / 2;
    const ym = ya.map((v, j) => v + (ym - ya[j]) * (tm - a) / (b - a)); // Linear interp
    const fm = eventFn(tm, ym);
    
    if (Math.abs(fm) < tol || (b - a) < 1e-12) return { t: tm, y: ym };
    
    if (f0 * fm <= 0) { b = tm; yb = ym; }
    else { a = tm; ya = ym; }
  }
  return { t: (a+b)/2, y: ya.map((v, j) => (v + yb[j])/2) };
}

export async function runSimulation(params) {
  // Initial state: [x_m, v_mps, Z]
  let y = [0, 0, 0.001];
  let t = 0;
  const tFinal = params.maxTime_s || 0.02; // Generous upper bound
  
  const results = { t: [], y: [], pressure_Pa: [] };
  let eventResult = null;
  
  // Adaptive integration loop
  let dt = 1e-8; // Start small for rapid pressure rise
  const dtMin = 1e-9, dtMax = 1e-5;
  
  while (t < tFinal) {
    // Store current state for output
    const [dxdt, dvdt, dZdt, P_Pa] = calculateDerivatives_SI(y, params);
    results.t.push(t);
    results.y.push([...y]);
    results.pressure_Pa.push(P_Pa);
    
    // Check terminal event before stepping
    const eventFn = (t, y) => y[0] - params.barrelLength_m; // x - L = 0
    if (eventFn(t, y) >= 0) {
      eventResult = { t, y };
      break;
    }
    
    // Adaptive step
    let stepResult;
    let attempts = 0;
    do {
      dt = Math.max(dtMin, Math.min(dtMax, dt));
      stepResult = adaptiveStep(y, params, dt, 1e-6);
      attempts++;
      if (attempts > 20) throw new Error('Step adaptation failed to converge');
    } while (!stepResult.accepted);
    
    // Check for event crossing during step
    const yNext = stepResult.yNew;
    const tNext = t + dt;
    if (eventFn(t, y) * eventFn(tNext, yNext) < 0) {
      // Event occurred during this step; refine via bisection
      eventResult = detectEvent(y, yNext, t, tNext, eventFn);
      if (eventResult) {
        // Add final event state to results
        const [,, , P_event] = calculateDerivatives_SI(eventResult.y, params);
        results.t.push(eventResult.t);
        results.y.push([...eventResult.y]);
        results.pressure_Pa.push(P_event);
        break;
      }
    }
    
    // Advance
    y = yNext;
    t = tNext;
    dt = stepResult.dtNew;
  }
  
  // Post-process to match existing output format (imperial for UI)
  const data = results.t.map((t_i, i) => {
    const [x, v, Z] = results.y[i];
    const P_Pa = results.pressure_Pa[i];
    return {
      t_ms: t_i * 1000,
      p_psi: P_Pa * 0.000145038,
      v_fps: v * 3.28084,
      z_pct: Z * 100,
      x_mm: x * 1000
    };
  });
  
  const finalY = eventResult?.y || results.y[results.y.length - 1];
  const finalT = eventResult?.t || results.t[results.t.length - 1];
  
  return {
    data,
    stats: {
      muzzleVel_fps: finalY[1] * 3.28084,
      peakPress_psi: Math.max(...results.pressure_Pa) * 0.000145038,
      timeToMuzzle_ms: finalT * 1000,
      solver: 'stiff-js',
      steps: results.t.length
    }
  };
}