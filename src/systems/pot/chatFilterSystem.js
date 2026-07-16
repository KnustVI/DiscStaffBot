// src/systems/pot/chatFilterSystem.js
/**
 * Filtro de palavras do chat em jogo (Global/Grupo) — quando um jogador
 * escreve uma palavra filtrada, aplica automaticamente o nível de punição
 * configurado (mesmo catálogo de níveis do /strike, ver punishmentLevels.js).
 * Pedido explícito do dono pra NÃO reaproveitar o filtro de profanidade
 * nativo do próprio jogo (PlayerProfanity) — esse já está desativado em
 * gatewayServer.js (DISABLED_EVENTS) por ter falsos positivos demais.
 *
 * Match de PALAVRA INTEIRA só (nunca substring) — decisão do dono
 * justamente pra evitar a mesma armadilha de falso positivo (ex: filtrar
 * "ass" não pode disparar em "classe"/"passar"). Fronteira de palavra usa
 * \p{L}/\p{N} (propriedade Unicode), não \b — \b é ASCII-only e trataria
 * letra acentuada como fronteira, quebrando em português (ex: "não"
 * separaria em torno do "ã").
 *
 * CRUD é módulo puro (sem discord.js), mesmo estilo de buffSystem.js.
 * applyFilterPunishment é a única parte que fala com Discord/RCON de
 * verdade — reaproveita o pipeline de aplicação do /strike
 * (PunishmentSystem._executeStrike) em vez de duplicar toda a lógica de
 * banco/RCON/Discord/DM/log já existente e testada.
 */
const db = require('../../database/index');

function _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _buildWordRegex(word) {
    const escaped = _escapeRegex(word.toLowerCase());
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'u');
}

function getFilters(guildId) {
    return db.prepare(`SELECT * FROM pot_chat_filters WHERE guild_id = ? ORDER BY word ASC`).all(guildId);
}

function getFilter(guildId, filterId) {
    return db.prepare(`SELECT * FROM pot_chat_filters WHERE guild_id = ? AND id = ?`).get(guildId, filterId);
}

/**
 * Adiciona (ou atualiza, se a mesma palavra já existir) um filtro.
 * @returns {{isNew: boolean, filter: object}}
 */
function addFilter(guildId, word, levelId, createdBy) {
    const normalized = word.trim().toLowerCase();
    const existing = db.prepare(`SELECT id FROM pot_chat_filters WHERE guild_id = ? AND word = ?`).get(guildId, normalized);
    const now = Date.now();
    db.prepare(`
        INSERT INTO pot_chat_filters (guild_id, word, level_id, created_at, created_by)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, word) DO UPDATE SET level_id = excluded.level_id, created_at = excluded.created_at, created_by = excluded.created_by
    `).run(guildId, normalized, levelId, now, createdBy);
    const filter = db.prepare(`SELECT * FROM pot_chat_filters WHERE guild_id = ? AND word = ?`).get(guildId, normalized);
    return { isNew: !existing, filter };
}

function removeFilter(guildId, filterId) {
    const filter = getFilter(guildId, filterId);
    if (!filter) return null;
    db.prepare(`DELETE FROM pot_chat_filters WHERE guild_id = ? AND id = ?`).run(guildId, filterId);
    return filter;
}

/**
 * Verifica uma mensagem de chat contra os filtros configurados do servidor.
 * Não decide nada sobre canal/sussurro — quem chama (gatewayServer.js) já
 * filtra isso ANTES de chegar aqui (só Global/Grupo, nunca sussurro).
 *
 * @returns {{id: number, word: string, level_id: number}|null} o primeiro
 *   filtro que bater, ou null se nenhum bater.
 */
function checkMessage(guildId, message) {
    if (!message) return null;
    const filters = getFilters(guildId);
    if (filters.length === 0) return null;

    // Preenchido com espaço nas pontas: garante uma fronteira "não-letra"
    // mesmo quando a palavra filtrada está bem no início/fim da mensagem,
    // sem precisar de tratamento especial pros casos de âncora ^/$.
    const padded = ` ${message.toLowerCase()} `;
    for (const filter of filters) {
        if (_buildWordRegex(filter.word).test(padded)) return filter;
    }
    return null;
}

/**
 * Aplica a punição configurada pro filtro que bateu — reaproveita o MESMO
 * pipeline de aplicação do /strike (PunishmentSystem._executeStrike): grava
 * a punição, desconta reputação, roda a ação em jogo via RCON (conforme o
 * nível escolhido), manda DM pro jogador (se tiver Discord vinculado) e
 * loga no canal de punições configurado — evita duplicar ~150 linhas de
 * lógica já existente e testada.
 *
 * Exclusivo do plano Caçador (pedido do dono; mesma flag `genericRconEnabled`
 * já usada pelo catálogo manual/buffs) — se o servidor perder o tier
 * depois, o filtro configurado continua salvo (nunca apaga config), só
 * para de ter efeito até o tier voltar (mesmo critério de downgrade já
 * usado no resto do bot, ver CLAUDE.md).
 *
 * "Moderador" creditado é o próprio bot (client.user) — é uma punição
 * automática, não tem staff nenhum clicando em nada. Só a ação EM JOGO do
 * nível é aplicada (discordAct fica 'none') — a violação aconteceu no chat
 * do jogo, não no Discord.
 *
 * @returns {Promise<object>} o mesmo formato de retorno de _executeStrike
 *   ({success, error} ou {success, strikeId, ...}).
 */
async function applyFilterPunishment(client, guildId, filter, alderonId, playerName) {
    const PremiumSystem = require('../premium/premiumSystem');
    if (!PremiumSystem.getGuildLimits(guildId).genericRconEnabled) {
        return { success: false, error: 'Plano Caçador necessário pra aplicar punição automática do filtro de chat.' };
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { success: false, error: 'Servidor não encontrado (bot não está mais nele).' };

    const PunishmentLevels = require('../moderation/punishmentLevels');
    const level = PunishmentLevels.getLevel(guildId, filter.level_id);
    if (!level) return { success: false, error: `Nível de punição #${filter.level_id} (configurado pro filtro "${filter.word}") não existe mais.` };

    const PunishmentSystem = require('../moderation/punishmentSystem');
    const PlayerRegistry = require('./potPlayerRegistry');
    const linked = PlayerRegistry.getPlayerByAlderonId(alderonId);
    const targetId = linked?.user_id || PunishmentSystem._unregisteredTargetId(alderonId);

    const session = {
        targetId,
        reason: `Palavra filtrada detectada no chat em jogo: "${filter.word}"`,
        reportId: null,
        levelId: level.id,
        levelName: level.name,
        levelSeverity: level.severity,
        levelAction: level.action || 'none',
        pointsLost: level.points,
        durationStr: level.duration_str || '',
        discordAct: 'none',
        jogoAct: level.action || 'none',
        alderonId,
        targetPlayerName: playerName || alderonId,
    };

    return await PunishmentSystem._executeStrike(guild, client.user, session);
}

module.exports = { getFilters, getFilter, addFilter, removeFilter, checkMessage, applyFilterPunishment };
