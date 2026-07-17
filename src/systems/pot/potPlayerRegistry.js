// /home/ubuntu/DiscStaffBot/src/systems/pot/potPlayerRegistry.js

/**
 * potPlayerRegistry.js
 *
 * Sistema de cadastro de jogadores do Path of Titans — duas portas de entrada:
 *
 *  1. AUTOMÁTICA (upsertPlayerFromEvent): chamada sempre que um evento de
 *     webhook do PoT é recebido (PlayerLogin, PlayerLogout, ou qualquer outro
 *     evento que traga AlderonId/PlayerName no payload). Só vincula o
 *     discord_id automaticamente se o servidor do jogo enviar esse campo no
 *     payload — o que exige o jogador ter conectado o Discord pelo site
 *     oficial da Alderon Games. Quando isso acontece, o vínculo também é
 *     espelhado na identidade GLOBAL (player_links — ver
 *     _syncGlobalLinkFromWebhook), a mesma usada por /registrar e /perfil:
 *     essa é a forma mais segura de vincular a conta, já que é a Alderon
 *     quem confirma a titularidade, não o próprio jogador.
 *
 *  2. MANUAL (registerPlayerManually): usada pelo comando /registrar — o
 *     jogador informa o próprio Alderon ID pelo Discord. Hoje é aceito sem
 *     confirmação (ver seção de verificação em jogo mais abaixo, que existe
 *     mas ainda não está ativada por depender de RCON confiável em produção).
 *
 * Referência do payload oficial:
 * https://hosting.pathoftitans.wiki/guide/webhooks
 *
 * Exemplo de payload PlayerLogin / PlayerLogout (formato "General"):
 *   {
 *     "ServerGuid": "63a86971-...",
 *     "PlayerName": "Test1",
 *     "AlderonId": "048-236-424",
 *     "bServerAdmin": false,
 *     ...
 *     // PlayerLogout pode incluir tempo de sessão, dependendo da versão
 *     // do servidor — tratamos esse campo como OPCIONAL (ver normalizeEvent).
 *   }
 *
 * IMPORTANTE: este módulo é INTENCIONALMENTE desacoplado de qualquer
 * Gateway/HTTP. Quando o Gateway de webhooks for refeito, basta chamar
 * upsertPlayerFromEvent(guildId, rawPayload, eventType) a partir do novo
 * handler — nenhuma lógica de banco precisa ser duplicada ou reescrita.
 */

'use strict';

const db = require('../../database/index');

// ---------------------------------------------------------------------------
// Eventos suportados e de onde tiramos "está online" / "tempo de jogo"
// ---------------------------------------------------------------------------

const ONLINE_EVENTS = new Set(['PlayerLogin']);
const OFFLINE_EVENTS = new Set(['PlayerLogout', 'PlayerLeave']);

/**
 * Tenta extrair um valor de playtime/sessão do payload, cobrindo as
 * variações de nome de campo já vistas em payloads do PoT/PotBot.
 * Retorna null se não houver nada utilizável — playtime é OPCIONAL.
 *
 * @param {object} payload
 * @returns {number|null} segundos de sessão, se disponível
 */
function extractSessionSeconds(payload) {
    const candidates = [
        payload.SessionDuration,
        payload.SessionLength,
        payload.PlayTime,
        payload.PlaytimeSeconds,
        payload.SessionSeconds,
    ];

    for (const value of candidates) {
        if (value === undefined || value === null) continue;
        const num = Number(value);
        if (!Number.isNaN(num) && num >= 0) return num;
    }

    return null;
}

/**
 * Tenta extrair um Discord ID do payload, se o evento já vier com isso
 * vinculado (alguns webhooks de servidores integrados com bots de conta
 * trazem esse campo; a maioria não traz — por isso é sempre opcional e
 * NUNCA sobrescreve um discord_id já existente com null/undefined).
 *
 * @param {object} payload
 * @returns {string|null}
 */
function extractDiscordId(payload) {
    const candidates = [payload.DiscordId, payload.discord_id, payload.DiscordID];
    for (const value of candidates) {
        if (value && String(value).trim().length > 0) return String(value).trim();
    }
    return null;
}

// O próprio servidor do PoT às vezes manda esse texto fixo como DinosaurType
// (ou as variantes VictimDinosaurType/KillerDinosaurType/SourceDinosaurType/
// TargetDinosaurType dos eventos de combate) quando ele mesmo não consegue
// resolver o asset da espécie do dino — visto ao vivo em /perfil mostrando
// "Último dinossauro jogado: Invalid Character Data Asset". É um problema do
// próprio jogo, não um bug do bot; tratado abaixo como "sem informação"
// (null) em vez de exibir essa string crua pro jogador/staff. Usado tanto
// aqui (normalizeEvent, abaixo) quanto em webhookPayloads.js/gatewayServer.js
// pra sanitizar os mesmos campos nos logs de webhook (combate/kill/missão).
const INVALID_DINOSAUR_TYPE_RE = /^invalid character data asset$/i;
function sanitizeDinosaurType(raw) {
    if (!raw) return null;
    const trimmed = String(raw).trim();
    if (!trimmed || INVALID_DINOSAUR_TYPE_RE.test(trimmed)) return null;
    return trimmed;
}

/**
 * Normaliza um payload de webhook do PoT em um formato interno consistente.
 * Retorna null se o payload não tiver o mínimo necessário (AlderonId).
 *
 * @param {object} rawPayload - Payload bruto recebido do webhook
 * @param {string} [eventType] - Nome do evento (ex: 'PlayerLogin'), se conhecido
 * @returns {{ alderonId: string, playerName: string, isOnline: boolean|null, sessionSeconds: number|null, discordId: string|null } | null}
 */
function normalizeEvent(rawPayload, eventType) {
    if (!rawPayload || typeof rawPayload !== 'object') return null;

    // PlayerLeave manda a chave como PlayerAlderonId, não AlderonId como os
    // demais eventos (PlayerLogin/PlayerLogout) — ver doc oficial de webhooks.
    const alderonId = rawPayload.AlderonId || rawPayload.PlayerAlderonId || rawPayload.alderon_id || null;
    if (!alderonId) return null; // sem AlderonId não há como identificar o jogador

    const playerName = rawPayload.PlayerName || rawPayload.player_name || 'Desconhecido';

    let isOnline = null;
    if (eventType) {
        if (ONLINE_EVENTS.has(eventType)) isOnline = 1;
        else if (OFFLINE_EVENTS.has(eventType)) isOnline = 0;
    }

    // DinosaurType/DinosaurGrowth só vêm no payload do PlayerRespawn — nos
    // demais eventos ficam undefined, e upsertPlayerFromEvent trata isso
    // como "não mexe no valor já salvo" (nunca sobrescreve com null).
    const dinosaurType = sanitizeDinosaurType(rawPayload.DinosaurType);
    const dinosaurGrowth = rawPayload.DinosaurGrowth !== undefined && rawPayload.DinosaurGrowth !== null
        ? Number(rawPayload.DinosaurGrowth)
        : null;

    return {
        alderonId: String(alderonId).trim(),
        playerName: String(playerName).trim(),
        isOnline,
        sessionSeconds: extractSessionSeconds(rawPayload),
        discordId: extractDiscordId(rawPayload),
        dinosaurType,
        dinosaurGrowth: Number.isNaN(dinosaurGrowth) ? null : dinosaurGrowth,
    };
}

/**
 * Espelha um vínculo Discord<->Alderon ID confirmado por um webhook (o
 * jogador conectou o Discord pelo site oficial da Alderon Games) na
 * identidade GLOBAL (player_links) — a mesma tabela usada por /registrar e
 * /perfil. Esse é o caminho "automático" citado no painel de /registrar:
 * mais seguro que o vínculo manual, já que é a própria Alderon quem confirma
 * a titularidade da conta, não o próprio jogador.
 *
 * Nunca sobrescreve um Alderon ID já vinculado a OUTRO Discord (conflito
 * real, precisa de intervenção manual da staff) — silenciosamente ignora
 * esse caso, já que aqui não há como avisar ninguém (é um evento de
 * webhook, não uma interação).
 *
 * @param {string} discordId
 * @param {string} alderonId
 * @param {string} playerName
 */
function _syncGlobalLinkFromWebhook(discordId, alderonId, playerName) {
    try {
        const takenBy = db.prepare(`SELECT user_id FROM player_links WHERE alderon_id = ?`).get(alderonId);
        if (takenBy && takenBy.user_id !== discordId) return;

        const now = Date.now();
        // verified_ingame = 1: este vínculo veio confirmado pela própria
        // Alderon (o jogador conectou o Discord pelo site oficial deles) —
        // fonte pelo menos tão confiável quanto o código in-game do /registrar
        // manual (ver registerPlayerManually).
        db.prepare(`
            INSERT INTO player_links (user_id, alderon_id, player_name, verified_ingame, registered_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                alderon_id = excluded.alderon_id,
                player_name = excluded.player_name,
                verified_ingame = 1,
                updated_at = excluded.updated_at
        `).run(discordId, alderonId, playerName, now, Math.floor(now / 1000));
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao sincronizar vínculo automático (webhook) com player_links:', error);
    }
}

/**
 * Ponto de entrada único do cadastro automático.
 *
 * Comportamento:
 *  - Se o jogador (guild_id + alderon_id) NÃO existir em pot_players: cria
 *    o registro, com first_login_at = agora (primeira vez que o vemos).
 *  - Se já existir: atualiza apenas os campos relevantes (nome, last_seen,
 *    is_online, total_playtime incrementado quando há sessionSeconds,
 *    discord_id se vier preenchido e ainda não estiver setado).
 *  - updated_at é sempre atualizado, em ambos os casos.
 *
 * Nunca lança em caso de payload malformado — apenas loga e retorna null,
 * para que um webhook ruim nunca derrube o processamento do Gateway.
 *
 * @param {string} guildId - ID da guild Discord associada a este servidor PoT
 * @param {object} rawPayload - Payload bruto do webhook
 * @param {string} [eventType] - Nome do evento, ex: 'PlayerLogin', 'PlayerLogout'
 * @returns {{ created: boolean, alderonId: string } | null}
 */
function upsertPlayerFromEvent(guildId, rawPayload, eventType) {
    if (!guildId) {
        console.warn('⚠️ [PoT Registry] upsertPlayerFromEvent chamado sem guildId — ignorando evento.');
        return null;
    }

    const normalized = normalizeEvent(rawPayload, eventType);
    if (!normalized) {
        console.warn(`⚠️ [PoT Registry] Payload sem AlderonId (evento: ${eventType || 'desconhecido'}) — ignorando.`);
        return null;
    }

    const { alderonId, playerName, isOnline, sessionSeconds, discordId, dinosaurType, dinosaurGrowth } = normalized;
    const now = Date.now();

    // ── "Tem dinossauro ativo nesta sessão?" — distingue "jogando" de "na
    // tela de seleção" no /perfil (dinosaur_type/growth acima NUNCA são
    // limpos, então sozinhos não bastam). PlayerLogin zera (login cai na
    // seleção); PlayerRespawn liga (acabou de escolher/spawnar um dino);
    // outros eventos não mexem nisso (PlayerKilled zera a vítima à parte,
    // ver recordKillEvent). ──────────────────────────────────────────────
    let dinosaurActiveOverride = null;
    if (eventType === 'PlayerLogin') dinosaurActiveOverride = 0;
    else if (eventType === 'PlayerRespawn') dinosaurActiveOverride = 1;

    // Um PlayerRespawn com espécie válida conta como "escolheu/jogou essa
    // espécie uma vez" — alimenta getMostPlayedDinosaur (badge de "espécie
    // mais jogada" no /perfil), distinto de dinosaur_type acima (que é
    // sempre a ÚLTIMA, não a mais jogada).
    const shouldRecordDinosaurPick = eventType === 'PlayerRespawn' && dinosaurType !== null;

    try {
        const existing = db.prepare(`
            SELECT * FROM pot_players WHERE guild_id = ? AND alderon_id = ?
        `).get(guildId, alderonId);

        if (!existing) {
            // ── Jogador novo: cadastro automático ────────────────────────────
            db.prepare(`
                INSERT INTO pot_players (
                    guild_id, alderon_id, player_name, discord_id,
                    dinosaur_type, dinosaur_growth, dinosaur_active,
                    last_seen, total_playtime, is_online, session_started_at,
                    linked_at, first_login_at, updated_at, admin_notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                guildId,
                alderonId,
                playerName,
                discordId || null,
                dinosaurType,
                dinosaurGrowth,
                dinosaurActiveOverride ?? 0,
                now,
                sessionSeconds || 0,
                isOnline === null ? 0 : isOnline,
                eventType === 'PlayerLogin' ? now : null, // session_started_at
                discordId ? now : null,   // linked_at só se já veio com discord_id
                now,                       // first_login_at — primeira vez que vemos este jogador
                Math.floor(now / 1000),    // updated_at é em segundos (strftime('%s'))
                null,
            );

            console.log(`🦖 [PoT Registry] Novo jogador cadastrado: ${playerName} (${alderonId})`);
            if (discordId) _syncGlobalLinkFromWebhook(discordId, alderonId, playerName);
            if (shouldRecordDinosaurPick) _recordDinosaurPick(guildId, alderonId, dinosaurType);
            return { created: true, alderonId };
        }

        // ── Jogador já existe: atualizar apenas o que é relevante ─────────────
        // Tempo de sessão: usa o valor do payload se o servidor mandou (nem
        // toda versão manda — ver extractSessionSeconds); se não mandou E o
        // evento é de saída (logout/leave), calcula pela diferença entre
        // agora e session_started_at (setado no login) — garante que
        // total_playtime seja incrementado de verdade mesmo quando o
        // servidor nunca envia esse campo, em vez de ficar sempre parado.
        let sessionSecondsToAdd = sessionSeconds;
        if (!sessionSecondsToAdd && OFFLINE_EVENTS.has(eventType) && existing.session_started_at) {
            sessionSecondsToAdd = Math.floor((now - existing.session_started_at) / 1000);
        }
        const newTotalPlaytime = sessionSecondsToAdd
            ? (existing.total_playtime || 0) + sessionSecondsToAdd
            : existing.total_playtime;

        // session_started_at: marca o INÍCIO da sessão atual no login, limpa
        // no logout/leave — usado por getGuildPlayerStats pra somar o tempo
        // AO VIVO (now - session_started_at) enquanto o jogador está online,
        // já que total_playtime só reflete sessões JÁ ENCERRADAS.
        let newSessionStartedAt = existing.session_started_at;
        if (eventType === 'PlayerLogin') newSessionStartedAt = now;
        else if (OFFLINE_EVENTS.has(eventType)) newSessionStartedAt = null;

        const newIsOnline = isOnline === null ? existing.is_online : isOnline;

        // discord_id: nunca sobrescreve um valor já existente com null;
        // só atualiza se vier um valor novo E o campo atual estiver vazio,
        // ou se o valor novo for diferente do atual (re-vínculo).
        let newDiscordId = existing.discord_id;
        let newLinkedAt = existing.linked_at;
        if (discordId && discordId !== existing.discord_id) {
            newDiscordId = discordId;
            newLinkedAt = now;
        }

        // Só sobrescreve espécie/growth quando o evento realmente trouxe esse
        // dado (PlayerRespawn) — em login/logout/etc ficam null e mantemos
        // o que já estava salvo.
        const newDinosaurType = dinosaurType !== null ? dinosaurType : existing.dinosaur_type;
        const newDinosaurGrowth = dinosaurGrowth !== null ? dinosaurGrowth : existing.dinosaur_growth;
        const newDinosaurActive = dinosaurActiveOverride ?? existing.dinosaur_active;

        db.prepare(`
            UPDATE pot_players SET
                player_name = ?,
                discord_id = ?,
                dinosaur_type = ?,
                dinosaur_growth = ?,
                dinosaur_active = ?,
                last_seen = ?,
                total_playtime = ?,
                is_online = ?,
                session_started_at = ?,
                linked_at = ?,
                updated_at = ?
            WHERE guild_id = ? AND alderon_id = ?
        `).run(
            playerName,
            newDiscordId,
            newDinosaurType,
            newDinosaurGrowth,
            newDinosaurActive,
            now,
            newTotalPlaytime,
            newIsOnline,
            newSessionStartedAt,
            newLinkedAt,
            Math.floor(now / 1000),
            guildId,
            alderonId,
        );

        if (discordId) _syncGlobalLinkFromWebhook(discordId, alderonId, playerName);
        if (shouldRecordDinosaurPick) _recordDinosaurPick(guildId, alderonId, dinosaurType);
        return { created: false, alderonId };
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao cadastrar/atualizar jogador:', error);
        return null;
    }
}

/**
 * Incrementa o contador de "vezes jogado" dessa espécie pra esse jogador
 * nesse guild — chamado sempre que um PlayerRespawn traz uma espécie válida
 * (já sanitizada por sanitizeDinosaurType). Nunca lança (mesmo padrão do
 * resto do arquivo): um erro aqui só afeta o "dinossauro mais jogado" do
 * /perfil, não pode derrubar o cadastro/atualização do jogador.
 *
 * @param {string} guildId
 * @param {string} alderonId
 * @param {string} dinosaurType
 */
function _recordDinosaurPick(guildId, alderonId, dinosaurType) {
    try {
        db.prepare(`
            INSERT INTO pot_dinosaur_picks (guild_id, alderon_id, dinosaur_type, pick_count, updated_at)
            VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(guild_id, alderon_id, dinosaur_type) DO UPDATE SET
                pick_count = pick_count + 1,
                updated_at = excluded.updated_at
        `).run(guildId, alderonId, dinosaurType, Math.floor(Date.now() / 1000));
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao registrar pick de dinossauro:', error);
    }
}

/**
 * "Dinossauro mais jogado" (por número de vezes escolhido/spawnado, não por
 * tempo de jogo) — GLOBAL, somando pot_dinosaur_picks de todos os guilds pro
 * mesmo alderon_id, mesmo critério "global" do resto deste arquivo (ver
 * getGlobalPlayerStats). Distinto de dinosaur_type (pot_players/
 * getGlobalPlayerStats), que é sempre o ÚLTIMO jogado — usado só no badge de
 * espécie do card de /perfil; o "Último dinossauro jogado" do painel
 * abaixo continua vindo de getGlobalPlayerStats, sem mudança.
 *
 * @param {string} alderonId
 * @returns {string|null}
 */
function getMostPlayedDinosaur(alderonId) {
    if (!alderonId) return null;
    try {
        const row = db.prepare(`
            SELECT dinosaur_type, SUM(pick_count) as total_picks
            FROM pot_dinosaur_picks
            WHERE alderon_id = ?
            GROUP BY dinosaur_type
            ORDER BY total_picks DESC
            LIMIT 1
        `).get(alderonId);
        return row?.dinosaur_type || null;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar dinossauro mais jogado:', error);
        return null;
    }
}

/**
 * Cadastro/vínculo MANUAL — usado pelo comando /registrar (painel + modal).
 *
 * GLOBAL: o vínculo Discord<->Alderon ID vale em qualquer servidor com o bot,
 * não é por guild — vive em player_links (sem guild_id), não em pot_players
 * (que continua guild-scoped, só pra atividade por servidor via webhook).
 *
 * Cenários tratados:
 *  - Nada existe ainda para este discord_id nem para este alderon_id: cria
 *    uma linha nova.
 *  - Este discord_id já está vinculado a OUTRO alderon_id: trata como
 *    re-vínculo — atualiza a linha existente do discord_id para o novo
 *    alderon_id.
 *  - O alderon_id já pertence a OUTRO discord_id: rejeita (conflito real,
 *    precisa de intervenção manual da staff).
 *
 * @param {string} discordId
 * @param {string} alderonId - Já validado no formato xxx-xxx-xxx pelo chamador
 * @param {string} playerName
 * @param {boolean} [verified=false] - true quando já passou pela verificação
 *   em jogo via RCON (ver /registrar, fluxo obrigatório de código) — grava
 *   verified_ingame=1. Sempre false se chamado sem esse parâmetro.
 * @returns {{ success: boolean, created?: boolean, relinked?: boolean, error?: string }}
 *   error, quando presente, é um código curto: 'MISSING_FIELDS' | 'ALDERON_TAKEN' | 'DB_ERROR'
 */
function registerPlayerManually(discordId, alderonId, playerName, verified = false) {
    if (!discordId || !alderonId || !playerName) {
        return { success: false, error: 'MISSING_FIELDS' };
    }

    const now = Date.now();

    try {
        const byAlderon = db.prepare(`
            SELECT * FROM player_links WHERE alderon_id = ?
        `).get(alderonId);

        if (byAlderon && byAlderon.user_id !== discordId) {
            return { success: false, error: 'ALDERON_TAKEN' };
        }

        const byDiscord = db.prepare(`
            SELECT * FROM player_links WHERE user_id = ?
        `).get(discordId);

        const relinked = !!(byDiscord && byDiscord.alderon_id !== alderonId);

        db.prepare(`
            INSERT INTO player_links (user_id, alderon_id, player_name, verified_ingame, registered_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                alderon_id = excluded.alderon_id,
                player_name = excluded.player_name,
                verified_ingame = excluded.verified_ingame,
                updated_at = excluded.updated_at
        `).run(discordId, alderonId, playerName, verified ? 1 : 0, now, Math.floor(now / 1000));

        return { success: true, created: !byDiscord, relinked };
    } catch (error) {
        console.error('❌ [PoT Registry] Erro no cadastro manual:', error);
        return { success: false, error: 'DB_ERROR' };
    }
}

/**
 * Busca o vínculo global por Alderon ID.
 *
 * @param {string} alderonId
 * @returns {object|null} linha completa de player_links
 */
function getPlayerByAlderonId(alderonId) {
    if (!alderonId) return null;
    try {
        return db.prepare(`
            SELECT * FROM player_links WHERE alderon_id = ?
        `).get(alderonId) || null;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar jogador por alderon_id:', error);
        return null;
    }
}

// ---------------------------------------------------------------------------
// VERIFICAÇÃO EM JOGO (RCON) — ATIVA, obrigatória no cadastro manual.
//
// O /registrar manual (registerPlayerManually) exige confirmar que quem está
// cadastrando é o dono de fato do Alderon ID: o bot gera um código, manda via
// RCON (`SystemMessage <username> <código>` — o comando espera o USERNAME da
// Alderon Games/nome em jogo, NÃO o Alderon ID, diferente de kick/ban que
// aceitam <Username/AGID> — ver PoTConfigSystem.executeRconCommand) para o
// jogador NO SERVIDOR ONDE o /registrar foi rodado — por isso o jogador
// precisa estar ONLINE nesse servidor específico no momento (ver
// getOnlinePotPlayer abaixo, que também devolve o player_name REAL vindo do
// webhook — mais confiável que o nome digitado à mão no modal). O código em
// si é staged no SessionManager entre o modal de cadastro e o modal de
// confirmação (ver playerRegistrationSystem.js) — não passa pelo banco,
// então não precisa de coluna própria; só o resultado final (verified_ingame,
// em player_links, GLOBAL) é persistido, via
// registerPlayerManually(..., verified=true).
//
// Vínculos confirmados automaticamente pela própria Alderon (webhook com
// DiscordId — ver _syncGlobalLinkFromWebhook) já são marcados verified_ingame
// = 1 direto, sem precisar desse fluxo — são pelo menos tão confiáveis.
// ---------------------------------------------------------------------------

/**
 * Gera um código numérico de 6 dígitos para verificação em jogo.
 * @returns {string}
 */
function generateVerificationCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Busca o jogador ONLINE agora no servidor de jogo configurado para esta
 * guild — pré-condição pra mandar o código de verificação via RCON (sem
 * isso, o SystemMessage não chega a ninguém, mas o comando RCON "funciona"
 * mesmo assim, dando uma falsa sensação de sucesso). Devolve a linha inteira
 * (não só um booleano) porque player_name é o USERNAME real vindo do
 * webhook — é ele, não o Alderon ID, que o comando SystemMessage espera
 * como alvo.
 *
 * @param {string} guildId
 * @param {string} alderonId
 * @returns {{ player_name: string } | null} null se não encontrado/offline
 */
function getOnlinePotPlayer(guildId, alderonId) {
    if (!guildId || !alderonId) return null;
    try {
        const row = db.prepare(`
            SELECT * FROM pot_players WHERE guild_id = ? AND alderon_id = ? AND is_online = 1
        `).get(guildId, alderonId);
        return row || null;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao checar status online:', error);
        return null;
    }
}

/**
 * Nome de exibição de um jogador só pelo Alderon ID, independente de estar
 * vinculado (/registrar) ou online — usado nos painéis de identificação de
 * /strike ingame/personalizado quando o alvo não tem conta Discord
 * conhecida, pra mostrar algo melhor que o AGID cru. Busca em pot_players
 * (visto em QUALQUER evento de webhook desta guild, não só quem já
 * registrou), pega o registro mais recente. Retorna null se o AGID nunca
 * apareceu em nenhum evento desta guild.
 *
 * @param {string} guildId
 * @param {string} alderonId
 * @returns {string|null}
 */
function getPlayerNameByAlderonId(guildId, alderonId) {
    if (!guildId || !alderonId) return null;
    try {
        const row = db.prepare(`
            SELECT player_name FROM pot_players WHERE guild_id = ? AND alderon_id = ? ORDER BY updated_at DESC LIMIT 1
        `).get(guildId, alderonId);
        return row?.player_name || null;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar nome por Alderon ID:', error);
        return null;
    }
}

/**
 * Busca o vínculo global pelo Discord ID, se houver.
 *
 * @param {string} discordId
 * @returns {{ alderon_id: string, player_name: string, banner_message_id: string|null } | null}
 */
function getPlayerByDiscordId(discordId) {
    if (!discordId) return null;
    try {
        return db.prepare(`
            SELECT alderon_id, player_name, banner_message_id, selected_photo_key,
                   profile_title, selected_badge_key, background_message_id,
                   selected_background_key, hide_kda
            FROM player_links WHERE user_id = ?
        `).get(discordId) || null;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar jogador por discord_id:', error);
        return null;
    }
}

/**
 * Define (ou remove, se messageId for null) o banner de perfil personalizado
 * do jogador — recurso do Player Premium Raptor (ver /perfil-edit). Guarda
 * o ID da mensagem no canal de armazenamento (BANNER_STORAGE_CHANNEL_ID),
 * NÃO a URL do anexo — URLs de anexo do Discord expiram (~24h), a mensagem
 * em si não; a URL é resolvida na hora, refazendo o fetch da mensagem
 * sempre que o perfil é exibido (ver playerRegistrationSystem.sendProfile).
 * Só atualiza se já existir um vínculo (usuário precisa ter rodado
 * /registrar antes de poder ter um banner).
 *
 * @param {string} discordId
 * @param {string|null} messageId
 * @returns {boolean} sucesso (false se o usuário não tem vínculo ainda)
 */
function setBannerMessageId(discordId, messageId) {
    try {
        const result = db.prepare(`
            UPDATE player_links SET banner_message_id = ?, updated_at = ? WHERE user_id = ?
        `).run(messageId, Math.floor(Date.now() / 1000), discordId);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao salvar banner de perfil:', error);
        return false;
    }
}

/**
 * Foto de perfil escolhida num menu (Player Premium Compy) — guarda a
 * CHAVE do imageManager (ex: "foto_perfil_05"), não um arquivo próprio.
 * @param {string} discordId
 * @param {string|null} photoKey
 * @returns {boolean} sucesso (false se o usuário não tem vínculo ainda)
 */
function setSelectedPhotoKey(discordId, photoKey) {
    try {
        const result = db.prepare(`
            UPDATE player_links SET selected_photo_key = ?, updated_at = ? WHERE user_id = ?
        `).run(photoKey, Math.floor(Date.now() / 1000), discordId);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao salvar foto de perfil escolhida:', error);
        return false;
    }
}

/**
 * Título customizado do card de perfil (Player Premium Raptor, texto
 * livre) — ver /perfil-edit.
 * @param {string} discordId
 * @param {string|null} title
 * @returns {boolean} sucesso (false se o usuário não tem vínculo ainda)
 */
function setProfileTitle(discordId, title) {
    try {
        const result = db.prepare(`
            UPDATE player_links SET profile_title = ?, updated_at = ? WHERE user_id = ?
        `).run(title, Math.floor(Date.now() / 1000), discordId);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao salvar título de perfil:', error);
        return false;
    }
}

/**
 * Emblema escolhido de uma lista fixa (Player Premium Compy/Raptor) — ver
 * /perfil-edit.
 * @param {string} discordId
 * @param {string|null} badgeKey
 * @returns {boolean} sucesso (false se o usuário não tem vínculo ainda)
 */
function setSelectedBadgeKey(discordId, badgeKey) {
    try {
        const result = db.prepare(`
            UPDATE player_links SET selected_badge_key = ?, updated_at = ? WHERE user_id = ?
        `).run(badgeKey, Math.floor(Date.now() / 1000), discordId);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao salvar emblema escolhido:', error);
        return false;
    }
}

/**
 * ID da mensagem que guarda o upload do PLANO DE FUNDO (Player Premium
 * Raptor) — mesmo padrão de setBannerMessageId, mas pro banner que
 * aparece atrás da mensagem inteira do /perfil, não o recorte de foto de
 * dentro do card.
 * @param {string} discordId
 * @param {string|null} messageId
 * @returns {boolean} sucesso (false se o usuário não tem vínculo ainda)
 */
function setBackgroundMessageId(discordId, messageId) {
    try {
        const result = db.prepare(`
            UPDATE player_links SET background_message_id = ?, updated_at = ? WHERE user_id = ?
        `).run(messageId, Math.floor(Date.now() / 1000), discordId);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao salvar plano de fundo:', error);
        return false;
    }
}

/**
 * Plano de fundo escolhido num menu (Player Premium Compy) — guarda a
 * CHAVE do imageManager, mesmo padrão de setSelectedPhotoKey.
 * @param {string} discordId
 * @param {string|null} backgroundKey
 * @returns {boolean} sucesso (false se o usuário não tem vínculo ainda)
 */
function setSelectedBackgroundKey(discordId, backgroundKey) {
    try {
        const result = db.prepare(`
            UPDATE player_links SET selected_background_key = ?, updated_at = ? WHERE user_id = ?
        `).run(backgroundKey, Math.floor(Date.now() / 1000), discordId);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao salvar plano de fundo escolhido:', error);
        return false;
    }
}

/**
 * Liga/desliga a linha de Kills/Deaths/K-D no /perfil — disponível pra
 * qualquer tier com acesso a /perfil-edit (Compy/Raptor).
 * @param {string} discordId
 * @param {boolean} hide
 * @returns {boolean} sucesso (false se o usuário não tem vínculo ainda)
 */
function setHideKda(discordId, hide) {
    try {
        const result = db.prepare(`
            UPDATE player_links SET hide_kda = ?, updated_at = ? WHERE user_id = ?
        `).run(hide ? 1 : 0, Math.floor(Date.now() / 1000), discordId);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao salvar preferência de esconder KDA:', error);
        return false;
    }
}

/**
 * Monta o sufixo "|ID ALDERON:xxx-xxx-xxx" usado nas linhas de identificação
 * de usuário nos containers (strike, unstrike, repset, historico, reportchat).
 * Retorna string vazia se o jogador ainda não tiver vínculo — nesse caso a
 * linha de identificação deve simplesmente omitir o Alderon ID.
 *
 * @param {string} discordId
 * @returns {string}
 */
function getAlderonIdSuffix(discordId) {
    const player = getPlayerByDiscordId(discordId);
    return player ? `|ID ALDERON:${player.alderon_id}` : '';
}

/**
 * Estatísticas do jogador pro card do /perfil, agregadas GLOBALMENTE — cada
 * linha de pot_players é atividade de UM servidor, mas o /perfil é global.
 * Status/espécie/growth vêm da linha mais recente (updated_at) entre todos
 * os servidores em que esse Alderon ID já jogou; tempo de jogo/kills/deaths
 * são a SOMA entre todos os servidores (estatística de carreira, não só do
 * servidor mais recente).
 *
 * @param {string} alderonId
 * @returns {{ isOnline: boolean, dinosaurActive: boolean, dinosaurType: string|null, dinosaurGrowth: number|null, totalPlaytime: number, kills: number, deaths: number }}
 */
function getGlobalPlayerStats(alderonId) {
    const empty = { isOnline: false, dinosaurActive: false, dinosaurType: null, dinosaurGrowth: null, totalPlaytime: 0, kills: 0, deaths: 0 };
    if (!alderonId) return empty;
    try {
        const latest = db.prepare(`
            SELECT is_online, dinosaur_type, dinosaur_growth, dinosaur_active FROM pot_players
            WHERE alderon_id = ? ORDER BY updated_at DESC LIMIT 1
        `).get(alderonId);
        const totals = db.prepare(`
            SELECT SUM(total_playtime) as playtime, SUM(kills) as kills, SUM(deaths) as deaths
            FROM pot_players WHERE alderon_id = ?
        `).get(alderonId);

        return {
            isOnline: !!latest?.is_online,
            dinosaurActive: !!latest?.dinosaur_active,
            dinosaurType: latest?.dinosaur_type || null,
            dinosaurGrowth: latest?.dinosaur_growth ?? null,
            totalPlaytime: totals?.playtime || 0,
            kills: totals?.kills || 0,
            deaths: totals?.deaths || 0,
        };
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar estatísticas globais:', error);
        return empty;
    }
}

/**
 * Estatísticas do jogador pro card do /perfil, escopadas a UM servidor —
 * mesmo formato de getGlobalPlayerStats, mas sem somar entre servidores
 * (guild_id+alderon_id é UNIQUE em pot_players, então é uma linha só, sem
 * precisar de SUM). Usada a partir do /perfil ter virado público: mostrar
 * o total GLOBAL (somado de todo servidor que o bot atende) numa mensagem
 * visível pra comunidade de UM servidor específico confundia mais do que
 * ajudava — pedido do dono pra escopar por servidor e avisar isso na tela.
 *
 * @param {string} guildId
 * @param {string} alderonId
 * @returns {{ isOnline: boolean, dinosaurActive: boolean, dinosaurType: string|null, dinosaurGrowth: number|null, totalPlaytime: number, kills: number, deaths: number }}
 */
function getGuildPlayerStats(guildId, alderonId) {
    const empty = { isOnline: false, dinosaurActive: false, dinosaurType: null, dinosaurGrowth: null, totalPlaytime: 0, kills: 0, deaths: 0 };
    if (!guildId || !alderonId) return empty;
    try {
        const row = db.prepare(`
            SELECT is_online, dinosaur_type, dinosaur_growth, dinosaur_active, total_playtime, kills, deaths, session_started_at
            FROM pot_players WHERE guild_id = ? AND alderon_id = ?
        `).get(guildId, alderonId);

        // total_playtime só é somado quando a sessão TERMINA (ver
        // upsertPlayerFromEvent) — sozinho, ficaria "parado" no /perfil pra
        // quem está jogando agora. Enquanto online, soma o tempo AO VIVO da
        // sessão atual (agora - session_started_at) por cima do acumulado.
        const liveSeconds = (row?.is_online && row?.session_started_at)
            ? Math.max(0, Math.floor((Date.now() - row.session_started_at) / 1000))
            : 0;

        return {
            isOnline: !!row?.is_online,
            dinosaurActive: !!row?.dinosaur_active,
            dinosaurType: row?.dinosaur_type || null,
            dinosaurGrowth: row?.dinosaur_growth ?? null,
            totalPlaytime: (row?.total_playtime || 0) + liveSeconds,
            kills: row?.kills || 0,
            deaths: row?.deaths || 0,
        };
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar estatísticas do servidor:', error);
        return empty;
    }
}

/**
 * Contabiliza um evento PlayerKilled — +1 kill pro matador, +1 death pra
 * vítima, no servidor (guild) onde o evento aconteceu. Identifica os dois
 * jogadores por KillerAlderonId/VictimAlderonId (campos oficiais do payload
 * PlayerKilled — diferente dos demais eventos, que usam só "AlderonId").
 * Cria a linha em pot_players se ainda não existir (jogador pode nunca ter
 * disparado um PlayerLogin registrado, em teoria).
 *
 * @param {string} guildId
 * @param {object} rawPayload
 */
function recordKillEvent(guildId, rawPayload) {
    if (!guildId || !rawPayload) return;
    const killerAlderonId = rawPayload.KillerAlderonId ? String(rawPayload.KillerAlderonId).trim() : null;
    const victimAlderonId = rawPayload.VictimAlderonId ? String(rawPayload.VictimAlderonId).trim() : null;
    const killerName = rawPayload.KillerName ? String(rawPayload.KillerName).trim() : 'Desconhecido';
    const victimName = rawPayload.VictimName ? String(rawPayload.VictimName).trim() : 'Desconhecido';
    const now = Date.now();

    const bump = (alderonId, playerName, column) => {
        if (!alderonId) return;
        try {
            const result = db.prepare(`
                UPDATE pot_players SET ${column} = ${column} + 1, updated_at = ? WHERE guild_id = ? AND alderon_id = ?
            `).run(Math.floor(now / 1000), guildId, alderonId);

            if (result.changes === 0) {
                db.prepare(`
                    INSERT INTO pot_players (guild_id, alderon_id, player_name, ${column}, last_seen, first_login_at, updated_at)
                    VALUES (?, ?, ?, 1, ?, ?, ?)
                `).run(guildId, alderonId, playerName, now, now, Math.floor(now / 1000));
            }
        } catch (error) {
            console.error(`❌ [PoT Registry] Erro ao contabilizar ${column} de ${playerName}:`, error);
        }
    };

    bump(killerAlderonId, killerName, 'kills');
    bump(victimAlderonId, victimName, 'deaths');

    // Vítima morreu — volta pra tela de seleção de dinossauro (ver
    // dinosaur_active em upsertPlayerFromEvent/getGlobalPlayerStats).
    if (victimAlderonId) {
        try {
            db.prepare(`UPDATE pot_players SET dinosaur_active = 0 WHERE guild_id = ? AND alderon_id = ?`)
                .run(guildId, victimAlderonId);
        } catch (error) {
            console.error('❌ [PoT Registry] Erro ao zerar dinosaur_active da vítima:', error);
        }
    }
}

module.exports = {
    upsertPlayerFromEvent,
    getPlayerByDiscordId,
    getPlayerByAlderonId,
    getAlderonIdSuffix,
    getGlobalPlayerStats,
    getGuildPlayerStats,
    getMostPlayedDinosaur,
    recordKillEvent,
    registerPlayerManually,
    setBannerMessageId,
    setSelectedPhotoKey,
    setProfileTitle,
    setSelectedBadgeKey,
    setBackgroundMessageId,
    setSelectedBackgroundKey,
    setHideKda,
    // Verificação em jogo (RCON) — ativa, ver /registrar.
    generateVerificationCode,
    getOnlinePotPlayer,
    getPlayerNameByAlderonId,
    // Exportados para uso em testes ou composição futura do Gateway:
    normalizeEvent,
    sanitizeDinosaurType,
    ONLINE_EVENTS,
    OFFLINE_EVENTS,
};