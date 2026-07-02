/**
 * potConfigSystem.js
 * 
 * Configurações da integração Path of Titans.
 * Armazena: config do servidor, webhooks Discord por grupo de eventos.
 */
const db = require('../database/index');

// ==================== GRUPOS DE EVENTOS ====================
// Definido aqui pois é dado puro (sem imports Discord), acessível
// tanto pelo painel (potWebhookSystem) quanto pelo gateway.

const EVENT_GROUPS = [
    {
        id: 'login',
        name: '📥 Login / Logout',
        description: 'Registro de entradas e saídas do servidor.',
        route: 'login',
        iniEvents: ['PlayerLogin', 'PlayerLogout', 'PlayerLeave']
    },
    {
        id: 'combate',
        name: '💀 Combate',
        description: 'Mortes e dano entre jogadores.',
        route: 'combate',
        iniEvents: ['PlayerKilled', 'PlayerDamagedPlayer']
    },
    {
        id: 'quest',
        name: '📜 Quest',
        description: 'Progresso de missões.',
        route: 'quest',
        iniEvents: ['PlayerQuestComplete', 'PlayerQuestFailed']
    },
    {
        id: 'respawn',
        name: '🔄 Respawn',
        description: 'Reviver e teletransporte.',
        route: 'respawn',
        iniEvents: ['PlayerRespawn', 'PlayerWaystone']
    },
    {
        id: 'chat',
        name: '💬 Chat',
        description: 'Mensagens e profanidade no chat.',
        route: 'chat',
        iniEvents: ['PlayerChat', 'PlayerProfanity']
    },
    {
        id: 'comando',
        name: '⚡ Comandos',
        description: 'Comandos de jogadores (prefixo !).',
        route: 'comando',
        iniEvents: ['PlayerCommand']
    },
    {
        id: 'grupo',
        name: '👥 Grupo',
        description: 'Formação e dissolução de grupos.',
        route: 'grupo',
        iniEvents: ['PlayerJoinedGroup', 'PlayerLeftGroup']
    },
    {
        id: 'servidor',
        name: '🖥️ Servidor',
        description: 'Eventos, alertas e performance do servidor.',
        route: 'servidor',
        iniEvents: ['ServerStart', 'ServerRestart', 'ServerRestartCountdown', 'ServerModerate', 'ServerError', 'SecurityAlert', 'BadAverageTick']
    },
    {
        id: 'admin',
        name: '👑 Admin',
        description: 'Ações e comandos administrativos.',
        route: 'admin',
        iniEvents: ['AdminSpectate', 'AdminCommand']
    },
    {
        id: 'nest',
        name: '🪺 Nest',
        description: 'Criação e gestão de ninhos.',
        route: 'nest',
        iniEvents: ['CreateNest', 'DestroyNest', 'NestInvite', 'PlayerJoinNest', 'UpdateNest']
    }
];

class PoTConfigSystem {

    // ==================== SERVIDOR ====================

    static setServerConfig(guildId, config, userId) {
        db.prepare(`
            INSERT INTO settings (guild_id, key, value, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, key) DO UPDATE SET
                value = excluded.value,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
        `).run(guildId, 'pot_server_config', JSON.stringify(config), userId, Date.now());
    }

    static getServerConfig(guildId) {
        const result = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, 'pot_server_config');
        if (!result) return null;
        try { return JSON.parse(result.value); } catch { return null; }
    }

    static isConfigured(guildId) {
        const config = this.getServerConfig(guildId);
        return config !== null && config.enabled === true;
    }

    // ==================== WEBHOOKS POR GRUPO ====================
    // Cada grupo (login, combate, quest...) tem uma URL de webhook Discord.
    // O bot recebe os eventos do PoT e posta nessas URLs já formatados.

    static setWebhookForGroup(guildId, groupId, webhookUrl) {
        db.prepare(`
            INSERT INTO settings (guild_id, key, value, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(guild_id, key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
        `).run(guildId, `pot_group_webhook_${groupId}`, webhookUrl, Date.now());
    }

    static getWebhookForGroup(guildId, groupId) {
        const result = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, `pot_group_webhook_${groupId}`);
        return result ? result.value : null;
    }

    static getAllGroupWebhooks(guildId) {
        const results = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ? AND key LIKE 'pot_group_webhook_%'`).all(guildId);
        const webhooks = {};
        for (const row of results) {
            webhooks[row.key.replace('pot_group_webhook_', '')] = row.value;
        }
        return webhooks;
    }

    static removeWebhookForGroup(guildId, groupId) {
        db.prepare(`DELETE FROM settings WHERE guild_id = ? AND key = ?`).run(guildId, `pot_group_webhook_${groupId}`);
    }

    // ==================== WEBHOOKS LEGADOS (por evento individual) ====================
    // Mantidos para compatibilidade — não usados no fluxo novo de grupos.

    static setWebhookForEvent(guildId, event, webhookUrl) {
        db.prepare(`
            INSERT INTO settings (guild_id, key, value, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(guildId, `pot_webhook_${event}`, webhookUrl, Date.now());
    }

    static getWebhookForEvent(guildId, event) {
        const result = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, `pot_webhook_${event}`);
        return result ? result.value : null;
    }

    static getAllWebhookConfigs(guildId) {
        const results = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ? AND key LIKE 'pot_webhook_%'`).all(guildId);
        const configs = {};
        for (const row of results) configs[row.key.replace('pot_webhook_', '')] = row.value;
        return configs;
    }

    static removeWebhook(guildId, event) {
        db.prepare(`DELETE FROM settings WHERE guild_id = ? AND key = ?`).run(guildId, `pot_webhook_${event}`);
    }

    static removeAllWebhooks(guildId) {
        db.prepare(`DELETE FROM settings WHERE guild_id = ? AND key LIKE 'pot_webhook_%'`).run(guildId);
    }

    // ==================== RCON ====================

    static async executeRconCommand(guildId, command) {
        const { getInstance } = require('../integrations/pathoftitans');
        const potIntegration = getInstance(global.client);
        if (!potIntegration) return { success: false, error: 'Integração não inicializada' };
        return await potIntegration.executeCommand(guildId, command);
    }

    // ==================== RESET ====================

    static resetConfig(guildId, scope) {
        switch (scope) {
            case 'server':
                db.prepare(`DELETE FROM settings WHERE guild_id = ? AND key = 'pot_server_config'`).run(guildId);
                break;
            case 'logs':
                db.prepare(`DELETE FROM settings WHERE guild_id = ? AND key LIKE 'pot_group_webhook_%'`).run(guildId);
                db.prepare(`DELETE FROM settings WHERE guild_id = ? AND key LIKE 'pot_webhook_%'`).run(guildId);
                break;
            case 'all':
                this.clearAllConfigs(guildId);
                break;
            default:
                throw new Error(`Escopo de reset inválido: ${scope}`);
        }
    }

    static clearAllConfigs(guildId) {
        db.prepare(`DELETE FROM settings WHERE guild_id = ? AND key LIKE 'pot_%'`).run(guildId);
    }

    // ==================== STATS / VALIDAÇÃO ====================

    static getStats(guildId) {
        const config = this.getServerConfig(guildId);
        const groupWebhooks = this.getAllGroupWebhooks(guildId);
        return {
            configured: config !== null,
            enabled: config?.enabled || false,
            server_ip: config?.server_ip || null,
            webhook_count: Object.keys(groupWebhooks).length,
            has_rcon: !!(config?.rcon_password && config?.rcon_port)
        };
    }

    static validateConfig(guildId) {
        const config = this.getServerConfig(guildId);
        if (!config) return { valid: false, missing: ['server_config'] };
        const missing = [];
        if (!config.server_ip) missing.push('server_ip');
        if (!config.rcon_password) missing.push('rcon_password');
        if (!config.rcon_port) missing.push('rcon_port');
        return { valid: missing.length === 0 && config.enabled === true, missing, config };
    }
}

// EVENT_GROUPS exportado junto — usado pelo painel e pelo gateway
PoTConfigSystem.EVENT_GROUPS = EVENT_GROUPS;

module.exports = PoTConfigSystem;