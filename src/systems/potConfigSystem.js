/**
 * Extensão do sistema de configuração para Path of Titans
 * NÃO modifica o ConfigSystem original - apenas adiciona funcionalidades
 * 
 * Gerencia:
 * - Configurações do servidor PoT (IP, RCON, portas)
 * - Canais de log
 * - Webhooks por evento
 * - URLs dos endpoints
 */
const db = require('../database/index');

class PoTConfigSystem {
    
    // ==================== SERVIDOR ====================
    
    /**
     * Define todas as configurações do servidor PoT
     * @param {string} guildId - ID do servidor Discord
     * @param {object} config - Configurações do servidor PoT
     * @param {string} userId - ID do usuário que configurou
     */
    static setServerConfig(guildId, config, userId) {
        const stmt = db.prepare(`
            INSERT INTO settings (guild_id, key, value, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, key) DO UPDATE SET
                value = excluded.value,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
        `);
        
        stmt.run(guildId, 'pot_server_config', JSON.stringify(config), userId, Date.now());
    }

    /**
     * Obtém configurações do servidor PoT
     * @param {string} guildId - ID do servidor Discord
     * @returns {object|null} Configurações ou null se não existir
     */
    static getServerConfig(guildId) {
        const stmt = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`);
        const result = stmt.get(guildId, 'pot_server_config');
        
        if (!result) return null;
        
        try {
            return JSON.parse(result.value);
        } catch {
            return null;
        }
    }

    /**
     * Verifica se o servidor PoT está configurado
     * @param {string} guildId - ID do servidor Discord
     * @returns {boolean}
     */
    static isConfigured(guildId) {
        const config = this.getServerConfig(guildId);
        return config !== null && config.enabled === true;
    }

    // ==================== CANAIS DE LOG ====================
    
    /**
     * Define o canal de log geral para o PoT
     * @param {string} guildId - ID do servidor Discord
     * @param {string} channelId - ID do canal
     * @param {string} userId - ID do usuário que configurou
     */
    static setLogChannel(guildId, channelId, userId) {
        const stmt = db.prepare(`
            INSERT INTO settings (guild_id, key, value, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, key) DO UPDATE SET
                value = excluded.value,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
        `);
        
        stmt.run(guildId, 'pot_log_channel', channelId, userId, Date.now());
    }

    /**
     * Obtém o canal de log configurado
     * @param {string} guildId - ID do servidor Discord
     * @returns {string|null} ID do canal ou null
     */
    static getLogChannel(guildId) {
        const stmt = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`);
        const result = stmt.get(guildId, 'pot_log_channel');
        return result ? result.value : null;
    }

    /**
     * Define um canal específico para um tipo de log
     * @param {string} guildId - ID do servidor Discord
     * @param {string} logType - Tipo de log (ex: 'killed', 'chat', 'login')
     * @param {string} channelId - ID do canal
     * @param {string} userId - ID do usuário que configurou
     */
    static setSpecificLogChannel(guildId, logType, channelId, userId) {
        const stmt = db.prepare(`
            INSERT INTO settings (guild_id, key, value, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(guild_id, key) DO UPDATE SET
                value = excluded.value,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
        `);
        
        stmt.run(guildId, `pot_log_channel_${logType}`, channelId, userId, Date.now());
    }

    /**
     * Obtém um canal específico para um tipo de log
     * @param {string} guildId - ID do servidor Discord
     * @param {string} logType - Tipo de log
     * @returns {string|null} ID do canal ou null
     */
    static getSpecificLogChannel(guildId, logType) {
        const stmt = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`);
        const result = stmt.get(guildId, `pot_log_channel_${logType}`);
        return result ? result.value : null;
    }

    // ==================== WEBHOOKS ====================
    
    /**
     * Salva URL do webhook para um evento específico
     * @param {string} guildId - ID do servidor Discord
     * @param {string} event - Nome do evento (ex: 'login', 'killed')
     * @param {string} webhookUrl - URL do webhook do Discord
     */
    static setWebhookForEvent(guildId, event, webhookUrl) {
        const stmt = db.prepare(`
            INSERT INTO settings (guild_id, key, value, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(guild_id, key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
        `);
        stmt.run(guildId, `pot_webhook_${event}`, webhookUrl, Date.now());
    }

    /**
     * Obtém URL do webhook para um evento
     * @param {string} guildId - ID do servidor Discord
     * @param {string} event - Nome do evento
     * @returns {string|null} URL do webhook ou null
     */
    static getWebhookForEvent(guildId, event) {
        const stmt = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`);
        const result = stmt.get(guildId, `pot_webhook_${event}`);
        return result ? result.value : null;
    }

    /**
     * Salva todas as configurações de webhook de uma vez
     * @param {string} guildId - ID do servidor Discord
     * @param {object} configs - Objeto com pares evento -> webhookUrl
     */
    static setWebhookConfigs(guildId, configs) {
        const stmt = db.prepare(`
            INSERT INTO settings (guild_id, key, value, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(guild_id, key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
        `);
        
        for (const [event, url] of Object.entries(configs)) {
            if (url && url.trim() !== '') {
                stmt.run(guildId, `pot_webhook_${event}`, url, Date.now());
            }
        }
    }

    /**
     * Obtém todas as configurações de webhook para um servidor
     * @param {string} guildId - ID do servidor Discord
     * @returns {object} Objeto com todos os webhooks configurados
     */
    static getAllWebhookConfigs(guildId) {
        const stmt = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ? AND key LIKE 'pot_webhook_%'`);
        const results = stmt.all(guildId);
        
        const configs = {};
        for (const row of results) {
            const event = row.key.replace('pot_webhook_', '');
            configs[event] = row.value;
        }
        return configs;
    }

    // ==================== ENDPOINTS DO SERVIDOR ====================
    
    /**
     * Gera a URL base para webhooks do servidor PoT
     * @param {string} guildId - ID do servidor Discord
     * @returns {string|null} URL base ou null se não configurado
     */
    static getBaseWebhookUrl(guildId) {
        const config = this.getServerConfig(guildId);
        if (!config || !config.server_ip || !config.webhook_port) return null;
        return `http://${config.server_ip}:${config.webhook_port}`;
    }

    /**
     * Obtém URL completa para um endpoint específico
     * @param {string} guildId - ID do servidor Discord
     * @param {string} endpoint - Endpoint (ex: '/pot/login')
     * @returns {string|null} URL completa ou null
     */
    static getEndpointUrl(guildId, endpoint) {
        const baseUrl = this.getBaseWebhookUrl(guildId);
        if (!baseUrl) return null;
        return `${baseUrl}${endpoint}`;
    }

    /**
     * Obtém todas as URLs dos endpoints para o Game.ini
     * @param {string} guildId - ID do servidor Discord
     * @returns {object} Objeto com eventos e URLs
     */
    static getAllEndpointUrls(guildId) {
        const baseUrl = this.getBaseWebhookUrl(guildId);
        if (!baseUrl) return {};
        
        return {
            PlayerLogin: `${baseUrl}/pot/login`,
            PlayerLogout: `${baseUrl}/pot/login`,
            PlayerLeave: `${baseUrl}/pot/login`,
            PlayerKilled: `${baseUrl}/pot/killed`,
            PlayerDamagedPlayer: `${baseUrl}/pot/damaged`,
            PlayerJoinedGroup: `${baseUrl}/pot/group`,
            PlayerLeftGroup: `${baseUrl}/pot/group`,
            CreateNest: `${baseUrl}/pot/nest`,
            DestroyNest: `${baseUrl}/pot/nest`,
            NestInvite: `${baseUrl}/pot/nest`,
            PlayerQuestComplete: `${baseUrl}/pot/quest`,
            PlayerQuestFailed: `${baseUrl}/pot/quest`,
            PlayerRespawn: `${baseUrl}/pot/respawn`,
            PlayerWaystone: `${baseUrl}/pot/waystone`,
            PlayerChat: `${baseUrl}/pot/chat`,
            PlayerCommand: `${baseUrl}/pot/command`,
            AdminCommand: `${baseUrl}/pot/admin_command`,
            AdminSpectate: `${baseUrl}/pot/spectate`,
            ServerStart: `${baseUrl}/pot/server`,
            ServerRestart: `${baseUrl}/pot/server`,
            ServerRestartCountdown: `${baseUrl}/pot/server`,
            ServerError: `${baseUrl}/pot/error`,
            SecurityAlert: `${baseUrl}/pot/error`,
            PlayerHack: `${baseUrl}/pot/hack`,
            PlayerPurchase: `${baseUrl}/pot/purchase`,
            PlayerProfanity: `${baseUrl}/pot/profanity`
        };
    }

    // ==================== COMANDOS RCON ====================
    
    /**
     * Executa um comando RCON no servidor
     * @param {string} guildId - ID do servidor Discord
     * @param {string} command - Comando a ser executado
     * @returns {Promise<object>} Resultado da execução
     */
    static async executeRconCommand(guildId, command) {
        const { getInstance } = require('../integrations/pathoftitans');
        const potIntegration = getInstance(global.client);
        
        if (!potIntegration) {
            return { success: false, error: 'Integração não inicializada' };
        }
        
        return await potIntegration.executeCommand(guildId, command);
    }

    // ==================== UTILITÁRIOS ====================
    
    /**
     * Limpa todas as configurações do PoT para um servidor
     * @param {string} guildId - ID do servidor Discord
     */
    static clearAllConfigs(guildId) {
        const stmt = db.prepare(`DELETE FROM settings WHERE guild_id = ? AND key LIKE 'pot_%'`);
        stmt.run(guildId);
    }

    /**
     * Obtém estatísticas das configurações
     * @param {string} guildId - ID do servidor Discord
     * @returns {object} Estatísticas
     */
    static getStats(guildId) {
        const config = this.getServerConfig(guildId);
        const webhooks = this.getAllWebhookConfigs(guildId);
        const logChannel = this.getLogChannel(guildId);
        
        return {
            configured: config !== null,
            enabled: config?.enabled || false,
            server_ip: config?.server_ip || null,
            webhook_count: Object.keys(webhooks).length,
            log_channel: logChannel,
            has_rcon: !!(config?.rcon_password && config?.rcon_port)
        };
    }

    /**
     * Valida se as configurações são completas
     * @param {string} guildId - ID do servidor Discord
     * @returns {object} Resultado da validação
     */
    static validateConfig(guildId) {
        const config = this.getServerConfig(guildId);
        
        if (!config) {
            return { valid: false, missing: ['server_config'] };
        }
        
        const missing = [];
        
        if (!config.server_ip) missing.push('server_ip');
        if (!config.rcon_password) missing.push('rcon_password');
        if (!config.rcon_port) missing.push('rcon_port');
        if (!config.webhook_port) missing.push('webhook_port');
        
        return {
            valid: missing.length === 0 && config.enabled === true,
            missing,
            config
        };
    }
}

module.exports = PoTConfigSystem;