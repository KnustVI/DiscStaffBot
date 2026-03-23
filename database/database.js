const Database = require('better-sqlite3');
const path = require('path');

// Caminho absoluto para evitar erros de diretório na Oracle Cloud
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);

// 🚀 PERFORMANCE PRO: Modo WAL permite leitura e escrita simultâneas (Adeus 'Database Locked')
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');

/**
 * 1. ESTRUTURA BÁSICA (Tabelas essenciais)
 */
db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
        guild_id TEXT NOT NULL, 
        key TEXT NOT NULL, 
        value TEXT NOT NULL, 
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
 * 2. SISTEMA DE MIGRAÇÃO (Evita erros em bancos antigos)
 */
const tableInfos = {
    punishments: db.prepare("PRAGMA table_info(punishments)").all(),
    reputation: db.prepare("PRAGMA table_info(reputation)").all()
};

const ensureColumn = (tableName, columnName, definition) => {
    if (!tableInfos[tableName].some(col => col.name === columnName)) {
        try {
            db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
            console.log(`✅ Coluna '${columnName}' injetada em '${tableName}'.`);
        } catch (e) {
            console.log(`⚠️ Falha ao injetar '${columnName}': ${e.message}`);
        }
    }
};

// Garante colunas de segurança
ensureColumn('punishments', 'ticket_id', "TEXT DEFAULT 'N/A'");
ensureColumn('punishments', 'guild_id', "TEXT DEFAULT '0'");

/**
 * 3. ÍNDICES DE VELOCIDADE (Busca instantânea)
 * O uso de 'IF NOT EXISTS' previne o erro da linha 83.
 */
try {
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_reputation_lookup ON reputation (guild_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_punishments_user ON punishments (guild_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_punishments_date ON punishments (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_settings_fast ON settings (guild_id, key);
    `);
    console.log("🚀 Índices de performance verificados.");
} catch (e) {
    console.log("⚠️ Aviso nos índices: " + e.message);
}

console.log("🗄️  Banco de Dados pronto para uso.");

module.exports = db;