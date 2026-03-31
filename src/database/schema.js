/**
 * Schema completo do banco de dados
 * Preparado para suportar:
 * - Sistema de punições (strikes)
 * - Sistema de tickets (atendimento)
 * - Analytics de staff
 * - Dashboard web
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
            is_bot INTEGER DEFAULT 0,
            INDEX idx_last_seen (last_seen)
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
            settings TEXT, -- JSON com configurações do servidor
            INDEX idx_owner (owner_id)
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
            PRIMARY KEY (guild_id, key),
            FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE
        )
    `,

    // ==================== REPUTAÇÃO DOS USUÁRIOS ====================
    reputation: `
        CREATE TABLE IF NOT EXISTS reputation (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            points INTEGER DEFAULT 100,
            rank TEXT DEFAULT 'normal', -- 'exemplar', 'normal', 'problematico'
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_by TEXT,
            UNIQUE(guild_id, user_id),
            FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
            INDEX idx_guild_user (guild_id, user_id),
            INDEX idx_points (points)
        )
    `,

    // ==================== PUNIÇÕES (STRIKES) ====================
    punishments: `
        CREATE TABLE IF NOT EXISTS punishments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL, -- UUID único para referência global
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            moderator_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            severity INTEGER NOT NULL, -- 0-5
            points_deducted INTEGER DEFAULT 0,
            ticket_id TEXT, -- Referência ao ticket associado
            created_at INTEGER NOT NULL,
            expires_at INTEGER,
            status TEXT DEFAULT 'active', -- 'active', 'expired', 'revoked'
            revoked_by TEXT,
            revoked_reason TEXT,
            revoked_at INTEGER,
            notes TEXT,
            FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
            FOREIGN KEY (moderator_id) REFERENCES users(user_id),
            INDEX idx_guild_user (guild_id, user_id),
            INDEX idx_moderator (moderator_id),
            INDEX idx_created (created_at),
            INDEX idx_status (status),
            INDEX idx_ticket (ticket_id)
        )
    `,

    // ==================== TICKETS (ATENDIMENTO) ====================
    tickets: `
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL, -- UUID único para referência global
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL, -- Criador do ticket
            channel_id TEXT NOT NULL,
            category_id TEXT,
            status TEXT DEFAULT 'open', -- 'open', 'claimed', 'closed', 'archived'
            priority TEXT DEFAULT 'normal', -- 'low', 'normal', 'high', 'urgent'
            type TEXT DEFAULT 'support', -- 'support', 'appeal', 'report', 'other'
            title TEXT,
            description TEXT,
            created_at INTEGER NOT NULL,
            claimed_by TEXT, -- Staff que assumiu o ticket
            claimed_at INTEGER,
            closed_by TEXT,
            closed_at INTEGER,
            closed_reason TEXT,
            rating INTEGER, -- 1-5 stars
            feedback TEXT,
            metadata TEXT, -- JSON com dados adicionais
            FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(user_id),
            FOREIGN KEY (claimed_by) REFERENCES users(user_id),
            FOREIGN KEY (closed_by) REFERENCES users(user_id),
            INDEX idx_guild (guild_id),
            INDEX idx_user (user_id),
            INDEX idx_status (status),
            INDEX idx_claimed_by (claimed_by),
            INDEX idx_created (created_at)
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
            attachments TEXT, -- JSON com URLs dos anexos
            created_at INTEGER NOT NULL,
            is_staff_reply INTEGER DEFAULT 0,
            FOREIGN KEY (ticket_uuid) REFERENCES tickets(uuid) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(user_id),
            INDEX idx_ticket (ticket_uuid),
            INDEX idx_message (message_id)
        )
    `,

    // ==================== ANALYTICS DE STAFF ====================
    staff_analytics: `
        CREATE TABLE IF NOT EXISTS staff_analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            period TEXT NOT NULL, -- 'day', 'week', 'month'
            date TEXT NOT NULL, -- YYYY-MM-DD
            punishments_applied INTEGER DEFAULT 0,
            punishments_revoked INTEGER DEFAULT 0,
            tickets_claimed INTEGER DEFAULT 0,
            tickets_closed INTEGER DEFAULT 0,
            avg_response_time INTEGER DEFAULT 0, -- em segundos
            avg_resolution_time INTEGER DEFAULT 0, -- em segundos
            satisfaction_score REAL DEFAULT 0, -- média de avaliações
            metrics TEXT, -- JSON com métricas adicionais
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            UNIQUE(guild_id, user_id, period, date),
            FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(user_id),
            INDEX idx_guild_user (guild_id, user_id),
            INDEX idx_period (period, date)
        )
    `,

    // ==================== LOGS DE ATIVIDADES ====================
    activity_logs: `
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            guild_id TEXT NOT NULL,
            user_id TEXT,
            action TEXT NOT NULL, -- 'punishment_add', 'punishment_remove', 'ticket_create', etc.
            target_id TEXT, -- ID do alvo (user_id, punishment_id, ticket_id)
            details TEXT, -- JSON com detalhes da ação
            ip_address TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(user_id),
            INDEX idx_guild (guild_id),
            INDEX idx_user (user_id),
            INDEX idx_action (action),
            INDEX idx_created (created_at)
        )
    `,

    // ==================== CARGOS TEMPORÁRIOS ====================
    temporary_roles: `
        CREATE TABLE IF NOT EXISTS temporary_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            punishment_id INTEGER, -- Referência à punição que causou o cargo
            expires_at INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(user_id),
            FOREIGN KEY (punishment_id) REFERENCES punishments(id) ON DELETE SET NULL,
            INDEX idx_expires (expires_at),
            INDEX idx_user (user_id)
        )
    `,

    // ==================== ÍNDICES ADICIONAIS PARA PERFORMANCE ====================
    indexes: `
        -- Índices para queries do dashboard
        CREATE INDEX IF NOT EXISTS idx_punishments_dashboard 
        ON punishments(created_at, guild_id, status, severity);
        
        CREATE INDEX IF NOT EXISTS idx_tickets_dashboard 
        ON tickets(created_at, guild_id, status, priority, claimed_by);
        
        CREATE INDEX IF NOT EXISTS idx_reputation_dashboard 
        ON reputation(guild_id, points, rank);
        
        CREATE INDEX IF NOT EXISTS idx_staff_analytics_dashboard 
        ON staff_analytics(guild_id, user_id, date, period);
    `
};

module.exports = SCHEMA;