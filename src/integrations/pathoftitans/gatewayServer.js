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
const ErrorLogger = require('../../systems/core/errorLogger');
const PoTTokenManager = require('./tokenManager');
const PoTConfigSystem = require('../../systems/pot/potConfigSystem');
const PlayerRegistry = require('../../systems/pot/potPlayerRegistry');
const WebhookPayloads = require('./webhookPayloads');

// Eventos do grupo "login" que já ganharam o container novo (avatar/Discord
// vinculado, quando reconhecemos o jogador). Os demais grupos continuam no
// formato de texto simples por enquanto — reformulação prevista pra todos.
const CONTAINER_EVENTS = new Set(['PlayerLogin', 'PlayerLogout', 'PlayerLeave']);

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
        // Só o essencial pra confirmar que o evento chegou e foi entendido —
        // rawBody completo só quando o parse falhar (fields vazio), que é
        // quando ele realmente ajuda a diagnosticar.
        this.app.use((req, res, next) => {
            if (process.env.DEBUG_POT === 'true') {
                const fieldCount = Object.keys(req.body || {}).length;
                const evt = req.query.evt || '-';
                if (fieldCount > 0) {
                    console.log(`📡 [Gateway] ${req.method} ${req.path} evt=${evt} (${fieldCount} campos recebidos)`);
                } else {
                    console.log(`📡 [Gateway] ${req.method} ${req.path} evt=${evt} — corpo vazio/não reconhecido. rawBody=${JSON.stringify(req.rawBody ?? '(vazio)')}`);
                }
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

    // ==================== NORMALIZAÇÃO Format="Discord" ====================

    /**
     * Se o payload já vier no formato pronto-pra-webhook (Format="Discord"
     * no Game.ini), extrai os pares "**Chave:** valor" de embeds[0].description
     * e devolve como objeto plano — mesma forma que Format="General" produz
     * (AlderonId, PlayerName, ServerName, bServerAdmin, DiscordId, etc.).
     * Retorna null se o payload não tiver essa forma (assumido Format="General").
     */
    _extractFieldsFromDiscordFormat(rawBody) {
        const description = rawBody?.embeds?.[0]?.description;
        if (typeof description !== 'string' || !description.trim()) return null;

        const fields = {};
        const lineRegex = /\*\*([^*:]+):\*\*[ \t]*(.*)/g;
        let match;
        while ((match = lineRegex.exec(description)) !== null) {
            const key = match[1].trim();
            const rawValue = match[2].trim();
            if (rawValue === 'true') fields[key] = true;
            else if (rawValue === 'false') fields[key] = false;
            else if (rawValue === '') fields[key] = null;
            else fields[key] = rawValue;
        }
        return Object.keys(fields).length > 0 ? fields : null;
    }

    // ==================== ROTEAMENTO PRINCIPAL ====================

    async _routeToDiscord(guildId, groupId, potEvent, rawData) {
        try {
            // 0. O Game.ini pode estar configurado com Format="Discord" — nesse
            // modo o servidor manda um payload já pronto pra postar direto num
            // webhook ({content, username, embeds:[{description: "**Chave:**
            // valor\n..."}]}), em vez de campos soltos (Format="General", o
            // que o resto do código espera). Normaliza pra sempre trabalhar
            // com campos soltos daqui pra frente. ──────────────────────────
            const data = this._extractFieldsFromDiscordFormat(rawData) || rawData;

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
            // Construção das mensagens fica em webhookPayloads.js — edite lá.
            if (CONTAINER_EVENTS.has(potEvent)) {
                const payload = await WebhookPayloads.buildLoginEventPayload(this.client, guildId, potEvent, data);
                await this._postJsonToWebhook(webhookUrl, payload);
                return;
            }

            const guild = this.client.guilds.cache.get(guildId);
            const message = WebhookPayloads.formatMessage(potEvent, data, guild);
            const embed = WebhookPayloads.formatEmbed(potEvent, data, guild);
            await this._postToWebhook(webhookUrl, message, embed);

        } catch (error) {
            ErrorLogger.error('pot_gateway', 'routeToDiscord', error, { guildId, groupId, potEvent });
        }
    }

    /**
     * URLs de webhook copiadas da interface do Discord (Configurações do
     * Canal → Integrações) não têm versão de API no caminho
     * (discord.com/api/webhooks/...). Força /v10/ por segurança/consistência
     * — isso sozinho NÃO resolve o 50006 (ver _postJsonToWebhook). */
    _withApiVersion(webhookUrl) {
        try {
            const url = new URL(webhookUrl);
            if (/^discord(app)?\.com$/.test(url.hostname) && !/^\/api\/v\d+\//.test(url.pathname)) {
                url.pathname = url.pathname.replace(/^\/api\//, '/api/v10/');
            }
            return url.toString();
        } catch {
            return webhookUrl;
        }
    }

    /**
     * A causa real do 50006 "Cannot send an empty message": um webhook comum
     * de canal (criado em Integrações) NÃO é "application-owned". Pra esses,
     * o Discord IGNORA o campo `components` da mensagem a menos que a
     * requisição inclua `?with_components=true` na URL — e como não mandamos
     * `content`/`embeds` (só components), depois de ignorado não sobra nada,
     * daí o erro. Doc: https://docs.discord.com/developers/resources/webhook
     * (Execute Webhook, query param with_components). */
    async _postJsonToWebhook(webhookUrl, payload) {
        try {
            const url = new URL(this._withApiVersion(webhookUrl));
            url.searchParams.set('with_components', 'true');

            const response = await fetch(url.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const text = await response.text();
                if (process.env.DEBUG_POT === 'true') {
                    console.warn(`⚠️ [Gateway] Webhook (container) retornou ${response.status}: ${text.slice(0, 200)} | payload enviado: ${JSON.stringify(payload).slice(0, 300)}`);
                }
                ErrorLogger.warn('pot_gateway', 'postJsonToWebhook', `HTTP ${response.status}: ${text.slice(0, 200)}`);
            }
        } catch (error) {
            ErrorLogger.warn('pot_gateway', 'postJsonToWebhook', error.message);
        }
    }

    async _postToWebhook(webhookUrl, content, embed = null) {
        try {
            const payload = { content };
            if (embed) payload.embeds = [embed.toJSON()];

            const response = await fetch(this._withApiVersion(webhookUrl), {
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

}

module.exports = PoTGatewayServer;