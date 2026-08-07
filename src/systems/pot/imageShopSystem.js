// src/systems/pot/imageShopSystem.js
/**
 * Loja de Personalização — compra de imagens do pool (avatar/plano de
 * fundo/badge/titulo) com Caçadas, guardadas no inventário do jogador.
 * Pedido do dono, 2026-08-07: "a loja vai ser permitida a qualquer
 * jogador, para comprar e adicionar ao seu inventario imagens de
 * personalização... na pool de imagens quero que adicione uma
 * configuração para permitir que eu gerencie as imagens como itens da
 * loja, e quem pode usar ou só comprar para o inventário."
 *
 * Duas coisas SEPARADAS, de propósito:
 *  - QUEM PODE COMPRAR: qualquer jogador, em qualquer tier, contanto que
 *    tenha Caçadas suficientes — sem gate de tier nenhum na compra em si.
 *  - QUEM PODE USAR (equipar) o item depois de comprado: configurável por
 *    item (profile_image_pool.shop_min_tier) — quem não atinge esse tier
 *    ainda fica com o item só no inventário, sem poder selecioná-lo.
 *
 * Isso é DIFERENTE do acesso "de graça" que Compy+/Raptor já tinham a
 * TODO o pool (ver configSystem.js getAvatarOptions/getBackgroundOptions)
 * — esse acesso continua existindo do jeito que já era, sem depender de
 * compra nenhuma. Esta loja é um caminho ADICIONAL: qualquer tier pode
 * comprar um item ESPECÍFICO com Caçadas em vez de precisar do plano
 * Compy pra ter acesso ao pool inteiro.
 *
 * Item sem shop_price definido (NULL) simplesmente não está à venda —
 * continua só acessível pelo caminho antigo (tier), esta loja não se
 * aplica a ele. canUseImage() abaixo NUNCA retorna true pra um item sem
 * preço — a regra de acesso "de graça" por tier é decidida FORA deste
 * arquivo, no call site (configSystem.js/dashboard.js), que já faz isso
 * há tempos; misturar as duas regras aqui seria fácil de acabar
 * liberando acesso indevido por engano.
 */
'use strict';

const db = require('../../database/index');
const ProfileImagePool = require('./profileImagePool');

const VALID_SHOP_TIERS = ['free', 'compy', 'raptor'];

/**
 * Define (ou remove) o preço/tier mínimo de uso de um item do pool.
 * price <= 0/null/undefined remove o item da loja (shop_price volta a
 * NULL) — o item continua existindo no pool normalmente, só não é mais
 * comprável. minTier inválido/ausente cai em 'free' (qualquer um que
 * comprar já pode usar imediatamente).
 * @param {string} type
 * @param {number} id
 * @param {{ price?: number|null, minTier?: string }} config
 * @returns {boolean} true se o item existe e foi atualizado
 */
function setShopConfig(type, id, { price, minTier } = {}) {
    const row = ProfileImagePool.getByTypeAndId(type, id);
    if (!row) return false;

    const normalizedPrice = (!price || price <= 0) ? null : Math.floor(price);
    const normalizedTier = normalizedPrice
        ? (VALID_SHOP_TIERS.includes(minTier) ? minTier : 'free')
        : null;

    db.prepare(`
        UPDATE profile_image_pool SET shop_price = ?, shop_min_tier = ? WHERE type = ? AND id = ?
    `).run(normalizedPrice, normalizedTier, type, id);
    return true;
}

/**
 * Itens à venda de um tipo (shop_price definido, público). Com userId,
 * cada linha ganha `owned: boolean` (já está no inventário desse jogador).
 * @param {string} type
 * @param {{ userId?: string }} opts
 */
function getShopItems(type, opts = {}) {
    const rows = db.prepare(`
        SELECT * FROM profile_image_pool
        WHERE type = ? AND shop_price IS NOT NULL AND is_public = 1
        ORDER BY shop_price ASC, label ASC
    `).all(type);

    if (!opts.userId) return rows;
    const owned = new Set(getInventory(opts.userId, type).map(r => r.pool_id));
    return rows.map(row => ({ ...row, owned: owned.has(row.id) }));
}

/**
 * Inventário do jogador — todos os itens comprados, opcionalmente
 * filtrado por tipo de pool.
 * @param {string} userId
 * @param {string} [type]
 */
function getInventory(userId, type) {
    if (!userId) return [];
    if (type) {
        return db.prepare(`SELECT * FROM image_inventory WHERE user_id = ? AND pool_type = ?`).all(userId, type);
    }
    return db.prepare(`SELECT * FROM image_inventory WHERE user_id = ?`).all(userId);
}

function ownsImage(userId, type, id) {
    if (!userId) return false;
    const row = db.prepare(`
        SELECT id FROM image_inventory WHERE user_id = ? AND pool_type = ? AND pool_id = ?
    `).get(userId, type, id);
    return !!row;
}

/**
 * True se este jogador pode USAR (equipar) este item ESPECÍFICO via
 * compra — comprado E o tier ATUAL dele (lido direto do banco via
 * PremiumSystem, nunca recebido por parâmetro — evita o chamador passar
 * um tier desatualizado sem querer) alcança o shop_min_tier configurado.
 * NUNCA retorna true pra item sem preço (ver docblock do arquivo) —
 * acesso "de graça" por tier ao pool inteiro é decidido no call site,
 * não aqui.
 * @param {string} userId
 * @param {string} type
 * @param {number} id
 */
function canUseImage(userId, type, id) {
    const row = ProfileImagePool.getByTypeAndId(type, id);
    if (!row || !row.shop_price) return false;
    if (!ownsImage(userId, type, id)) return false;
    const PremiumSystem = require('../premium/premiumSystem');
    return PremiumSystem.isPlayerAtLeast(userId, row.shop_min_tier || 'free');
}

/**
 * Compra um item — debita Caçadas e grava no inventário. Debita ANTES de
 * inserir (mesmo raciocínio do resto da economia: nunca deixar duas
 * chamadas simultâneas do mesmo jogador comprarem além do saldo, ver
 * spendBones/spendHunt); se a inserção falhar depois de já ter debitado
 * (erro inesperado), devolve a Caçada gasta na hora, igual já é feito no
 * conversor Ossos<->Marks pra nunca fazer o jogador perder moeda por uma
 * falha do lado do bot.
 * @param {string} userId
 * @param {string} type
 * @param {number} id
 * @returns {{ ok: boolean, error?: string }}
 */
function purchaseImage(userId, type, id) {
    if (!userId) return { ok: false, error: 'Vincule sua conta com /registrar primeiro.' };

    const row = ProfileImagePool.getByTypeAndId(type, id);
    if (!row || !row.is_public) return { ok: false, error: 'Item não encontrado.' };
    if (!row.shop_price) return { ok: false, error: 'Este item não está à venda.' };
    if (ownsImage(userId, type, id)) return { ok: false, error: 'Você já tem este item no seu inventário.' };

    const PlayerRegistry = require('./potPlayerRegistry');
    const spent = PlayerRegistry.spendHunt(userId, row.shop_price);
    if (!spent) return { ok: false, error: 'Saldo de Caçadas insuficiente.' };

    try {
        db.prepare(`
            INSERT INTO image_inventory (user_id, pool_type, pool_id, purchased_at)
            VALUES (?, ?, ?, ?)
        `).run(userId, type, id, Date.now());
        return { ok: true };
    } catch (error) {
        PlayerRegistry.addHunt(userId, row.shop_price);
        console.error('❌ [ImageShop] Erro ao registrar compra (Caçadas devolvidas):', error);
        return { ok: false, error: 'Erro ao registrar a compra — suas Caçadas foram devolvidas.' };
    }
}

module.exports = {
    VALID_SHOP_TIERS,
    setShopConfig,
    getShopItems,
    getInventory,
    ownsImage,
    canUseImage,
    purchaseImage,
};
