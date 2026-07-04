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
 *     payload — o que exige o jogador ter linkado o Discord pelo site oficial
 *     do Path of Titans. Bem menos comum na prática.
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

/**
 * Cadastro/vínculo MANUAL — usado pelo comando /registrar (painel + modal).
 * Complementa upsertPlayerFromEvent (que só roda a partir de webhooks do
 * jogo): aqui o Discord ID é sempre conhecido de antemão (quem clicou no
 * botão), então o cadastro é indexado primeiro por discord_id.
 *
 * Cenários tratados:
 *  - Nada existe ainda para este discord_id nem para este alderon_id: cria
 *    uma linha nova.
 *  - Já existe uma linha para este alderon_id (ex: criada por um webhook,
 *    ainda sem discord_id vinculado, ou já vinculada a este mesmo usuário):
 *    atualiza discord_id/nome nela.
 *  - Este discord_id já está vinculado a OUTRO alderon_id: trata como
 *    re-vínculo — atualiza a linha existente do discord_id para o novo
 *    alderon_id, em vez de criar uma segunda linha para o mesmo usuário.
 *  - O alderon_id já pertence a OUTRO discord_id: rejeita (conflito real,
 *    precisa de intervenção manual da staff).
 *
 * @param {string} guildId
 * @param {string} discordId
 * @param {string} alderonId - Já validado no formato xxx-xxx-xxx pelo chamador
 * @param {string} playerName
 * @returns {{ success: boolean, created?: boolean, relinked?: boolean, error?: string }}
 *   error, quando presente, é um código curto: 'MISSING_FIELDS' | 'ALDERON_TAKEN' | 'DB_ERROR'
 */
function registerPlayerManually(guildId, discordId, alderonId, playerName) {
    if (!guildId || !discordId || !alderonId || !playerName) {
        return { success: false, error: 'MISSING_FIELDS' };
    }

    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);

    try {
        const byAlderon = db.prepare(`
            SELECT * FROM pot_players WHERE guild_id = ? AND alderon_id = ?
        `).get(guildId, alderonId);

        if (byAlderon && byAlderon.discord_id && byAlderon.discord_id !== discordId) {
            return { success: false, error: 'ALDERON_TAKEN' };
        }

        const byDiscord = db.prepare(`
            SELECT * FROM pot_players WHERE guild_id = ? AND discord_id = ?
        `).get(guildId, discordId);

        if (byDiscord && byDiscord.alderon_id !== alderonId) {
            // Re-vínculo: o usuário já tinha outro Alderon ID cadastrado.
            db.prepare(`
                UPDATE pot_players SET
                    alderon_id = ?, player_name = ?, linked_at = ?, updated_at = ?
                WHERE guild_id = ? AND discord_id = ?
            `).run(alderonId, playerName, now, nowSeconds, guildId, discordId);
            return { success: true, created: false, relinked: true };
        }

        if (byAlderon) {
            // Linha já existe para este Alderon ID (webhook ou já era este
            // mesmo usuário) — só garante o vínculo/nome atualizados.
            db.prepare(`
                UPDATE pot_players SET
                    discord_id = ?, player_name = ?, linked_at = ?, updated_at = ?
                WHERE guild_id = ? AND alderon_id = ?
            `).run(discordId, playerName, now, nowSeconds, guildId, alderonId);
            return { success: true, created: false, relinked: false };
        }

        db.prepare(`
            INSERT INTO pot_players (
                guild_id, alderon_id, player_name, discord_id,
                last_seen, total_playtime, is_online,
                linked_at, first_login_at, updated_at, admin_notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(guildId, alderonId, playerName, discordId, null, 0, 0, now, null, nowSeconds, null);

        return { success: true, created: true, relinked: false };
    } catch (error) {
        console.error('❌ [PoT Registry] Erro no cadastro manual:', error);
        return { success: false, error: 'DB_ERROR' };
    }
}

/**
 * Busca o jogador PoT por Alderon ID (qualquer guild_id específico).
 *
 * @param {string} guildId
 * @param {string} alderonId
 * @returns {object|null} linha completa de pot_players
 */
function getPlayerByAlderonId(guildId, alderonId) {
    if (!guildId || !alderonId) return null;
    try {
        return db.prepare(`
            SELECT * FROM pot_players WHERE guild_id = ? AND alderon_id = ?
        `).get(guildId, alderonId) || null;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar jogador por alderon_id:', error);
        return null;
    }
}

// ---------------------------------------------------------------------------
// VERIFICAÇÃO EM JOGO (RCON) — PREPARADO, AINDA NÃO ATIVADO.
//
// O cadastro manual (/registrar) hoje aceita o Alderon ID informado pelo
// próprio usuário sem confirmar que ele realmente é o dono daquele
// personagem no jogo. A ideia é fechar esse buraco com um código de uso
// único enviado no chat do jogo via RCON, que o jogador digita de volta no
// Discord para confirmar.
//
// As funções abaixo só mexem no banco (gerar/guardar/confirmar o código) —
// nenhuma delas é chamada pelo fluxo atual de /registrar. O envio de fato
// pelo RCON (`PoTRconClient.sendCommand`) depende de termos uma conexão
// RCON confiável em produção, o que ainda está pendente (ver conversas
// anteriores sobre ECONNREFUSED). Quando isso for resolvido, o fluxo de
// /registrar precisa ser ajustado para: gerar o código com
// generateVerificationCode(), guardar com setVerificationCode(), mandar via
// RCON (broadcast ou whisper — checar o comando certo na doc do PoT), e só
// marcar verified_ingame=1 (confirmVerification) depois do jogador informar
// o código de volta no Discord.
// ---------------------------------------------------------------------------

/**
 * Gera um código numérico de 6 dígitos para verificação em jogo.
 * @returns {string}
 */
function generateVerificationCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Guarda o código de verificação pendente para um jogador já cadastrado.
 * @returns {boolean} sucesso
 */
function setVerificationCode(guildId, alderonId, code) {
    try {
        const result = db.prepare(`
            UPDATE pot_players SET verification_code = ? WHERE guild_id = ? AND alderon_id = ?
        `).run(code, guildId, alderonId);
        return result.changes > 0;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao salvar código de verificação:', error);
        return false;
    }
}

/**
 * Confirma a verificação em jogo se o código bater, e limpa o código usado.
 * @returns {boolean} true se o código conferiu e a verificação foi confirmada
 */
function confirmVerification(guildId, alderonId, submittedCode) {
    try {
        const player = getPlayerByAlderonId(guildId, alderonId);
        if (!player || !player.verification_code || player.verification_code !== String(submittedCode).trim()) {
            return false;
        }
        db.prepare(`
            UPDATE pot_players SET verified_ingame = 1, verification_code = NULL WHERE guild_id = ? AND alderon_id = ?
        `).run(guildId, alderonId);
        return true;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao confirmar verificação:', error);
        return false;
    }
}

/**
 * Busca o jogador PoT vinculado a um Discord ID, se houver.
 *
 * O vínculo pode vir de duas fontes: o comando /registrar (manual, ver
 * registerPlayerManually) ou o payload de webhook trazer o campo
 * DiscordId/discord_id (ver extractDiscordId acima) — o que exige o servidor
 * do jogo enviar esse dado, algo que a maioria não faz.
 *
 * @param {string} guildId
 * @param {string} discordId
 * @returns {{ alderon_id: string, player_name: string } | null}
 */
function getPlayerByDiscordId(guildId, discordId) {
    if (!guildId || !discordId) return null;
    try {
        return db.prepare(`
            SELECT alderon_id, player_name FROM pot_players
            WHERE guild_id = ? AND discord_id = ?
            ORDER BY updated_at DESC LIMIT 1
        `).get(guildId, discordId) || null;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar jogador por discord_id:', error);
        return null;
    }
}

/**
 * Monta o sufixo "|ID ALDERON:xxx-xxx-xxx" usado nas linhas de identificação
 * de usuário nos containers (strike, unstrike, repset, historico, reportchat).
 * Retorna string vazia se o jogador ainda não tiver vínculo — nesse caso a
 * linha de identificação deve simplesmente omitir o Alderon ID.
 *
 * @param {string} guildId
 * @param {string} discordId
 * @returns {string}
 */
function getAlderonIdSuffix(guildId, discordId) {
    const player = getPlayerByDiscordId(guildId, discordId);
    return player ? `|ID ALDERON:${player.alderon_id}` : '';
}

module.exports = {
    upsertPlayerFromEvent,
    getPlayerByDiscordId,
    getPlayerByAlderonId,
    getAlderonIdSuffix,
    registerPlayerManually,
    // Verificação em jogo (RCON) — preparado, ainda não ativado no fluxo real.
    generateVerificationCode,
    setVerificationCode,
    confirmVerification,
    // Exportados para uso em testes ou composição futura do Gateway:
    normalizeEvent,
    ONLINE_EVENTS,
    OFFLINE_EVENTS,
};