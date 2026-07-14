// src/systems/moderation/punishmentLevels.js
/**
 * Níveis de punição customizados por servidor — substituem os 5 níveis fixos
 * hardcoded (Leve/Moderada/Grave/Severa/Permanente) do antigo /strike. Cada
 * servidor cria seus próprios níveis (nome, severidade, pontos, duração,
 * ação em jogo via RCON), limitados pelo tier (ver premiumSystem.js,
 * GUILD_LIMITS.maxPunishmentLevels: Free=0, Rastreador=4, Caçador=10).
 *
 * Módulo puro (sem discord.js) — usado por configSystem.js (painel/modais),
 * punishmentSystem.js (execução) e src/commands/strike/*.
 */
const db = require('../../database/index');
const PremiumSystem = require('../premium/premiumSystem');
const { EMOJIS } = require('../../database/emojis.js');

const SEVERITY_OPTIONS = ['Leve', 'Moderada', 'Grave', 'Severa'];
const ACTION_OPTIONS = ['SystemMessage', 'Kick', 'Ban', 'ServerMute'];

// Ícone por severidade — fonte única, reaproveitada pelo painel /config
// punishments (configSystem.js) e por severityIconFor (punishmentSystem.js).
const SEVERITY_ICONS = {
    Leve: EMOJIS.severidadebaixa || '🟢',
    Moderada: EMOJIS.severidademedia || '🟡',
    Grave: EMOJIS.severidadelaranja || '🟠',
    Severa: EMOJIS.severidadealta || '🔴',
};

function getLevels(guildId) {
    return db.prepare(`SELECT * FROM punishment_levels WHERE guild_id = ? ORDER BY created_at ASC`).all(guildId);
}

function getLevel(guildId, levelId) {
    return db.prepare(`SELECT * FROM punishment_levels WHERE guild_id = ? AND id = ?`).get(guildId, levelId);
}

function countLevels(guildId) {
    const row = db.prepare(`SELECT COUNT(*) as count FROM punishment_levels WHERE guild_id = ?`).get(guildId);
    return row?.count || 0;
}

function getLevelLimit(guildId) {
    return PremiumSystem.getGuildLimits(guildId).maxPunishmentLevels || 0;
}

function canCreateLevel(guildId) {
    return countLevels(guildId) < getLevelLimit(guildId);
}

/**
 * Valida e normaliza os dados de um nível vindos do modal de criação/edição.
 * Nome e pontos são obrigatórios; duração e ação são opcionais (vazio é
 * válido — nível sem ação em jogo / duração permanente), mas um valor
 * informado fora das listas válidas é erro, nunca silenciosamente ignorado.
 *
 * @returns {{ valid: boolean, errors: string[], data: object|null }}
 */
function validateLevelInput({ name, severity, points, durationStr, action }) {
    const errors = [];

    const trimmedName = String(name || '').trim();
    if (!trimmedName) errors.push('Nome é obrigatório.');

    const normalizedSeverity = SEVERITY_OPTIONS.find(
        (s) => s.toLowerCase() === String(severity || '').trim().toLowerCase(),
    );
    if (!normalizedSeverity) {
        errors.push(`Severidade deve ser uma de: ${SEVERITY_OPTIONS.join(', ')}.`);
    }

    const parsedPoints = parseInt(points, 10);
    if (isNaN(parsedPoints) || parsedPoints < 0 || parsedPoints > 100) {
        errors.push('Pontos deve ser um número entre 0 e 100.');
    }

    const trimmedDuration = String(durationStr || '').trim();

    let normalizedAction = null;
    const trimmedAction = String(action || '').trim();
    if (trimmedAction) {
        normalizedAction = ACTION_OPTIONS.find((a) => a.toLowerCase() === trimmedAction.toLowerCase());
        if (!normalizedAction) {
            errors.push(`Ação deve ser uma de: ${ACTION_OPTIONS.join(', ')} (ou vazio).`);
        }
    }

    if (errors.length > 0) {
        return { valid: false, errors, data: null };
    }

    return {
        valid: true,
        errors: [],
        data: {
            name: trimmedName,
            severity: normalizedSeverity,
            points: parsedPoints,
            durationStr: trimmedDuration || null,
            action: normalizedAction,
        },
    };
}

// Duração > 72h (mesmo limiar usado por punishmentSystem.parseDuration/
// requiresSupervisorApproval) — duplicado aqui de propósito, pra não criar
// dependência circular (punishmentSystem.js já importa este módulo).
function _durationExceeds72h(durationStr) {
    const match = String(durationStr || '').trim().match(/^(\d+)([mhd])$/i);
    if (!match) return false;
    const value = parseInt(match[1], 10);
    const multipliers = { m: 60000, h: 3600000, d: 86400000 };
    return value * (multipliers[match[2].toLowerCase()] || 3600000) > 72 * 3600000;
}

/**
 * Valor inicial de requires_supervisor_approval pra um nível recém-criado —
 * espelha a regra automática de sempre (severidade Grave/Severa OU duração
 * >72h/permanente, ver punishmentSystem.requiresSupervisorApproval) só
 * como PONTO DE PARTIDA. No plano Caçador, o admin pode depois alternar
 * livremente pelo botão no painel (/config punishments) — a partir daí o
 * valor gravado é a fonte da verdade, não é recalculado automaticamente
 * de novo (editar o nível não reseta essa escolha, ver updateLevel abaixo).
 */
function _defaultSupervisorApproval(severity, durationStr) {
    if (severity === 'Grave' || severity === 'Severa') return 1;
    const d = String(durationStr || '').trim().toLowerCase();
    const isPermanent = d === '' || d === '0' || d === 'perm';
    if (isPermanent) return 1;
    return _durationExceeds72h(durationStr) ? 1 : 0;
}

function createLevel(guildId, data, createdBy) {
    const uuid = db.generateUUID();
    const now = Date.now();
    const requiresApproval = _defaultSupervisorApproval(data.severity, data.durationStr);
    const result = db.prepare(`
        INSERT INTO punishment_levels (uuid, guild_id, name, severity, points, duration_str, action, requires_supervisor_approval, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuid, guildId, data.name, data.severity, data.points, data.durationStr, data.action, requiresApproval, now, createdBy);
    return getLevel(guildId, result.lastInsertRowid);
}

// Não mexe em requires_supervisor_approval — editar nome/severidade/pontos/
// etc não deve resetar silenciosamente uma escolha explícita do admin feita
// pelo botão de toggle (ver configSystem.handleToggleLevelApproval).
function updateLevel(guildId, levelId, data, updatedBy) {
    db.prepare(`
        UPDATE punishment_levels
        SET name = ?, severity = ?, points = ?, duration_str = ?, action = ?, updated_at = ?, updated_by = ?
        WHERE guild_id = ? AND id = ?
    `).run(data.name, data.severity, data.points, data.durationStr, data.action, Date.now(), updatedBy, guildId, levelId);
    return getLevel(guildId, levelId);
}

function setSupervisorApproval(guildId, levelId, requiresApproval) {
    db.prepare(`
        UPDATE punishment_levels SET requires_supervisor_approval = ? WHERE guild_id = ? AND id = ?
    `).run(requiresApproval ? 1 : 0, guildId, levelId);
    return getLevel(guildId, levelId);
}

// Seguro deletar a qualquer momento: punições já aplicadas com este nível
// guardam uma cópia CONGELADA dos dados (level_name/level_severity/
// level_action/duration_str em punishments, ver database/index.js
// ensureColumn) no momento em que foram aplicadas — não há JOIN nem FK
// viva pra punishment_levels, então apagar o nível não altera nem quebra
// nenhum registro histórico.
function deleteLevel(guildId, levelId) {
    const level = getLevel(guildId, levelId);
    if (!level) return null;
    db.prepare(`DELETE FROM punishment_levels WHERE guild_id = ? AND id = ?`).run(guildId, levelId);
    return level;
}

module.exports = {
    SEVERITY_OPTIONS,
    ACTION_OPTIONS,
    SEVERITY_ICONS,
    getLevels,
    getLevel,
    countLevels,
    getLevelLimit,
    canCreateLevel,
    validateLevelInput,
    createLevel,
    updateLevel,
    setSupervisorApproval,
    deleteLevel,
};
