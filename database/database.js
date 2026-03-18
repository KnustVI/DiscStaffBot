const Database = require('better-sqlite3');
const db = new Database('database.sqlite');

// Ativa o modo de alto desempenho (Write-Ahead Logging)
db.pragma('journal_mode = WAL');

// ==========================================
// 1. CONFIGURAÇÕES (Métricas, Canais, Cargos e Alertas)
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
// 2. USUÁRIOS (Reputação e Penalidades Locais)
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
// 3. PUNIÇÕES (Histórico com Suporte a Revogação)
// ==========================================
db.prepare(`
    CREATE TABLE IF NOT EXISTS punishments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        reason TEXT DEFAULT 'Motivo não informado',
        severity INTEGER NOT NULL, -- 0 será usado para Punições Revogadas
        ticket_id TEXT DEFAULT 'N/A',
        created_at INTEGER NOT NULL
    )
`).run();

/** * LÓGICA DE MANUTENÇÃO (MIGRAÇÕES)
 * Garante que o banco se adapte sem precisar deletar o arquivo .sqlite
 */
const punishmentsInfo = db.prepare("PRAGMA table_info(punishments)").all();
const usersInfo = db.prepare("PRAGMA table_info(users)").all();

// Verifica ticket_id na tabela punishments
if (!punishmentsInfo.some(col => col.name === 'ticket_id')) {
    db.prepare("ALTER TABLE punishments ADD COLUMN ticket_id TEXT DEFAULT 'N/A'").run();
    console.log("✅ Coluna 'ticket_id' injetada em 'punishments'.");
}

// Verifica se a coluna reputation existe (prevenção de erros em DBs antigos)
if (!usersInfo.some(col => col.name === 'reputation')) {
    db.prepare("ALTER TABLE users ADD COLUMN reputation INTEGER DEFAULT 100").run();
    console.log("✅ Coluna 'reputation' injetada em 'users'.");
}

/**
 * ÍNDICES DE PERFORMANCE (Otimização de Consultas)
 */

// Acelera a busca por ID de punição (Essencial para o delpunir/revogar)
db.prepare(`CREATE INDEX IF NOT EXISTS idx_punishments_id ON punishments (id)`).run();

// Acelera a busca de configurações (Canais, Cargos e alert_channel)
db.prepare(`CREATE INDEX IF NOT EXISTS idx_settings_guild ON settings (guild_id, key)`).run();

// Acelera o Ranking Local e verificação de estado crítico
db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_reputation_local ON users (guild_id, reputation DESC)`).run();

// Acelera buscas de histórico (/check)
db.prepare(`CREATE INDEX IF NOT EXISTS idx_punishments_lookup ON punishments (guild_id, user_id)`).run();

console.log("🗄️ Banco de Dados pronto: Sistema de Alertas e Auditoria Habilitado.");

module.exports = db;