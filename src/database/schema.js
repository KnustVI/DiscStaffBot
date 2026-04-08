/**
 * Schema completo do banco de dados
 */

const SCHEMA = {
    // ==================== TABELA DE USUÁRIOS GLOBAL ====================
    users: `
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            username TEXT,
            discriminator TEXT,
            avatar TEXT,
            created_at INTEGER,
            first_seen INTEGER DEFAULT (strftime('%s', 'now')),
            last_seen INTEGER DEFAULT (strftime('%s', 'now')),
            is_bot INTEGER DEFAULT 0
        )
    `,

    // ==================== TABELA DE SERVIDORES ====================
    guilds: `
        CREATE TABLE IF NOT EXISTS guilds (
            guild_id TEXT PRIMARY KEY,
            name TEXT,
            icon TEXT,
            owner_id TEXT,
            joined_at INTEGER DEFAULT (strftime('%s', 'now')),
            settings TEXT
        )
    `,

    // ==================== CONFIGURAÇÕES DOS SERVIDORES ====================
    settings: `
        CREATE TABLE IF NOT EXISTS settings (
            guild_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT,
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_by TEXT,
            PRIMARY KEY (guild_id, key)
        )
    `,

    // ==================== REPUTAÇÃO DOS USUÁRIOS ====================
    reputation: `
        CREATE TABLE IF NOT EXISTS reputation (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            points INTEGER DEFAULT 100,
            rank TEXT DEFAULT 'normal',
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_by TEXT,
            UNIQUE(guild_id, user_id)
        )
    `,

    // ==================== PUNIÇÕES (STRIKES) ====================
    punishments: `
        CREATE TABLE IF NOT EXISTS punishments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            moderator_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            severity INTEGER NOT NULL,
            points_deducted INTEGER DEFAULT 0,
            ticket_id TEXT,
            created_at INTEGER NOT NULL,
            expires_at INTEGER,
            status TEXT DEFAULT 'active',
            revoked_by TEXT,
            revoked_reason TEXT,
            revoked_at INTEGER,
            notes TEXT
        )
    `,

    // ==================== TICKETS ====================
        tickets: `
        CREATE TABLE IF NOT EXISTS tickets (
            id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            closed_at INTEGER,
            closed_by TEXT,
            closed_reason TEXT,
            rating INTEGER,
            status TEXT DEFAULT 'open'
        )
    `,

    // ==================== MENSAGENS DOS TICKETS ====================
    ticket_messages: `
        CREATE TABLE IF NOT EXISTS ticket_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_uuid TEXT NOT NULL,
            message_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            content TEXT,
            attachments TEXT,
            created_at INTEGER NOT NULL,
            is_staff_reply INTEGER DEFAULT 0
        )
    `,

    // ==================== ANALYTICS DE STAFF ====================
    staff_analytics: `
        CREATE TABLE IF NOT EXISTS staff_analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            period TEXT NOT NULL,
            date TEXT NOT NULL,
            punishments_applied INTEGER DEFAULT 0,
            punishments_revoked INTEGER DEFAULT 0,
            tickets_claimed INTEGER DEFAULT 0,
            tickets_closed INTEGER DEFAULT 0,
            avg_response_time INTEGER DEFAULT 0,
            avg_resolution_time INTEGER DEFAULT 0,
            satisfaction_score REAL DEFAULT 0,
            metrics TEXT,
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            UNIQUE(guild_id, user_id, period, date)
        )
    `,

    // ==================== LOGS DE ATIVIDADES ====================
    activity_logs: `
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            guild_id TEXT NOT NULL,
            user_id TEXT,
            action TEXT NOT NULL,
            target_id TEXT,
            details TEXT,
            ip_address TEXT,
            created_at INTEGER NOT NULL
        )
    `,

    // ==================== CARGOS TEMPORÁRIOS ====================
    temporary_roles: `
        CREATE TABLE IF NOT EXISTS temporary_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            punishment_id INTEGER,
            expires_at INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `,

    // ==================== FEEDBACKS ====================
    feedbacks: `
        CREATE TABLE IF NOT EXISTS feedbacks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            message_id TEXT,
            channel_id TEXT,
            status TEXT DEFAULT 'pending',
            reviewed_by TEXT,
            reviewed_at INTEGER,
            created_at INTEGER NOT NULL
        )
    `
};

// ==================== ÍNDICES ====================
const INDEXES = [
    `CREATE INDEX IF NOT EXISTS idx_punishments_guild_user ON punishments(guild_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_punishments_moderator ON punishments(moderator_id)`,
    `CREATE INDEX IF NOT EXISTS idx_punishments_created ON punishments(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reputation_guild_user ON reputation(guild_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_logs_guild ON activity_logs(guild_id)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_temporary_roles_expires ON temporary_roles(expires_at)`
];

module.exports = { SCHEMA, INDEXES };