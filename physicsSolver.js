/**
 * Physics Solver Module
 * Contains the core ODE system and Adaptive RK4 integrator.
 */

const G_RATIO = 1.25; // Specific heat ratio approx

/**
 * Calculates the derivatives [dx, dv, dz, dp] for the current state.
 * @param {Array} state - [x, v, z, p]
 * @param {Object} params - Simulation parameters
 * @returns {Array} Derivatives
 */
function calculateDerivatives(state, params) {
    const [x, v, z, p] = state;
    const { propellant: prop, chargeMass_kg: Cm, projectileMass_kg: Ws, boreArea_m2: As, chamberVolume_m3: Vc } = params;

    // 1. Geometry Factor
    let geomFactor = 1.0;
    if(prop.grain_type === 'Spherical') geomFactor = 1 - z;
    else if(prop.grain_type === 'Flake') geomFactor = 1.0;
    else geomFactor = 1 + 0.2*z;

    // 2. Dynamic Burn Rate
    const P_MPa = p / 1e6;
    let n_eff = prop.n;
    if(P_MPa > 300) n_eff -= 0.02 * (P_MPa - 300)/100;

    const r_burn = prop.B * Math.pow(p, n_eff);
    // Characteristic dimension approx 0.5mm = 0.0005m
    const dzdt = (r_burn * geomFactor) / 0.0005;

    // 3. Thermodynamics (Noble-Abel)
    const V_total = Vc + As * x;
    // Volume occupied by solids and gas covolume
    const vol_solids = (Cm / prop.rho_s) * (1 - z);
    const vol_gas_free = V_total - vol_solids - (Cm * z * prop.eta);

    let P_calc = 0;
    if(vol_gas_free > 1e-9 && z > 0) {
        P_calc = (prop.lambda * Cm * z) / vol_gas_free;
    } else if (z <= 0.001) {
        P_calc = 100000; // Seed pressure
    }

    // 4. Projectile Motion (Lagrange Gradient)
    const lagrangeFactor = 1.0 + (Cm / (3.0 * Ws));
    const P_base = P_calc / lagrangeFactor;
    const accel = (As * P_base) / Ws;

    return [v, accel, dzdt, 0]; // dP is algebraic, not integrated directly in state
}

/**
 * Performs a single Adaptive RK4 Step.
 * Uses step doubling to estimate error and adjust dt.
 * @param {Array} state - Current state [x, v, z, p]
 * @param {Object} params - Params
 * @param {Number} dt - Current timestep
 * @param {Number} tol - Error tolerance
 * @returns {Object} { newState, newDt, accepted }
 */
function adaptiveStep(state, params, dt, tol) {
    // Helper for standard RK4
    const rk4 = (h) => {
        const k1 = calculateDerivatives(state, params);
        const s2 = state.map((val, i) => val + k1[i] * h * 0.5);
        const k2 = calculateDerivatives(s2, params);
        const s3 = state.map((val, i) => val + k2[i] * h * 0.5);
        const k3 = calculateDerivatives(s3, params);
        const s4 = state.map((val, i) => val + k3[i] * h);
        const k4 = calculateDerivatives(s4, params);
        
        return state.map((val, i) => val + (h/6.0) * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i]));
    };

    // 1. Take one full step
    const stateFull = rk4(dt);
    
    // 2. Take two half steps
    const stateHalf1 = rk4(dt * 0.5);
    const stateHalf2 = rk4(dt * 0.5); // Note: In strict implementation, we should re-eval derivs at midpoint, but rk4 func handles internal stages. 
    // Correction: To properly do step doubling, we must call rk4 starting from stateHalf1 with dt/2
    const stateDouble = (() => {
        const mid = rk4(dt * 0.5); // First half from start
        // Second half from mid
        const k1 = calculateDerivatives(mid, params);
        const s2 = mid.map((val, i) => val + k1[i] * dt * 0.25);
        const k2 = calculateDerivatives(s2, params);
        const s3 = mid.map((val, i) => val + k2[i] * dt * 0.25);
        const k3 = calculateDerivatives(s3, params);
        const s4 = mid.map((val, i) => val + k3[i] * dt * 0.5);
        const k4 = calculateDerivatives(s4, params);
        return mid.map((val, i) => val + (dt*0.5/6.0) * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i]));
    })();

    // 3. Estimate Error (Difference between full step and two half steps)
    // We care most about Position and Velocity errors for stability
    const err = Math.max(
        Math.abs(stateFull[0] - stateDouble[0]),
        Math.abs(stateFull[1] - stateDouble[1]) * 1e-3 // Scale velocity error
    );

    // 4. Adjust Dt
    // Safety factor 0.9, order 4 -> power 0.25
    let newDt = dt;
    if (err > 0) {
        newDt = dt * 0.9 * Math.pow(tol / err, 0.25);
    } else {
        newDt = dt * 2.0; // Increase if error is zero (unlikely)
    }
    
    // Clamp dt to reasonable physical bounds (10ns to 100us)
    newDt = Math.max(1e-8, Math.min(newDt, 1e-4));

    const accepted = err <= tol;

    return {
        newState: accepted ? stateDouble : state, // If rejected, keep old state (retry with smaller dt in loop)
        newDt: newDt,
        accepted: accepted
    };
}

/**
 * Runs the full simulation loop.
 * @param {Object} params - Simulation parameters
 * @returns {Array} Array of result objects for plotting
 */
export function runSimulation(params) {
    const tMax = 0.005; // 5ms
    let dt = 1.0e-6; // Initial guess 1us
    const tol = 1e-6; // Tolerance for adaptive step

    // State: [x(m), v(m/s), z(frac), p(Pa)]
    let state = [0.0, 0.0, 0.001, 100000.0]; 
    let t = 0;
    let results = [];
    let peakP = 0;

    while(t < tMax && state[0] < params.barrelLength_m && state[2] < 1.0) {
        const stepResult = adaptiveStep(state, params, dt, tol);
        
        if(stepResult.accepted) {
            t += dt;
            state = stepResult.newState;
            
            // Clamp
            if(state[2] > 1.0) state[2] = 1.0;
            if(state[0] > params.barrelLength_m) state[0] = params.barrelLength_m;

            // Recalculate P for storage
            const derivs = calculateDerivatives(state, params);
            // We need P explicitly from algebraic eq for storage, derivs[3] is 0
            const V_total = params.chamberVolume_m3 + params.boreArea_m2 * state[0];
            const vol_solids = (params.chargeMass_kg / params.propellant.rho_s) * (1 - state[2]);
            const vol_gas_free = V_total - vol_solids - (params.chargeMass_kg * state[2] * params.propellant.eta);
            const currentP = (vol_gas_free > 1e-9) ? (params.propellant.lambda * params.chargeMass_kg * state[2]) / vol_gas_free : 0;

            if(currentP > peakP) peakP = currentP;

            // Store data (downsampled)
            // Using a simple counter or time check for downsampling
            if(results.length === 0 || t - results[results.length-1].t_raw > 1e-5) {
                results.push({
                    t_raw: t,
                    t_ms: t * 1000,
                    p_psi: currentP * 0.000145038,
                    v_fps: state[1] * 3.28084,
                    z_pct: state[2] * 100,
                    x_mm: state[0] * 1000
                });
            }
        }
        
        dt = stepResult.newDt;
    }

    return {
         data: results,
        stats: {
            muzzleVel: results.length > 0 ? results[results.length-1].v_fps : 0,
            peakPress: peakP * 0.000145038,
            timeToMuzzle: results.length > 0 ? results[results.length-1].t_ms : 0
        }
    };
}