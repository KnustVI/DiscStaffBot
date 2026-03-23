const Database = require('better-sqlite3');
const db = new Database('database.sqlite');

db.pragma('journal_mode = WAL');

// 1. CRIAR TABELAS (Garante a estrutura básica)
db.prepare(`CREATE TABLE IF NOT EXISTS settings (guild_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (guild_id, key))`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS users (user_id TEXT NOT NULL, guild_id TEXT NOT NULL, reputation INTEGER DEFAULT 100, penalties INTEGER DEFAULT 0, last_penalty INTEGER, PRIMARY KEY (user_id, guild_id))`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS punishments (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, moderator_id TEXT NOT NULL, reason TEXT DEFAULT 'Motivo não informado', severity INTEGER NOT NULL, ticket_id TEXT DEFAULT 'N/A', created_at INTEGER NOT NULL)`).run();

// 2. MIGRAÇÕES (Adiciona colunas se elas não existirem em bancos velhos)
const punishmentsInfo = db.prepare("PRAGMA table_info(punishments)").all();
const usersInfo = db.prepare("PRAGMA table_info(users)").all();

if (!punishmentsInfo.some(col => col.name === 'guild_id')) {
    db.prepare("ALTER TABLE punishments ADD COLUMN guild_id TEXT NOT NULL DEFAULT '0'").run();
    console.log("✅ Coluna 'guild_id' injetada.");
}
if (!punishmentsInfo.some(col => col.name === 'ticket_id')) {
    db.prepare("ALTER TABLE punishments ADD COLUMN ticket_id TEXT DEFAULT 'N/A'").run();
}
if (!usersInfo.some(col => col.name === 'reputation')) {
    db.prepare("ALTER TABLE users ADD COLUMN reputation INTEGER DEFAULT 100").run();
}

// 3. ÍNDICES (SÓ DEPOIS DAS COLUNAS EXISTIREM)
// É aqui que dava o erro na linha 83!
try {
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_punishments_id ON punishments (id)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_settings_guild ON settings (guild_id, key)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_reputation_local ON users (guild_id, reputation DESC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_punishments_lookup ON punishments (guild_id, user_id)`).run();
    console.log("🚀 Índices verificados/criados com sucesso.");
} catch (e) {
    console.log("⚠️ Aviso nos índices: " + e.message);
}

console.log("🗄️ Banco de Dados pronto.");
module.exports = db;