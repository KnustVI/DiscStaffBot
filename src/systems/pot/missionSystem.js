// src/systems/pot/missionSystem.js
/**
 * Missões globais criadas pelo dono em /dev/Loja (pedido do dono,
 * 2026-08-19: "Crie um criador de missões com os mesmos requisitos que
 * temos em emblemas e titulo... vai criar uma missão global para todos os
 * usuarios cumprir. Essas missões vão poder conceder recompensas de ossos,
 * caçadas, ou titulos e emblemas.") — mesmo mecanismo de resgate-por-
 * requisito que Emblema/Título já usam (ver imageShopSystem.js/
 * achievementSystem.js), generalizado pra também poder pagar em moeda, não
 * só conceder um item do pool.
 *
 * Criação em 2 passos, igual todo o resto desta página: `createMission`
 * cria a missão NUA (título+descrição, is_public=0); `setRequirement` e
 * `setReward` são configurados DEPOIS, cada um no seu próprio dialog (ver
 * partials/requirement-form.ejs, reaproveitado sem mudança nenhuma, e o
 * novo partials/mission-reward-form.ejs) — o dono torna pública manualmente
 * quando terminar (setPublic, mesmo toggle já usado pro resto do pool).
 *
 * `requirement` usa o MESMO formato/catálogo de profile_image_pool
 * (AchievementSystem.REQUIREMENT_TYPES/parseRequirement/
 * checkRequirementMet/describeRequirement são agnósticas de tabela — só
 * olham pra `row.requirement`), sem nenhuma mudança lá.
 *
 * `reward_type`/`reward_config` são exclusivos deste arquivo:
 *   - 'ossos':   { amount, guildId } — Ossos é moeda POR SERVIDOR
 *                (ver pot_player_bones), por isso sempre precisa de um
 *                guildId escolhido na hora de configurar a recompensa.
 *   - 'cacadas': { amount } — Caçadas é global.
 *   - 'badge'/'titulo': { poolId } — aponta pra uma linha JÁ EXISTENTE em
 *                profile_image_pool (o dono escolhe entre os que já
 *                cadastrou nas seções de Emblema/Título da mesma página).
 */
'use strict';

const db = require('../../database/index');

const VALID_REWARD_TYPES = ['ossos', 'cacadas', 'badge', 'titulo'];

function getMissionById(id) {
    return db.prepare(`SELECT * FROM pot_missions WHERE id = ?`).get(id) || null;
}

/**
 * @param {{publicOnly?: boolean}} [opts] - publicOnly:true filtra só
 *   is_public=1 (mesmo espírito de ProfileImagePool.listImages) — usado
 *   pela /loja pública; sem isso, /dev/Loja vê tudo (inclusive as ainda
 *   privadas/em configuração).
 */
function listMissions(opts = {}) {
    const { publicOnly = false } = opts;
    if (publicOnly) {
        return db.prepare(`SELECT * FROM pot_missions WHERE is_public = 1 ORDER BY id ASC`).all();
    }
    return db.prepare(`SELECT * FROM pot_missions ORDER BY id ASC`).all();
}

/**
 * @param {string} title
 * @param {string} description
 * @param {string} createdBy - Discord ID do dono
 * @returns {{ok:true,id:number}|{ok:false,error:string}}
 */
function createMission(title, description, createdBy) {
    const cleanTitle = (title || '').trim().slice(0, 100);
    const cleanDescription = (description || '').trim().slice(0, 500);
    if (!cleanTitle) return { ok: false, error: 'Título é obrigatório.' };
    if (!cleanDescription) return { ok: false, error: 'Descrição é obrigatória.' };

    const result = db.prepare(`
        INSERT INTO pot_missions (title, description, created_by, created_at)
        VALUES (?, ?, ?, ?)
    `).run(cleanTitle, cleanDescription, createdBy, Date.now());
    return { ok: true, id: result.lastInsertRowid };
}

function setPublic(id, isPublic) {
    const row = getMissionById(id);
    if (!row) return false;
    db.prepare(`UPDATE pot_missions SET is_public = ? WHERE id = ?`).run(isPublic ? 1 : 0, id);
    return true;
}

function setComingSoon(id, comingSoon) {
    const row = getMissionById(id);
    if (!row) return false;
    db.prepare(`UPDATE pot_missions SET coming_soon = ? WHERE id = ?`).run(comingSoon ? 1 : 0, id);
    return true;
}

function removeMission(id) {
    const row = getMissionById(id);
    if (!row) return false;
    db.prepare(`DELETE FROM pot_missions WHERE id = ?`).run(id);
    return true;
}

/**
 * Mesmo corpo de ProfileImagePool.setRequirement, sem o parâmetro `type`
 * (só existe um "tipo" de missão). Ver docblock do arquivo.
 * @param {number} id
 * @param {Array<object>|null} requirement
 */
function setRequirement(id, requirement) {
    const row = getMissionById(id);
    if (!row) return false;
    db.prepare(`UPDATE pot_missions SET requirement = ? WHERE id = ?`)
        .run(requirement ? JSON.stringify(requirement) : null, id);
    return true;
}

/**
 * @param {number} id
 * @param {string} rewardType - um de VALID_REWARD_TYPES
 * @param {{amount?: number, guildId?: string, poolId?: number}} config
 */
function setReward(id, rewardType, config) {
    if (!VALID_REWARD_TYPES.includes(rewardType)) return false;
    const row = getMissionById(id);
    if (!row) return false;
    db.prepare(`UPDATE pot_missions SET reward_type = ?, reward_config = ? WHERE id = ?`)
        .run(rewardType, JSON.stringify(config || {}), id);
    return true;
}

function parseReward(row) {
    if (!row?.reward_type || !row?.reward_config) return null;
    try {
        const config = JSON.parse(row.reward_config);
        return { type: row.reward_type, ...config };
    } catch {
        return null;
    }
}

/**
 * Texto legível da recompensa pro card de /dev/Loja e de /loja — mesmo
 * espírito de AchievementSystem.describeRequirement.
 * @param {object} row - linha de pot_missions
 * @returns {string|null}
 */
function describeReward(row) {
    const reward = parseReward(row);
    if (!reward) return null;
    switch (reward.type) {
        case 'ossos': {
            const PoTConfigSystem = require('./potConfigSystem');
            const name = PoTConfigSystem.getServerConfig(reward.guildId)?.server_name || 'servidor removido';
            return `${reward.amount} Ossos (em ${name})`;
        }
        case 'cacadas':
            return `${reward.amount} Caçadas`;
        case 'badge':
        case 'titulo': {
            const ProfileImagePool = require('./profileImagePool');
            const poolRow = ProfileImagePool.getByTypeAndId(reward.type, reward.poolId);
            if (!poolRow) return null;
            return reward.type === 'badge' ? `Emblema: ${poolRow.label}` : `Título: "${poolRow.label}"`;
        }
        default:
            return null;
    }
}

function hasClaimed(userId, missionId) {
    if (!userId) return false;
    const row = db.prepare(`SELECT id FROM pot_mission_claims WHERE user_id = ? AND mission_id = ?`).get(userId, missionId);
    return !!row;
}

/**
 * Missões com requisito CUMPRIDO agora e ainda não reivindicadas — mesmo
 * padrão de imageShopSystem.getRedeemableItems.
 * @param {string} userId
 * @returns {Array<{id:number, title:string, requirement:object}>}
 */
function getClaimableMissions(userId) {
    if (!userId) return [];
    const AchievementSystem = require('./achievementSystem');
    const results = [];
    for (const row of listMissions({ publicOnly: true })) {
        if (!row.requirement || row.coming_soon || hasClaimed(userId, row.id)) continue;
        const requirement = AchievementSystem.parseRequirement(row);
        if (requirement && AchievementSystem.checkRequirementMet(userId, requirement)) {
            results.push({ id: row.id, title: row.title, requirement });
        }
    }
    return results;
}

/**
 * Reivindica uma missão cujo requisito já foi cumprido — reconfere
 * elegibilidade AQUI (nunca confia só na lista já mostrada ao jogador, ver
 * imageShopSystem.redeemItem pro mesmo raciocínio), grava a reivindicação
 * ANTES de conceder a recompensa (nunca deixar conceder 2x), e credita a
 * recompensa configurada.
 * @param {string} userId
 * @param {number} missionId
 * @returns {{ok:boolean, error?:string, label?:string}}
 */
function claimMission(userId, missionId) {
    if (!userId) return { ok: false, error: 'Vincule sua conta com /registrar primeiro.' };
    const row = getMissionById(missionId);
    if (!row || !row.is_public) return { ok: false, error: 'Missão não encontrada.' };
    if (row.coming_soon) return { ok: false, error: 'Esta missão ainda não está disponível — em breve.' };
    if (hasClaimed(userId, missionId)) return { ok: false, error: 'Você já concluiu esta missão.' };

    const AchievementSystem = require('./achievementSystem');
    const requirement = AchievementSystem.parseRequirement(row);
    if (!requirement || !AchievementSystem.checkRequirementMet(userId, requirement)) {
        return { ok: false, error: 'Você ainda não cumpre o requisito desta missão.' };
    }

    const reward = parseReward(row);
    if (!reward) return { ok: false, error: 'Esta missão ainda não tem uma recompensa configurada.' };

    try {
        db.prepare(`INSERT INTO pot_mission_claims (user_id, mission_id, claimed_at) VALUES (?, ?, ?)`)
            .run(userId, missionId, Date.now());
    } catch (error) {
        console.error('❌ [MissionSystem] Erro ao registrar reivindicação:', error);
        return { ok: false, error: 'Erro ao registrar a conclusão — tente novamente.' };
    }

    const PlayerRegistry = require('./potPlayerRegistry');
    switch (reward.type) {
        case 'ossos':
            PlayerRegistry.addBones(userId, reward.guildId, reward.amount);
            break;
        case 'cacadas':
            PlayerRegistry.addHunt(userId, reward.amount);
            break;
        case 'badge':
        case 'titulo':
            db.prepare(`
                INSERT OR IGNORE INTO image_inventory (user_id, pool_type, pool_id, purchased_at, source)
                VALUES (?, ?, ?, ?, 'mission')
            `).run(userId, reward.type, reward.poolId, Date.now());
            break;
    }

    return { ok: true, label: row.title };
}

module.exports = {
    VALID_REWARD_TYPES,
    getMissionById,
    listMissions,
    createMission,
    setPublic,
    setComingSoon,
    removeMission,
    setRequirement,
    setReward,
    parseReward,
    describeReward,
    hasClaimed,
    getClaimableMissions,
    claimMission,
};
