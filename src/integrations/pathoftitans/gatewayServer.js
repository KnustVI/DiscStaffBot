// src/integrations/pathoftitans/gatewayServer.js
/**
 * Gateway Server - Padrão PotBot
 * 
 * Recebe eventos do servidor PoT e envia para os webhooks do Discord
 * NUNCA expõe IP real do bot
 */
const express = require('express');
const crypto = require('crypto');
const { EmbedBuilder } = require('discord.js');
const ErrorLogger = require('../../systems/errorLogger');
const PoTTokenManager = require('./tokenManager');

class PoTGatewayServer {
    constructor(client) {
        this.client = client;
        this.app = null;
        this.server = null;
        this.isRunning = false;
        this.webhooksCache = new Map(); // guildId -> { eventType: webhookUrl }
    }

    start(port = 8080) {
        if (this.isRunning) return;

        this.app = express();
        this.app.use(express.json());

        this.app.use((req, res, next) => {
            if (process.env.DEBUG_POT === 'true') {
                console.log(`📡 [Gateway] ${req.method} ${req.path} - IP: ${req.ip}`);
            }
            next();
        });

        this.app.use((req, res, next) => {
            if (req.path === '/health' || req.path === '/') {
                return next();
            }

            const token = req.query.token || req.headers['x-pot-token'];
            
            if (!token) {
                return res.status(401).json({ 
                    error: 'Token required',
                    hint: 'Add ?token=SEU_TOKEN to the URL'
                });
            }
            
            const guildId = PoTTokenManager.validateToken(token);
            
            if (!guildId) {
                return res.status(403).json({ error: 'Invalid token' });
            }
            
            req.guildId = guildId;
            req.token = token;
            next();
        });

        const potRouter = express.Router();

        potRouter.post('/login', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'login', req.body);
            res.json({ status: 'ok', event: 'login' });
        });

        potRouter.post('/damaged', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'damaged', req.body);
            res.json({ status: 'ok', event: 'damaged' });
        });

        potRouter.post('/killed', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'killed', req.body);
            res.json({ status: 'ok', event: 'killed' });
        });

        potRouter.post('/group', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'group', req.body);
            res.json({ status: 'ok', event: 'group' });
        });

        potRouter.post('/nest', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'nest', req.body);
            res.json({ status: 'ok', event: 'nest' });
        });

        potRouter.post('/quest', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'quest', req.body);
            res.json({ status: 'ok', event: 'quest' });
        });

        potRouter.post('/respawn', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'respawn', req.body);
            res.json({ status: 'ok', event: 'respawn' });
        });

        potRouter.post('/waystone', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'waystone', req.body);
            res.json({ status: 'ok', event: 'waystone' });
        });

        potRouter.post('/chat', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'chat', req.body);
            res.json({ status: 'ok', event: 'chat' });
        });

        potRouter.post('/command', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'command', req.body);
            res.json({ status: 'ok', event: 'command' });
        });

        potRouter.post('/admin_command', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'admin_command', req.body);
            res.json({ status: 'ok', event: 'admin_command' });
        });

        potRouter.post('/spectate', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'spectate', req.body);
            res.json({ status: 'ok', event: 'spectate' });
        });

        potRouter.post('/server', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'server', req.body);
            res.json({ status: 'ok', event: 'server' });
        });

        potRouter.post('/error', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'error', req.body);
            res.json({ status: 'ok', event: 'error' });
        });

        potRouter.post('/hack', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'hack', req.body);
            res.json({ status: 'ok', event: 'hack' });
        });

        potRouter.post('/purchase', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'purchase', req.body);
            res.json({ status: 'ok', event: 'purchase' });
        });

        potRouter.post('/profanity', async (req, res) => {
            await this._routeToDiscord(req.guildId, 'profanity', req.body);
            res.json({ status: 'ok', event: 'profanity' });
        });

        this.app.use('/pot', potRouter);

        this.app.get('/health', (req, res) => {
            res.json({ status: 'alive', version: '1.0.0', uptime: process.uptime() });
        });

        this.app.get('/', (req, res) => {
            res.json({
                name: 'PoT Discord Gateway',
                version: '1.0.0',
                endpoints: ['/pot/login', '/pot/killed', '/pot/chat', '/pot/group', '/pot/nest', '/pot/quest', '/pot/respawn', '/pot/waystone', '/pot/command', '/pot/admin_command', '/pot/spectate', '/pot/server', '/pot/error', '/pot/hack', '/pot/purchase', '/pot/profanity'],
                docs: 'Use /config-potserverlogs to setup channels'
            });
        });

        this.server = this.app.listen(port, '0.0.0.0', () => {
            this.isRunning = true;
            console.log(`🔒 [Gateway] Rodando na porta ${port} - Modo PotBot`);
            console.log(`🔐 [Gateway] Tokens obrigatórios para todas as requisições`);
        });

        this.server.on('error', (error) => {
            ErrorLogger.error('pot_gateway', 'server', error);
            this.isRunning = false;
        });
    }

    stop() {
        if (this.server) {
            this.server.close();
            this.isRunning = false;
        }
    }

    // ==================== ROTEAMENTO PARA DISCORD ====================
    // ✅ FIX: havia DOIS métodos `_routeToDiscord` nesta classe — em JS,
    // o segundo sobrescrevia o primeiro silenciosamente (sem erro), o que
    // é confuso e arriscado de manter. Consolidado em um só, com:
    //   1. Registro automático do jogador (potPlayerRegistry)
    //   2. Envio pro canal de log dedicado (potConfigSystem → setLogChannelForEvent)
    //   3. Envio pro webhook configurado (ou webhook geral de fallback)
    async _routeToDiscord(guildId, eventType, data) {
        try {
            // 1. Registrar jogador (login/logout/chat/killed/command/group)
            if (['login', 'logout', 'chat', 'killed', 'command', 'group'].includes(eventType)) {
                try {
                    const potPlayerRegistry = require('../../systems/potPlayerRegistry');
                    const registryEvent = eventType === 'logout' ? 'PlayerLogout' : eventType;
                    potPlayerRegistry.upsertPlayerFromEvent(guildId, data, registryEvent);
                } catch (registryError) {
                    console.warn('⚠️ [Gateway] Erro no registro do jogador:', registryError.message);
                }
            }

            // 2. Canal de log dedicado (mensagem formatada, postada pelo bot)
            await this._sendToLogChannel(guildId, eventType, data);

            // 3. Webhook configurado (raw POST do Discord, sem precisar do bot)
            const webhookUrl = await this._getWebhookForEvent(guildId, eventType);

            if (!webhookUrl) {
                const generalWebhook = await this._getGeneralWebhook(guildId);
                if (!generalWebhook) return;
                await this._sendToWebhook(generalWebhook, eventType, data);
                return;
            }

            await this._sendToWebhook(webhookUrl, eventType, data);

        } catch (error) {
            ErrorLogger.error('pot_gateway', 'route', error, { guildId, eventType });
        }
    }

    /**
     * Envia uma mensagem formatada (texto + embed quando aplicável) direto
     * pro canal de log dedicado do evento, via bot.send — independente de
     * webhook. Configurado pelo painel /potserver logs ("Criar Canal de Log").
     */
    async _sendToLogChannel(guildId, eventType, data) {
        try {
            const PoTConfigSystem = require('../../systems/potConfigSystem');
            const channelId = PoTConfigSystem.getLogChannelForEvent(guildId, eventType);
            if (!channelId) return;

            const channel = await this.client.channels.fetch(channelId).catch(() => null);
            if (!channel) return;

            const content = this._formatMessage(eventType, data);
            const embed = this._formatEmbed(eventType, data);
            const payload = embed ? { content, embeds: [embed] } : { content };

            await channel.send(payload);
        } catch (error) {
            ErrorLogger.warn('pot_gateway', 'sendLogChannel', error.message);
        }
    }

    async _getWebhookForEvent(guildId, eventType) {
        const cacheKey = `${guildId}:${eventType}`;
        
        if (this.webhooksCache.has(cacheKey)) {
            return this.webhooksCache.get(cacheKey);
        }
        
        const db = require('../../database/index');
        const stmt = db.prepare(`
            SELECT value FROM settings 
            WHERE guild_id = ? AND key = ?
        `);
        const result = stmt.get(guildId, `pot_webhook_${eventType}`);
        
        if (result && result.value) {
            this.webhooksCache.set(cacheKey, result.value);
            return result.value;
        }
        
        return null;
    }

    async _getGeneralWebhook(guildId) {
        const db = require('../../database/index');
        const stmt = db.prepare(`
            SELECT value FROM settings 
            WHERE guild_id = ? AND key = 'pot_general_webhook'
        `);
        const result = stmt.get(guildId);
        return result ? result.value : null;
    }

    async _sendToWebhook(webhookUrl, eventType, data) {
        const fetch = require('node-fetch');
        
        const content = this._formatMessage(eventType, data);
        const embed = this._formatEmbed(eventType, data);
        
        const payload = { content };
        if (embed) payload.embeds = [embed];
        
        try {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            ErrorLogger.warn('pot_gateway', 'sendWebhook', error.message);
        }
    }

    // ==================== FORMATAÇÃO DAS MENSAGENS ====================
    
    _formatMessage(eventType, data) {
        const formatters = {
            login: `🎮 **${data.PlayerName}** entrou no servidor${data.bServerAdmin ? ' 👑' : ''}`,
            logout: `👋 **${data.PlayerName}** saiu do servidor`,
            killed: `💀 **${data.VictimName}** foi morto por **${data.KillerName}** | ${data.DamageType}`,
            damaged: `💥 **${data.SourceName}** causou ${data.DamageAmount} de dano em **${data.TargetName}**`,
            chat: `💬 **${data.PlayerName}:** ${data.Message}`,
            group: data.Leader ? `👥 **${data.Player}** entrou no grupo de **${data.Leader}**` : `👥 **${data.Player}** saiu do grupo`,
            nest: `🪺 **${data.PlayerName}** ${data.NestHealth ? 'atualizou' : 'criou'} um ninho`,
            quest: `📜 **${data.PlayerName}** ${data.QuestRewardGrowth ? 'completou' : 'falhou'} a missão "${data.Quest}"`,
            respawn: `🔄 **${data.PlayerName}** ressurgiu como ${data.DinosaurType}`,
            waystone: `✨ **${data.InviterName}** invocou **${data.TeleportedPlayerName}**`,
            command: `⚡ **${data.PlayerName}:** ${data.Message}`,
            admin_command: `👑 **${data.AdminName}:** ${data.Command}`,
            spectate: `👁️ **${data.AdminName}** ${data.Action === 'Entered Spectator Mode' ? 'entrou no modo espectador' : 'saiu do modo espectador'}`,
            server: `🔄 Servidor ${data.Map ? 'iniciou' : 'reiniciou'}${data.Map ? ` | Mapa: ${data.Map}` : ''}`,
            error: `⚠️ **ERRO:** ${data.ErrorMesssage || data.SecurityAlert || 'Erro desconhecido'}`,
            hack: `🚨 **${data.PlayerName}** detectado como possível hacker (${data.EstimatedHackerProbability}%)`,
            purchase: `💰 **${data.PlayerName}** comprou ${data.SkinName || 'upgrade'} por ${data.Cost} marcos`,
            profanity: `🔞 **${data.PlayerName}** tentou mensagem bloqueada`
        };
        
        return formatters[eventType] || `📡 Evento: ${eventType}`;
    }

    _formatEmbed(eventType, data) {
        if (eventType === 'killed' && data) {
            return new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('💀 Morte')
                .addFields(
                    { name: 'Vítima', value: data.VictimName, inline: true },
                    { name: 'Assassino', value: data.KillerName, inline: true },
                    { name: 'Causa', value: data.DamageType, inline: true }
                )
                .setTimestamp();
        }
        
        if (eventType === 'login' && data.bServerAdmin) {
            return new EmbedBuilder()
                .setColor(0x00AAFF)
                .setTitle('👑 Admin Login')
                .setDescription(`${data.PlayerName} entrou no servidor (Admin)`)
                .setTimestamp();
        }
        
        return null;
    }
}

module.exports = PoTGatewayServer;