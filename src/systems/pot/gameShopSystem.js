// src/systems/pot/gameShopSystem.js
/**
 * Loja de Jogo — reforma pedida pelo dono, 2026-08-12: "A loja em jogo deve
 * permitir ser configuravel growths, skipshed, quest de jogo, e os growths
 * podem configurados para ser limitados a certos dinossauros." Diferente da
 * Loja de Personalização (Caçadas, global, só o dono administra): esta usa
 * Ossos (Bones) e cada SERVIDOR configura seu próprio catálogo (preço,
 * liga/desliga, restrição de espécie por etapa de Growth) — ver
 * ConfigSystem.memberIsGuildAdmin/rota `/lojajogo/:guildId` no dashboard.
 *
 * Catálogo fixo (6 itens, sem CRUD de item novo — só preço/liga/restrição
 * são configuráveis): 4 etapas de Growth (cada uma com sua própria lista de
 * espécies permitidas, pedido explícito do dono — lista vazia = todas
 * liberadas), Skipshed e Missão (GiveQuest, precisa do nome exato da missão
 * configurada em jogo).
 *
 * Config por servidor vive na tabela `settings` já existente (mesmo padrão
 * de PoTConfigSystem.setServerConfig/getServerConfig), chave
 * 'pot_game_shop_config' — sem tabela nova, JSON pequeno por guild.
 *
 * Compra segue exatamente o padrão já usado em
 * currencySystem.convertBonesToMarks: debita Ossos ANTES do RCON, devolve
 * se o RCON falhar — nunca deixa o jogador perder moeda por uma falha fora
 * do controle dele.
 */
const db = require('../../database/index');
const PlayerRegistry = require('./potPlayerRegistry');
const PremiumSystem = require('../premium/premiumSystem');

const SETTINGS_KEY = 'pot_game_shop_config';

// growthValue é o valor cru passado pro RCON `rewardgrowth` (mesma escala
// 0-1 de pot_players.dinosaur_growth). speciesRestrictable só existe nos 4
// itens de Growth — Skipshed/Missão não fazem sentido restringir por
// espécie (não alteram o dinossauro em si).
const GAME_SHOP_ITEMS = {
    growth_juvenil: { label: 'Growth: Juvenil', growthValue: 0.25, speciesRestrictable: true },
    growth_adolescente: { label: 'Growth: Adolescente', growthValue: 0.5, speciesRestrictable: true },
    growth_subadulto: { label: 'Growth: Subadulto', growthValue: 0.75, speciesRestrictable: true },
    growth_adulto: { label: 'Growth: Adulto', growthValue: 1.0, speciesRestrictable: true },
    skipshed: { label: 'Skipshed', speciesRestrictable: false },
    quest: { label: 'Missão de Marks', speciesRestrictable: false, needsMission: true },
};

// enabled:false por padrão em TODO item — nada fica comprável até o admin
// do servidor (ou o dono) ligar e definir um preço de propósito, evitando
// abrir a loja sem querer com preço zero/indefinido.
function _defaultItemConfig(key) {
    const item = GAME_SHOP_ITEMS[key];
    const base = { enabled: false, price: 0 };
    if (item.speciesRestrictable) base.species = [];
    if (item.needsMission) base.missionName = '';
    return base;
}

function _readRaw(guildId) {
    const result = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`).get(guildId, SETTINGS_KEY);
    if (!result) return null;
    try { return JSON.parse(result.value); } catch { return null; }
}

/**
 * Config completa (todos os 6 itens, mesclada com o padrão) — chamadores
 * nunca precisam checar `undefined` por item novo adicionado depois que o
 * servidor já tinha uma config salva.
 * @param {string} guildId
 */
function getGuildShopConfig(guildId) {
    const stored = _readRaw(guildId) || {};
    const merged = {};
    for (const key of Object.keys(GAME_SHOP_ITEMS)) {
        merged[key] = { ..._defaultItemConfig(key), ...(stored[key] || {}) };
    }
    return merged;
}

/**
 * Grava a config inteira de uma vez (o painel de admin sempre reenvia o
 * formulário completo) — mesmo padrão upsert de PoTConfigSystem.setServerConfig.
 * @param {string} guildId
 * @param {object} config - shape de getGuildShopConfig()
 * @param {string} userId
 */
function setGuildShopConfig(guildId, config, userId) {
    db.prepare(`
        INSERT INTO settings (guild_id, key, value, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, key) DO UPDATE SET
            value = excluded.value,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
    `).run(guildId, SETTINGS_KEY, JSON.stringify(config), userId, Date.now());
}

function _buildRconCommand(itemKey, target, itemConfig) {
    const item = GAME_SHOP_ITEMS[itemKey];
    if (item.speciesRestrictable) return `rewardgrowth ${target} ${item.growthValue}`;
    if (itemKey === 'skipshed') return `SkipShed ${target}`;
    if (itemKey === 'quest') return `GiveQuest ${target} ${itemConfig.missionName}`;
    return null;
}

/**
 * Compra um item da Loja de Jogo — debita Ossos, dispara o RCON
 * correspondente, devolve o valor se o RCON falhar.
 * @param {string} guildId
 * @param {string} discordId
 * @param {string} itemKey - chave de GAME_SHOP_ITEMS
 * @returns {Promise<{ok: true, label: string, price: number} | {ok: false, error: string}>}
 */
async function purchaseGameShopItem(guildId, discordId, itemKey) {
    const item = GAME_SHOP_ITEMS[itemKey];
    if (!item) return { ok: false, error: 'Item inválido.' };

    if (!PremiumSystem.getGuildLimits(guildId).genericRconEnabled) {
        return { ok: false, error: 'Este servidor não está no plano Caçador — a Loja de Jogo depende do mesmo RCON liberado só nesse tier.' };
    }

    const config = getGuildShopConfig(guildId);
    const itemConfig = config[itemKey];
    if (!itemConfig.enabled) return { ok: false, error: 'Este item não está à venda neste servidor.' };
    if (!Number.isInteger(itemConfig.price) || itemConfig.price <= 0) return { ok: false, error: 'Este item ainda não tem um preço configurado.' };
    if (item.needsMission && !itemConfig.missionName) return { ok: false, error: 'Este item ainda não tem uma missão configurada — avise a equipe do servidor.' };

    const link = PlayerRegistry.getPlayerByDiscordId(discordId);
    if (!link) return { ok: false, error: 'Você precisa vincular sua conta com /registrar antes de comprar.' };

    const onlinePlayer = PlayerRegistry.getOnlinePotPlayer(guildId, link.alderon_id);
    if (!onlinePlayer) return { ok: false, error: 'Você precisa estar online no servidor de jogo pra comprar.' };

    if (item.speciesRestrictable) {
        if (!onlinePlayer.dinosaur_active || !onlinePlayer.dinosaur_type) {
            return { ok: false, error: 'Você precisa estar dentro de um dinossauro (fora da tela de seleção de personagem) pra comprar Growth.' };
        }
        const allowedSpecies = Array.isArray(itemConfig.species) ? itemConfig.species : [];
        if (allowedSpecies.length > 0) {
            const isAllowed = allowedSpecies.some(s => s.toLowerCase() === onlinePlayer.dinosaur_type.toLowerCase());
            if (!isAllowed) return { ok: false, error: `${item.label} não está liberado pra ${onlinePlayer.dinosaur_type} neste servidor.` };
        }
    }

    if (!PlayerRegistry.spendBones(discordId, itemConfig.price)) {
        return { ok: false, error: 'Saldo de Ossos insuficiente.' };
    }

    const command = _buildRconCommand(itemKey, link.alderon_id, itemConfig);
    const PoTConfigSystem = require('./potConfigSystem');
    const rconResult = await PoTConfigSystem.executeRconCommand(guildId, command, { actor: `<@${discordId}>`, source: `Loja de Jogo (${item.label})` });

    if (!rconResult.success) {
        PlayerRegistry.addBones(discordId, itemConfig.price);
        return { ok: false, error: `Não foi possível aplicar "${item.label}" no jogo (${rconResult.error || 'erro desconhecido'}). Seus Ossos foram devolvidos.` };
    }

    db.logActivity(guildId, discordId, 'game_shop_purchase', null, {
        itemKey, price: itemConfig.price, command, sucesso: true,
    });

    return { ok: true, label: item.label, price: itemConfig.price };
}

module.exports = {
    GAME_SHOP_ITEMS,
    getGuildShopConfig,
    setGuildShopConfig,
    purchaseGameShopItem,
};
