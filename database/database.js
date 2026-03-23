const Database = require('better-sqlite3');
// DICA: No Ubuntu, garanta que o caminho aqui seja o mesmo que o código espera
const db = new Database('database.sqlite');

// Ativa o modo de alto desempenho (Write-Ahead Logging)
db.pragma('journal_mode = WAL');

// ==========================================
// 1. CONFIGURAÇÕES
// ==========================================
db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
        guild_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (guild_id, key)
    )
`).run();

// ==========================================
// 2. USUÁRIOS
// ==========================================
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        reputation INTEGER DEFAULT 100,
        penalties INTEGER DEFAULT 0,
        last_penalty INTEGER,
        PRIMARY KEY (user_id, guild_id)
    )
`).run();

// ==========================================
// 3. PUNIÇÕES
// ==========================================
db.prepare(`
    CREATE TABLE IF NOT EXISTS punishments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        reason TEXT DEFAULT 'Motivo não informado',
        severity INTEGER NOT NULL,
        ticket_id TEXT DEFAULT 'N/A',
        created_at INTEGER NOT NULL
    )
`).run();

/** * LÓGICA DE MANUTENÇÃO (MIGRAÇÕES)
 * Isso evita que você precise deletar o banco toda vez que mudar algo
 */
const punishmentsInfo = db.prepare("PRAGMA table_info(punishments)").all();
const usersInfo = db.prepare("PRAGMA table_info(users)").all();

// [CORREÇÃO] Verifica se a guild_id existe em punishments
if (!punishmentsInfo.some(col => col.name === 'guild_id')) {
    try {
        db.prepare("ALTER TABLE punishments ADD COLUMN guild_id TEXT NOT NULL DEFAULT '0'").run();
        console.log("✅ Coluna 'guild_id' injetada em 'punishments'.");
    } catch (e) {
        console.log("⚠️ Aviso: Não foi possível adicionar 'guild_id' (talvez já exista).");
    }
}

// Verifica ticket_id na tabela punishments
if (!punishmentsInfo.some(col => col.name === 'ticket_id')) {
    db.prepare("ALTER TABLE punishments ADD COLUMN ticket_id TEXT DEFAULT 'N/A'").run();
    console.log("✅ Coluna 'ticket_id' injetada em 'punishments'.");
}

// Verifica se a coluna reputation existe em users
if (!usersInfo.some(col => col.name === 'reputation')) {
    db.prepare("ALTER TABLE users ADD COLUMN reputation INTEGER DEFAULT 100").run();
    console.log("✅ Coluna 'reputation' injetada em 'users'.");
}

/**
 * ÍNDICES DE PERFORMANCE
 */
db.prepare(`CREATE INDEX IF NOT EXISTS idx_punishments_id ON punishments (id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_settings_guild ON settings (guild_id, key)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_reputation_local ON users (guild_id, reputation DESC)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_punishments_lookup ON punishments (guild_id, user_id)`).run();

console.log("🗄️ Banco de Dados pronto: Sistema de Alertas e Auditoria Habilitado.");

module.exports = db;