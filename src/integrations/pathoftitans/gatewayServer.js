// src/integrations/pathoftitans/gatewayServer.js
/**
 * Gateway Server — recebe eventos do servidor PoT e repassa ao Discord.
 *
 * Fluxo:
 *   PoT Server → POST /pot/<grupo>?token=...&evt=NomeDoEvento
 *   → Gateway valida token → traduz o body → POST no webhook Discord do grupo
 *
 * O `?evt=` diz qual evento PoT específico chegou (ex: PlayerLogin, PlayerLogout),
 * mesmo que vários eventos compartilhem a mesma rota de grupo (/pot/login).
 */
const express = require('express');
const { EmbedBuilder } = require('discord.js');
const ErrorLogger = require('../../systems/errorLogger');
const PoTTokenManager = require('./tokenManager');
const PoTConfigSystem = require('../../systems/potConfigSystem');

const EVENT_GROUPS = PoTConfigSystem.EVENT_GROUPS;

class PoTGatewayServer {
    constructor(client) {
        this.client = client;
        this.app = null;
        this.server = null;
        this.isRunning = false;
    }

    start(port = 8080) {
        if (this.isRunning) return;

        this.app = express();
        this.app.use(express.json());

        // ── Log de debug (ativar com DEBUG_POT=true no .env) ──────────────
        this.app.use((req, res, next) => {
            if (process.env.DEBUG_POT === 'true') {
                console.log(`📡 [Gateway] ${req.method} ${req.path} evt=${req.query.evt || '-'}`);
            }
            next();
        });

        // ── Autenticação por token ─────────────────────────────────────────
        this.app.use((req, res, next) => {
            if (req.path === '/health' || req.path === '/') return next();

            const token = req.query.token || req.headers['x-pot-token'];
            if (!token) return res.status(401).json({ error: 'Token required' });

            const guildId = PoTTokenManager.validateToken(token);
            if (!guildId) return res.status(403).json({ error: 'Invalid token' });

            req.guildId = guildId;
            next();
        });

        // ── Rotas — uma por grupo de eventos ──────────────────────────────
        const potRouter = express.Router();

        for (const group of EVENT_GROUPS) {
            potRouter.post(`/${group.route}`, async (req, res) => {
                const potEvent = req.query.evt || group.iniEvents[0];
                await this._routeToDiscord(req.guildId, group.id, potEvent, req.body);
                res.json({ status: 'ok', group: group.id, evt: potEvent });
            });
        }

        this.app.use('/pot', potRouter);

        this.app.get('/health', (req, res) => {
            res.json({ status: 'alive', uptime: process.uptime() });
        });

        this.app.get('/', (req, res) => {
            res.json({
                name: 'PoT Discord Gateway',
                groups: EVENT_GROUPS.map(g => ({ id: g.id, route: `/pot/${g.route}`, events: g.iniEvents }))
            });
        });

        this.server = this.app.listen(port, '0.0.0.0', () => {
            this.isRunning = true;
            console.log(`🔒 [Gateway] Rodando na porta ${port}`);
            console.log(`📋 [Gateway] ${EVENT_GROUPS.length} grupos de eventos registrados`);
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

    // ==================== ROTEAMENTO PRINCIPAL ====================

    async _routeToDiscord(guildId, groupId, potEvent, data) {
        try {
            // 1. Registro automático do jogador nos eventos relevantes
            const playerEvents = ['PlayerLogin', 'PlayerLogout', 'PlayerLeave', 'PlayerKilled', 'PlayerChat', 'PlayerCommand'];
            if (playerEvents.includes(potEvent)) {
                try {
                    const registry = require('../../systems/potPlayerRegistry');
                    registry.upsertPlayerFromEvent(guildId, data, potEvent);
                } catch (err) {
                    console.warn('⚠️ [Gateway] Registro de jogador falhou:', err.message);
                }
            }

            // 2. Busca o webhook Discord configurado para este grupo
            const webhookUrl = PoTConfigSystem.getWebhookForGroup(guildId, groupId);
            if (!webhookUrl) return; // grupo não configurado, ignora silenciosamente

            // 3. Traduz e posta no webhook Discord
            const message = this._formatMessage(potEvent, data);
            const embed = this._formatEmbed(potEvent, data);
            await this._postToWebhook(webhookUrl, message, embed);

        } catch (error) {
            ErrorLogger.error('pot_gateway', 'routeToDiscord', error, { guildId, groupId, potEvent });
        }
    }

    async _postToWebhook(webhookUrl, content, embed = null) {
        try {
            const fetch = require('node-fetch');
            const payload = { content };
            if (embed) payload.embeds = [embed.toJSON()];

            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok && process.env.DEBUG_POT === 'true') {
                const text = await response.text();
                console.warn(`⚠️ [Gateway] Webhook retornou ${response.status}: ${text.slice(0, 100)}`);
            }
        } catch (error) {
            ErrorLogger.warn('pot_gateway', 'postToWebhook', error.message);
        }
    }

    // ==================== FORMATAÇÃO POR EVENTO ====================

    _formatMessage(potEvent, data) {
        const d = data || {};

        const formatters = {
            // ── Login / Logout ──
            PlayerLogin:   () => `🎮 **${d.PlayerName}** entrou no servidor${d.bServerAdmin ? ' 👑' : ''}`,
            PlayerLogout:  () => `👋 **${d.PlayerName}** saiu do servidor`,
            PlayerLeave:   () => `🚶 **${d.PlayerName}** desconectou`,

            // ── Combate ──
            PlayerKilled:        () => `💀 **${d.VictimName}** foi morto por **${d.KillerName}**\n🔧 Causa: \`${d.DamageType}\``,
            PlayerDamagedPlayer: () => `⚔️ **${d.SourceName}** causou **${d.DamageAmount}** de dano em **${d.TargetName}**`,

            // ── Quest ──
            PlayerQuestComplete: () => `📜 **${d.PlayerName}** completou a missão **${d.Quest}**`,
            PlayerQuestFailed:   () => `❌ **${d.PlayerName}** falhou na missão **${d.Quest}**`,

            // ── Respawn ──
            PlayerRespawn:  () => `🔄 **${d.PlayerName}** ressurgiu como **${d.DinosaurType}**`,
            PlayerWaystone: () => `✨ **${d.InviterName}** teletransportou **${d.TeleportedPlayerName}**`,

            // ── Chat ──
            PlayerChat:      () => `💬 **${d.PlayerName}:** ${d.Message}`,
            PlayerProfanity: () => `🔞 **${d.PlayerName}** tentou enviar mensagem bloqueada`,

            // ── Comandos ──
            PlayerCommand: () => `⚡ **${d.PlayerName}:** \`${d.Message}\``,

            // ── Grupo ──
            PlayerJoinedGroup: () => `👥 **${d.Player}** entrou no grupo de **${d.Leader}**`,
            PlayerLeftGroup:   () => `👥 **${d.Player}** saiu do grupo`,

            // ── Servidor ──
            ServerStart:             () => `🟢 Servidor **iniciou** | Mapa: \`${d.Map || 'desconhecido'}\``,
            ServerRestart:           () => `🔄 Servidor **reiniciando**...`,
            ServerRestartCountdown:  () => `⏳ Servidor reinicia em **${d.CountdownTime || '?'}s**`,
            ServerModerate:          () => `🛡️ Moderação automática: **${d.PlayerName}** — ${d.Reason || 'sem motivo'}`,
            ServerError:             () => `⚠️ **ERRO:** ${d.ErrorMessage || d.ErrorMesssage || 'desconhecido'}`,
            SecurityAlert:           () => `🚨 **ALERTA DE SEGURANÇA:** ${d.SecurityAlert || 'suspeita detectada'}`,
            BadAverageTick:          () => `📉 **PERFORMANCE:** Tick médio baixo (${d.AverageTick || '?'})`,

            // ── Admin ──
            AdminSpectate: () => `👁️ **${d.AdminName}** ${d.Action === 'Entered Spectator Mode' ? 'entrou no modo espectador' : 'saiu do modo espectador'}`,
            AdminCommand:  () => `👑 **${d.AdminName}** executou: \`${d.Command}\``,

            // ── Nest ──
            CreateNest:    () => `🪺 **${d.PlayerName}** criou um ninho`,
            DestroyNest:   () => `💥 Ninho de **${d.PlayerName}** foi destruído`,
            NestInvite:    () => `📨 **${d.PlayerName}** convidou **${d.InvitedPlayer}** para o ninho`,
            PlayerJoinNest: () => `✅ **${d.PlayerName}** entrou em um ninho`,
            UpdateNest:    () => `📝 Ninho de **${d.PlayerName}** foi atualizado`,
        };

        const fn = formatters[potEvent];
        if (!fn) return `📡 Evento: \`${potEvent}\``;

        try {
            return fn();
        } catch (err) {
            return `📡 Evento: \`${potEvent}\` (dados incompletos)`;
        }
    }

    _formatEmbed(potEvent, data) {
        const d = data || {};

        // Embed extra apenas para eventos que ganham com contexto visual
        if (potEvent === 'PlayerKilled' && d.VictimName && d.KillerName) {
            return new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('💀 Morte em Combate')
                .addFields(
                    { name: 'Vítima', value: d.VictimName, inline: true },
                    { name: 'Assassino', value: d.KillerName, inline: true },
                    { name: 'Causa', value: d.DamageType || 'Desconhecida', inline: true }
                )
                .setTimestamp();
        }

        if (potEvent === 'ServerError' || potEvent === 'SecurityAlert') {
            return new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle(`🚨 ${potEvent === 'SecurityAlert' ? 'Alerta de Segurança' : 'Erro do Servidor'}`)
                .setDescription(d.ErrorMessage || d.SecurityAlert || 'Sem detalhes')
                .setTimestamp();
        }

        return null;
    }
}

module.exports = PoTGatewayServer;