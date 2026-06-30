/**
 * potConfigSystem.js
 * 
 * Extensão do sistema de configuração para Path of Titans
 * NÃO modifica o ConfigSystem original - apenas adiciona funcionalidades
 * 
 * Gerencia:
 * - Configurações do servidor PoT (IP, RCON, portas)
 * - Webhooks por evento
 * - Canais de log dedicados por evento (mensagens formatadas pelo bot)
 * - URLs dos endpoints
 */
const db = require('../database/index');
const { AdvancedContainerBuilder } = require('../utils/containerBuilder');

// Carregar emojis
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

    /**
     * Remove um webhook específico do banco
     * @param {string} guildId - ID do servidor
     * @param {string} event - Nome do evento (login, killed, etc.)
     */
    static removeWebhook(guildId, event) {
        const stmt = db.prepare(`
            DELETE FROM settings 
            WHERE guild_id = ? AND key = ?
        `);
        stmt.run(guildId, `pot_webhook_${event}`);
    }

    /**
     * Remove todos os webhooks de um servidor
     * @param {string} guildId - ID do servidor
     */
    static removeAllWebhooks(guildId) {
        const stmt = db.prepare(`
            DELETE FROM settings 
            WHERE guild_id = ? AND key LIKE 'pot_webhook_%'
        `);
        stmt.run(guildId);
    }

    // ==================== CANAIS DE LOG (por evento) ====================
    //
    // ✅ NOVO: distinto do webhook. O webhook recebe o POST bruto do
    // servidor PoT (configurado no Game.ini). O canal de log aqui é onde
    // o PRÓPRIO BOT posta mensagens já formatadas (via gatewayServer →
    // _sendToLogChannel), útil pra quem quer ver os eventos dentro do
    // Discord sem depender só do webhook cru.

    static setLogChannelForEvent(guildId, event, channelId) {
        const stmt = db.prepare(`
            INSERT INTO settings (guild_id, key, value, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(guild_id, key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
        `);
        stmt.run(guildId, `pot_logchannel_${event}`, channelId, Date.now());
    }

    static getLogChannelForEvent(guildId, event) {
        const stmt = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`);
        const result = stmt.get(guildId, `pot_logchannel_${event}`);
        return result ? result.value : null;
    }

    static getAllLogChannels(guildId) {
        const stmt = db.prepare(`SELECT key, value FROM settings WHERE guild_id = ? AND key LIKE 'pot_logchannel_%'`);
        const results = stmt.all(guildId);

        const channels = {};
        for (const row of results) {
            const event = row.key.replace('pot_logchannel_', '');
            channels[event] = row.value;
        }
        return channels;
    }

    static removeLogChannelForEvent(guildId, event) {
        const stmt = db.prepare(`DELETE FROM settings WHERE guild_id = ? AND key = ?`);
        stmt.run(guildId, `pot_logchannel_${event}`);
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

    /**
     * Reseta configurações específicas do servidor
     * @param {string} guildId - ID do servidor
     * @param {string} scope - 'server' | 'logs' | 'all'
     */
    static resetConfig(guildId, scope) {
        switch(scope) {
            case 'server':
                const stmtServer = db.prepare(`
                    DELETE FROM settings 
                    WHERE guild_id = ? AND key = 'pot_server_config'
                `);
                stmtServer.run(guildId);
                break;

            case 'logs':
                this.removeAllWebhooks(guildId);
                break;

            case 'all':
                this.clearAllConfigs(guildId);
                break;

            default:
                throw new Error(`Escopo de reset inválido: ${scope}`);
        }
    }

    /**
     * Verifica se um webhook específico existe e está configurado
     */
    static getWebhookStatus(guildId, event) {
        const url = this.getWebhookForEvent(guildId, event);
        return {
            configured: !!url && url.trim() !== '',
            url: url || null,
            event: event
        };
    }

    static getAllWebhooksStatus(guildId) {
        const allWebhooks = this.getAllWebhookConfigs(guildId);
        const status = {};
        
        const events = [
            'login', 'killed', 'chat', 'group', 'nest', 
            'quest', 'respawn', 'waystone', 'command', 
            'admin_command', 'error'
        ];
        
        for (const event of events) {
            status[event] = {
                configured: !!allWebhooks[event],
                url: allWebhooks[event] || null,
                event: event
            };
        }
        
        return status;
    }

    static countConfiguredWebhooks(guildId) {
        const webhooks = this.getAllWebhookConfigs(guildId);
        return Object.keys(webhooks).length;
    }

    static getFullStatus(guildId) {
        const config = this.getServerConfig(guildId);
        const webhooks = this.getAllWebhookConfigs(guildId);
        
        return {
            configured: config !== null && config.enabled === true,
            server: config ? {
                ip: config.server_ip || null,
                rcon_port: config.rcon_port || null,
                webhook_port: config.webhook_port || null,
                enabled: config.enabled || false
            } : null,
            webhooks: {
                total: Object.keys(webhooks).length,
                events: Object.keys(webhooks),
                urls: webhooks
            },
            hasRcon: config ? !!(config.rcon_password && config.rcon_port) : false,
            hasWebhooks: Object.keys(webhooks).length > 0
        };
    }

    static getQuickStatusContainer(guildId, guildName, gatewayStats = null, tokenStats = null) {
        const status = this.getFullStatus(guildId);
        const builder = new AdvancedContainerBuilder({ 
            accentColor: status.configured ? 0x00AAFF : 0xFFA500 
        });

        builder
            .title('📊 Status do Servidor Path of Titans')
            .text('Resumo da integração com seu servidor PoT.')
            .separator();

        if (status.configured) {
            builder.text(`✅ **Servidor:** ${status.server.ip}`);
            builder.text(`🔌 **Porta RCON:** ${status.server.rcon_port}`);
            builder.text(`📨 **Webhooks:** ${status.webhooks.total} configurados`);
            
            if (gatewayStats) {
                builder.text(`🔒 **Gateway:** ${gatewayStats.gatewayRunning ? '✅ Rodando' : '❌ Parado'}`);
            }
            
            if (tokenStats) {
                builder.text(`📊 **Usos do Token:** ${tokenStats.usage_count || 0} requisições`);
                if (tokenStats.last_used) {
                    builder.text(`🕐 **Último uso:** <t:${Math.floor(tokenStats.last_used / 1000)}:R>`);
                }
            }
        } else {
            builder.text('❌ **Servidor:** Não configurado');
            builder.text('Use `/potserver setup` para configurar');
        }

        builder.separator();
        
        if (!status.configured) {
            builder.text('💡 **Dica:** Use `/potserver setup` para configurar o servidor.');
        } else if (status.webhooks.total === 0) {
            builder.text('💡 **Dica:** Use `/potserver logs` para criar os webhooks.');
        } else {
            builder.text('✅ **Tudo pronto!** O servidor está integrado com o bot.');
        }

        builder.footer(guildName);
        return builder;
    }

    // ==================== GERADORES DE CONTAINER ====================
    
    static getStatusContainer(guildId, guildName) {
        const config = this.getServerConfig(guildId);
        const stats = this.getStats(guildId);
        
        const builder = new AdvancedContainerBuilder({
            accentColor: stats.enabled ? 0xBBF96A : 0xDCA15E,
        });
        
        builder
            .title(`${EMOJIS.Config || '⚙️'} Configuração Path of Titans`)
            .text('Status da integração com o servidor PoT.')
            .separator()
            .text(`${EMOJIS.Status || '📊'} **Status:** ${stats.enabled ? `${EMOJIS.Check || '✅'} Conectado` : `${EMOJIS.Error || '❌'} Desconectado`}`);
        
        if (config) {
            const webhooks = this.getAllWebhookConfigs(guildId);
            const webhookCount = Object.keys(webhooks).length;

            builder.block([
                `${EMOJIS.global   || '🌐'} **Servidor:** ${config.server_ip || `${EMOJIS.Error || '❌'} Não configurado`}`,
                `${EMOJIS.Config   || '🔌'} **Portas:** RCON: ${config.rcon_port || 'N/A'} | Webhook: ${config.webhook_port || 'N/A'}`,
                `${EMOJIS.link     || '🔗'} **Webhooks Configurados:** ${webhookCount} evento(s) ativo(s)`,
                `${EMOJIS.rcon     || '🖥️'} **RCON:** ${stats.has_rcon ? `${EMOJIS.Check || '✅'} Configurado` : `${EMOJIS.Error || '❌'} Não configurado`}`,
            ]);
        } else {
            builder.text('```\nNenhuma configuração encontrada. Use /potserver setup para configurar.\n```');
        }
        
        builder.footer(guildName);
        
        return builder;
    }
    
    static getEndpointsContainer(guildId, guildName) {
        const endpoints = this.getAllEndpointUrls(guildId);
        
        const builder = new AdvancedContainerBuilder({ accentColor: 0xDCA15E })
            .title(`${EMOJIS.Config || '📝'} Endpoints para Game.ini`)
            .text('Copie estas URLs para o arquivo `Game.ini` do seu servidor.')
            .separator();
        
        if (Object.keys(endpoints).length === 0) {
            builder.text('```\nConfigure o servidor PoT primeiro usando /potserver setup\n```');
        } else {
            const lines = [
                '```ini',
                '[ServerWebhooks]',
                'bEnabled=true',
                'Format="Discord"',
                '',
                ...Object.entries(endpoints).map(([event, url]) => `${event}="${url}"`),
                '```',
            ];
            builder.text(lines.join('\n'));
        }
        
        builder.footer(guildName);
        
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
        
        return {
            configured: config !== null,
            enabled: config?.enabled || false,
            server_ip: config?.server_ip || null,
            webhook_count: Object.keys(webhooks).length,
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