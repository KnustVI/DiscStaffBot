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
const ErrorLogger = require('../../systems/core/errorLogger');
const PoTTokenManager = require('./tokenManager');
const PoTConfigSystem = require('../../systems/pot/potConfigSystem');
const PlayerRegistry = require('../../systems/pot/potPlayerRegistry');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

// Eventos do grupo "login" que já ganharam o container novo (avatar/Discord
// vinculado, quando reconhecemos o jogador). Os demais grupos continuam no
// formato de texto simples por enquanto — reformulação prevista pra todos.
const CONTAINER_EVENTS = new Set(['PlayerLogin', 'PlayerLogout', 'PlayerLeave']);

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

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

        // ── type: () => true força o parse como JSON não importa o
        // Content-Type enviado. O servidor do jogo (motor Unreal) nem sempre
        // manda "application/json" certinho — sem isso, express.json() com
        // as opções padrão IGNORA o corpo silenciosamente (req.body vira
        // {}), e todo campo (PlayerName, AlderonId etc.) chega "undefined"
        // mesmo que o payload real esteja completo. ──────────────────────
        this.app.use(express.json({
            type: () => true,
            // Guarda o corpo bruto (antes de qualquer parse) pra diagnosticar
            // via DEBUG_POT=true — sem isso, um corpo que falha o parse vira
            // {} e nunca sabemos o que o servidor do jogo mandou de fato.
            verify: (req, res, buf) => {
                req.rawBody = buf && buf.length ? buf.toString('utf8') : '';
            },
        }));

        // Corpo que não é JSON válido (ex: o motor do jogo manda algo vazio
        // ou com formatação inesperada em algum evento) NUNCA deve derrubar
        // o evento — melhor seguir com body vazio (e os campos saem com
        // fallback) do que rejeitar a requisição inteira com 400 e o evento
        // nunca chegar no Discord.
        this.app.use((err, req, res, next) => {
            if (err?.type === 'entity.parse.failed') {
                if (process.env.DEBUG_POT === 'true') {
                    console.warn(`⚠️ [Gateway] Corpo não-JSON em ${req.method} ${req.path}, seguindo com body vazio:`, err.message);
                }
                req.body = {};
                return next();
            }
            next(err);
        });

        // ── Log de debug (ativar com DEBUG_POT=true no .env) ──────────────
        this.app.use((req, res, next) => {
            if (process.env.DEBUG_POT === 'true') {
                console.log(`📡 [Gateway] ${req.method} ${req.path} query=${JSON.stringify(req.query)} content-type=${req.headers['content-type'] || '-'} rawBody=${JSON.stringify(req.rawBody ?? '(vazio)')} parsedBody=${JSON.stringify(req.body)}`);
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
                    PlayerRegistry.upsertPlayerFromEvent(guildId, data, potEvent);
                } catch (err) {
                    console.warn('⚠️ [Gateway] Registro de jogador falhou:', err.message);
                }
            }

            // 2. Busca o webhook Discord configurado para este grupo
            const webhookUrl = PoTConfigSystem.getWebhookForGroup(guildId, groupId);
            if (!webhookUrl) return; // grupo não configurado, ignora silenciosamente

            // 3. Login/Logout/Leave já usam o container novo (Components V2);
            // os demais grupos continuam no formato antigo por enquanto.
            if (CONTAINER_EVENTS.has(potEvent)) {
                const payload = await this._buildLoginEventPayload(guildId, potEvent, data);
                await this._postJsonToWebhook(webhookUrl, payload);
                return;
            }

            const message = this._formatMessage(potEvent, data);
            const embed = this._formatEmbed(potEvent, data);
            await this._postToWebhook(webhookUrl, message, embed);

        } catch (error) {
            ErrorLogger.error('pot_gateway', 'routeToDiscord', error, { guildId, groupId, potEvent });
        }
    }

    // ==================== CONTAINER: LOGIN / LOGOUT / LEAVE ====================

    /**
     * Monta o container (Components V2) do evento de login/logout/leave.
     * Se o AlderonId já estiver vinculado a um Discord (via /registrar ou
     * webhook de login com DiscordId), mostra o usuário do Discord — avatar
     * e username — junto das informações do jogo.
     */
    async _buildLoginEventPayload(guildId, potEvent, data) {
        const d = data || {};

        const titles = {
            PlayerLogin:  `${EMOJIS.DinoFootprint || '🎮'} JOGADOR ENTROU`,
            PlayerLogout: `${EMOJIS.logout || '👋'} JOGADOR SAIU`,
            PlayerLeave:  `${EMOJIS.logout || '🚶'} JOGADOR DESCONECTOU`,
        };
        const color = potEvent === 'PlayerLogin' ? COLORS.SUCCESS : COLORS.DEFAULT;

        let discordUser = null;
        try {
            const linked = PlayerRegistry.getPlayerByAlderonId(guildId, d.AlderonId);
            if (linked?.discord_id) {
                discordUser = await this.client.users.fetch(linked.discord_id).catch(() => null);
            }
        } catch (err) {
            // sem vínculo encontrado — segue sem info de Discord
        }

        const guild = this.client.guilds.cache.get(guildId);
        const avatarUrl = discordUser?.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';

        const builder = new AdvancedContainerBuilder({ accentColor: color });
        builder.section(
            [
                `# ${titles[potEvent] || potEvent}`,
                `**${d.PlayerName || 'Desconhecido'}**`,
            ].join('\n'),
            AdvancedContainerBuilder.thumbnail(avatarUrl),
        );
        builder.separator();
        builder.text(`${EMOJIS.tv || '🖥️'} **Servidor:** ${d.ServerName || 'Desconhecido'}`);
        builder.text(`${EMOJIS.idcard || '🆔'} **Alderon ID:** \`${d.AlderonId || 'N/A'}\``);
        builder.text(`${EMOJIS.crown || '👑'} **Admin:** ${d.bServerAdmin ? 'Sim' : 'Não'}`);
        if (discordUser) {
            builder.separator();
            builder.text(`${EMOJIS.user || '👤'} **Discord:** ${discordUser.toString()} (\`${discordUser.tag}\`)`);
        }
        builder.footer(guild?.name || d.ServerName || 'Servidor');

        const { components, flags } = builder.build();
        return { components: components.map(c => c.toJSON()), flags };
    }

    async _postJsonToWebhook(webhookUrl, payload) {
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok && process.env.DEBUG_POT === 'true') {
                const text = await response.text();
                console.warn(`⚠️ [Gateway] Webhook (container) retornou ${response.status}: ${text.slice(0, 100)}`);
            }
        } catch (error) {
            ErrorLogger.warn('pot_gateway', 'postJsonToWebhook', error.message);
        }
    }

    async _postToWebhook(webhookUrl, content, embed = null) {
        try {
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
            PlayerLogin:   () => `${EMOJIS.DinoFootprint || '🎮'} **${d.PlayerName}** entrou no servidor${d.bServerAdmin ? ` ${EMOJIS.crown || '👑'}` : ''}`,
            PlayerLogout:  () => `${EMOJIS.logout || '👋'} **${d.PlayerName}** saiu do servidor`,
            PlayerLeave:   () => `${EMOJIS.logout || '🚶'} **${d.PlayerName}** desconectou`,

            // ── Combate ──
            PlayerKilled:        () => `${EMOJIS.Dead || '💀'} **${d.VictimName}** foi morto por **${d.KillerName}**\n${EMOJIS.build || '🔧'} Causa: \`${d.DamageType}\``,
            PlayerDamagedPlayer: () => `${EMOJIS.swords || '⚔️'} **${d.SourceName}** causou **${d.DamageAmount}** de dano em **${d.TargetName}**`,

            // ── Quest ──
            PlayerQuestComplete: () => `${EMOJIS.listchecks || '📜'} **${d.PlayerName}** completou a missão **${d.Quest}**`,
            PlayerQuestFailed:   () => `${EMOJIS.circlealert || '❌'} **${d.PlayerName}** falhou na missão **${d.Quest}**`,

            // ── Respawn ──
            PlayerRespawn:  () => `${EMOJIS.refreshccw || '🔄'} **${d.PlayerName}** ressurgiu como **${d.DinosaurType}**`,
            PlayerWaystone: () => `${EMOJIS.Waystone || '✨'} **${d.InviterName}** teletransportou **${d.TeleportedPlayerName}**`,

            // ── Chat ──
            PlayerChat:      () => `${EMOJIS.messagecircle || '💬'} **${d.PlayerName}:** ${d.Message}`,
            PlayerProfanity: () => `${EMOJIS.shieldban || '🔞'} **${d.PlayerName}** tentou enviar mensagem bloqueada`,

            // ── Comandos ──
            PlayerCommand: () => `${EMOJIS.raio || '⚡'} **${d.PlayerName}:** \`${d.Message}\``,

            // ── Grupo ──
            PlayerJoinedGroup: () => `${EMOJIS.users || '👥'} **${d.Player}** entrou no grupo de **${d.Leader}**`,
            PlayerLeftGroup:   () => `${EMOJIS.users || '👥'} **${d.Player}** saiu do grupo`,

            // ── Servidor ──
            ServerStart:             () => `🟢 Servidor **iniciou** | Mapa: \`${d.Map || 'desconhecido'}\``,
            ServerRestart:           () => `${EMOJIS.refreshccw || '🔄'} Servidor **reiniciando**...`,
            ServerRestartCountdown:  () => `${EMOJIS.clockalert || '⏳'} Servidor reinicia em **${d.CountdownTime || '?'}s**`,
            ServerModerate:          () => `${EMOJIS.shieldcheck || '🛡️'} Moderação automática: **${d.PlayerName}** — ${d.Reason || 'sem motivo'}`,
            ServerError:             () => `${EMOJIS.filewarning || '⚠️'} **ERRO:** ${d.ErrorMessage || d.ErrorMesssage || 'desconhecido'}`,
            SecurityAlert:           () => `${EMOJIS.siren || '🚨'} **ALERTA DE SEGURANÇA:** ${d.SecurityAlert || 'suspeita detectada'}`,
            BadAverageTick:          () => `${EMOJIS.trendingdown || '📉'} **PERFORMANCE:** Tick médio baixo (${d.AverageTick || '?'})`,

            // ── Admin ──
            AdminSpectate: () => `${EMOJIS.eye || '👁️'} **${d.AdminName}** ${d.Action === 'Entered Spectator Mode' ? 'entrou no modo espectador' : 'saiu do modo espectador'}`,
            AdminCommand:  () => `${EMOJIS.crown || '👑'} **${d.AdminName}** executou: \`${d.Command}\``,

            // ── Nest ──
            CreateNest:    () => `${EMOJIS.Nest || '🪺'} **${d.PlayerName}** criou um ninho`,
            DestroyNest:   () => `💥 Ninho de **${d.PlayerName}** foi destruído`,
            NestInvite:    () => `${EMOJIS.mensagem || '📨'} **${d.PlayerName}** convidou **${d.InvitedPlayer}** para o ninho`,
            PlayerJoinNest: () => `${EMOJIS.circlecheck || '✅'} **${d.PlayerName}** entrou em um ninho`,
            UpdateNest:    () => `${EMOJIS.filetext || '📝'} Ninho de **${d.PlayerName}** foi atualizado`,
        };

        const fn = formatters[potEvent];
        if (!fn) return `${EMOJIS.wifi || '📡'} Evento: \`${potEvent}\``;

        try {
            return fn();
        } catch (err) {
            return `${EMOJIS.wifi || '📡'} Evento: \`${potEvent}\` (dados incompletos)`;
        }
    }

    _formatEmbed(potEvent, data) {
        const d = data || {};

        // Embed extra apenas para eventos que ganham com contexto visual
        if (potEvent === 'PlayerKilled' && d.VictimName && d.KillerName) {
            return new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle(`${EMOJIS.Dead || '💀'} Morte em Combate`)
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
                .setTitle(`${EMOJIS.siren || '🚨'} ${potEvent === 'SecurityAlert' ? 'Alerta de Segurança' : 'Erro do Servidor'}`)
                .setDescription(d.ErrorMessage || d.SecurityAlert || 'Sem detalhes')
                .setTimestamp();
        }

        return null;
    }
}

module.exports = PoTGatewayServer;