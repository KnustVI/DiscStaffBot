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
const LevelSystem = require('./levelSystem');

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

// BUG REAL corrigido (pedido do dono, 2026-08-19: "Tp no mapa Gondwa não
// funcionou por ver o player no mapa Island... Island = Gondwa neste
// caso"). O campo MapName/Map que o webhook do jogo manda usa o codinome
// INTERNO do mapa, não o nome público que o admin conhece e digita ao
// criar um item de teleporte na Loja de Jogo — current_map chegava como
// "Island", nunca batendo contra o "Gondwa" configurado no item, então a
// verificação de mapa (ver gameShopSystem.js#useGameShopItem) bloqueava
// teleportes válidos achando que o jogador estava em outro mapa. Só este
// par confirmado por enquanto — adicionar outros aqui SÓ conforme forem
// confirmados ao vivo (nunca chutar um codinome sem confirmação, mesmo
// espírito de sanitizeDinosaurType acima). Chave sempre minúscula
// (comparação case-insensitive); valor é o nome público de exibição.
const MAP_NAME_ALIASES = {
    island: 'Gondwa',
};
function _normalizeMapName(raw) {
    if (!raw) return raw;
    const trimmed = String(raw).trim();
    const alias = MAP_NAME_ALIASES[trimmed.toLowerCase()];
    return alias || trimmed;
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

    // Mapa atual do jogador (pedido do dono, 2026-08-18: verificação de
    // segurança do item de teleporte da Loja de Jogo) — mesmos campos já
    // confirmados ao vivo em extractLocationParts (webhookPayloads.js),
    // duplicado aqui de propósito (mesmo padrão de auto-contenção já usado
    // por aquele arquivo, evita um require circular com potPlayerRegistry).
    // Nem todo evento traz esse campo — upsertPlayerFromEvent trata do
    // mesmo jeito de dinosaurType/dinosaurGrowth acima, nunca sobrescreve
    // com null.
    const mapName = _normalizeMapName(rawPayload.MapName || rawPayload.Map || null);

    return {
        alderonId: String(alderonId).trim(),
        playerName: String(playerName).trim(),
        isOnline,
        sessionSeconds: extractSessionSeconds(rawPayload),
        discordId: extractDiscordId(rawPayload),
        dinosaurType,
        dinosaurGrowth: Number.isNaN(dinosaurGrowth) ? null : dinosaurGrowth,
        mapName,
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

    const { alderonId, playerName, isOnline, sessionSeconds, discordId, dinosaurType, dinosaurGrowth, mapName } = normalized;
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
                    linked_at, first_login_at, updated_at, admin_notes, current_map
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                mapName,
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
        // Mesmo padrão de dinosaur_type acima — nem todo evento traz
        // MapName/Map, então só sobrescreve quando o payload realmente
        // trouxe esse dado (ver normalizeEvent).
        const newCurrentMap = mapName !== null ? mapName : existing.current_map;

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
                updated_at = ?,
                current_map = ?
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
            newCurrentMap,
            guildId,
            alderonId,
        );

        if (discordId) _syncGlobalLinkFromWebhook(discordId, alderonId, playerName);
        if (shouldRecordDinosaurPick) _recordDinosaurPick(guildId, alderonId, dinosaurType);
        // DEPOIS do sync acima de propósito — se este mesmo evento acabou
        // de criar o vínculo (discord_id vindo do próprio jogo), a
        // sessão que fechou agora já entra creditando moeda, em vez de
        // precisar de um PRÓXIMO login/logout pra "descobrir" o vínculo.
        if (sessionSecondsToAdd) _creditPlaytimeCurrency(guildId, alderonId, sessionSecondsToAdd);
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
 * Espelha _recordDinosaurPick acima, só que pra espécie ABATIDA (vítima),
 * não jogada — alimenta o requisito "species_kills" de achievementSystem.js
 * (pedido do dono, 2026-08-14: "Matou 'especie' especifica"). Chamada de
 * dentro de recordKillEvent, abaixo, com a espécie da VÍTIMA já sanitizada.
 *
 * @param {string} guildId
 * @param {string} killerAlderonId
 * @param {string} victimSpecies
 */
function _recordSpeciesKill(guildId, killerAlderonId, victimSpecies) {
    try {
        db.prepare(`
            INSERT INTO pot_species_kills (guild_id, alderon_id, species_killed, kill_count, updated_at)
            VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(guild_id, alderon_id, species_killed) DO UPDATE SET
                kill_count = kill_count + 1,
                updated_at = excluded.updated_at
        `).run(guildId, killerAlderonId, victimSpecies, Math.floor(Date.now() / 1000));
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao registrar abate de espécie:', error);
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
 * Catálogo de espécies já vistas neste servidor — deriva de
 * pot_dinosaur_picks (já grava toda espécie que algum jogador spawnou,
 * incrementado em _recordDinosaurPick acima a cada PlayerRespawn), sem
 * precisar de tabela nova. Usado pelo seletor de espécies do painel de
 * admin da Loja de Jogo (restrição por espécie dos itens de Growth) — ver
 * src/systems/pot/gameShopSystem.js.
 *
 * @param {string} guildId
 * @returns {string[]}
 */
function getKnownSpecies(guildId) {
    if (!guildId) return [];
    try {
        const rows = db.prepare(`
            SELECT DISTINCT dinosaur_type
            FROM pot_dinosaur_picks
            WHERE guild_id = ? AND dinosaur_type IS NOT NULL AND dinosaur_type != ''
            ORDER BY dinosaur_type COLLATE NOCASE
        `).all(guildId);
        return rows.map(r => r.dinosaur_type);
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar catálogo de espécies:', error);
        return [];
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
 * Status "em jogo" de um jogador numa guild específica — SEMPRE devolve
 * algo (isOnline: false quando offline/nunca visto), diferente de
 * getOnlinePotPlayer acima (que só devolve linha quando ESTÁ online, null
 * caso contrário). Fonte única pra "está online agora nesta guild + há
 * quanto tempo + jogando qual dinossauro" (pedido do dono, 2026-08-11:
 * "verificar se em todos os casos de verificação de player online podemos
 * usar uma query") — antes /staffonline (Discord) e getServerPulse/rota de
 * perfil avulso (dashboard.js) cada um escrevia a MESMA `SELECT is_online,
 * session_started_at... FROM pot_players WHERE guild_id = ? AND
 * alderon_id = ?` na mão, podendo divergir silenciosamente se um dos 3
 * fosse ajustado sem lembrar dos outros 2.
 * @param {string} guildId
 * @param {string} alderonId
 * @returns {{ isOnline: boolean, sessionStartedAt: number|null, dinosaurType: string|null }}
 */
function getPlayerGameStatus(guildId, alderonId) {
    const empty = { isOnline: false, sessionStartedAt: null, dinosaurType: null };
    if (!guildId || !alderonId) return empty;
    try {
        const row = db.prepare(`
            SELECT is_online, session_started_at, dinosaur_type FROM pot_players WHERE guild_id = ? AND alderon_id = ?
        `).get(guildId, alderonId);
        if (!row) return empty;
        return {
            isOnline: !!row.is_online,
            sessionStartedAt: row.session_started_at || null,
            dinosaurType: row.dinosaur_type || null,
        };
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar status em jogo:', error);
        return empty;
    }
}

/**
 * Reconcilia `is_online` com uma lista de nomes REALMENTE conectados agora,
 * vinda de uma fonte externa confiável (Source Query A2S_PLAYER, ver
 * sourceQueryClient.js / onlineStatusWorker.js) — corrige o desvio que os
 * webhooks sozinhos não cobrem: PlayerLogout/PlayerLeave nunca dispara numa
 * queda abrupta (crash, ban, perda de conexão), então o registro fica preso
 * "online" pra sempre; mais raro, um PlayerLogin perdido (gateway fora do
 * ar num instante exato) deixa alguém realmente online aparecendo como
 * offline. Pedido do dono, 2026-08-11: "vários relatos de problema de
 * identificar o jogador online, pra registro, pra ver staff online".
 *
 * Casamento por NOME (não Alderon ID — A2S_PLAYER não expõe isso, só o
 * nome em jogo) — correção de MELHOR ESFORÇO por cima dos webhooks, que
 * continuam sendo a fonte PRIMÁRIA; nomes duplicados entre jogadores
 * diferentes (raro) podem confundir a correção, aceito como limitação.
 *
 * Direção OFFLINE (banco diz online, lista viva não tem o jogador): fecha
 * a sessão com o MESMO efeito colateral de um logout normal (soma o tempo
 * decorrido em total_playtime, credita moeda por hora jogada, limpa
 * session_started_at) — só assim o /perfil e a economia não perdem o tempo
 * dessa sessão só porque o evento de saída nunca chegou.
 *
 * Direção ONLINE (banco diz offline, lista viva TEM o jogador): só
 * corrige jogadores JÁ CONHECIDOS nesta guild — sem Alderon ID vindo do
 * A2S, não dá pra criar um cadastro novo só a partir do nome.
 *
 * Bounded por design: nunca varre a tabela inteira — só as linhas
 * atualmente `is_online = 1` (tende a ser pequeno) e uma busca pontual por
 * nome pra cada jogador da lista viva (tende a ser pequeno também).
 *
 * Precisão do tempo de jogo (pedido do dono, 2026-08-12: "deixar o mais
 * preciso possível o tempo de jogo") — na direção ONLINE, `durationSeconds`
 * (quando o chamador tiver essa informação, ver A2S_PLAYER em
 * sourceQueryClient.js) é usado pra calcular o INÍCIO real da sessão
 * (`agora - duração`), em vez de assumir que a sessão começou agora. Sem
 * isso, um jogador só detectado como online numa reconciliação (webhook de
 * PlayerLogin perdido) tinha o tempo de sessão SUBESTIMADO em até o
 * intervalo entre execuções do worker — o servidor de jogo já sabe a
 * duração real da conexão, não precisa ser um palpite nosso. Na direção
 * OFFLINE não tem o que corrigir da mesma forma: uma vez que o jogador
 * desconecta, ele simplesmente some da próxima resposta do Source Query,
 * sem informar quando isso aconteceu de verdade.
 *
 * @param {string} guildId
 * @param {{name: string, durationSeconds?: number}[]} livePlayers - jogadores
 *   em jogo retornados pelo Source Query agora (formato de queryPlayers, ver
 *   sourceQueryClient.js) — durationSeconds ausente/inválido cai no
 *   comportamento antigo (sessão começando agora).
 * @returns {{ correctedOffline: number, correctedOnline: number }}
 */
function reconcileOnlineStatus(guildId, livePlayers) {
    const result = { correctedOffline: 0, correctedOnline: 0 };
    if (!guildId || !Array.isArray(livePlayers)) return result;

    const liveEntries = livePlayers
        .map((p) => ({ name: String(p?.name || '').trim(), durationSeconds: Number.isFinite(p?.durationSeconds) ? p.durationSeconds : null }))
        .filter((p) => p.name);
    const liveSet = new Set(liveEntries.map((p) => p.name.toLowerCase()));
    const now = Date.now();

    try {
        const staleOnline = db.prepare(`SELECT * FROM pot_players WHERE guild_id = ? AND is_online = 1`).all(guildId);
        for (const player of staleOnline) {
            if (liveSet.has(String(player.player_name || '').trim().toLowerCase())) continue;

            const sessionSeconds = player.session_started_at
                ? Math.max(0, Math.floor((now - player.session_started_at) / 1000))
                : 0;
            const newTotalPlaytime = sessionSeconds ? (player.total_playtime || 0) + sessionSeconds : player.total_playtime;

            db.prepare(`
                UPDATE pot_players SET is_online = 0, session_started_at = NULL, total_playtime = ?, updated_at = ?
                WHERE guild_id = ? AND alderon_id = ?
            `).run(newTotalPlaytime, Math.floor(now / 1000), guildId, player.alderon_id);

            if (sessionSeconds) _creditPlaytimeCurrency(guildId, player.alderon_id, sessionSeconds);
            result.correctedOffline++;
        }

        for (const { name, durationSeconds } of liveEntries) {
            const row = db.prepare(`
                SELECT alderon_id FROM pot_players WHERE guild_id = ? AND player_name = ? COLLATE NOCASE AND is_online = 0
            `).get(guildId, name);
            if (!row) continue;

            const sessionStartedAt = durationSeconds !== null ? now - (durationSeconds * 1000) : now;

            db.prepare(`
                UPDATE pot_players SET is_online = 1, session_started_at = ?, updated_at = ? WHERE guild_id = ? AND alderon_id = ?
            `).run(sessionStartedAt, Math.floor(now / 1000), guildId, row.alderon_id);
            result.correctedOnline++;
        }
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao reconciliar status online:', error);
    }

    return result;
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
            SELECT user_id, alderon_id, player_name, banner_message_id, selected_photo_key,
                   profile_title, selected_badge_key, background_message_id,
                   selected_background_key, hide_kda, registered_at
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
 * Saldo de Ossos (Bones, moeda da Loja de Jogo — ver PREMIUM.txt seção
 * 122) do jogador NUM SERVIDOR ESPECÍFICO — reforma 2026-08-15 (pedido do
 * dono: "vamos mudar os ossos, gostaria que ossos fossem um saldo por
 * servidor"), ver docblock de pot_player_bones em schema.js. 0 se ele
 * nunca ganhou/gastou Ossos NESTE servidor (sem linha ainda, ou sem
 * vínculo nenhum) — nunca null, sempre seguro pra exibir/somar direto.
 * @param {string} discordId
 * @param {string} guildId
 * @returns {number}
 */
function getBonesBalance(discordId, guildId) {
    if (!discordId || !guildId) return 0;
    try {
        const row = db.prepare(`SELECT balance FROM pot_player_bones WHERE user_id = ? AND guild_id = ?`).get(discordId, guildId);
        return row ? row.balance : 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar saldo de Ossos:', error);
        return 0;
    }
}

/**
 * Credita Ossos ao jogador NUM SERVIDOR ESPECÍFICO (ex: conversão
 * Marks->Ossos concluída com sucesso via RCON, ver currencySystem.js) —
 * sempre soma, sem checagem de limite superior. Upsert: cria a linha em
 * pot_player_bones se ainda não existir.
 * @param {string} discordId
 * @param {string} guildId
 * @param {number} amount - inteiro positivo
 * @returns {boolean} true se creditou de verdade
 */
function addBones(discordId, guildId, amount) {
    if (!discordId || !guildId || !Number.isInteger(amount) || amount <= 0) return false;
    try {
        const result = db.prepare(`
            INSERT INTO pot_player_bones (user_id, guild_id, balance, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, guild_id) DO UPDATE SET
                balance = balance + excluded.balance,
                updated_at = excluded.updated_at
        `).run(discordId, guildId, amount, Math.floor(Date.now() / 1000));
        return result.changes > 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao creditar Ossos:', error);
        return false;
    }
}

/**
 * Debita Ossos do jogador NUM SERVIDOR ESPECÍFICO se ele tiver saldo
 * suficiente NAQUELE servidor — checa e desconta na MESMA query (WHERE
 * balance >= ?), atômico o suficiente pra evitar 2 gastos simultâneos do
 * mesmo jogador NO MESMO servidor descontando saldo que já não existia
 * mais (better-sqlite3 é síncrono, então não há como uma segunda chamada
 * entrelaçar no meio desta). Nunca cria linha (UPDATE puro) — sem linha
 * pra este par jogador+servidor, `changes` é 0, mesmo resultado de saldo
 * insuficiente.
 * @param {string} discordId
 * @param {string} guildId
 * @param {number} amount - inteiro positivo
 * @returns {boolean} true se debitou de verdade, false se saldo insuficiente/sem linha
 */
function spendBones(discordId, guildId, amount) {
    if (!discordId || !guildId || !Number.isInteger(amount) || amount <= 0) return false;
    try {
        const result = db.prepare(`
            UPDATE pot_player_bones SET balance = balance - ?, updated_at = ?
            WHERE user_id = ? AND guild_id = ? AND balance >= ?
        `).run(amount, Math.floor(Date.now() / 1000), discordId, guildId, amount);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao debitar Ossos:', error);
        return false;
    }
}

/**
 * Ajuste ADMINISTRATIVO de Ossos NUM SERVIDOR ESPECÍFICO (dev-only, ver
 * /moeda-admin) — soma OU subtrai livremente, SEM a trava de saldo mínimo
 * que spendBones tem (`WHERE balance >= amount`, falha se insuficiente).
 * Diferente de addBones (só soma) e spendBones (só subtrai, falha se
 * insuficiente), este é o único caminho que pode SUBTRAIR sem falhar por
 * saldo insuficiente — pedido do dono é "adicionar ou remover", uma
 * correção manual de suporte, não uma compra que precisa respeitar saldo.
 * Resultado nunca fica negativo (clampado em 0 — remover mais do que o
 * jogador tem apenas zera, não é erro). Upsert (cria a linha se ainda não
 * existir), mesmo padrão de addBones.
 * @param {string} discordId
 * @param {string} guildId
 * @param {number} delta - inteiro, positivo soma / negativo subtrai
 * @returns {number} saldo resultante (0 em qualquer entrada inválida)
 */
function adjustBones(discordId, guildId, delta) {
    if (!discordId || !guildId || !Number.isInteger(delta)) return getBonesBalance(discordId, guildId);
    try {
        const next = Math.max(0, getBonesBalance(discordId, guildId) + delta);
        db.prepare(`
            INSERT INTO pot_player_bones (user_id, guild_id, balance, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, guild_id) DO UPDATE SET
                balance = excluded.balance,
                updated_at = excluded.updated_at
        `).run(discordId, guildId, next, Math.floor(Date.now() / 1000));
        return next;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao ajustar Ossos (admin):', error);
        return getBonesBalance(discordId, guildId);
    }
}

// "Dia local" no formato YYYY-MM-DD — mesmo conceito/formato de
// AnalyticsSystem.getLocalDate, copiado aqui em vez de importado pra não
// criar dependência circular (analyticsSystem.js já importa este arquivo
// em purgeStaffOnRoleLoss) — mesmo padrão de duplicação já usado pra
// formatGrowth/formatPlaytime em outros arquivos deste projeto.
function _todayLocalDate() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Quantos Marks o jogador já converteu em Ossos HOJE, NUM SERVIDOR
 * ESPECÍFICO (teto diário do conversor, agora POR SERVIDOR — reforma
 * 2026-08-15, ver CurrencySystem.DAILY_MARKS_TO_BONES_LIMIT/
 * convertMarksToBones) — leitura pura, sem efeito colateral: se a data
 * guardada não é mais hoje, o total EFETIVO já é 0 sem precisar escrever
 * nada no banco agora (addMarksConvertedToday é quem grava o reset,
 * na próxima conversão bem-sucedida).
 * @param {string} discordId
 * @param {string} guildId
 * @returns {number}
 */
function getMarksConvertedToday(discordId, guildId) {
    if (!discordId || !guildId) return 0;
    try {
        const row = db.prepare(`SELECT marks_converted_today, marks_converted_date FROM pot_player_bones WHERE user_id = ? AND guild_id = ?`).get(discordId, guildId);
        if (!row) return 0;
        return row.marks_converted_date === _todayLocalDate() ? (row.marks_converted_today || 0) : 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar Marks convertidos hoje:', error);
        return 0;
    }
}

/**
 * Soma `amount` ao total de Marks convertidos HOJE NUM SERVIDOR
 * ESPECÍFICO — chamada só depois de uma conversão Marks->Ossos
 * bem-sucedida de verdade (mesmo critério de addBones logo acima).
 * Reseta sozinha pro novo dia: sempre GRAVA o total já recalculado por
 * getMarksConvertedToday (que já zera se a data mudou) mais `amount`,
 * nunca um `+ ?` cru no SQL, então não importa se a linha ainda tinha a
 * data de ontem. Upsert: cria a linha em pot_player_bones se ainda não
 * existir (sem mexer em `balance`, que essa chamada não decide).
 * @param {string} discordId
 * @param {string} guildId
 * @param {number} amount - inteiro positivo (quantidade de Marks desta conversão)
 * @returns {boolean}
 */
function addMarksConvertedToday(discordId, guildId, amount) {
    if (!discordId || !guildId || !Number.isInteger(amount) || amount <= 0) return false;
    try {
        const newTotal = getMarksConvertedToday(discordId, guildId) + amount;
        const today = _todayLocalDate();
        const result = db.prepare(`
            INSERT INTO pot_player_bones (user_id, guild_id, marks_converted_today, marks_converted_date, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, guild_id) DO UPDATE SET
                marks_converted_today = excluded.marks_converted_today,
                marks_converted_date = excluded.marks_converted_date,
                updated_at = excluded.updated_at
        `).run(discordId, guildId, newTotal, today, Math.floor(Date.now() / 1000));
        return result.changes > 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao registrar Marks convertidos hoje:', error);
        return false;
    }
}

/**
 * Saldo de Caçadas (Hunt, moeda da Loja de Personalização) — mesmo padrão
 * de getBonesBalance, ver docblock lá.
 * @param {string} discordId
 * @returns {number}
 */
function getHuntBalance(discordId) {
    if (!discordId) return 0;
    try {
        const row = db.prepare(`SELECT hunt_balance FROM player_links WHERE user_id = ?`).get(discordId);
        return row ? row.hunt_balance : 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar saldo de Caçadas:', error);
        return 0;
    }
}

/**
 * Credita Caçadas ao jogador — mesmo padrão de addBones, ver docblock lá.
 * @param {string} discordId
 * @param {number} amount - inteiro positivo
 * @returns {boolean}
 */
function addHunt(discordId, amount) {
    if (!discordId || !Number.isInteger(amount) || amount <= 0) return false;
    try {
        const result = db.prepare(`
            UPDATE player_links SET hunt_balance = hunt_balance + ?, updated_at = ? WHERE user_id = ?
        `).run(amount, Math.floor(Date.now() / 1000), discordId);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao creditar Caçadas:', error);
        return false;
    }
}

/**
 * Debita Caçadas do jogador SE ele tiver saldo suficiente — mesmo padrão
 * atômico de spendBones, ver docblock lá. Usado pela Loja de
 * Personalização (compra de imagem, ver imageShopSystem.js).
 * @param {string} discordId
 * @param {number} amount - inteiro positivo
 * @returns {boolean} true se debitou de verdade, false se saldo insuficiente/sem vínculo
 */
function spendHunt(discordId, amount) {
    if (!discordId || !Number.isInteger(amount) || amount <= 0) return false;
    try {
        const result = db.prepare(`
            UPDATE player_links SET hunt_balance = hunt_balance - ?, updated_at = ?
            WHERE user_id = ? AND hunt_balance >= ?
        `).run(amount, Math.floor(Date.now() / 1000), discordId, amount);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao debitar Caçadas:', error);
        return false
    }
}

/**
 * Ajuste ADMINISTRATIVO de Caçadas (dev-only, ver /moeda-admin) — mesmo
 * raciocínio de adjustBones (soma OU subtrai livremente, sem a trava de
 * saldo mínimo de spendHunt, resultado nunca negativo). SEMPRE um UPDATE
 * puro (nunca cria linha) — diferente de adjustBones, `player_links` só
 * existe pra quem já rodou /registrar; sem vínculo não há o que ajustar,
 * e quem chama esta função (o comando /moeda-admin) já valida isso ANTES
 * de chegar aqui, então `changes === 0` aqui não deveria acontecer na
 * prática.
 * @param {string} discordId
 * @param {number} delta - inteiro, positivo soma / negativo subtrai
 * @returns {number} saldo resultante (0 em qualquer entrada inválida)
 */
function adjustHunt(discordId, delta) {
    if (!discordId || !Number.isInteger(delta)) return getHuntBalance(discordId);
    try {
        const next = Math.max(0, getHuntBalance(discordId) + delta);
        const result = db.prepare(`UPDATE player_links SET hunt_balance = ?, updated_at = ? WHERE user_id = ?`)
            .run(next, Math.floor(Date.now() / 1000), discordId);
        // UPDATE puro nunca cria linha — sem player_links (nunca rodou
        // /registrar), `changes` é 0 e `next` NUNCA foi gravado de
        // verdade. Devolver `next` mesmo assim reportaria um saldo que
        // não existe em lugar nenhum — devolve o saldo REAL (0, sem
        // linha) em vez disso.
        return result.changes > 0 ? next : getHuntBalance(discordId);
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao ajustar Caçadas (admin):', error);
        return getHuntBalance(discordId);
    }
}

/**
 * XP acumulado (sistema de Nível, ver src/systems/pot/levelSystem.js) —
 * sempre cresce, sem conceito de "gastar" (diferente de Ossos/Caçadas, que
 * são moeda de verdade). Este arquivo só guarda o total bruto; Nível/XP
 * dentro do nível/percentual de progresso são sempre CALCULADOS a partir
 * dele (nunca armazenados) — ver getLevelProgress abaixo.
 * @param {string} discordId
 * @returns {number}
 */
function getXp(discordId) {
    if (!discordId) return 0;
    try {
        const row = db.prepare(`SELECT xp FROM player_links WHERE user_id = ?`).get(discordId);
        return row ? row.xp : 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar XP:', error);
        return 0;
    }
}

/**
 * Progressão de Nível completa do jogador (nível atual, XP dentro do
 * nível, XP necessária pro próximo nível, percentual) — ver
 * levelSystem.getLevelProgress pro formato exato do retorno. Wrapper de
 * conveniência: quem já teria que chamar getXp(discordId) primeiro só pra
 * passar pro LevelSystem usa isto direto.
 * @param {string} discordId
 * @returns {object}
 */
function getLevelProgress(discordId) {
    return LevelSystem.getLevelProgress(getXp(discordId));
}

/**
 * Registra 1 linha em player_level_ups pra cada nível efetivamente cruzado
 * entre xpBefore e xpAfter (pedido do dono: "Ao subir de nível, registrar
 * um evento de level up") — um crédito grande o bastante pra pular mais de
 * 1 nível de uma vez (ex: catch-up depois de um tempo offline) grava uma
 * linha por nível intermediário, não só a final. Chamada por addXp() e
 * _creditPlaytimeCurrency() — as 2 únicas formas de creditar XP hoje.
 * @param {string} discordId
 * @param {number} xpBefore
 * @param {number} xpAfter
 */
function _recordLevelUpsIfAny(discordId, xpBefore, xpAfter) {
    const levelBefore = LevelSystem.getLevelForXp(xpBefore);
    const levelAfter = LevelSystem.getLevelForXp(xpAfter);
    if (levelAfter <= levelBefore) return;
    try {
        const insert = db.prepare(`
            INSERT INTO player_level_ups (user_id, level, xp_total, created_at) VALUES (?, ?, ?, ?)
        `);
        const now = Math.floor(Date.now() / 1000);
        for (let level = levelBefore + 1; level <= levelAfter; level++) {
            insert.run(discordId, level, xpAfter, now);
        }
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao registrar evento de level up:', error);
    }
}

/**
 * Credita XP ao jogador — mesmo padrão de addBones/addHunt. Fonte
 * pretendida pra XP de missões (quando existir) — soma no MESMO campo
 * player_links.xp que já recebe XP de hora jogada (ver
 * _creditPlaytimeCurrency), então os dois sempre entram na mesma
 * progressão de Nível, nunca contam separado.
 * @param {string} discordId
 * @param {number} amount - inteiro positivo
 * @returns {boolean}
 */
function addXp(discordId, amount) {
    if (!discordId || !Number.isInteger(amount) || amount <= 0) return false;
    try {
        const xpBefore = getXp(discordId);
        const result = db.prepare(`
            UPDATE player_links SET xp = xp + ?, updated_at = ? WHERE user_id = ?
        `).run(amount, Math.floor(Date.now() / 1000), discordId);
        if (result.changes > 0) _recordLevelUpsIfAny(discordId, xpBefore, xpBefore + amount);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao creditar XP:', error);
        return false;
    }
}

/**
 * Converte tempo de jogo em moeda — pedido do dono, 2026-08-07: "Libere o
 * farm dos itens por hora jogada agora". Taxa original do dono (ver
 * PREMIUM.txt seção 117): 1 HORA jogada = 1 Caçada (Hunt) + 5 Ossos
 * (Bones) + 1 XP.
 *
 * Reforma 2026-08-15 (Ossos virou saldo POR SERVIDOR, pedido do dono):
 * Caçadas/XP continuam creditadas aqui, no MESMO carry GLOBAL de sempre
 * (`player_links.playtime_credit_seconds`) — inalterado. Ossos foi
 * REMOVIDO deste UPDATE e passou a ser creditado por `_creditGuildBones`
 * (logo abaixo), com um carry PRÓPRIO por servidor
 * (`pot_player_bones.playtime_credit_seconds`) — Ossos só fecha hora
 * cheia com sessões daquele MESMO servidor, nunca somando tempo jogado
 * em outro. Por isso esta função agora recebe `guildId`.
 *
 * Chamada de upsertPlayerFromEvent/reconcileOnlineStatus toda vez que uma
 * sessão de jogo fecha (mesmo `sessionSeconds` que também alimenta
 * pot_players.total_playtime — nunca um valor diferente, pra moeda e
 * "tempo total exibido" nunca discordarem entre si). Só credita se o
 * Alderon ID tiver vínculo com uma conta Discord (player_links) — sem
 * vínculo, não tem onde guardar o saldo, mesmo critério de todo o resto
 * da economia (Player Premium é sempre amarrado a um user_id do Discord).
 *
 * `playtime_credit_seconds` é a SOBRA entre uma hora fechada e outra —
 * sem ela, sessões curtas (a maioria) nunca completariam 3600s sozinhas e
 * NUNCA creditariam nada. Cada chamada soma a sobra antiga + os segundos
 * novos, credita quantas horas CHEIAS isso já forma, e guarda só o resto
 * (`% 3600`) pra próxima vez — nunca perde segundo nenhum, só atrasa o
 * crédito até fechar 3600s de verdade.
 *
 * @param {string} guildId - servidor onde a sessão que fechou aconteceu
 * @param {string} alderonId
 * @param {number} sessionSeconds - segundos da sessão que acabou de fechar
 */
function _creditPlaytimeCurrency(guildId, alderonId, sessionSeconds) {
    if (!alderonId || !sessionSeconds || sessionSeconds <= 0) return;
    try {
        const link = getPlayerByAlderonId(alderonId);
        if (!link) return; // sem vínculo Discord — nada a creditar ainda

        // xp incluído aqui (não só playtime_credit_seconds) pra ter o total
        // ANTES do crédito à mão — necessário pra _recordLevelUpsIfAny
        // abaixo saber se essa hora cruzou a fronteira de algum Nível.
        const row = db.prepare(`SELECT playtime_credit_seconds, xp FROM player_links WHERE user_id = ?`).get(link.user_id);
        const carrySeconds = (row?.playtime_credit_seconds || 0) + Math.floor(sessionSeconds);
        const hoursEarned = Math.floor(carrySeconds / 3600);
        const remainderSeconds = carrySeconds % 3600;
        const now = Math.floor(Date.now() / 1000);

        if (hoursEarned > 0) {
            db.prepare(`
                UPDATE player_links SET
                    hunt_balance = hunt_balance + ?,
                    xp = xp + ?,
                    playtime_credit_seconds = ?,
                    updated_at = ?
                WHERE user_id = ?
            `).run(hoursEarned, hoursEarned, remainderSeconds, now, link.user_id);
            _recordLevelUpsIfAny(link.user_id, row?.xp || 0, (row?.xp || 0) + hoursEarned);
        } else {
            db.prepare(`
                UPDATE player_links SET playtime_credit_seconds = ?, updated_at = ? WHERE user_id = ?
            `).run(remainderSeconds, now, link.user_id);
        }

        if (guildId) _creditGuildBones(link.user_id, guildId, sessionSeconds);
    } catch (error) {
        // BUG REAL confirmado (pedido do dono, 2026-08-19: "algo não parece
        // muito consistente no ganho de caçadas e osso" — investigado com um
        // snapshot real via diagnostico_moedas.js: total_playtime de um
        // servidor tinha ~70min A MAIS de sessões já fechadas do que o carry
        // de Caçadas refletia, mesmo jogando num único servidor o dia
        // inteiro). Causa raiz exata ainda não confirmada — PlayerLogin/
        // PlayerLogout/PlayerLeave nunca foram persistidos em pot_logs (só
        // AdminSpectate/AdminCommand/ServerModerate, ver PERSISTED_EVENTS em
        // gatewayServer.js), então não dava pra reconstruir a linha do tempo
        // de sessões de hoje pra achar o exato evento problemático. Corrigido
        // aqui: se este catch disparar de novo, agora fica REGISTRADO de
        // verdade (ErrorLogger, avisa no canal de log do sistema) em vez de
        // só um console.error que ninguém vê numa VPS remota — mesmo padrão
        // já usado em playerRegistrationSystem.js pro mesmo tipo de relato
        // ("saldo sumindo do /perfil"). Os 3 eventos passaram a ser
        // persistidos também (ver gatewayServer.js), pra a PRÓXIMA ocorrência
        // já vir com histórico de sessão reconstruível.
        const ErrorLogger = require('../core/errorLogger');
        ErrorLogger.error('potPlayerRegistry', '_creditPlaytimeCurrency', error, { guildId, alderonId, sessionSeconds });
    }
}

/**
 * Credita Ossos por hora jogada NUM SERVIDOR ESPECÍFICO — carry PRÓPRIO
 * (`pot_player_bones.playtime_credit_seconds`), totalmente separado do
 * carry global de Caçadas/XP em `_creditPlaytimeCurrency` acima. A MESMA
 * `sessionSeconds` de uma sessão alimenta os dois carries ao mesmo tempo,
 * mas cada um só fecha hora cheia (e credita) na PRÓPRIA soma — Ossos
 * deste servidor só crescem quando ESTE servidor específico acumula
 * 3600s de sessões, nunca misturado com tempo jogado em outro servidor
 * (decisão confirmada com o dono, 2026-08-15).
 * @param {string} userId
 * @param {string} guildId
 * @param {number} sessionSeconds
 */
function _creditGuildBones(userId, guildId, sessionSeconds) {
    try {
        const row = db.prepare(`SELECT playtime_credit_seconds FROM pot_player_bones WHERE user_id = ? AND guild_id = ?`).get(userId, guildId);
        const carrySeconds = (row?.playtime_credit_seconds || 0) + Math.floor(sessionSeconds);
        const hoursEarned = Math.floor(carrySeconds / 3600);
        const remainderSeconds = carrySeconds % 3600;
        const now = Math.floor(Date.now() / 1000);

        if (hoursEarned > 0) {
            db.prepare(`
                INSERT INTO pot_player_bones (user_id, guild_id, balance, playtime_credit_seconds, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id, guild_id) DO UPDATE SET
                    balance = balance + excluded.balance,
                    playtime_credit_seconds = excluded.playtime_credit_seconds,
                    updated_at = excluded.updated_at
            `).run(userId, guildId, hoursEarned * 5, remainderSeconds, now);
        } else {
            db.prepare(`
                INSERT INTO pot_player_bones (user_id, guild_id, playtime_credit_seconds, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, guild_id) DO UPDATE SET
                    playtime_credit_seconds = excluded.playtime_credit_seconds,
                    updated_at = excluded.updated_at
            `).run(userId, guildId, remainderSeconds, now);
        }
    } catch (error) {
        // Visibilidade real (ver comentário completo no catch de
        // _creditPlaytimeCurrency acima, que chama esta função) — se isto
        // falhar, só afeta Ossos (Caçadas/XP já foram creditados antes desta
        // chamada, num UPDATE separado que não depende desta função) — por
        // isso é uma causa PLAUSÍVEL isolada pra Ossos ficar pra trás de
        // Caçadas especificamente, mas não sozinha suficiente pra explicar
        // Caçadas também ficando atrás do total_playtime real (ver
        // investigação de 2026-08-19 no catch acima).
        const ErrorLogger = require('../core/errorLogger');
        ErrorLogger.error('potPlayerRegistry', '_creditGuildBones', error, { userId, guildId, sessionSeconds });
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
/**
 * Grava/limpa o grupo (matilha/pack) ATUAL de um jogador nesta guild —
 * pedido do dono, 2026-08-13: "sabemos quais grupos estão brigando"
 * (relatório de combate juntando engages sem relação entre si só porque
 * compartilham um participante). Chamado a partir de PlayerJoinedGroup/
 * PlayerLeftGroup (ver gatewayServer.js _routeToDiscord) — NUNCA a partir
 * de um evento de dano/morte, que não carrega esse campo.
 *
 * leaderAlderonId/leaderName nulos = limpa o grupo (jogador voltou a
 * solo) — é assim que PlayerLeftGroup chama esta função.
 *
 * UPDATE-only (mesmo padrão de setSelectedBadgeKey/setBackgroundMessageId
 * acima): se o jogador ainda não tem linha em pot_players nesta guild
 * (nunca disparou nenhum dos playerEvents que criam a linha — raríssimo,
 * exigiria entrar num grupo antes de qualquer login/chat/respawn já
 * processado), a atualização vira um no-op silencioso em vez de criar uma
 * linha incompleta; o grupo fica sem registro até o próximo evento normal
 * criar a linha e ele entrar/sair do grupo de novo.
 *
 * @param {string} guildId
 * @param {string} alderonId - jogador que entrou/saiu
 * @param {string|null} leaderAlderonId
 * @param {string|null} leaderName
 * @returns {boolean} true se alguma linha foi atualizada
 */
function setGroupMembership(guildId, alderonId, leaderAlderonId, leaderName) {
    if (!guildId || !alderonId) return false;
    try {
        const result = db.prepare(`
            UPDATE pot_players SET group_leader_alderon_id = ?, group_leader_name = ?, updated_at = ?
            WHERE guild_id = ? AND alderon_id = ?
        `).run(leaderAlderonId || null, leaderName || null, Math.floor(Date.now() / 1000), guildId, alderonId);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao registrar grupo do jogador:', error);
        return false;
    }
}

/**
 * Grupo ATUAL de um jogador nesta guild (ver setGroupMembership acima) —
 * null quando ele não está em nenhum grupo (ou nunca foi registrado).
 * @param {string} guildId
 * @param {string} alderonId
 * @returns {{leaderAlderonId: string, leaderName: string}|null}
 */
function getGroupMembership(guildId, alderonId) {
    if (!guildId || !alderonId) return null;
    try {
        const row = db.prepare(`
            SELECT group_leader_alderon_id, group_leader_name FROM pot_players WHERE guild_id = ? AND alderon_id = ?
        `).get(guildId, alderonId);
        if (!row || !row.group_leader_alderon_id) return null;
        return { leaderAlderonId: row.group_leader_alderon_id, leaderName: row.group_leader_name };
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar grupo do jogador:', error);
        return null;
    }
}

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

    // Espécie da vítima (requisito "species_kills") — só grava com matador
    // de verdade; morte por ambiente/queda/fome não manda KillerAlderonId
    // (vem string vazia), e nesse caso ninguém "abateu" a espécie.
    if (killerAlderonId) {
        const victimSpecies = sanitizeDinosaurType(rawPayload.VictimDinosaurType);
        if (victimSpecies) _recordSpeciesKill(guildId, killerAlderonId, victimSpecies);
    }

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
    getKnownSpecies,
    recordKillEvent,
    // Grupo (matilha/pack) atual do jogador — ver PlayerJoinedGroup/
    // PlayerLeftGroup em gatewayServer.js e docblock de setGroupMembership.
    setGroupMembership,
    getGroupMembership,
    registerPlayerManually,
    setBannerMessageId,
    setSelectedPhotoKey,
    setProfileTitle,
    setSelectedBadgeKey,
    setBackgroundMessageId,
    setSelectedBackgroundKey,
    setHideKda,
    // Saldo de Ossos (Bones) — ver currencySystem.js e /loja.
    getBonesBalance,
    addBones,
    spendBones,
    // Ajuste administrativo (dev-only, /moeda-admin) — soma/subtrai livre,
    // sem trava de saldo mínimo, resultado clampado em 0.
    adjustBones,
    // Limite diário do conversor Marks->Ossos — ver currencySystem.js.
    getMarksConvertedToday,
    addMarksConvertedToday,
    // Saldo de Caçadas (Hunt) e XP — ganhos por hora de jogo, ver
    // _creditPlaytimeCurrency (chamada de dentro de upsertPlayerFromEvent)
    // e /loja.
    getHuntBalance,
    addHunt,
    spendHunt,
    adjustHunt,
    getXp,
    addXp,
    // Progressão de Nível (infinita, ver levelSystem.js) — calculada
    // dinamicamente a partir de getXp, nunca armazenada separadamente.
    getLevelProgress,
    // Verificação em jogo (RCON) — ativa, ver /registrar.
    generateVerificationCode,
    getOnlinePotPlayer,
    // Status "em jogo" (online/há quanto tempo/dinossauro) por guild+jogador
    // — fonte única, ver docblock completo acima (pedido do dono, 2026-08-11).
    getPlayerGameStatus,
    getPlayerNameByAlderonId,
    // Reconciliação de status online via Source Query (A2S) — corrige o
    // desvio que webhooks sozinhos não cobrem (queda abrupta sem logout,
    // login perdido). Ver docblock completo acima e onlineStatusWorker.js.
    reconcileOnlineStatus,
    // Exportados para uso em testes ou composição futura do Gateway:
    normalizeEvent,
    sanitizeDinosaurType,
    ONLINE_EVENTS,
    OFFLINE_EVENTS,
};