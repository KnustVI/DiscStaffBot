const Database = require('better-sqlite3')

const db = new Database('database.sqlite')

db.prepare(`
CREATE TABLE IF NOT EXISTS guild_config (
guild_id TEXT PRIMARY KEY,
logs_channel TEXT
)
`).run()

db.prepare(`
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    last_penalty INTEGER,
    penalties INTEGER DEFAULT 0
)
`).run()

db.prepare(`
CREATE TABLE IF NOT EXISTS penalties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    staff_id TEXT,
    reason TEXT,
    date INTEGER
)
`).run()

db.prepare(`
CREATE TABLE IF NOT EXISTS settings (
guild_id TEXT,
key TEXT,
value TEXT,
PRIMARY KEY (guild_id, key)
)
`).run()

db.prepare(`
CREATE TABLE IF NOT EXISTS punishments (
id INTEGER PRIMARY KEY AUTOINCREMENT,
guild_id TEXT,
user_id TEXT,
moderator_id TEXT,
reason TEXT,
severity INTEGER,
created_at TEXT
)
`).run()

module.exports = db