// src/systems/pot/achievementSystem.js
/**
 * Resgate de emblema/título por requisito — reforma das lojas, 2026-08-12:
 * "Emblemas e titulos não vão ser itens compraveis apenas itens
 * recompensaveis por missões, onde só o desenvolvedor pode colocar na
 * loja com requisitos para o player resgatar." O dono define o requisito
 * (tipo + valor, ver `requirement` em profile_image_pool/
 * ProfileImagePool.setRequirement) no painel /dev/Loja; o sistema
 * verifica automaticamente se um jogador já cumpre e libera um botão
 * "Resgatar" (ver playerRegistrationSystem.js/configSystem.js) — sem
 * conceder nada sozinho, o jogador precisa clicar.
 *
 * Todo requisito usa dados JÁ rastreados (nenhuma tabela nova): kills/
 * tempo de jogo vêm de potPlayerRegistry.getGlobalPlayerStats, nível vem
 * de getLevelProgress (XP), espécie mais jogada usa pot_dinosaur_picks —
 * tudo GLOBAL (somado entre servidores), mesmo critério já usado pro
 * resto do /perfil.
 */
'use strict';

// valueLabel/hint (novos, 2026-08-12 — pedido do dono: "não esta claro
// como devem ser os requisitos") alimentam o painel /dev/Loja: valueLabel
// rotula o campo "Valor" de acordo com o tipo escolhido (em vez de um
// "Valor" genérico sem contexto), hint explica em uma frase o que aquele
// requisito realmente checa — os dois só existem pra UI, não mudam nada
// em checkRequirementMet/describeRequirement.
const REQUIREMENT_TYPES = {
    kills: {
        label: 'Kills (total)',
        valueLabel: 'Kills',
        hint: 'Jogador precisa ter pelo menos esse número de abates (kills), somando todos os servidores.',
    },
    playtime_hours: {
        label: 'Tempo de jogo (horas)',
        valueLabel: 'Horas',
        hint: 'Jogador precisa ter pelo menos essa quantidade de horas jogadas, somando todos os servidores.',
    },
    level: {
        label: 'Nível (XP)',
        valueLabel: 'Nível',
        hint: 'Jogador precisa ter alcançado pelo menos esse Nível (calculado a partir do XP acumulado).',
    },
    species_picks: {
        label: 'Vezes jogadas com uma espécie',
        valueLabel: 'Vezes',
        hint: 'Jogador precisa ter jogado com a espécie informada abaixo pelo menos esse número de vezes (spawns), somando todos os servidores.',
        needsSpecies: true,
    },
};

function parseRequirement(row) {
    if (!row?.requirement) return null;
    try {
        return JSON.parse(row.requirement);
    } catch {
        return null;
    }
}

/**
 * @param {string} userId - Discord ID
 * @param {{type: string, value: number, species?: string}|null} requirement
 * @returns {boolean}
 */
function checkRequirementMet(userId, requirement) {
    if (!requirement || !REQUIREMENT_TYPES[requirement.type] || !Number.isFinite(requirement.value)) return false;

    const PlayerRegistry = require('./potPlayerRegistry');
    const link = PlayerRegistry.getPlayerByDiscordId(userId);
    if (!link?.alderon_id) return false;

    switch (requirement.type) {
        case 'kills': {
            const stats = PlayerRegistry.getGlobalPlayerStats(link.alderon_id);
            return stats.kills >= requirement.value;
        }
        case 'playtime_hours': {
            const stats = PlayerRegistry.getGlobalPlayerStats(link.alderon_id);
            return (stats.totalPlaytime / 3600) >= requirement.value;
        }
        case 'level': {
            const progress = PlayerRegistry.getLevelProgress(userId);
            return (progress?.level || 0) >= requirement.value;
        }
        case 'species_picks': {
            if (!requirement.species) return false;
            const db = require('../../database/index');
            const row = db.prepare(`
                SELECT SUM(pick_count) as total FROM pot_dinosaur_picks
                WHERE alderon_id = ? AND dinosaur_type = ? COLLATE NOCASE
            `).get(link.alderon_id, requirement.species);
            return (row?.total || 0) >= requirement.value;
        }
        default:
            return false;
    }
}

/**
 * Descrição legível do requisito (pro card de emblema/título e pro painel
 * do dono) — ex: "500 kills", "10 horas de jogo", "Nível 5", "20x jogando
 * de Deinosuchus".
 */
function describeRequirement(requirement) {
    if (!requirement || !REQUIREMENT_TYPES[requirement.type]) return null;
    switch (requirement.type) {
        case 'kills': return `${requirement.value} kills`;
        case 'playtime_hours': return `${requirement.value}h de tempo de jogo`;
        case 'level': return `Nível ${requirement.value}`;
        case 'species_picks': return `${requirement.value}x jogando de ${requirement.species || '?'}`;
        default: return null;
    }
}

module.exports = {
    REQUIREMENT_TYPES,
    parseRequirement,
    checkRequirementMet,
    describeRequirement,
};
