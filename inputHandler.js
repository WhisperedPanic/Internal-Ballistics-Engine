/**
 * Input Handler Module
 * Responsible for DOM interaction, data fetching, and unit conversion.
 */

let propellantData = [];

/**
 * Initializes the module by fetching external data and populating UI.
 */
export async function init() {
    try { 
        const response = await fetch(new URL('../data/propellants.json', import.meta.url));
        if (!response.ok) throw new Error("Failed to load propellant data");
        propellantData = await response.json();
        populatePropellantSelect();
    } catch (error) {
        console.error("Initialization Error:", error);
        document.getElementById('propDetails').innerHTML = `<span style="color:red">Error loading library</span>`;
    }
}

function populatePropellantSelect() {
    const select = document.getElementById('propellantSelect');
    select.innerHTML = ''; // Clear existing
    propellantData.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.text = p.name;
        select.add(opt);
    });
    
    // Set default
    select.value = "cluster-3-2"; 
    updatePropellantDetails();
    
    // Attach listener
    select.addEventListener('change', updatePropellantDetails);
}

function updatePropellantDetails() {
    const pid = document.getElementById('propellantSelect').value;
    const p = propellantData.find(x => x.id === pid);
    if(p) {
        document.getElementById('propDetails').innerHTML = `
            <strong>Type:</strong> ${p.cluster} (${p.grain_type})<br>
            <strong>Burn Rate (B):</strong> ${p.B.toExponential(2)}<br>
            <strong>Exp (n):</strong> ${p.n.toFixed(2)}<br>
            <strong>Covolume (η):</strong> ${p.eta}
        `;
    }
}

/**
 * Gathers all inputs from HTML and converts to SI units.
 * @returns {Object} Simulation parameters in SI units.
 */
export function getSimulationParams() {
    const pid = document.getElementById('propellantSelect').value;
    const prop = propellantData.find(p => p.id === pid);
    
    if (!prop) throw new Error("Invalid propellant selection");

    const C_grains = parseFloat(document.getElementById('chargeMass').value);
    const W_grains = parseFloat(document.getElementById('projMass').value);
    const L_in = parseFloat(document.getElementById('barrelLength').value);
    const Vc_cc = parseFloat(document.getElementById('chamberVol').value);

    // Conversions
    const Cm = C_grains * 0.0000647989; // kg
    const Ws = W_grains * 0.0000647989; // kg
    const Lb = L_in * 0.0254; // meters
    const Vc = Vc_cc * 1e-6; // m^3
    
    // Assume .30 cal for demo consistency, or could be added as input
    const D_bore = 0.00762; 
    const As = Math.PI * Math.pow(D_bore/2, 2); // m^2

    return {
        propellant: prop,
        chargeMass_kg: Cm,
        projectileMass_kg: Ws,
        barrelLength_m: Lb,
        chamberVolume_m3: Vc,
        boreArea_m2: As
    };
}