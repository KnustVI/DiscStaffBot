// /home/ubuntu/DiscStaffBot/src/systems/potConfigSystem.js
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
const ContainerFormatter = require('../utils/containerFormatter.js');

let EMOJIS = {};
try {
    const emojisFile = require('../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

class PoTConfigSystem {
    
    // ==================== SERVIDOR ====================
    
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

    static isConfigured(guildId) {
        const config = this.getServerConfig(guildId);
        return config !== null && config.enabled === true;
    }

    // ==================== CANAIS DE LOG ====================
    
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

    static getLogChannel(guildId) {
        const stmt = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`);
        const result = stmt.get(guildId, 'pot_log_channel');
        return result ? result.value : null;
    }

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

    static getSpecificLogChannel(guildId, logType) {
        const stmt = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`);
        const result = stmt.get(guildId, `pot_log_channel_${logType}`);
        return result ? result.value : null;
    }

    // ==================== WEBHOOKS ====================
    
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

    static getWebhookForEvent(guildId, event) {
        const stmt = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`);
        const result = stmt.get(guildId, `pot_webhook_${event}`);
        return result ? result.value : null;
    }

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
    
    static getBaseWebhookUrl(guildId) {
        const config = this.getServerConfig(guildId);
        if (!config || !config.server_ip || !config.webhook_port) return null;
        return `http://${config.server_ip}:${config.webhook_port}`;
    }

    static getEndpointUrl(guildId, endpoint) {
        const baseUrl = this.getBaseWebhookUrl(guildId);
        if (!baseUrl) return null;
        return `${baseUrl}${endpoint}`;
    }

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
    
    static async executeRconCommand(guildId, command) {
        const { getInstance } = require('../integrations/pathoftitans');
        const potIntegration = getInstance(global.client);
        
        if (!potIntegration) {
            return { success: false, error: 'Integração não inicializada' };
        }
        
        return await potIntegration.executeCommand(guildId, command);
    }

    // ==================== GERADORES DE CONTAINER ====================
    
    /**
     * Gera um container com o status da configuração do PoT
     * @param {string} guildId - ID do servidor Discord
     * @param {string} guildName - Nome do servidor
     * @returns {ContainerBuilderWrapper} Builder configurado
     */
    static getStatusContainer(guildId, guildName) {
        const config = this.getServerConfig(guildId);
        const stats = this.getStats(guildId);
        const logChannel = this.getLogChannel(guildId);
        
        const builder = ContainerFormatter.create(guildName, stats.enabled ? ContainerFormatter.colors.success : ContainerFormatter.colors.info);
        
        builder.addTitle(`${EMOJIS.Config || '⚙️'} Configuração Path of Titans`, 1);
        builder.addText(`Status da integração com o servidor PoT.`);
        builder.addSeparator();
        
        builder.addText(`${EMOJIS.Status || '📊'} **Status:** ${stats.enabled ? `${EMOJIS.Check || '✅'} Conectado` : `${EMOJIS.Error || '❌'} Desconectado`}`);
        
        if (config) {
            builder.addText(`${EMOJIS.global || '🌐'} **Servidor:** ${config.server_ip || `${EMOJIS.Error || '❌'} Não configurado`}`);
            builder.addText(`${EMOJIS.Config || '🔌'} **Portas:** RCON: ${config.rcon_port || 'N/A'} | Webhook: ${config.webhook_port || 'N/A'}`);
            builder.addText(`${EMOJIS.dashboard || '📝'} **Canal de Log:** ${logChannel ? `<#${logChannel}>` : `${EMOJIS.Error || '❌'} Não configurado`}`);
            
            const webhooks = this.getAllWebhookConfigs(guildId);
            builder.addText(`${EMOJIS.link || '🔗'} **Webhooks Configurados:** ${Object.keys(webhooks).length} evento(s)`);
            builder.addText(`${EMOJIS.rcon || '🖥️'} **RCON:** ${stats.has_rcon ? `${EMOJIS.Check || '✅'} Configurado` : `${EMOJIS.Error || '❌'} Não configurado`}`);
        } else {
            builder.addText(`\`\`\`\nNenhuma configuração encontrada. Use /pot-config para configurar.\n\`\`\``);
        }
        
        builder.addFooter();
        
        return builder;
    }
    
    /**
     * Gera um container com a lista de webhooks configurados
     * @param {string} guildId - ID do servidor Discord
     * @param {string} guildName - Nome do servidor
     * @returns {ContainerBuilderWrapper} Builder configurado
     */
    static getWebhooksContainer(guildId, guildName) {
        const webhooks = this.getAllWebhookConfigs(guildId);
        
        const builder = ContainerFormatter.create(guildName, ContainerFormatter.colors.info);
        builder.addTitle(`${EMOJIS.link || '🔗'} Webhooks Configurados`, 1);
        builder.addText(`Eventos que estão enviando dados para o bot.`);
        builder.addSeparator();
        
        if (Object.keys(webhooks).length === 0) {
            builder.addText(`\`\`\`\nNenhum webhook configurado.\n\`\`\``);
        } else {
            const eventIcons = {
                PlayerLogin: '🔐',
                PlayerLogout: '🚪',
                PlayerKilled: '💀',
                PlayerChat: '💬',
                PlayerCommand: '⌨️',
                PlayerQuestComplete: '📋',
                ServerStart: '🟢',
                ServerRestart: '🔄',
                ServerError: '⚠️'
            };
            
            for (const [event, url] of Object.entries(webhooks)) {
                const icon = eventIcons[event] || '📡';
                builder.addText(`${icon} **${event}:** ${url.length > 60 ? url.substring(0, 57) + '...' : url}`);
            }
        }
        
        builder.addFooter();
        
        return builder;
    }
    
    /**
     * Gera um container com as URLs dos endpoints para o Game.ini
     * @param {string} guildId - ID do servidor Discord
     * @param {string} guildName - Nome do servidor
     * @returns {ContainerBuilderWrapper} Builder configurado
     */
    static getEndpointsContainer(guildId, guildName) {
        const endpoints = this.getAllEndpointUrls(guildId);
        const config = this.getServerConfig(guildId);
        
        const builder = ContainerFormatter.create(guildName, ContainerFormatter.colors.info);
        
        builder.addTitle(`${EMOJIS.Config || '📝'} Endpoints para Game.ini`, 1);
        builder.addText(`Copie estas URLs para o arquivo \`Game.ini\` do seu servidor.`);
        builder.addSeparator();
        
        if (Object.keys(endpoints).length === 0) {
            builder.addText(`\`\`\`\nConfigure o servidor PoT primeiro usando /pot-config\n\`\`\``);
        } else {
            builder.addText(`\`\`\`ini\n[ServerWebhooks]\nbEnabled=true\nFormat="Discord"\n`);
            
            for (const [event, url] of Object.entries(endpoints)) {
                builder.addText(`${event}="${url}"`);
            }
            
            builder.addText(`\`\`\``);
        }
        
        builder.addFooter();
        
        return builder;
    }

    // ==================== UTILITÁRIOS ====================
    
    static clearAllConfigs(guildId) {
        const stmt = db.prepare(`DELETE FROM settings WHERE guild_id = ? AND key LIKE 'pot_%'`);
        stmt.run(guildId);
    }

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