/**
 * Main Orchestration Module
 * Connects Input, Physics, and Output modules.
 */

import { init as initInput, getSimulationParams } from './inputHandler.js';
import { runSimulation } from './physicsSolver.js';
import { initCharts, updateUI, resetUI } from './outputRenderer.js';

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
    await initInput();
    initCharts();
    
    // Preset Logic (Moved from inline script)
    const presets = {
        "308win": { charge: 42.0, proj: 175.0, barrel: 22.0, vol: 3.6 },
        "7.62mm NATO": { charge: 42.0, proj: 175.0, barrel: 22.0, vol: 3.6 },
        "223rem": { charge: 25.0, proj: 77.0, barrel: 20.0, vol: 1.8 },
        "5.56mm NATO": { charge: 25.0, proj: 62.0, barrel: 22.0, vol: 1.85 },
        "300winmag": { charge: 75.0, proj: 200.0, barrel: 26.0, vol: 5.8 },
        "50bmg": { charge: 240.0, proj: 650.0, barrel: 45.0, vol: 18.5 }
    };

    document.getElementById('presetSelect').addEventListener('change', (e) => {
        const key = e.target.value;
        if(key !== 'custom' && presets[key]) {
            const d = presets[key];
            document.getElementById('chargeMass').value = d.charge;
            document.getElementById('projMass').value = d.proj;
            document.getElementById('barrelLength').value = d.barrel;
            document.getElementById('chamberVol').value = d.vol;
        }
    });

    // Global Event Handlers
    window.runSimulation = handleRunSimulation;
    window.resetSim = handleReset;
});

async function handleRunSimulation() {
    try {
        const btn = document.querySelector('.btn-run');
        btn.innerText = "Running...";
        btn.disabled = true;

        // Small delay to allow UI update
        await new Promise(r => setTimeout(r, 10));

        const params = getSimulationParams();
        const results = runSimulation(params);
        
        updateUI(results);

        btn.innerText = "▶ Run Simulation";
        btn.disabled = false;
    } catch (error) {
        console.error(error);
        alert("Simulation Error: " + error.message);
        document.querySelector('.btn-run').disabled = false;
    }
}

function handleReset() {
    resetUI();
}
