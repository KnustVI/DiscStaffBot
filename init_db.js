const db = require('./database/database');

console.log("🛠️ Iniciando criação das tabelas...");

// Tabela de Reputação
db.prepare(`
    CREATE TABLE IF NOT EXISTS reputation (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        points INTEGER DEFAULT 100,
        PRIMARY KEY (guild_id, user_id)
    )
`).run();

// Tabela de Punições
db.prepare(`
    CREATE TABLE IF NOT EXISTS punishments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        severity INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`).run();

// Tabela de Configurações (Settings)
db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
        guild_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (guild_id, key)
    )
`).run();

console.log("✅ Tabelas criadas com sucesso no SQLite!");
process.exit();