// /home/ubuntu/DiscStaffBot/src/systems/potPlayerRegistry.js

/**
 * potPlayerRegistry.js
 *
 * Sistema de cadastro AUTOMÁTICO de jogadores do Path of Titans.
 *
 * Não existe nenhum comando administrativo de cadastro manual — o único
 * ponto de entrada é upsertPlayerFromEvent(), chamado sempre que um evento
 * de webhook do PoT é recebido (PlayerLogin, PlayerLogout, ou qualquer outro
 * evento que traga AlderonId/PlayerName no payload).
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

const db = require('../database/index');

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

    const alderonId = rawPayload.AlderonId || rawPayload.alderon_id || null;
    if (!alderonId) return null; // sem AlderonId não há como identificar o jogador

    const playerName = rawPayload.PlayerName || rawPayload.player_name || 'Desconhecido';

    let isOnline = null;
    if (eventType) {
        if (ONLINE_EVENTS.has(eventType)) isOnline = 1;
        else if (OFFLINE_EVENTS.has(eventType)) isOnline = 0;
    }

    return {
        alderonId: String(alderonId).trim(),
        playerName: String(playerName).trim(),
        isOnline,
        sessionSeconds: extractSessionSeconds(rawPayload),
        discordId: extractDiscordId(rawPayload),
    };
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

    const { alderonId, playerName, isOnline, sessionSeconds, discordId } = normalized;
    const now = Date.now();

    try {
        const existing = db.prepare(`
            SELECT * FROM pot_players WHERE guild_id = ? AND alderon_id = ?
        `).get(guildId, alderonId);

        if (!existing) {
            // ── Jogador novo: cadastro automático ────────────────────────────
            db.prepare(`
                INSERT INTO pot_players (
                    guild_id, alderon_id, player_name, discord_id,
                    last_seen, total_playtime, is_online,
                    linked_at, first_login_at, updated_at, admin_notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                guildId,
                alderonId,
                playerName,
                discordId || null,
                now,
                sessionSeconds || 0,
                isOnline === null ? 0 : isOnline,
                discordId ? now : null,   // linked_at só se já veio com discord_id
                now,                       // first_login_at — primeira vez que vemos este jogador
                Math.floor(now / 1000),    // updated_at é em segundos (strftime('%s'))
                null,
            );

            console.log(`🦖 [PoT Registry] Novo jogador cadastrado: ${playerName} (${alderonId})`);
            return { created: true, alderonId };
        }

        // ── Jogador já existe: atualizar apenas o que é relevante ─────────────
        const newTotalPlaytime = sessionSeconds
            ? (existing.total_playtime || 0) + sessionSeconds
            : existing.total_playtime;

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

        db.prepare(`
            UPDATE pot_players SET
                player_name = ?,
                discord_id = ?,
                last_seen = ?,
                total_playtime = ?,
                is_online = ?,
                linked_at = ?,
                updated_at = ?
            WHERE guild_id = ? AND alderon_id = ?
        `).run(
            playerName,
            newDiscordId,
            now,
            newTotalPlaytime,
            newIsOnline,
            newLinkedAt,
            Math.floor(now / 1000),
            guildId,
            alderonId,
        );

        return { created: false, alderonId };
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao cadastrar/atualizar jogador:', error);
        return null;
    }
}

module.exports = {
    upsertPlayerFromEvent,
    // Exportados para uso em testes ou composição futura do Gateway:
    normalizeEvent,
    ONLINE_EVENTS,
    OFFLINE_EVENTS,
};