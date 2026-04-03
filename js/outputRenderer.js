/**
 * Output Renderer Module
 * Handles Chart.js updates and DOM statistic displays.
 */

let mainChart, burnChart, phaseChart;

/**
 * Initialize Chart.js instances.
 */
export function initCharts() {
    const commonOptions = {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top' } },
        scales: { x: { title: { display: true, text: 'Time (ms)' } } }
    };

    mainChart = new Chart(document.getElementById('mainChart'), {
        type: 'line',
         { labels: [], datasets: [] },
        options: { ...commonOptions, scales: { ...commonOptions.scales, y: { title: { display: true, text: 'Pressure (PSI)' } } } }
    });

    burnChart = new Chart(document.getElementById('burnChart'), {
        type: 'line',
         { labels: [], datasets: [] },
        options: { ...commonOptions, scales: { ...commonOptions.scales, y: { title: { display: true, text: 'Burn Fraction (%)' } } } }
    });

    phaseChart = new Chart(document.getElementById('phaseChart'), {
        type: 'line',
         { labels: [], datasets: [] },
        options: { ...commonOptions, scales: { ...commonOptions.scales, y: { title: { display: true, text: 'Velocity (ft/s)' } } } }
    });
}

/**
 * Update UI with simulation results.
 * @param {Object} simResult - Output from physicsSolver
 */
export function updateUI(simResult) {
    const { data, stats } = simResult;

    // Update Stats
    document.getElementById('resVel').innerText = Math.round(stats.muzzleVel);
    document.getElementById('resPress').innerText = Math.round(stats.peakPress);
    document.getElementById('resTime').innerText = stats.timeToMuzzle.toFixed(2);

    // Prepare Data
    const labels = data.map(d => d.t_ms.toFixed(3));

    // Update Charts
    updateChart(mainChart, labels, data.map(d => d.p_psi), 'Chamber Pressure (PSI)', '#ef4444');
    updateChart(burnChart, labels, data.map(d => d.z_pct), 'Propellant Burnt (%)', '#10b981');
    updateChart(phaseChart, labels, data.map(d => d.v_fps), 'Projectile Velocity (ft/s)', '#2563eb');
}

function updateChart(chart, labels, data, label, color) {
    chart.data = {
        labels: labels,
        datasets: [{
            label: label,
             data,
            borderColor: color,
            backgroundColor: color + '1A', // 10% opacity hex
            fill: true,
            tension: 0.4
        }]
    };
    chart.update();
}

/**
 * Reset UI to initial state.
 */
export function resetUI() {
    document.getElementById('resVel').innerText = "--";
    document.getElementById('resPress').innerText = "--";
    document.getElementById('resTime').innerText = "--";
    
    [mainChart, burnChart, phaseChart].forEach(chart => {
        if(chart) {
            chart.data = { labels: [], datasets: [] };
            chart.update();
        }
    });
}

