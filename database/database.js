const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);

// PERFORMANCE PRO: Modo WAL para evitar 'Database Locked' na Oracle Cloud
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');

/**
 * 1. CRIAÇÃO DE TABELAS (Sincronizadas com os Handlers)
 */
db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
        guild_id TEXT NOT NULL, 
        key TEXT NOT NULL, 
        value TEXT, 
        PRIMARY KEY (guild_id, key)
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS reputation (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        points INTEGER DEFAULT 100,
        PRIMARY KEY (guild_id, user_id)
    )
`).run();

// IMPORTANTE: created_at deve ser INTEGER para cálculos matemáticos (Date.now())
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

/**
 * 2. SISTEMA DE MIGRAÇÃO (Segurança para colunas novas)
 */
const ensureColumn = (tableName, columnName, definition) => {
    const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (!tableInfo.some(col => col.name === columnName)) {
        try {
            db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
            console.log(`✅ Coluna '${columnName}' injetada em '${tableName}'.`);
        } catch (e) {
            console.log(`⚠️ Falha ao injetar '${columnName}': ${e.message}`);
        }
    }
};

ensureColumn('punishments', 'ticket_id', "TEXT DEFAULT 'N/A'");
ensureColumn('punishments', 'guild_id', "TEXT DEFAULT '0'");

/**
 * 3. ÍNDICES DE VELOCIDADE
 */
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reputation_lookup ON reputation (guild_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_punishments_user ON punishments (guild_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_punishments_date ON punishments (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_settings_fast ON settings (guild_id, key);
`);

console.log("🗄️ Banco de Dados pronto e otimizado.");

module.exports = db;