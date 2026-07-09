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

// Janela de agrupamento de PlayerDamagedPlayer: cada golpe entre o mesmo par
// atacante/alvo reinicia esse tempo — o relatório só é enviado depois de
// ficar esse tanto sem NOVO golpe entre os dois (não é uma janela fixa),
// pra cobrir o combate/afogamento inteiro, não cortar no meio. Ver
// _bufferDamageEvent/_flushDamageBatchByKey.
const DAMAGE_BATCH_IDLE_MS = 5 * 60 * 1000;

class PoTGatewayServer {
    constructor(client) {
        this.client = client;
        this.app = null;
        this.server = null;
        this.isRunning = false;
        // Map<string, { guildId, groupId, sourceName, sourceAlderonId,
        //   targetName, targetAlderonId, hits: [{damageType, damageAmount}],
        //   firstAt, timer }>
        this.damageBatches = new Map();
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
        for (const batch of this.damageBatches.values()) {
            if (batch.timer) clearTimeout(batch.timer);
        }
        this.damageBatches.clear();
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
            // PlayerRespawn carrega DinosaurType/DinosaurGrowth (espécie/growth
            // atuais, mostrados no card do /perfil) — sem isso na lista, esses
            // dois campos nunca eram atualizados.
            const playerEvents = ['PlayerLogin', 'PlayerLogout', 'PlayerLeave', 'PlayerKilled', 'PlayerChat', 'PlayerCommand', 'PlayerRespawn'];
            if (playerEvents.includes(potEvent)) {
                try {
                    PlayerRegistry.upsertPlayerFromEvent(guildId, data, potEvent);
                } catch (err) {
                    console.warn('⚠️ [Gateway] Registro de jogador falhou:', err.message);
                }
            }

            // 1b. PlayerKilled identifica matador/vítima por KillerAlderonId/
            // VictimAlderonId (não por "AlderonId" like os demais eventos), então
            // kills/deaths são contabilizados à parte, não pelo upsert genérico acima.
            if (potEvent === 'PlayerKilled') {
                try {
                    PlayerRegistry.recordKillEvent(guildId, data);
                } catch (err) {
                    console.warn('⚠️ [Gateway] Contagem de kill/death falhou:', err.message);
                }
                // A morte encerra o combate entre os dois — manda o relatório
                // de dano acumulado (se houver) na hora, em vez de esperar o
                // resto da janela de inatividade.
                this._flushDamageBatchesForPair(
                    guildId,
                    data.KillerAlderonId || data.KillerName,
                    data.VictimAlderonId || data.VictimName,
                );
            }

            // 2. Busca o webhook Discord configurado para este grupo
            const webhookUrl = PoTConfigSystem.getWebhookForGroup(guildId, groupId);
            if (!webhookUrl) return; // grupo não configurado, ignora silenciosamente

            // 2b. PlayerDamagedPlayer nunca é enviado na hora — combates e
            // dano contínuo (afogamento, fome...) mandam um evento por golpe,
            // e isso flooda o canal de log. Em vez disso, acumula por par
            // atacante/alvo e manda UM relatório depois de um tempo sem novo
            // golpe entre os dois (ver _bufferDamageEvent). ──────────────────
            if (potEvent === 'PlayerDamagedPlayer') {
                this._bufferDamageEvent(guildId, groupId, data);
                return;
            }

            // 3. Login/Logout/Leave já usam o container novo (Components V2);
            // os demais grupos continuam no formato antigo por enquanto.
            // Construção das mensagens fica em webhookPayloads.js — edite lá.
            if (CONTAINER_EVENTS.has(potEvent)) {
                const payload = await WebhookPayloads.buildLoginEventPayload(this.client, guildId, potEvent, data);
                await this._deliverMessage(webhookUrl, payload);
                return;
            }

            const guild = this.client.guilds.cache.get(guildId);
            const message = WebhookPayloads.formatMessage(potEvent, data, guild);
            const embed = WebhookPayloads.formatEmbed(potEvent, data, guild);
            const payload = { content: message };
            if (embed) payload.embeds = [embed.toJSON()];
            await this._deliverMessage(webhookUrl, payload);

        } catch (error) {
            ErrorLogger.error('pot_gateway', 'routeToDiscord', error, { guildId, groupId, potEvent });
        }
    }

    // ==================== RELATÓRIO DE DANO/COMBATE (batching) ====================

    /**
     * Acumula um golpe de PlayerDamagedPlayer no lote do par atacante/alvo
     * (identificados por Alderon ID quando disponível, senão pelo nome) e
     * (re)inicia o timer de inatividade — cada novo golpe entre os mesmos
     * dois adia o envio, então o relatório só sai quando o combate/dano
     * realmente parar (ou quando um dos dois morrer, ver
     * _flushDamageBatchesForPair).
     */
    _bufferDamageEvent(guildId, groupId, data) {
        const sourceKey = data.SourceAlderonId || data.SourceName || 'desconhecido';
        const targetKey = data.TargetAlderonId || data.TargetName || 'desconhecido';
        const key = `${guildId}:${sourceKey}->${targetKey}`;

        let batch = this.damageBatches.get(key);
        if (!batch) {
            batch = {
                guildId, groupId,
                sourceName: data.SourceName || 'Desconhecido',
                sourceAlderonId: data.SourceAlderonId || null,
                targetName: data.TargetName || 'Desconhecido',
                targetAlderonId: data.TargetAlderonId || null,
                hits: [],
                firstAt: Date.now(),
                timer: null,
            };
            this.damageBatches.set(key, batch);
        }

        // DamageAmount pode chegar como float do motor do jogo (ex: 9.999998)
        // — arredonda pra inteiro, que é como dano é sempre exibido no jogo.
        const damageAmount = Math.round(Number(data.DamageAmount) || 0);
        batch.hits.push({ damageType: data.DamageType || 'DT_GENERIC', damageAmount });

        if (batch.timer) clearTimeout(batch.timer);
        batch.timer = setTimeout(() => this._flushDamageBatchByKey(key), DAMAGE_BATCH_IDLE_MS);
    }

    async _flushDamageBatchByKey(key) {
        const batch = this.damageBatches.get(key);
        if (!batch) return;
        this.damageBatches.delete(key);
        if (batch.timer) clearTimeout(batch.timer);

        try {
            const webhookUrl = PoTConfigSystem.getWebhookForGroup(batch.guildId, batch.groupId);
            if (!webhookUrl) return;

            const guild = this.client.guilds.cache.get(batch.guildId);
            const embed = WebhookPayloads.buildDamageReportEmbed(batch, guild);
            await this._deliverMessage(webhookUrl, { embeds: [embed.toJSON()] });
        } catch (error) {
            ErrorLogger.error('pot_gateway', 'flushDamageBatch', error, { guildId: batch.guildId });
        }
    }

    /**
     * Manda na hora qualquer lote pendente entre dois identificadores
     * (Alderon ID ou nome), nas duas ordens possíveis — chamado quando um
     * PlayerKilled acontece entre os mesmos dois jogadores, já que a morte
     * encerra o combate e não faz sentido esperar o resto da janela de
     * inatividade pra mandar o relatório.
     */
    _flushDamageBatchesForPair(guildId, idA, idB) {
        for (const [key, batch] of this.damageBatches.entries()) {
            if (batch.guildId !== guildId) continue;
            const src = batch.sourceAlderonId || batch.sourceName;
            const tgt = batch.targetAlderonId || batch.targetName;
            const matches = (src === idA && tgt === idB) || (src === idB && tgt === idA);
            if (matches) this._flushDamageBatchByKey(key);
        }
    }

    // ==================== ENTREGA DA MENSAGEM ====================

    /**
     * Tenta entregar a mensagem autenticado como o bot (channel.send na sala
     * dona do webhook) e só cai pro POST cru no webhook se isso não for
     * possível (bot não está no servidor/canal, ou sem permissão). O envio
     * autenticado é o único jeito de emoji de APLICAÇÃO (EMOJIS.*) renderizar
     * de verdade — webhook execute nunca autentica como o bot, então emoji de
     * aplicação sempre aparece como texto (":nome:") nesse caminho, não
     * importa se o servidor tem o bot ou não. */
    async _deliverMessage(webhookUrl, payload) {
        const sentAsBot = await this._trySendViaBotChannel(webhookUrl, payload);
        if (sentAsBot) return;
        await this._postRawToWebhook(webhookUrl, payload);
    }

    async _trySendViaBotChannel(webhookUrl, payload) {
        const { id, token } = this._parseWebhookUrl(webhookUrl);
        if (!id || !token) return false;

        try {
            const webhook = await this.client.fetchWebhook(id, token).catch(() => null);
            if (!webhook?.channelId) return false;

            const channel = await this.client.channels.fetch(webhook.channelId).catch(() => null);
            if (!channel?.isTextBased?.() || !channel.guild) return false;

            const me = channel.guild.members.me ?? await channel.guild.members.fetchMe().catch(() => null);
            if (!me) return false;

            const perms = channel.permissionsFor(me);
            if (!perms?.has(['ViewChannel', 'SendMessages'])) return false;

            await channel.send(payload);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Extrai {id, token} de uma URL de webhook do Discord
     * (discord.com/api/webhooks/<id>/<token>). */
    _parseWebhookUrl(webhookUrl) {
        try {
            const url = new URL(webhookUrl);
            const parts = url.pathname.split('/').filter(Boolean);
            const idx = parts.indexOf('webhooks');
            if (idx === -1 || !parts[idx + 1] || !parts[idx + 2]) return {};
            return { id: parts[idx + 1], token: parts[idx + 2] };
        } catch {
            return {};
        }
    }

    /**
     * URLs de webhook copiadas da interface do Discord (Configurações do
     * Canal → Integrações) não têm versão de API no caminho
     * (discord.com/api/webhooks/...). Força /v10/ por segurança/consistência
     * — isso sozinho NÃO resolve o 50006 (ver _postRawToWebhook). */
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
     * Fallback quando não dá pra mandar autenticado como o bot (não está no
     * servidor/canal, ou sem permissão) — mesmo caminho de sempre: POST cru
     * no webhook. A causa real do 50006 "Cannot send an empty message": um
     * webhook comum de canal (criado em Integrações) NÃO é "application-
     * owned". Pra esses, o Discord IGNORA o campo `components` da mensagem a
     * menos que a requisição inclua `?with_components=true` na URL — e como
     * não mandamos `content`/`embeds` junto (só components), depois de
     * ignorado não sobra nada, daí o erro. Doc:
     * https://docs.discord.com/developers/resources/webhook
     * (Execute Webhook, query param with_components). */
    async _postRawToWebhook(webhookUrl, payload) {
        try {
            const url = new URL(this._withApiVersion(webhookUrl));
            if (payload.components) url.searchParams.set('with_components', 'true');

            const response = await fetch(url.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const text = await response.text();
                if (process.env.DEBUG_POT === 'true') {
                    console.warn(`⚠️ [Gateway] Webhook retornou ${response.status}: ${text.slice(0, 200)} | payload enviado: ${JSON.stringify(payload).slice(0, 300)}`);
                }
                ErrorLogger.warn('pot_gateway', 'postRawToWebhook', `HTTP ${response.status}: ${text.slice(0, 200)}`);
            }
        } catch (error) {
            ErrorLogger.warn('pot_gateway', 'postRawToWebhook', error.message);
        }
    }

}

module.exports = PoTGatewayServer;