import Database from "better-sqlite3";
import fs from "node:fs";
const dataDir = process.env.DATA_DIR || "./data";
fs.mkdirSync(dataDir, { recursive: true });
export const db = new Database(`${dataDir}/manager.sqlite`);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS bots (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 label TEXT NOT NULL,
 application_id TEXT NOT NULL,
 token_enc TEXT NOT NULL,
 token_iv TEXT NOT NULL,
 token_tag TEXT NOT NULL,
 created_at TEXT NOT NULL
);
`);
