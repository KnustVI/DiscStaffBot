const Database = require('better-sqlite3');
const db = new Database('database.sqlite');

db.pragma('journal_mode = WAL');

// 1. CONFIGURAÇÕES
db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
        guild_id TEXT,
        key TEXT,
        value TEXT,
        PRIMARY KEY (guild_id, key)
    )
`).run();

// 2. USUÁRIOS (Ajustado para Guild_ID)
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        user_id TEXT,
        guild_id TEXT,
        reputation INTEGER DEFAULT 100,
        penalties INTEGER DEFAULT 0,
        last_penalty INTEGER,
        PRIMARY KEY (user_id, guild_id)
    )
`).run();

// 3. PUNIÇÕES (Adicionado índices)
db.prepare(`
    CREATE TABLE IF NOT EXISTS punishments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        reason TEXT DEFAULT 'Motivo não informado',
        severity INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    )
`).run();

// Criar índices para buscas rápidas no Automod e comandos de perfil
db.prepare(`CREATE INDEX IF NOT EXISTS idx_punishments_user ON punishments (user_id, guild_id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_reputation ON users (reputation)`).run();

module.exports = db;