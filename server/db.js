const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tracking.db');

let db = null;

function save() {
  const data = db.export();
  const buffer = Buffer.from(data);
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, buffer);
}

function mapParams(params) {
  return params.length > 0 ? params.map(p => p ?? null) : [];
}

const database = {
  prepare(sql) {
    const stmt = db.prepare(sql);
    return {
      get(...params) {
        const p = mapParams(params);
        if (p.length > 0) stmt.bind(p);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const rows = [];
        const p = mapParams(params);
        if (p.length > 0) stmt.bind(p);
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      },
      run(...params) {
        const p = mapParams(params);
        if (p.length > 0) stmt.bind(p);
        stmt.step();
        stmt.free();
        save();
        return { changes: db.getRowsModified() };
      }
    };
  },
  exec(sql) {
    db.exec(sql);
    save();
  },
  close() {
    save();
    db.close();
  }
};

async function init() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  database.exec(`
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
}

module.exports = { init, db: database };
