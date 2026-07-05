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
 * @returns {{ success: boolean, created?: boolean, relinked?: boolean, error?: string }}
 *   error, quando presente, é um código curto: 'MISSING_FIELDS' | 'ALDERON_TAKEN' | 'DB_ERROR'
 */
function registerPlayerManually(discordId, alderonId, playerName) {
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
            INSERT INTO player_links (user_id, alderon_id, player_name, registered_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                alderon_id = excluded.alderon_id,
                player_name = excluded.player_name,
                updated_at = excluded.updated_at
        `).run(discordId, alderonId, playerName, now, Math.floor(now / 1000));

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
 * Continua guild-scoped de propósito — verification_code/verified_ingame são
 * campos de pot_players (atividade por servidor), não de player_links.
 * @returns {boolean} true se o código conferiu e a verificação foi confirmada
 */
function confirmVerification(guildId, alderonId, submittedCode) {
    try {
        const player = db.prepare(`
            SELECT * FROM pot_players WHERE guild_id = ? AND alderon_id = ?
        `).get(guildId, alderonId);
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
 * Busca o vínculo global pelo Discord ID, se houver.
 *
 * @param {string} discordId
 * @returns {{ alderon_id: string, player_name: string, banner_message_id: string|null } | null}
 */
function getPlayerByDiscordId(discordId) {
    if (!discordId) return null;
    try {
        return db.prepare(`
            SELECT alderon_id, player_name, banner_message_id FROM player_links WHERE user_id = ?
        `).get(discordId) || null;
    } catch (error) {
        console.error('❌ [PoT Registry] Erro ao buscar jogador por discord_id:', error);
        return null;
    }
}

/**
 * Define (ou remove, se messageId for null) o banner de perfil personalizado
 * do jogador — recurso do Player Premium Raptor (ver /perfil-banner). Guarda
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

module.exports = {
    upsertPlayerFromEvent,
    getPlayerByDiscordId,
    getPlayerByAlderonId,
    getAlderonIdSuffix,
    registerPlayerManually,
    setBannerMessageId,
    // Verificação em jogo (RCON) — preparado, ainda não ativado no fluxo real.
    generateVerificationCode,
    setVerificationCode,
    confirmVerification,
    // Exportados para uso em testes ou composição futura do Gateway:
    normalizeEvent,
    ONLINE_EVENTS,
    OFFLINE_EVENTS,
};