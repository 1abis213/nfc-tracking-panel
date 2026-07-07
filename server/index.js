const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { init, db } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

let ready = init();

app.set('trust proxy', true);
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use(express.static('public'));

// ─── Plates API ─────────────────────────────────────────────

app.post('/api/plates', (req, res) => {
  const { business_name, google_maps_url } = req.body;
  if (!business_name || !google_maps_url) {
    return res.status(400).json({ error: 'business_name and google_maps_url are required' });
  }

  const id = uuidv4().slice(0, 8);
  const stmt = db.prepare('INSERT INTO plates (id, business_name, google_maps_url) VALUES (?, ?, ?)');
  stmt.run(id, business_name, google_maps_url);

  res.json({ id, business_name, google_maps_url, tracking_urls: {
    qr: `${req.protocol}://${req.get('host')}/r/${id}/qr`,
    nfc: `${req.protocol}://${req.get('host')}/r/${id}/nfc`
  }});
});

app.get('/api/plates', (req, res) => {
  const plates = db.prepare('SELECT * FROM plates ORDER BY created_at DESC').all();
  res.json(plates);
});

app.get('/api/plates/:id', (req, res) => {
  const plate = db.prepare('SELECT * FROM plates WHERE id = ?').get(req.params.id);
  if (!plate) return res.status(404).json({ error: 'Plate not found' });
  res.json(plate);
});

app.delete('/api/plates/:id', (req, res) => {
  const result = db.prepare('DELETE FROM plates WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Plate not found' });
  res.json({ success: true });
});

// ─── Stats API ──────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  const totalScans = db.prepare('SELECT COUNT(*) as count FROM scans').get();
  const qrScans = db.prepare("SELECT COUNT(*) as count FROM scans WHERE type = 'qr'").get();
  const nfcScans = db.prepare("SELECT COUNT(*) as count FROM scans WHERE type = 'nfc'").get();
  const todayScans = db.prepare("SELECT COUNT(*) as count FROM scans WHERE date(scanned_at) = date('now')").get();
  const plateCount = db.prepare('SELECT COUNT(*) as count FROM plates WHERE is_active = 1').get();

  const scansByDate = db.prepare(`
    SELECT date(scanned_at) as date, type, COUNT(*) as count
    FROM scans
    GROUP BY date(scanned_at), type
    ORDER BY date ASC
  `).all();

  const perPlate = db.prepare(`
    SELECT p.id, p.business_name,
           COUNT(s.id) as total,
           SUM(CASE WHEN s.type = 'qr' THEN 1 ELSE 0 END) as qr,
           SUM(CASE WHEN s.type = 'nfc' THEN 1 ELSE 0 END) as nfc
    FROM plates p
    LEFT JOIN scans s ON s.plate_id = p.id
    GROUP BY p.id
    ORDER BY total DESC
  `).all();

  res.json({
    summary: {
      total_scans: totalScans.count,
      qr_scans: qrScans.count,
      nfc_scans: nfcScans.count,
      today_scans: todayScans.count,
      active_plates: plateCount.count
    },
    scans_by_date: scansByDate,
    per_plate: perPlate
  });
});

app.get('/api/stats/:plateId', (req, res) => {
  const plate = db.prepare('SELECT * FROM plates WHERE id = ?').get(req.params.plateId);
  if (!plate) return res.status(404).json({ error: 'Plate not found' });

  const total = db.prepare('SELECT COUNT(*) as count FROM scans WHERE plate_id = ?').get(req.params.plateId);
  const qr = db.prepare("SELECT COUNT(*) as count FROM scans WHERE plate_id = ? AND type = 'qr'").get(req.params.plateId);
  const nfc = db.prepare("SELECT COUNT(*) as count FROM scans WHERE plate_id = ? AND type = 'nfc'").get(req.params.plateId);
  const today = db.prepare("SELECT COUNT(*) as count FROM scans WHERE plate_id = ? AND date(scanned_at) = date('now')").get(req.params.plateId);

  const timeline = db.prepare(`
    SELECT date(scanned_at) as date, type, COUNT(*) as count
    FROM scans WHERE plate_id = ?
    GROUP BY date(scanned_at), type
    ORDER BY date ASC
  `).all(req.params.plateId);

  const recentScans = db.prepare(`
    SELECT type, scanned_at, ip_address
    FROM scans WHERE plate_id = ?
    ORDER BY scanned_at DESC LIMIT 50
  `).all(req.params.plateId);

  res.json({
    plate,
    stats: {
      total: total.count,
      qr: qr.count,
      nfc: nfc.count,
      today: today.count
    },
    timeline,
    recent_scans: recentScans
  });
});

// ─── QR Code Generation ────────────────────────────────────

app.get('/api/qr/:id/:type', async (req, res) => {
  const { id, type } = req.params;
  if (!['qr', 'nfc'].includes(type)) {
    return res.status(400).send('Invalid type');
  }

  const plate = db.prepare('SELECT * FROM plates WHERE id = ?').get(id);
  if (!plate) return res.status(404).send('Plate not found');

  const url = `${req.protocol}://${req.get('host')}/r/${id}/${type}`;
  try {
    const svg = await QRCode.toString(url, { type: 'svg', width: 300, margin: 2, color: { dark: '#1a1a2e', light: '#ffffff' } });
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  } catch (err) {
    res.status(500).send('Error generating QR code');
  }
});

// ─── Redirect / Tracking Endpoints ──────────────────────────

app.get('/r/:id/:type', (req, res) => {
  const { id, type } = req.params;
  if (!['qr', 'nfc'].includes(type)) {
    return res.status(400).send('Invalid tracking type');
  }

  const plate = db.prepare('SELECT * FROM plates WHERE id = ? AND is_active = 1').get(id);
  if (!plate) {
    return res.status(404).send('Tracking link not found or inactive');
  }

  const stmt = db.prepare(
    'INSERT INTO scans (plate_id, type, ip_address, user_agent, referer) VALUES (?, ?, ?, ?, ?)'
  );
  stmt.run(id, type, req.ip, req.get('User-Agent'), req.get('Referer'));

  // Track pixel response (1x1 transparent GIF for QR-friendly tracking)
  const acceptHeader = req.get('Accept') || '';
  if (acceptHeader.includes('image/')) {
    // Return 1x1 transparent GIF for image requests
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/gif',
      'Content-Length': gif.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    return res.end(gif);
  }

  res.redirect(301, plate.google_maps_url);
});

// ─── Start ──────────────────────────────────────────────────

ready.then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NFC Tracking Panel running at http://localhost:${PORT}`);
  });
});
