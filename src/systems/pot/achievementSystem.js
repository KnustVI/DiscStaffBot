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
    // por período e "já jogou nesse servidor". needsDateRange é uma
    // flag NOVA (só existia needsSpecies/needsServer/noValue até aqui) — ver
    // requirement-form.ejs pros 2 campos de data que ela liga.
    registered_between: {
        label: 'Registrou-se entre duas datas',
        valueLabel: 'Data',
        hint: 'Jogador precisa ter se registrado (/registrar) entre as duas datas informadas abaixo (inclusive).',
        noValue: true,
        needsDateRange: true,
    },
    // RENOMEADO (pedido do dono, 2026-08-19, mesmo dia da criação — "esse
    // requisito de registro em servidor especifico... mas se uma pessoa se
    // registrou em um servidor ela não consegue se registrar em outro?
    // Vamos mudar esse 'registro' para já logou no servidor, o que seria
    // que alguma vez ela já entrou lá para jogar"). O CHECK em si (case
    // 'registered_on_server' abaixo) já sempre foi por servidor de verdade
    // (SELECT ... WHERE guild_id = ? AND alderon_id = ? em pot_players,
    // UNIQUE(guild_id, alderon_id) no schema — um jogador pode ter uma
    // linha em N servidores diferentes ao mesmo tempo, sem exclusividade
    // nenhuma entre eles) — o "registro" nunca travou entre servidores,
    // só o RÓTULO/texto é que dava a entender (por engano) que era o
    // mesmo tipo de "registro" exclusivo do /registrar global (esse sim
    // é 1 vínculo só, ver registered_between acima). Só label/hint/
    // describeRequirement mudaram aqui — a CHAVE do tipo
    // ('registered_on_server') continua igual de propósito, pra não
    // quebrar missões/emblemas/títulos já salvos com esse requisito no
    // banco (profile_image_pool.requirement guarda o JSON com essa chave
    // literal).
    registered_on_server: {
        label: 'Já jogou em um servidor específico',
        valueLabel: 'Servidor',
        hint: 'Jogador precisa ter entrado pelo menos uma vez NESSE servidor específico pra jogar (visto em algum webhook do jogo) — não tem exclusividade entre servidores, o mesmo jogador pode cumprir esse requisito em vários servidores diferentes ao mesmo tempo. Diferente do registro global (/registrar), que não é por servidor.',
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

// current arredondado ANTES de comparar com target (não o valor cru) —
// mantém `met`/`percent` sempre consistentes entre si (nunca mostra 100%
// na barra com met:false, ou vice-versa, por causa de uma casa decimal
// escondida). decimals=1 pros tipos de hora (8.3h fica mais legível que
// 8.333333h), decimals=0 pro resto (contagens já são inteiras).
function _numericProgress(requirement, rawCurrent, decimals = 0) {
    const factor = Math.pow(10, decimals);
    const current = Math.floor(rawCurrent * factor) / factor;
    const target = requirement.value;
    const percent = target > 0 ? Math.min(100, (current / target) * 100) : 0;
    return { met: current >= target, isBoolean: false, current, target, percent };
}

function _booleanProgress(met) {
    return { met, isBoolean: true, current: met, target: null, percent: met ? 100 : 0 };
}

/**
 * Progresso de UM requisito — current/target/percent/met, usado tanto por
 * checkRequirementMet (só olha `.met`) quanto pelo overlay de progresso de
 * /loja (pedido do dono, 2026-08-19: "Em missões, emblemas e titullos
 * motre o progresso em uma overlay" — ver getRequirementsProgress
 * abaixo). Única fonte de verdade da busca de stats por tipo — nunca
 * duplicada entre as duas funções que a usam.
 * @returns {{type:string, label:string|null, met:boolean, isBoolean:boolean, current:number|boolean|null, target:number|null, percent:number}}
 */
function _singleRequirementProgress(userId, requirement, link) {
    const PlayerRegistry = require('./potPlayerRegistry');
    let progress;

    switch (requirement.type) {
        case 'kills':
            progress = _numericProgress(requirement, PlayerRegistry.getGlobalPlayerStats(link.alderon_id).kills);
            break;
        case 'playtime_hours':
            progress = _numericProgress(requirement, PlayerRegistry.getGlobalPlayerStats(link.alderon_id).totalPlaytime / 3600, 1);
            break;
        case 'level':
            progress = _numericProgress(requirement, PlayerRegistry.getLevelProgress(userId)?.level || 0);
            break;
        case 'species_picks': {
            if (!requirement.species) { progress = _numericProgress(requirement, 0); break; }
            const db = require('../../database/index');
            const row = db.prepare(`
                SELECT SUM(pick_count) as total FROM pot_dinosaur_picks
                WHERE alderon_id = ? AND dinosaur_type = ? COLLATE NOCASE
            `).get(link.alderon_id, requirement.species);
            progress = _numericProgress(requirement, row?.total || 0);
            break;
        }
        case 'server_playtime_hours': {
            if (!requirement.guildId) { progress = _numericProgress(requirement, 0, 1); break; }
            const stats = PlayerRegistry.getGuildPlayerStats(requirement.guildId, link.alderon_id);
            progress = _numericProgress(requirement, stats.totalPlaytime / 3600, 1);
            break;
        }
        case 'species_kills': {
            if (!requirement.species) { progress = _numericProgress(requirement, 0); break; }
            const db = require('../../database/index');
            const row = db.prepare(`
                SELECT SUM(kill_count) as total FROM pot_species_kills
                WHERE alderon_id = ? AND species_killed = ? COLLATE NOCASE
            `).get(link.alderon_id, requirement.species);
            progress = _numericProgress(requirement, row?.total || 0);
            break;
        }
        case 'is_online':
            progress = _booleanProgress(PlayerRegistry.getGlobalPlayerStats(link.alderon_id).isOnline === true);
            break;
        case 'registered_between': {
            if (!requirement.startDate || !requirement.endDate || !link.registered_at) { progress = _booleanProgress(false); break; }
            // Comparação como string YYYY-MM-DD (não timestamp) pra evitar
            // fuso horário — ISO-date ordena igual string, então >= / <=
            // funcionam direto.
            const registeredDate = new Date(link.registered_at).toISOString().slice(0, 10);
            progress = _booleanProgress(registeredDate >= requirement.startDate && registeredDate <= requirement.endDate);
            break;
        }
        case 'registered_on_server': {
            if (!requirement.guildId) { progress = _booleanProgress(false); break; }
            const db = require('../../database/index');
            const row = db.prepare(`
                SELECT 1 FROM pot_players WHERE guild_id = ? AND alderon_id = ? LIMIT 1
            `).get(requirement.guildId, link.alderon_id);
            progress = _booleanProgress(!!row);
            break;
        }
        default:
            progress = { met: false, isBoolean: false, current: null, target: null, percent: 0 };
    }

    return { type: requirement.type, label: describeRequirement([requirement]), ...progress };
}

/**
 * Checagem de UM requisito só — delega pra _singleRequirementProgress
 * (única fonte de verdade da busca de stats) e só olha `.met`.
 */
function _checkSingleRequirementMet(userId, requirement, link) {
    if (!requirement || !REQUIREMENT_TYPES[requirement.type] || !Number.isFinite(requirement.value)) return false;
    return _singleRequirementProgress(userId, requirement, link).met;
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
 * Progresso de CADA requisito da lista (pedido do dono, 2026-08-19: "Em
 * missões, emblemas e titullos motre o progresso em uma overlay") — uma
 * linha por requisito (current/target/percent/met/label, ver
 * _singleRequirementProgress), na MESMA ordem da lista salva. Sem
 * vínculo (`link`) devolve tudo zerado/não-cumprido em vez de lançar —
 * mesmo espírito defensivo de checkRequirementMet, só que sem jogar fora
 * a lista inteira (o overlay ainda precisa mostrar os requisitos, só que
 * como "0 de N cumpridos").
 * @param {string} userId
 * @param {Array<object>|object|null} requirements
 * @returns {Array<{type:string, label:string|null, met:boolean, isBoolean:boolean, current:number|boolean|null, target:number|null, percent:number}>}
 */
function getRequirementsProgress(userId, requirements) {
    const list = Array.isArray(requirements) ? requirements : (requirements ? [requirements] : []);
    if (list.length === 0) return [];

    const PlayerRegistry = require('./potPlayerRegistry');
    const link = PlayerRegistry.getPlayerByDiscordId(userId);

    return list.map((r) => {
        if (!link?.alderon_id || !r || !REQUIREMENT_TYPES[r.type]) {
            return { type: r?.type, label: describeRequirement([r]), met: false, isBoolean: false, current: null, target: r?.value ?? null, percent: 0 };
        }
        return _singleRequirementProgress(userId, r, link);
    });
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
                    return `Já jogou em ${name}`;
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
    getRequirementsProgress,
};
