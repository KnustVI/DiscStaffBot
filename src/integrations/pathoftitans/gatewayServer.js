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
const PremiumSystem = require('../../systems/premium/premiumSystem');

// Eventos do grupo "login" que já ganharam o container novo (avatar/Discord
// vinculado, quando reconhecemos o jogador). Os demais grupos continuam no
// formato de texto simples por enquanto — reformulação prevista pra todos.
const CONTAINER_EVENTS = new Set(['PlayerLogin', 'PlayerLogout', 'PlayerLeave']);

// Eventos temporariamente desativados a pedido do dono — chegam normalmente
// (o webhook do jogo continua sendo recebido/processado), mas não geram
// mensagem nenhuma no Discord. PlayerProfanity: o filtro de profanidade do
// PRÓPRIO jogo tem falsos positivos demais pra valer a pena logar por
// enquanto. Pra reativar, é só tirar o evento daqui.
const DISABLED_EVENTS = new Set(['PlayerProfanity']);

// Quantas vezes _postRawToWebhook tenta de novo depois de um 429 (rate
// limit) antes de desistir de vez — ver comentário lá.
const WEBHOOK_RETRY_LIMIT = 3;

/**
 * Nome/ID do dinossauro (não confundir com AlderonId, que é do JOGADOR) e
 * dieta de um dos lados de um evento de combate (Source/Target/Killer/
 * Victim). CONFIRMADO ao vivo (DEBUG_POT, Atlas Brasil):
 * - PlayerDamagedPlayer NÃO manda nenhum dos três — payload real tem
 *   exatamente 15 campos (Name/AlderonId/DinosaurType/Role/IsAdmin/Growth
 *   de cada lado + DamageType/DamageAmount/ServerGuid), sem CharacterName/
 *   CharacterID/Diet em nenhuma variação.
 * - PlayerKilled manda o NOME do dino (sem ID nenhum, nem vítima nem
 *   matador) só que com uma inconsistência real do próprio jogo: o nome do
 *   dino da vítima vem em "DinosaurVictimName" (não "VictimCharacterName"/
 *   "VictimDinosaurName" como o padrão de prefixo sugeriria), enquanto o do
 *   matador vem em "KillerCharacterName" (esse sim no padrão esperado).
 *   Diet também confirmado AUSENTE em PlayerKilled, os dois lados.
 * Os outros candidatos (DinosaurName/DinoName/CharacterId etc.) ficam como
 * fallback só por segurança — nunca confirmados, mas nunca quebram nada se
 * não baterem.
 */
function extractDinoIdentity(data, prefix) {
    const victimNameOverride = prefix === 'Victim' ? data.DinosaurVictimName : null;
    return {
        characterName: victimNameOverride || data[`${prefix}CharacterName`] || data[`${prefix}DinosaurName`] || data[`${prefix}DinoName`] || null,
        dinosaurId: data[`${prefix}CharacterID`] || data[`${prefix}CharacterId`] || data[`${prefix}DinosaurId`] || data[`${prefix}DinoId`] || null,
        diet: data[`${prefix}Diet`] || data[`${prefix}DinosaurDiet`] || null,
    };
}

// Formato REAL confirmado (DEBUG_POT, Atlas Brasil) do campo de local — só
// que em DOIS formatos diferentes dependendo do evento:
//   PlayerRespawn/PlayerLeave/PlayerQuestComplete/Failed → "Location":
//     "X=12345.670 Y=-890.120 Z=345.000" (sem parênteses, separado por espaço)
//   PlayerKilled → "VictimLocation"/"KillerLocation":
//     "(X=-227406.641113,Y=-15547.44159,Z=4662.364509)" (com parênteses,
//     separado por vírgula)
// O regex aceita os dois (aceita vírgula OU espaço como separador, ignora
// parênteses por não precisar ancorar no início/fim da string).
const LOCATION_STRING_RE = /X=(-?[\d.]+)[,\s]+Y=(-?[\d.]+)[,\s]+Z=(-?[\d.]+)/;

/**
 * Local (mapa/POI/coordenadas) de um evento — aceita um prefixo opcional
 * (ex: "Victim"/"Killer" em PlayerKilled, que tem doiS locais possíveis;
 * vazio pra eventos com um só campo de local sem prefixo, como
 * PlayerRespawn/Leave/Quest). CONFIRMADO ao vivo que PlayerDamagedPlayer
 * NÃO manda NENHUM campo de local (mesma checagem de 15 campos da
 * extractDinoIdentity acima). PlayerKilled CONFIRMADO com "VictimPOI" (sem
 * MapName) e "VictimLocation"/"KillerLocation" — ver extractKillLocation
 * abaixo, que escolhe entre os dois lados. Sem nenhum campo reconhecido,
 * retorna tudo null e a seção "Local" do relatório some inteira (ver
 * buildDamageReportPayload em webhookPayloads.js).
 */
function extractEventLocation(data, prefix = '') {
    const field = (name) => data[`${prefix}${name}`];
    const mapName = field('MapName') || field('Map') || null;
    const poiName = field('POI') || field('POIName') || field('LocationName') || null;

    // Formato mantido igual ao cru do jogo a pedido do dono: "(X=..,Y=..,Z=..)".
    let coords = null;
    const raw = field('Location');
    const match = typeof raw === 'string' ? raw.match(LOCATION_STRING_RE) : null;
    if (match) {
        coords = `(X=${Math.round(Number(match[1]))},Y=${Math.round(Number(match[2]))},Z=${Math.round(Number(match[3]))})`;
    } else {
        const x = field('LocationX') ?? field('PosX') ?? null;
        const y = field('LocationY') ?? field('PosY') ?? null;
        const z = field('LocationZ') ?? field('PosZ') ?? null;
        if (x !== null && y !== null) {
            coords = `(X=${Math.round(x)},Y=${Math.round(y)}${z !== null ? `,Z=${Math.round(z)}` : ''})`;
        }
    }

    return { mapName, poiName, coords };
}

/**
 * Local de um PlayerKilled — CONFIRMADO ao vivo que existem DOIS campos
 * possíveis (VictimLocation/VictimPOI sempre existem; KillerLocation só
 * quando há matador de verdade — em morte por ambiente/queda/fome,
 * KillerName/KillerLocation vêm como string vazia "", KillerGrowth como
 * -1). Prioriza o lado do matador quando disponível (mais preciso de onde
 * o combate aconteceu), cai pro lado da vítima senão.
 */
function extractKillLocation(data) {
    const killerLoc = extractEventLocation(data, 'Killer');
    if (killerLoc.mapName || killerLoc.poiName || killerLoc.coords) return killerLoc;
    return extractEventLocation(data, 'Victim');
}

const EVENT_GROUPS = PoTConfigSystem.EVENT_GROUPS;

// Janela de agrupamento de PlayerDamagedPlayer/PlayerKilled: cada evento
// novo entre jogadores já ligados a um "encontro" reinicia esse tempo — o
// relatório só é enviado depois de ficar esse tanto sem NENHUM evento novo
// entre qualquer um dos participantes (não é uma janela fixa), pra cobrir
// o combate/afogamento inteiro, não cortar no meio. Ver
// _bufferDamageEvent/_recordKillIntoEncounter/_flushEncounter.
// TEMPORÁRIO: baixado pra 3min a pedido do dono pra facilitar teste dos
// relatórios de combate/dano em produção — voltar pra 7min depois.
const DAMAGE_BATCH_IDLE_MS = 3 * 60 * 1000;

class PoTGatewayServer {
    constructor(client) {
        this.client = client;
        this.app = null;
        this.server = null;
        this.isRunning = false;
        // Map<encounterId, {
        //   guildId, groupId,
        //   participants: Map<playerKey, { name, alderonId, dinosaurType, dinosaurGrowth }>,
        //   events: [ { type: 'damage', sourceKey, targetKey, damageType, damageAmount, at }
        //            | { type: 'kill', killerKey, victimKey, damageType, at } ],
        //   firstAt, timer,
        // }>
        // "Encontro" (não mais por par atacante/alvo): qualquer novo evento
        // que envolva um jogador JÁ participante de um encontro aberto entra
        // NELE, mesmo que o outro lado seja um terceiro jogador novo — assim
        // uma briga de 3+ jogadores vira UM relatório só, não um por par.
        this.damageEncounters = new Map();
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
        // Mostra o corpo bruto INTEIRO (campos + valores, não só a
        // contagem) sempre que houver algo — é o único jeito de conferir os
        // nomes de campo reais que o servidor do jogo manda pra um evento
        // específico, já que a doc oficial nem sempre bate 100% com o que
        // cada versão do servidor realmente envia (histórico: Format=
        // "Discord" vs "General", PlayerAlderonId vs AlderonId em
        // PlayerLeave...). Corpo vazio/não reconhecido mostra o rawBody.
        this.app.use((req, res, next) => {
            if (process.env.DEBUG_POT === 'true') {
                const fieldCount = Object.keys(req.body || {}).length;
                const evt = req.query.evt || '-';
                if (fieldCount > 0) {
                    console.log(`📡 [Gateway] ${req.method} ${req.path} evt=${evt} (${fieldCount} campos): ${JSON.stringify(req.body)}`);
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
        for (const encounter of this.damageEncounters.values()) {
            if (encounter.timer) clearTimeout(encounter.timer);
        }
        this.damageEncounters.clear();
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
            if (DISABLED_EVENTS.has(potEvent)) return;

            // 0. O Game.ini pode estar configurado com Format="Discord" — nesse
            // modo o servidor manda um payload já pronto pra postar direto num
            // webhook ({content, username, embeds:[{description: "**Chave:**
            // valor\n..."}]}), em vez de campos soltos (Format="General", o
            // que o resto do código espera). Normaliza pra sempre trabalhar
            // com campos soltos daqui pra frente. ──────────────────────────
            const data = this._extractFieldsFromDiscordFormat(rawData) || rawData;

            // 0b. Campos REALMENTE usados pelos formatters (webhookPayloads.js)
            // depois de qualquer normalização — o log acima (linha ~90) mostra
            // o corpo cru; este mostra o que sobra depois do Format="Discord"
            // ser desmontado, que é o que decide o que aparece na mensagem.
            if (process.env.DEBUG_POT === 'true') {
                console.log(`📡 [Gateway] campos resolvidos pra ${potEvent}: ${JSON.stringify(data)}`);
            }

            // 1. Registro automático do jogador nos eventos relevantes
            // PlayerRespawn carrega DinosaurType/DinosaurGrowth (espécie/growth
            // atuais, mostrados no card do /perfil) — sem isso na lista, esses
            // dois campos nunca eram atualizados.
            // PlayerKilled NÃO entra aqui de propósito — esse evento nunca tem
            // um campo "AlderonId"/"PlayerAlderonId" solto (só KillerAlderonId/
            // VictimAlderonId), então upsertPlayerFromEvent SEMPRE falhava e
            // logava "Payload sem AlderonId — ignorando" em TODA morte, sem
            // nunca fazer nada de útil (kills/deaths já são contados à parte,
            // corretamente, em recordKillEvent — ver 1b abaixo).
            const playerEvents = ['PlayerLogin', 'PlayerLogout', 'PlayerLeave', 'PlayerChat', 'PlayerCommand', 'PlayerRespawn'];
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
                // A morte vira mais um evento na linha do tempo do encontro
                // (não encerra mais o encontro na hora — outros participantes
                // podem continuar brigando entre si) - ver _recordKillIntoEncounter.
                // O aviso IMEDIATO de morte (embed "Morte em Combate") continua
                // sendo mandado normalmente logo abaixo, sem esperar o relatório —
                // essa parte NÃO é bloqueada por tier, só a entrada no encontro
                // (relatório de combate/dano em si é Rastreador+, ver abaixo).
                if (PremiumSystem.getGuildLimits(guildId).damageReportEnabled) {
                    this._recordKillIntoEncounter(guildId, groupId, data);
                }
            }

            // 2. Busca o webhook Discord configurado para este grupo
            const webhookUrl = PoTConfigSystem.getWebhookForGroup(guildId, groupId);
            if (!webhookUrl) {
                // Pra PlayerDamagedPlayer/PlayerKilled isso é especialmente
                // importante de logar: sem webhook aqui, o golpe/morte NEM
                // CHEGA a entrar no encontro (_bufferDamageEvent só é chamado
                // mais abaixo) — ou seja, se o webhook cair/sumir no meio de
                // uma sessão, os combates seguintes desaparecem sem deixar
                // rastro nenhum. Log permanente pra distinguir esse caso de
                // "encontro criado mas ainda não fechou" nos logs do flush.
                if (potEvent === 'PlayerDamagedPlayer' || potEvent === 'PlayerKilled') {
                    console.warn(`⚔️ [Gateway] ${potEvent} recebido (guild ${guildId}, grupo ${groupId}) mas SEM webhook configurado pro grupo "${groupId}" — evento descartado, nem entra no encontro.`);
                }
                return; // grupo não configurado, ignora silenciosamente
            }

            // 2b. PlayerDamagedPlayer nunca é enviado na hora — combates e
            // dano contínuo (afogamento, fome...) mandam um evento por golpe,
            // e isso flooda o canal de log. Em vez disso, acumula por par
            // atacante/alvo e manda UM relatório depois de um tempo sem novo
            // golpe entre os dois (ver _bufferDamageEvent). Relatório de
            // combate/dano é feature Rastreador+ (pedido do dono) — no Free,
            // o evento é só descartado aqui (não serve pra mais nada sozinho,
            // ao contrário de PlayerKilled que também conta kills/deaths).
            if (potEvent === 'PlayerDamagedPlayer') {
                if (!PremiumSystem.getGuildLimits(guildId).damageReportEnabled) return;
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

            // 3b. PlayerKilled ganhou painel próprio em Components V2 (ver
            // buildKillPanel em webhookPayloads.js) — precisa ser
            // interceptado ANTES do caminho genérico de texto+embed logo
            // abaixo, porque Components V2 não pode se misturar com
            // content/embeds na mesma mensagem (ResponseManager/Discord
            // rejeitam).
            if (potEvent === 'PlayerKilled') {
                const guild = this.client.guilds.cache.get(guildId);
                const payload = WebhookPayloads.buildKillPanel(data, guild);
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

    // ==================== RELATÓRIO DE DANO/COMBATE (encontros) ====================

    /**
     * Acha um encontro já aberto (nesta guild) que já tenha QUALQUER um dos
     * dois identificadores como participante, ou cria um novo. É isso que
     * faz uma briga de 3+ jogadores (A bate em B, B bate em C) virar UM
     * relatório só — quando o evento entre B e C chega, B já é participante
     * do encontro criado pelo evento entre A e B, então C entra no MESMO
     * encontro em vez de abrir um novo.
     */
    _findOrCreateEncounter(guildId, groupId, keyA, keyB) {
        for (const encounter of this.damageEncounters.values()) {
            if (encounter.guildId !== guildId) continue;
            if (encounter.participants.has(keyA) || encounter.participants.has(keyB)) {
                return encounter;
            }
        }
        const id = `${guildId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        const encounter = {
            id, guildId, groupId,
            participants: new Map(),
            events: [],
            firstAt: Date.now(),
            timer: null,
        };
        this.damageEncounters.set(id, encounter);
        // Log SEMPRE ativo (não só com DEBUG_POT) — encontros são raros o
        // bastante pra não virar spam, e ter um rastro de "isso foi criado"
        // é essencial pra diagnosticar um relatório que nunca chegou (ver
        // PREMIUM.txt, seção sobre isso).
        console.log(`⚔️ [Gateway] Novo encontro de combate ${id} (guild ${guildId}, grupo ${groupId})`);
        return encounter;
    }

    /**
     * Registra/atualiza um participante do encontro — sempre mantém o
     * growth mais RECENTE visto (o dinossauro cresce durante o encontro),
     * mas nunca apaga nome/ID/espécie/dieta/identidade do dino já
     * conhecidos com um valor vazio.
     */
    _upsertParticipant(encounter, key, info) {
        if (!key) return;
        const existing = encounter.participants.get(key) || {};
        encounter.participants.set(key, {
            name: info.name || existing.name || 'Desconhecido',
            alderonId: info.alderonId || existing.alderonId || null,
            dinosaurType: info.dinosaurType || existing.dinosaurType || null,
            dinosaurGrowth: (info.growth !== undefined && info.growth !== null) ? info.growth : (existing.dinosaurGrowth ?? null),
            diet: info.diet || existing.diet || null,
            characterName: info.characterName || existing.characterName || null,
            dinosaurId: info.dinosaurId || existing.dinosaurId || null,
        });
    }

    _resetEncounterTimer(encounter) {
        if (encounter.timer) clearTimeout(encounter.timer);
        encounter.timer = setTimeout(() => this._flushEncounter(encounter.id), DAMAGE_BATCH_IDLE_MS);
    }

    /**
     * Acumula um golpe de PlayerDamagedPlayer no encontro do par atacante/
     * alvo (ou cria um novo, ou junta a um encontro já aberto de um dos
     * dois — ver _findOrCreateEncounter) e reinicia o timer de inatividade.
     */
    _bufferDamageEvent(guildId, groupId, data) {
        const sourceKey = data.SourceAlderonId || data.SourceName || 'desconhecido';
        const targetKey = data.TargetAlderonId || data.TargetName || 'desconhecido';

        const encounter = this._findOrCreateEncounter(guildId, groupId, sourceKey, targetKey);
        this._upsertParticipant(encounter, sourceKey, {
            name: data.SourceName, alderonId: data.SourceAlderonId,
            dinosaurType: data.SourceDinosaurType, growth: data.SourceGrowth,
            ...extractDinoIdentity(data, 'Source'),
        });
        this._upsertParticipant(encounter, targetKey, {
            name: data.TargetName, alderonId: data.TargetAlderonId,
            dinosaurType: data.TargetDinosaurType, growth: data.TargetGrowth,
            ...extractDinoIdentity(data, 'Target'),
        });

        // DamageAmount pode chegar como float do motor do jogo (ex: 9.999998)
        // — arredonda pra inteiro, que é como dano é sempre exibido no jogo.
        const damageAmount = Math.round(Number(data.DamageAmount) || 0);
        encounter.events.push({
            type: 'damage', sourceKey, targetKey,
            damageType: data.DamageType || 'DT_GENERIC', damageAmount,
            at: Date.now(),
            location: extractEventLocation(data),
        });

        this._resetEncounterTimer(encounter);
    }

    /**
     * Registra uma morte na linha do tempo do encontro (junta ou cria, mesmo
     * critério de _bufferDamageEvent) — NÃO manda o relatório na hora mais:
     * outros participantes do mesmo encontro podem continuar brigando entre
     * si depois dessa morte, então só o timer de inatividade decide quando
     * fechar. O aviso imediato de morte (embed "Morte em Combate") é
     * independente disso e continua sendo mandado na hora, ver _routeToDiscord.
     */
    _recordKillIntoEncounter(guildId, groupId, data) {
        // Morte por ambiente (queda/fome/afogamento, sem outro jogador
        // envolvido): CONFIRMADO ao vivo que KillerName/KillerAlderonId
        // vêm como string vazia "" (e KillerGrowth como -1, sentinela)
        // nesse caso — sem essa checagem, o encontro ganhava um
        // participante fantasma "desconhecido" com growth -1, e o
        // relatório virava "RELATÓRIO DE COMBATE" mesmo sem nenhum outro
        // jogador de verdade envolvido (deveria ser "DANO ISOLADO").
        const hasKiller = Boolean(data.KillerName || data.KillerAlderonId);
        const killerKey = hasKiller ? (data.KillerAlderonId || data.KillerName) : 'ambiente';
        const victimKey = data.VictimAlderonId || data.VictimName || 'desconhecido';

        const encounter = this._findOrCreateEncounter(guildId, groupId, killerKey, victimKey);
        if (hasKiller) {
            this._upsertParticipant(encounter, killerKey, {
                name: data.KillerName, alderonId: data.KillerAlderonId,
                dinosaurType: data.KillerDinosaurType, growth: data.KillerGrowth,
                ...extractDinoIdentity(data, 'Killer'),
            });
        }
        this._upsertParticipant(encounter, victimKey, {
            name: data.VictimName, alderonId: data.VictimAlderonId,
            dinosaurType: data.VictimDinosaurType, growth: data.VictimGrowth,
            ...extractDinoIdentity(data, 'Victim'),
        });

        encounter.events.push({
            type: 'kill', killerKey: hasKiller ? killerKey : null, victimKey,
            damageType: data.DamageType || 'DT_GENERIC',
            at: Date.now(),
            location: extractKillLocation(data),
        });

        this._resetEncounterTimer(encounter);
    }

    async _flushEncounter(encounterId) {
        const encounter = this.damageEncounters.get(encounterId);
        if (!encounter) {
            console.warn(`⚔️ [Gateway] _flushEncounter chamado pra ${encounterId}, mas ele já não existe mais (flush duplicado ou já removido) — ignorando.`);
            return;
        }
        this.damageEncounters.delete(encounterId);
        if (encounter.timer) clearTimeout(encounter.timer);

        // Log SEMPRE ativo — mesmo motivo do log de criação em
        // _findOrCreateEncounter: sem isso, um relatório que nunca chega no
        // Discord não deixa NENHUM rastro no console, impossível saber se o
        // encontro nem chegou a fechar, fechou sem webhook configurado, ou
        // fechou e falhou ao entregar.
        console.log(`⚔️ [Gateway] Fechando encontro ${encounterId} — ${encounter.participants.size} participante(s), ${encounter.events.length} evento(s)`);

        try {
            const webhookUrl = PoTConfigSystem.getWebhookForGroup(encounter.guildId, encounter.groupId);
            if (!webhookUrl) {
                console.warn(`⚔️ [Gateway] Encontro ${encounterId} fechado, mas o grupo "${encounter.groupId}" não tem webhook configurado nesta guild — relatório NÃO enviado.`);
                return;
            }

            const guild = this.client.guilds.cache.get(encounter.guildId);
            const payload = WebhookPayloads.buildDamageReportPayload(encounter, guild);
            await this._deliverMessage(webhookUrl, payload);
            console.log(`⚔️ [Gateway] Relatório do encontro ${encounterId} entregue.`);
        } catch (error) {
            console.error(`⚔️ [Gateway] Falha ao entregar relatório do encontro ${encounterId}:`, error.message);
            ErrorLogger.error('pot_gateway', 'flushEncounter', error, { guildId: encounter.guildId });
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
    async _postRawToWebhook(webhookUrl, payload, attempt = 0) {
        try {
            const url = new URL(this._withApiVersion(webhookUrl));
            if (payload.components) url.searchParams.set('with_components', 'true');

            const response = await fetch(url.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            // 429 (rate limit) — CAUSA PROVÁVEL de relatórios que "somem"
            // quando muitos eventos acontecem ao mesmo tempo (ex: vários
            // encontros de combate fechando perto um do outro): antes disso,
            // um 429 caía direto no bloco de baixo, logava um aviso e a
            // mensagem era descartada pra sempre, sem tentar de novo. Agora
            // respeita o "Retry-After" que o Discord manda e tenta de novo
            // (até WEBHOOK_RETRY_LIMIT vezes) antes de desistir. O caminho
            // autenticado (_trySendViaBotChannel) já não tinha esse
            // problema — o REST manager do discord.js já lida com rate
            // limit sozinho — só o POST cru (fallback) ficava exposto.
            if (response.status === 429 && attempt < WEBHOOK_RETRY_LIMIT) {
                let retryAfterSeconds = Number(response.headers.get('retry-after'));
                if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
                    const body = await response.json().catch(() => null);
                    retryAfterSeconds = Number(body?.retry_after) || 1;
                }
                const waitMs = Math.ceil(retryAfterSeconds * 1000) + 50;
                console.warn(`⚠️ [Gateway] Webhook rate limitado (429) — tentando de novo em ${waitMs}ms (tentativa ${attempt + 1}/${WEBHOOK_RETRY_LIMIT})`);
                await new Promise((resolve) => setTimeout(resolve, waitMs));
                return this._postRawToWebhook(webhookUrl, payload, attempt + 1);
            }

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