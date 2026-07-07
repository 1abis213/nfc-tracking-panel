const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tracking.db');
const fs = require('fs');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS plates (
    id TEXT PRIMARY KEY,
    business_name TEXT NOT NULL,
    google_maps_url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plate_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('qr', 'nfc')),
    scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
    ip_address TEXT,
    user_agent TEXT,
    referer TEXT,
    FOREIGN KEY (plate_id) REFERENCES plates(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_scans_plate_id ON scans(plate_id);
  CREATE INDEX IF NOT EXISTS idx_scans_type ON scans(type);
  CREATE INDEX IF NOT EXISTS idx_scans_scanned_at ON scans(scanned_at);
  CREATE INDEX IF NOT EXISTS idx_scans_plate_type ON scans(plate_id, type);
`);

module.exports = db;
