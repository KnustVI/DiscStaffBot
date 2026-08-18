// src/systems/pot/achievementSystem.js
/**
 * Resgate de emblema/título por requisito — reforma das lojas, 2026-08-12:
 * "Emblemas e titulos não vão ser itens compraveis apenas itens
 * recompensaveis por missões, onde só o desenvolvedor pode colocar na
 * loja com requisitos para o player resgatar." O dono define os
 * requisitos (ver `requirement` em profile_image_pool/
 * ProfileImagePool.setRequirement) no painel /dev/Loja; o sistema
 * verifica automaticamente se um jogador já cumpre e libera um botão
 * "Resgatar" (ver playerRegistrationSystem.js/configSystem.js) — sem
 * conceder nada sozinho, o jogador precisa clicar.
 *
 * UMA LISTA de requisitos por item, não só um (pedido do dono,
 * 2026-08-13: "preciso que ele adicione os requisitos como uma lista
 * onde o player só consiga reivindicar se fez todos os requisitos") —
 * `requirement` é sempre um ARRAY (`profile_image_pool.requirement`,
 * JSON), e `checkRequirementMet` só devolve true se TODOS os itens da
 * lista forem cumpridos (E, não OU). Dado salvo ANTES desta mudança
 * (objeto solto, não array) continua funcionando — `parseRequirement`
 * normaliza pra array de 1 item na leitura, sem precisar de migração.
 *
 * Todo requisito usa dados já rastreados (kills/tempo de jogo/status
 * online vêm de potPlayerRegistry.getGlobalPlayerStats, nível vem de
 * getLevelProgress/XP, espécie mais jogada usa pot_dinosaur_picks) — tudo
 * GLOBAL (somado entre servidores), mesmo critério já usado pro resto do
 * /perfil. 3 tipos novos (pedido do dono, 2026-08-14): `server_playtime_
 * hours` (tempo de jogo ESCOPADO a um servidor específico, via
 * getGuildPlayerStats, não somado), `species_kills` (abates de uma
 * espécie específica — vítima, não jogada; única exceção que precisou de
 * tabela nova, pot_species_kills, alimentada por
 * potPlayerRegistry.recordKillEvent) e `is_online` (checagem ao vivo,
 * sem valor numérico — ver flag `noValue` em REQUIREMENT_TYPES).
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
    // 3 tipos novos (pedido do dono, 2026-08-14): servidor específico,
    // abate de espécie (vítima) e status online — ver docblock do topo.
    server_playtime_hours: {
        label: 'Tempo de jogo em um servidor específico (horas)',
        valueLabel: 'Horas',
        hint: 'Jogador precisa ter pelo menos essa quantidade de horas jogadas NESSE servidor específico (diferente de "Tempo de jogo", que soma todos os servidores).',
        needsServer: true,
    },
    species_kills: {
        label: 'Abates de uma espécie específica',
        valueLabel: 'Abates',
        hint: 'Jogador precisa ter abatido a espécie informada abaixo pelo menos esse número de vezes, somando todos os servidores.',
        needsSpecies: true,
    },
    is_online: {
        label: 'Está online agora',
        valueLabel: 'Online',
        hint: 'Jogador precisa estar online AGORA em algum servidor — checagem em tempo real, sem valor numérico associado.',
        noValue: true,
    },
    // 2 tipos novos (pedido do dono, 2026-08-19, junto com o criador de
    // Missões — "Adicione mais 2 requisitos em tudo dessa área"): registro
    // por período e registro num servidor específico. needsDateRange é uma
    // flag NOVA (só existia needsSpecies/needsServer/noValue até aqui) — ver
    // requirement-form.ejs pros 2 campos de data que ela liga.
    registered_between: {
        label: 'Registrou-se entre duas datas',
        valueLabel: 'Data',
        hint: 'Jogador precisa ter se registrado (/registrar) entre as duas datas informadas abaixo (inclusive).',
        noValue: true,
        needsDateRange: true,
    },
    registered_on_server: {
        label: 'Registrou-se em um servidor específico',
        valueLabel: 'Servidor',
        hint: 'Jogador precisa ter aparecido pelo menos uma vez NESSE servidor específico (visto em algum webhook do jogo) — diferente do registro global (/registrar), que não é por servidor.',
        noValue: true,
        needsServer: true,
    },
};

/**
 * Sempre devolve um ARRAY de requisitos (ou null, "sem requisito
 * nenhum") — pedido do dono, 2026-08-13: "preciso que ele adicione os
 * requisitos como uma lista onde o player só consiga reivindicar se fez
 * todos os requisitos" (AND, não "qualquer um deles"). Compatível com
 * dado ANTIGO já salvo (objeto solto `{type,value,species?}`, formato de
 * antes desta mudança) — normaliza pra array de 1 item aqui mesmo, sem
 * precisar de migração de banco; o próximo "Salvar" no painel /dev/Loja
 * já regrava no formato array de verdade. NUNCA devolve array vazio —
 * "sem requisito" sempre vira `null` (código em vários lugares, ex.
 * configSystem._usableBadgeOptions/imageShopSystem.getRedeemableItems,
 * faz `!row.requirement` pra checar isso — um array vazio é truthy em
 * JS, viraria "tem requisito" por engano).
 */
function parseRequirement(row) {
    if (!row?.requirement) return null;
    try {
        const parsed = JSON.parse(row.requirement);
        if (Array.isArray(parsed)) return parsed.length > 0 ? parsed : null;
        return parsed && parsed.type ? [parsed] : null;
    } catch {
        return null;
    }
}

/**
 * Checagem de UM requisito só — corpo movido pra fora de
 * checkRequirementMet (que agora itera a lista inteira) sem nenhuma
 * mudança de lógica interna.
 */
function _checkSingleRequirementMet(userId, requirement, link) {
    if (!requirement || !REQUIREMENT_TYPES[requirement.type] || !Number.isFinite(requirement.value)) return false;

    const PlayerRegistry = require('./potPlayerRegistry');

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
        case 'server_playtime_hours': {
            if (!requirement.guildId) return false;
            const stats = PlayerRegistry.getGuildPlayerStats(requirement.guildId, link.alderon_id);
            return (stats.totalPlaytime / 3600) >= requirement.value;
        }
        case 'species_kills': {
            if (!requirement.species) return false;
            const db = require('../../database/index');
            const row = db.prepare(`
                SELECT SUM(kill_count) as total FROM pot_species_kills
                WHERE alderon_id = ? AND species_killed = ? COLLATE NOCASE
            `).get(link.alderon_id, requirement.species);
            return (row?.total || 0) >= requirement.value;
        }
        case 'is_online':
            return PlayerRegistry.getGlobalPlayerStats(link.alderon_id).isOnline === true;
        case 'registered_between': {
            if (!requirement.startDate || !requirement.endDate || !link.registered_at) return false;
            // Comparação como string YYYY-MM-DD (não timestamp) pra evitar
            // fuso horário — ISO-date ordena igual string, então >= / <=
            // funcionam direto.
            const registeredDate = new Date(link.registered_at).toISOString().slice(0, 10);
            return registeredDate >= requirement.startDate && registeredDate <= requirement.endDate;
        }
        case 'registered_on_server': {
            if (!requirement.guildId) return false;
            const db = require('../../database/index');
            const row = db.prepare(`
                SELECT 1 FROM pot_players WHERE guild_id = ? AND alderon_id = ? LIMIT 1
            `).get(requirement.guildId, link.alderon_id);
            return !!row;
        }
        default:
            return false;
    }
}

/**
 * @param {string} userId - Discord ID
 * @param {Array<{type: string, value: number, species?: string}>|{type: string, value: number, species?: string}|null} requirements
 *   Normalmente um array (ver parseRequirement) — objeto solto aceito só
 *   defensivamente (nunca deve chegar assim vindo de parseRequirement,
 *   mas outros call sites eventuais não quebram).
 * @returns {boolean} true só se TODOS os requisitos da lista forem
 *   cumpridos (AND) — lista vazia/nula nunca é "cumprida".
 */
function checkRequirementMet(userId, requirements) {
    const list = Array.isArray(requirements) ? requirements : (requirements ? [requirements] : []);
    if (list.length === 0) return false;

    const PlayerRegistry = require('./potPlayerRegistry');
    const link = PlayerRegistry.getPlayerByDiscordId(userId);
    if (!link?.alderon_id) return false;

    return list.every((r) => _checkSingleRequirementMet(userId, r, link));
}

/**
 * Descrição legível da LISTA de requisitos (pro card de emblema/título e
 * pro painel do dono) — ex: "500 kills", ou "500 kills + Nível 10" com
 * mais de um. " + " deixa claro que são TODOS obrigatórios (AND), sem
 * precisar de gramática de lista (vírgula + "e") só pra isso.
 */
function describeRequirement(requirements) {
    const list = Array.isArray(requirements) ? requirements : (requirements ? [requirements] : []);
    const parts = list
        .map((requirement) => {
            if (!requirement || !REQUIREMENT_TYPES[requirement.type]) return null;
            switch (requirement.type) {
                case 'kills': return `${requirement.value} kills`;
                case 'playtime_hours': return `${requirement.value}h de tempo de jogo`;
                case 'level': return `Nível ${requirement.value}`;
                case 'species_picks': return `${requirement.value}x jogando de ${requirement.species || '?'}`;
                case 'server_playtime_hours': {
                    const PoTConfigSystem = require('./potConfigSystem');
                    const name = PoTConfigSystem.getServerConfig(requirement.guildId)?.server_name || 'servidor removido';
                    return `${requirement.value}h jogadas em ${name}`;
                }
                case 'species_kills': return `${requirement.value}x abatendo ${requirement.species || '?'}`;
                case 'is_online': return 'Online agora';
                case 'registered_between': return `Registrado entre ${requirement.startDate || '?'} e ${requirement.endDate || '?'}`;
                case 'registered_on_server': {
                    const PoTConfigSystem = require('./potConfigSystem');
                    const name = PoTConfigSystem.getServerConfig(requirement.guildId)?.server_name || 'servidor removido';
                    return `Registrado em ${name}`;
                }
                default: return null;
            }
        })
        .filter(Boolean);
    return parts.length > 0 ? parts.join(' + ') : null;
}

module.exports = {
    REQUIREMENT_TYPES,
    parseRequirement,
    checkRequirementMet,
    describeRequirement,
};
