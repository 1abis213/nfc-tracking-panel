let timelineChart = null;
let pieChart = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts
  });
  return res.json();
}

// ─── Summary Stats ────────────────────────────────────────

async function loadSummary() {
  const data = await api('/api/stats');
  const s = data.summary;
  document.getElementById('totalScans').textContent = s.total_scans;
  document.getElementById('todayScans').textContent = s.today_scans;
  document.getElementById('qrScans').textContent = s.qr_scans;
  document.getElementById('nfcScans').textContent = s.nfc_scans;
  document.getElementById('activePlates').textContent = s.active_plates;
  renderCharts(data);
}

// ─── Charts ───────────────────────────────────────────────

function renderCharts(data) {
  const byDate = data.scans_by_date;
  const labels = [...new Set(byDate.map(d => d.date))].sort();
  const qrData = labels.map(d => {
    const match = byDate.find(x => x.date === d && x.type === 'qr');
    return match ? match.count : 0;
  });
  const nfcData = labels.map(d => {
    const match = byDate.find(x => x.date === d && x.type === 'nfc');
    return match ? match.count : 0;
  });

  const ctx1 = document.getElementById('timelineChart').getContext('2d');
  if (timelineChart) timelineChart.destroy();
  timelineChart = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'QR', data: qrData, backgroundColor: '#2563eb', borderRadius: 4 },
        { label: 'NFC', data: nfcData, backgroundColor: '#7c3aed', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: '#f0f0f0' } }
      }
    }
  });

  const ctx2 = document.getElementById('pieChart').getContext('2d');
  if (pieChart) pieChart.destroy();
  const s = data.summary;
  pieChart = new Chart(ctx2, {
    type: 'doughnut',
    data: {
      labels: ['QR', 'NFC'],
      datasets: [{
        data: [s.qr_scans, s.nfc_scans],
        backgroundColor: ['#2563eb', '#7c3aed'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });
}

// ─── Plates Table ─────────────────────────────────────────

async function loadPlates() {
  const data = await api('/api/stats');
  const tbody = document.getElementById('platesBody');
  tbody.innerHTML = '';
  for (const p of data.per_plate) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(p.business_name)}</strong></td>
      <td><span class="badge badge-qr">${p.qr}</span></td>
      <td><span class="badge badge-nfc">${p.nfc}</span></td>
      <td><strong>${p.total}</strong></td>
      <td>
        <button class="btn" onclick="viewPlate('${p.id}')">Details</button>
        <button class="btn btn-secondary" onclick="window.open('/api/qr/${p.id}/qr')">QR</button>
        <button class="btn btn-danger" onclick="deletePlate('${p.id}')">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

// ─── Add Plate ────────────────────────────────────────────

document.getElementById('addPlateBtn').addEventListener('click', () => {
  document.getElementById('addForm').style.display = 'flex';
});

document.getElementById('cancelAddBtn').addEventListener('click', () => {
  document.getElementById('addForm').style.display = 'none';
});

document.getElementById('savePlateBtn').addEventListener('click', async () => {
  const name = document.getElementById('businessName').value.trim();
  const url = document.getElementById('mapsUrl').value.trim();
  if (!name || !url) return alert('Please fill in all fields');

  try {
    new URL(url);
  } catch {
    return alert('Please enter a valid URL');
  }

  await api('/api/plates', {
    method: 'POST',
    body: JSON.stringify({ business_name: name, google_maps_url: url })
  });

  document.getElementById('businessName').value = '';
  document.getElementById('mapsUrl').value = '';
  document.getElementById('addForm').style.display = 'none';
  refresh();
});

// ─── Delete Plate ─────────────────────────────────────────

async function deletePlate(id) {
  if (!confirm('Delete this plate and all its scan data?')) return;
  await api(`/api/plates/${id}`, { method: 'DELETE' });
  refresh();
}

// ─── View Plate Details ───────────────────────────────────

async function viewPlate(id) {
  const data = await api(`/api/stats/${id}`);
  const p = data.plate;
  const s = data.stats;

  const modal = document.getElementById('modal');
  const body = document.getElementById('modalBody');
  document.getElementById('modalTitle').textContent = p.business_name;

  const mapsHost = new URL(p.google_maps_url).hostname;

  body.innerHTML = `
    <div class="detail-stats">
      <div class="detail-stat"><span class="stat-label">Total</span><span class="stat-value">${s.total}</span></div>
      <div class="detail-stat"><span class="stat-label">QR</span><span class="stat-value" style="color:#2563eb">${s.qr}</span></div>
      <div class="detail-stat"><span class="stat-label">NFC</span><span class="stat-value" style="color:#7c3aed">${s.nfc}</span></div>
      <div class="detail-stat"><span class="stat-label">Today</span><span class="stat-value">${s.today}</span></div>
    </div>

    <div class="tracking-urls">
      <strong>Tracking URLs &amp; QR Codes:</strong>
      <div class="tracking-url"><span class="badge badge-qr">QR</span> <span id="qrUrl">${location.origin}/r/${p.id}/qr</span> <button class="copy-btn" onclick="copyUrl('qrUrl')">Copy</button> <button class="copy-btn" onclick="window.open('/api/qr/${p.id}/qr')">QR Image</button></div>
      <div class="tracking-url"><span class="badge badge-nfc">NFC</span> <span id="nfcUrl">${location.origin}/r/${p.id}/nfc</span> <button class="copy-btn" onclick="copyUrl('nfcUrl')">Copy</button> <button class="copy-btn" onclick="window.open('/api/qr/${p.id}/nfc')">QR Image</button></div>
    </div>

    <p style="margin-bottom:12px;font-size:0.85rem;color:#666;">
      Redirects to: <a href="${esc(p.google_maps_url)}" target="_blank">${esc(mapsHost)}…</a>
    </p>

    <div style="margin-bottom:12px;">
      <strong>Timeline (last 30 days):</strong>
      <canvas id="detailChart" style="max-height:180px;margin-top:8px;"></canvas>
    </div>

    <div class="recent-scans">
      <h3>Recent Scans</h3>
      ${data.recent_scans.length === 0 ? '<p style="color:#888;font-size:0.85rem;">No scans yet</p>' :
        data.recent_scans.map(sc => `
          <div class="scan-row">
            <span><span class="badge ${sc.type === 'qr' ? 'badge-qr' : 'badge-nfc'}">${sc.type.toUpperCase()}</span></span>
            <span>${sc.scanned_at}</span>
            <span style="color:#888;font-size:0.8rem;">${sc.ip_address || '—'}</span>
          </div>
        `).join('')
      }
    </div>
  `;

  modal.style.display = 'flex';

  // Render detail chart
  const tl = data.timeline;
  const labels = [...new Set(tl.map(d => d.date))].sort();
  const qrD = labels.map(d => { const m = tl.find(x => x.date === d && x.type === 'qr'); return m ? m.count : 0; });
  const nfcD = labels.map(d => { const m = tl.find(x => x.date === d && x.type === 'nfc'); return m ? m.count : 0; });
  const ctx = document.getElementById('detailChart').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'QR', data: qrD, backgroundColor: '#2563eb', borderRadius: 3 },
        { label: 'NFC', data: nfcD, backgroundColor: '#7c3aed', borderRadius: 3 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: '#f0f0f0' }, ticks: { stepSize: 1 } }
      }
    }
  });
}

// ─── Modal ────────────────────────────────────────────────

document.getElementById('closeModal').addEventListener('click', () => {
  document.getElementById('modal').style.display = 'none';
});

document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById('modal').style.display = 'none';
  }
});

// ─── Utils ────────────────────────────────────────────────

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function copyUrl(elId) {
  const text = document.getElementById(elId).textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector(`[onclick="copyUrl('${elId}')"]`);
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}

function refresh() {
  loadSummary();
  loadPlates();
}

refresh();
