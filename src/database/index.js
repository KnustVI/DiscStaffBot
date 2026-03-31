const Database = require('better-sqlite3');
const path = require('path');

// Caminho absoluto para o arquivo do banco
const dbPath = path.join(__dirname, '../../database.sqlite');
const db = new Database(dbPath);

/**
 * OTIMIZAÇÕES DE PERFORMANCE (Nível Produção)
 * WAL: Permite leituras e escritas simultâneas.
 * Synchronous NORMAL: Balanço ideal entre velocidade e segurança contra corrupção.
 */
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON'); // Ativa integridade referencial

// --- 1. ESTRUTURA DE TABELAS ---

// Configurações do Servidor (Cache-friendly)
db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
        guild_id TEXT NOT NULL, 
        key TEXT NOT NULL, 
        value TEXT, 
        PRIMARY KEY (guild_id, key)
    )
`).run();

// Pontuação de Reputação (Escalável)
db.prepare(`
    CREATE TABLE IF NOT EXISTS reputation (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        points INTEGER DEFAULT 100,
        updated_at INTEGER,
        PRIMARY KEY (guild_id, user_id)
    )
`).run();

// Registro Permanente de Punições
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

// Controle de Cargos Temporários (Ex: Mute/Strike temporário)
db.prepare(`
    CREATE TABLE IF NOT EXISTS temporary_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
    )
`).run();

// Controle de Punições Temporárias (Bans/Mutes)
db.prepare(`
    CREATE TABLE IF NOT EXISTS temporary_punishments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        expires_at INTEGER NOT NULL
    )
`).run();

// --- 2. SISTEMA DE MIGRAÇÃO DINÂMICA ---
// Evita erros ao atualizar o bot com novas funcionalidades
const ensureColumn = (tableName, columnName, definition) => {
    const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (!tableInfo.some(col => col.name === columnName)) {
        try {
            db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
            console.log(`✅ [DB_MIGRATION] Coluna '${columnName}' injetada em '${tableName}'.`);
        } catch (e) {
            console.error(`⚠️ [DB_MIGRATION] Falha ao injetar '${columnName}': ${e.message}`);
        }
    }
};

// Migrações necessárias para a versão atual
ensureColumn('reputation', 'updated_at', "INTEGER");
ensureColumn('punishments', 'ticket_id', "TEXT DEFAULT 'N/A'");

// --- 3. ÍNDICES DE VELOCIDADE (O Segredo da Fluidez) ---
db.exec(`
    -- Busca rápida de reputação por servidor/membro
    CREATE INDEX IF NOT EXISTS idx_rep_lookup ON reputation (guild_id, user_id);
    
    -- Busca de histórico ordenada por data (Otimiza o /historico)
    CREATE INDEX IF NOT EXISTS idx_punish_history ON punishments (guild_id, user_id, created_at DESC);
    
    -- Otimiza o AutoMod Diário (Busca por expiração)
    CREATE INDEX IF NOT EXISTS idx_temp_roles_exp ON temporary_roles (expires_at);
    CREATE INDEX IF NOT EXISTS idx_temp_punish_exp ON temporary_punishments (expires_at);
`);

console.log("🗄️ [DATABASE] Banco de Dados pronto e otimizado com WAL Mode.");

module.exports = db;