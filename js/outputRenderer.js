// js/outputRenderer.js
// Internal Ballistics Engine - Output Rendering Module

// ============================================================================
// CHART INSTANCES
// ============================================================================

const chartInstances = {
  pressure: null,
  velocity: null,
  burn: null,
  pressurePosition: null
};

// ============================================================================
// MAIN RENDER FUNCTIONS (Exported)
// ============================================================================

export function render(results) {
  if (!results || !results.data || !results.stats) {
    console.error('❌ Invalid results object passed to render()');
    return;
  }
  
  const resultsContainer = document.getElementById('results-container');
  if (resultsContainer) {
    resultsContainer.style.display = 'block';
    resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  
  _renderCharts(results.data);
  console.log('✓ Results rendered successfully');
}

export function renderStats(stats) {
  if (!stats) {
    console.error('❌ Invalid stats object passed to renderStats()');
    return;
  }
  
  const statsContainer = document.getElementById('stats-container');
  if (!statsContainer) {
    console.warn('⚠️ Stats container not found in DOM');
    return;
  }
  
  let comparisonHtml = '';
  if (stats.comparison) {
    const comp = stats.comparison;
    const velStatus = comp.muzzleVel.pass ? '✅' : '⚠️';
    const pressStatus = comp.peakPressure.pass ? '✅' : '⚠️';
    
    comparisonHtml = `
      <div class="stat-card comparison-summary" style="grid-column: 1 / -1;">
        <h4 style="margin-bottom: 10px; color: #666;">Solver Comparison</h4>
        <div style="display: flex; gap: 20px; justify-content: center; flex-wrap: wrap;">
          <span>${velStatus} Velocity Δ: ${comp.muzzleVel.delta_pct.toFixed(2)}%</span>
          <span>${pressStatus} Pressure Δ: ${comp.peakPressure.delta_pct.toFixed(2)}%</span>
          <span style="font-weight: bold; color: ${comp.overall ? '#28a745' : '#ffc107'};">
            ${comp.overall ? '✅ PASS' : '⚠️ FAIL'} (< 2% tolerance)
          </span>
        </div>
      </div>
    `;
  }
  
  const solverBadge = stats.solver 
    ? `<span class="badge badge-info" style="margin-left: 10px;">${stats.solver}</span>` 
    : '';
  
  statsContainer.innerHTML = `
    ${comparisonHtml}
    <div class="stat-card">
      <div class="value">${stats.muzzleVel_fps?.toFixed(0) || 'N/A'}</div>
      <div class="label">Muzzle Velocity (FPS)${solverBadge}</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.muzzleVel_mps?.toFixed(1) || 'N/A'}</div>
      <div class="label">Muzzle Velocity (m/s)</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.peakPress_psi?.toFixed(0) || 'N/A'}</div>
      <div class="label">Peak Pressure (PSI)</div>
    </div>
    <div class="stat-card">
      <div class="value">${(stats.peakPress_Pa / 1e6)?.toFixed(1) || 'N/A'}</div>
      <div class="label">Peak Pressure (MPa)</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.timeToMuzzle_ms?.toFixed(2) || 'N/A'}</div>
      <div class="label">Time to Muzzle (ms)</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.steps?.toLocaleString() || 'N/A'}</div>
      <div class="label">Integration Steps</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.solveTime_ms?.toFixed(1) || 'N/A'}</div>
      <div class="label">Solve Time (ms)</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.efficiency_pct?.toFixed(1) || 'N/A'}</div>
      <div class="label">Energy Efficiency (%)</div>
    </div>
  `;
  
  console.log('✓ Stats rendered successfully');
}

export function clearResults() {
  const resultsContainer = document.getElementById('results-container');
  if (resultsContainer) {
    resultsContainer.style.display = 'none';
  }
  
  const statsContainer = document.getElementById('stats-container');
  if (statsContainer) {
    statsContainer.innerHTML = '';
  }
  
  for (const [key, chart] of Object.entries(chartInstances)) {
    if (chart) {
      chart.destroy();
      chartInstances[key] = null;
    }
  }
  
  console.log('✓ Results cleared');
}

// ============================================================================
// INTERNAL HELPER FUNCTIONS (Not Exported)
// ============================================================================

function _renderCharts(data) {
  if (!data || data.length === 0) {
    console.error('❌ No data to render charts');
    return;
  }
  
  const labels = data.map(d => d.t_ms.toFixed(2));
  const pressureData = data.map(d => d.p_psi);
  const velocityData = data.map(d => d.v_fps);
  const burnData = data.map(d => d.z_pct);
  const positionData = data.map(d => d.x_mm);
  
  _renderPressureChart(labels, pressureData);
  _renderVelocityChart(labels, velocityData);
  _renderBurnChart(labels, burnData);
  _renderPressurePositionChart(positionData, pressureData);
}

function _renderPressureChart(labels, data) {
  const ctx = _getCanvasContext('chart-pressure');
  if (!ctx) return;
  
  if (chartInstances.pressure) {
    chartInstances.pressure.destroy();
  }
  
  chartInstances.pressure = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Chamber Pressure (PSI)',
        data: data,
        borderColor: '#dc3545',
        backgroundColor: 'rgba(220, 53, 69, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top' },
        tooltip: { callbacks: { label: (c) => `Pressure: ${c.parsed.y.toFixed(0)} PSI` } }
      },
      scales: {
        x: { title: { display: true, text: 'Time (ms)' }, ticks: { maxTicksLimit: 10 } },
        y: { title: { display: true, text: 'Pressure (PSI)' }, beginAtZero: true }
      }
    }
  });
}

function _renderVelocityChart(labels, data) {
  const ctx = _getCanvasContext('chart-velocity');
  if (!ctx) return;
  
  if (chartInstances.velocity) {
    chartInstances.velocity.destroy();
  }
  
  chartInstances.velocity = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Projectile Velocity (FPS)',
        data: data,
        borderColor: '#007bff',
        backgroundColor: 'rgba(0, 123, 255, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top' },
        tooltip: { callbacks: { label: (c) => `Velocity: ${c.parsed.y.toFixed(0)} FPS` } }
      },
      scales: {
        x: { title: { display: true, text: 'Time (ms)' }, ticks: { maxTicksLimit: 10 } },
        y: { title: { display: true, text: 'Velocity (FPS)' }, beginAtZero: true }
      }
    }
  });
}

function _renderBurnChart(labels, data) {
  const ctx = _getCanvasContext('chart-burn');
  if (!ctx) return;
  
  if (chartInstances.burn) {
    chartInstances.burn.destroy();
  }
  
  chartInstances.burn = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Burn Fraction (%)',
        data: data,
        borderColor: '#28a745',
        backgroundColor: 'rgba(40, 167, 69, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top' },
        tooltip: { callbacks: { label: (c) => `Burned: ${c.parsed.y.toFixed(1)}%` } }
      },
      scales: {
        x: { title: { display: true, text: 'Time (ms)' }, ticks: { maxTicksLimit: 10 } },
        y: { title: { display: true, text: 'Burn Fraction (%)' }, beginAtZero: true, max: 100 }
      }
    }
  });
}

function _renderPressurePositionChart(positionData, pressureData) {
  const ctx = _getCanvasContext('chart-pressure-position');
  if (!ctx) return;
  
  if (chartInstances.pressurePosition) {
    chartInstances.pressurePosition.destroy();
  }
  
  chartInstances.pressurePosition = new Chart(ctx, {
    type: 'line',
    data: {
      labels: positionData.map(x => x.toFixed(1)),
      datasets: [{
        label: 'Pressure vs Position',
        data: pressureData,
        borderColor: '#ffc107',
        backgroundColor: 'rgba(255, 193, 7, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top' },
        tooltip: { callbacks: { label: (c) => `Pressure: ${c.parsed.y.toFixed(0)} PSI @ ${c.label} mm` } }
      },
      scales: {
        x: { title: { display: true, text: 'Projectile Position (mm)' }, ticks: { maxTicksLimit: 10 } },
        y: { title: { display: true, text: 'Pressure (PSI)' }, beginAtZero: true }
      }
    }
  });
}

function _getCanvasContext(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.warn(`⚠️ Canvas element not found: ${canvasId}`);
    return null;
  }
  return canvas.getContext('2d');
}

// ============================================================================
// SINGLE EXPORT STATEMENT (All exports in one place)
// ============================================================================

export { chartInstances };

// Console helper for debugging
if (typeof window !== 'undefined') {
  window.ballisticsRenderer = {
    clear: clearResults,
    charts: chartInstances,
    render
  };
  console.log('🔧 Renderer helpers: window.ballisticsRenderer');
}
