// src/systems/pot/imageShopSystem.js
/**
 * Loja de Personalização — compra de imagens do pool (tipo 'personalizacao'
 * — foto de perfil e plano de fundo unificados, reforma 2026-08-12) com
 * Caçadas, guardadas no inventário do jogador. Pedido original do dono,
 * 2026-08-07: "a loja vai ser permitida a qualquer jogador, para comprar e
 * adicionar ao seu inventario imagens de personalização... quero que
 * adicione uma configuração para permitir que eu gerencie as imagens como
 * itens da loja, e quem pode usar ou só comprar para o inventário."
 *
 * Duas coisas SEPARADAS, de propósito:
 *  - QUEM PODE COMPRAR: qualquer jogador, em qualquer tier, contanto que
 *    tenha Caçadas suficientes — sem gate de tier nenhum na compra em si.
 *  - QUEM PODE USAR (equipar) o item depois de comprado: configurável por
 *    item (profile_image_pool.shop_min_tier) — quem não atinge esse tier
 *    ainda fica com o item só no inventário, sem poder selecioná-lo.
 *
 * Isso é DIFERENTE do acesso "de graça" que Compy+/Raptor já tinham a TODO
 * o pool (ver configSystem.js getPersonalizationOptions) — esse acesso
 * continua existindo do jeito que já era, sem depender de compra nenhuma.
 * Esta loja é um caminho ADICIONAL: qualquer tier pode comprar um item
 * ESPECÍFICO com Caçadas em vez de precisar do plano Compy pra ter acesso
 * ao pool inteiro.
 *
 * setShopConfig só aceita tipo 'personalizacao' (reforma 2026-08-12) —
 * badge/titulo deixaram de ser compráveis direto, viram resgate por
 * requisito cumprido (ver `requirement` na tabela e checkRequirementMet).
 *
 * Item sem shop_price definido (NULL) simplesmente não está à venda —
 * continua só acessível pelo caminho antigo (tier), esta loja não se
 * aplica a ele. canUseImage() abaixo NUNCA retorna true pra um item sem
 * preço — a regra de acesso "de graça" por tier é decidida FORA deste
 * arquivo, no call site (configSystem.js/dashboard.js), que já faz isso
 * há tempos; misturar as duas regras aqui seria fácil de acabar
 * liberando acesso indevido por engano.
 *
 * MARKETPLACE de imagens enviadas por jogador (reforma 2026-08-12, pedido
 * do dono: jogador paga Caçadas pra enviar uma imagem, dono aprova/reprova
 * em /dev/image-pool — ver dashboard.js POST /loja/enviar-imagem). Item com
 * `submitted_by` preenchido é DIFERENTE de um item curado pelo dono:
 *  - Repasse: 10% do valor de CADA venda vai pro `submitted_by` em Caçadas
 *    (purchaseImage abaixo).
 *  - Preço por popularidade: sobe POPULARITY_PRICE_STEP (5%, arredondado
 *    pra cima) a cada compra, nunca desce sozinho — só o dono pode editar
 *    manualmente pra baixo se quiser, via setShopConfig. Itens curados
 *    pelo dono (submitted_by NULL) NUNCA são repreçados automaticamente.
 */
'use strict';

const db = require('../../database/index');
const ProfileImagePool = require('./profileImagePool');

const VALID_SHOP_TIERS = ['free', 'compy', 'raptor'];

// Repasse pro autor de um item de marketplace (submitted_by preenchido) a
// cada venda, e o quanto o preço sobe por popularidade a cada venda —
// pedido do dono, 2026-08-12: "recebe 10% do valor da imagem em modas de
// caçada" + "quanto mais pessoas comprarem maior vai ficando o preço" —
// 5% (não os 15% sugeridos por mim inicialmente: "acho que 15% é muito
// alto, tente fazer esse crescimento ser um pouco lento").
const CREATOR_REVENUE_SHARE = 0.10;
const POPULARITY_PRICE_STEP = 0.05;

/**
 * Define (ou remove) o preço/tier mínimo de uso de um item do pool. Só
 * aceita tipo 'personalizacao' (badge/titulo usam `requirement`, não
 * preço — ver docblock do arquivo). price <= 0/null/undefined remove o
 * item da loja (shop_price volta a NULL) — o item continua existindo no
 * pool normalmente, só não é mais comprável. minTier inválido/ausente cai
 * em 'free' (qualquer um que comprar já pode usar imediatamente).
 * @param {string} type
 * @param {number} id
 * @param {{ price?: number|null, minTier?: string }} config
 * @returns {boolean} true se o item existe e foi atualizado
 */
function setShopConfig(type, id, { price, minTier } = {}) {
    if (type !== 'personalizacao') return false;
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
        WHERE type = ? AND shop_price IS NOT NULL AND is_public = 1 AND pending_review = 0
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
 * Emblemas/títulos com requisito CUMPRIDO agora e ainda não possuídos —
 * reforma 2026-08-12: badge/titulo saem do preço direto, viram resgate
 * por requisito (ver AchievementSystem). Usado pra montar o menu
 * "Resgatar" do /perfil (bot e site).
 * @param {string} userId
 * @returns {Array<{type: string, id: number, label: string, requirement: object}>}
 */
function getRedeemableItems(userId) {
    if (!userId) return [];
    const AchievementSystem = require('./achievementSystem');
    const results = [];
    for (const type of ['badge', 'titulo']) {
        for (const row of ProfileImagePool.listImages(type, { publicOnly: true })) {
            if (!row.requirement || ownsImage(userId, type, row.id)) continue;
            const requirement = AchievementSystem.parseRequirement(row);
            if (requirement && AchievementSystem.checkRequirementMet(userId, requirement)) {
                results.push({ type, id: row.id, label: row.label, requirement });
            }
        }
    }
    return results;
}

/**
 * Resgata um emblema/título cujo requisito já foi cumprido — sem gastar
 * moeda, grava em image_inventory com source='redeemed' (auditoria,
 * distingue de 'purchase'). Reconfere elegibilidade AQUI (nunca confia só
 * na lista já mostrada ao jogador, que pode ter ficado desatualizada
 * entre a interação abrir e o clique de verdade).
 * @param {string} userId
 * @param {string} type - 'badge'|'titulo'
 * @param {number} id
 * @returns {{ok: boolean, error?: string, label?: string}}
 */
function redeemItem(userId, type, id) {
    if (!userId) return { ok: false, error: 'Vincule sua conta com /registrar primeiro.' };
    const row = ProfileImagePool.getByTypeAndId(type, id);
    if (!row || !row.is_public) return { ok: false, error: 'Item não encontrado.' };
    if (ownsImage(userId, type, id)) return { ok: false, error: 'Você já possui este item.' };

    const AchievementSystem = require('./achievementSystem');
    const requirement = AchievementSystem.parseRequirement(row);
    if (!requirement || !AchievementSystem.checkRequirementMet(userId, requirement)) {
        return { ok: false, error: 'Você ainda não cumpre o requisito pra resgatar este item.' };
    }

    try {
        db.prepare(`
            INSERT INTO image_inventory (user_id, pool_type, pool_id, purchased_at, source)
            VALUES (?, ?, ?, ?, 'redeemed')
        `).run(userId, type, id, Date.now());
        return { ok: true, label: row.label };
    } catch (error) {
        console.error('❌ [ImageShop] Erro ao registrar resgate:', error);
        return { ok: false, error: 'Erro ao registrar o resgate — tente novamente.' };
    }
}

/**
 * Compra um item — debita Caçadas e grava no inventário. Debita ANTES de
 * inserir (mesmo raciocínio do resto da economia: nunca deixar duas
 * chamadas simultâneas do mesmo jogador comprarem além do saldo, ver
 * spendBones/spendHunt); se a inserção falhar depois de já ter debitado
 * (erro inesperado), devolve a Caçada gasta na hora, igual já é feito no
 * conversor Ossos<->Marks pra nunca fazer o jogador perder moeda por uma
 * falha do lado do bot.
 *
 * Se o item for de marketplace (submitted_by preenchido — ver docblock do
 * arquivo), a compra bem-sucedida também credita 10% do preço em Caçadas
 * pro autor e sobe o preço em 5% (arredondado pra cima, nunca desce
 * sozinho) — os dois passos rodam DEPOIS do inventário já gravado com
 * sucesso, best-effort (uma falha aqui não desfaz a compra em si, já
 * concluída — só loga o erro).
 * @param {string} userId
 * @param {string} type
 * @param {number} id
 * @returns {{ ok: boolean, error?: string }}
 */
function purchaseImage(userId, type, id) {
    if (!userId) return { ok: false, error: 'Vincule sua conta com /registrar primeiro.' };

    const row = ProfileImagePool.getByTypeAndId(type, id);
    if (!row || !row.is_public || row.pending_review) return { ok: false, error: 'Item não encontrado.' };
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
    } catch (error) {
        PlayerRegistry.addHunt(userId, row.shop_price);
        console.error('❌ [ImageShop] Erro ao registrar compra (Caçadas devolvidas):', error);
        return { ok: false, error: 'Erro ao registrar a compra — suas Caçadas foram devolvidas.' };
    }

    if (row.submitted_by && row.submitted_by !== userId) {
        try {
            const creatorShare = Math.round(row.shop_price * CREATOR_REVENUE_SHARE);
            if (creatorShare > 0) PlayerRegistry.addHunt(row.submitted_by, creatorShare);

            const newPrice = row.shop_price + Math.max(1, Math.ceil(row.shop_price * POPULARITY_PRICE_STEP));
            db.prepare(`UPDATE profile_image_pool SET shop_price = ? WHERE type = ? AND id = ?`).run(newPrice, type, id);
        } catch (error) {
            console.error('❌ [ImageShop] Erro ao aplicar repasse/reprecificação de item de marketplace:', error);
        }
    }

    return { ok: true };
}

/**
 * Config global (única linha, id=1) do marketplace de envio de imagens —
 * taxa de envio em Caçadas e se o dono está aceitando envios novos agora.
 * Sempre existe uma linha (seedada em database/index.js na migração), mas
 * o fallback aqui cobre qualquer ambiente onde isso ainda não rodou.
 */
function getPersonalizationShopConfig() {
    const row = db.prepare(`SELECT * FROM personalization_shop_config WHERE id = 1`).get();
    return row || { id: 1, submission_fee: 500, accepting_submissions: 1 };
}

function setPersonalizationShopConfig({ submissionFee, acceptingSubmissions }) {
    const normalizedFee = Number.isInteger(submissionFee) && submissionFee > 0 ? submissionFee : 500;
    db.prepare(`
        INSERT INTO personalization_shop_config (id, submission_fee, accepting_submissions)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET submission_fee = excluded.submission_fee, accepting_submissions = excluded.accepting_submissions
    `).run(normalizedFee, acceptingSubmissions ? 1 : 0);
}

/**
 * Submete uma imagem enviada por jogador pra venda — cobra a taxa de
 * envio (Caçadas), valida se o marketplace está aceitando envios, e cria
 * a entrada como pendente de aprovação (ver ProfileImagePool.
 * addSubmittedImage). Mesmo padrão débito-antes-devolve-se-falhar do
 * resto da economia.
 * @param {string} userId
 * @param {string} label
 * @param {string} messageId - já armazenado via storeImageBuffer (ver
 *   dashboard.js POST /loja/enviar-imagem)
 * @returns {{ok: boolean, error?: string}}
 */
function submitImageForSale(userId, label, messageId) {
    if (!userId) return { ok: false, error: 'Vincule sua conta com /registrar primeiro.' };
    const config = getPersonalizationShopConfig();
    if (!config.accepting_submissions) return { ok: false, error: 'O envio de imagens pra venda está temporariamente fechado.' };
    if (!label || !messageId) return { ok: false, error: 'Imagem inválida.' };

    const PlayerRegistry = require('./potPlayerRegistry');
    if (!PlayerRegistry.spendHunt(userId, config.submission_fee)) {
        return { ok: false, error: 'Saldo de Caçadas insuficiente pra pagar a taxa de envio.' };
    }

    const ProfileImagePool = require('./profileImagePool');
    try {
        ProfileImagePool.addSubmittedImage(label, messageId, userId, config.submission_fee);
        return { ok: true };
    } catch (error) {
        PlayerRegistry.addHunt(userId, config.submission_fee);
        console.error('❌ [ImageShop] Erro ao registrar envio pra venda (Caçadas devolvidas):', error);
        return { ok: false, error: 'Erro ao registrar o envio — suas Caçadas foram devolvidas.' };
    }
}

/**
 * Reprova um envio pendente — devolve a taxa de envio e apaga a entrada
 * por completo (pedido do dono: "removemos tudo sobre o item").
 * @param {number} id
 */
function rejectSubmission(id) {
    const ProfileImagePool = require('./profileImagePool');
    const row = ProfileImagePool.getByTypeAndId('personalizacao', id);
    if (!row || !row.pending_review) return false;
    if (row.submitted_by && row.submission_fee) {
        const PlayerRegistry = require('./potPlayerRegistry');
        PlayerRegistry.addHunt(row.submitted_by, row.submission_fee);
    }
    ProfileImagePool.removeImage('personalizacao', id);
    return true;
}

module.exports = {
    VALID_SHOP_TIERS,
    CREATOR_REVENUE_SHARE,
    POPULARITY_PRICE_STEP,
    setShopConfig,
    getShopItems,
    getInventory,
    ownsImage,
    canUseImage,
    getRedeemableItems,
    redeemItem,
    purchaseImage,
    getPersonalizationShopConfig,
    setPersonalizationShopConfig,
    submitImageForSale,
    rejectSubmission,
};
