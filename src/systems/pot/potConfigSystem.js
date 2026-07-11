/**
 * potConfigSystem.js
 * 
 * Configurações da integração Path of Titans.
 * Armazena: config do servidor, webhooks Discord por grupo de eventos.
 */
const db = require('../../database/index');

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

// ==================== GRUPOS DE EVENTOS ====================
// Definido aqui pois é dado puro (sem imports Discord), acessível
// tanto pelo painel (potWebhookSystem) quanto pelo gateway.
//
// `label` = texto puro (SEM emoji custom) — usado em título de modal e no
// comentário do Game.ini, nenhum dos dois renderiza tag de emoji customizado
// (modal só aceita texto puro; Game.ini é lido pelo servidor PoT/editor de
// texto do host, não pelo Discord).
// `emoji` = emoji customizado já resolvido — usado só em texto que o Discord
// realmente renderiza (painel, `name` legado mantido pra outros usos soltos).
//
// `description` aparece no painel /potserver logs — atualize sempre que uma
// nova funcionalidade do bot passar a usar os dados desse grupo.

const EVENT_GROUPS = [
    {
        id: 'login',
        name: `${EMOJIS.login || '📥'} Login / Logout`,
        label: 'Login / Logout',
        emoji: EMOJIS.login || '📥',
        description: 'Registra entrada/saída e vincula o jogador ao Discord (usado por /registrar e pelo container de login).',
        route: 'login',
        iniEvents: ['PlayerLogin', 'PlayerLogout', 'PlayerLeave']
    },
    {
        id: 'combate',
        name: `${EMOJIS.swords || '💀'} Combate`,
        label: 'Combate',
        emoji: EMOJIS.swords || '💀',
        description: 'Mortes e dano entre jogadores. Só gera log no Discord por enquanto.',
        route: 'combate',
        iniEvents: ['PlayerKilled', 'PlayerDamagedPlayer']
    },
    {
        id: 'quest',
        name: `${EMOJIS.listchecks || '📜'} Quest`,
        label: 'Quest',
        emoji: EMOJIS.listchecks || '📜',
        description: 'Progresso de missões. Só gera log no Discord por enquanto.',
        route: 'quest',
        iniEvents: ['PlayerQuestComplete', 'PlayerQuestFailed']
    },
    {
        id: 'respawn',
        name: `${EMOJIS.refreshccw || '🔄'} Respawn`,
        label: 'Respawn',
        emoji: EMOJIS.refreshccw || '🔄',
        description: 'Reviver e teletransporte. Só gera log no Discord por enquanto.',
        route: 'respawn',
        iniEvents: ['PlayerRespawn', 'PlayerWaystone']
    },
    {
        id: 'chat',
        name: `${EMOJIS.messagecircle || '💬'} Chat`,
        label: 'Chat',
        emoji: EMOJIS.messagecircle || '💬',
        description: 'Mensagens e profanidade no chat do jogo. Só gera log no Discord por enquanto — útil pra moderação manual.',
        route: 'chat',
        iniEvents: ['PlayerChat', 'PlayerProfanity']
    },
    {
        id: 'comando',
        name: `${EMOJIS.raio || '⚡'} Comandos`,
        label: 'Comandos',
        emoji: EMOJIS.raio || '⚡',
        description: 'Comandos de jogadores (prefixo !). Só gera log no Discord por enquanto.',
        route: 'comando',
        iniEvents: ['PlayerCommand']
    },
    {
        id: 'grupo',
        name: `${EMOJIS.users || '👥'} Grupo`,
        label: 'Grupo',
        emoji: EMOJIS.users || '👥',
        description: 'Formação e dissolução de grupos. Só gera log no Discord por enquanto.',
        route: 'grupo',
        iniEvents: ['PlayerJoinedGroup', 'PlayerLeftGroup']
    },
    {
        id: 'servidor',
        name: `${EMOJIS.tv || '🖥️'} Servidor`,
        label: 'Servidor',
        emoji: EMOJIS.tv || '🖥️',
        description: 'Eventos, alertas e performance do servidor (start, restart, erros, tick baixo). Só gera log no Discord por enquanto — bom pra monitorar a saúde do servidor.',
        route: 'servidor',
        iniEvents: ['ServerStart', 'ServerRestart', 'ServerRestartCountdown', 'ServerModerate', 'ServerError', 'SecurityAlert', 'BadAverageTick']
    },
    {
        id: 'admin',
        name: `${EMOJIS.crown || '👑'} Admin`,
        label: 'Admin',
        emoji: EMOJIS.crown || '👑',
        description: 'Ações administrativas no jogo (espectador, comandos de admin). Só gera log no Discord por enquanto — útil pra auditoria da staff.',
        route: 'admin',
        iniEvents: ['AdminSpectate', 'AdminCommand']
    },
    {
        id: 'nest',
        name: `${EMOJIS.Nest || '🪺'} Nest`,
        label: 'Nest',
        emoji: EMOJIS.Nest || '🪺',
        description: 'Criação e gestão de ninhos. Só gera log no Discord por enquanto.',
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

    // Lista todos os guild_id com um pot_server_config salvo e enabled=true —
    // usado no boot pra reconectar RCON de todo mundo automaticamente (ver
    // PathOfTitansIntegration.reconnectAllGuilds), já que rconClients é só em
    // memória e some a cada reinício do processo.
    static getAllConfiguredGuildIds() {
        const rows = db.prepare(`SELECT guild_id, value FROM settings WHERE key = 'pot_server_config'`).all();
        const guildIds = [];
        for (const row of rows) {
            try {
                const config = JSON.parse(row.value);
                if (config?.enabled === true) guildIds.push(row.guild_id);
            } catch { /* config corrompida/vazia — ignora essa guild */ }
        }
        return guildIds;
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
        const { getInstance } = require('../../integrations/pathoftitans');
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