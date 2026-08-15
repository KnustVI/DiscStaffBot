// src/systems/pot/profileImagePool.js
/**
 * Pool de imagens (personalização/emblema/banner) usado pelos pickers de
 * /perfil-edit E pela galeria de banner de /config personalizar (Strike/
 * Unstrike/Report-Chat, Discord + dashboard) — alimentado pelo dono via
 * /dev/Loja no dashboard, sem precisar editar código/redeployar a cada
 * imagem nova. "Padrão do bot" de cada banner continua sendo a única
 * exceção estática (é a imagem oficial do bot, não um item do pool).
 *
 * type 'avatar'/'background' foram UNIFICADOS em 'personalizacao' (reforma
 * das lojas, 2026-08-12 — "Qualquer imagem da loja, se adiquirido, agora
 * pode ser usada como plano de fundo ou como perfil, não vamos dividir o
 * uso das mesmas") — quem possui uma imagem pode usá-la como foto OU plano
 * de fundo, independentemente, ver configSystem.js getPersonalizationOptions.
 *
 * Cada imagem pode ser marcada pública ou privada (is_public, ver
 * setPublic() abaixo) — controle exclusivo do dono, pela página /dev/Loja
 * do dashboard, pra esconder uma imagem do menu de escolha sem precisar
 * removê-la de verdade. listImages(type, {publicOnly:true}) é o que os
 * pickers voltados ao usuário comum usam; sem esse filtro (só /dev/Loja)
 * o dono vê tudo, inclusive pendentes de aprovação (ver pending_review).
 *
 * Mesmo padrão de armazenamento já usado pro upload próprio do Raptor
 * (banner_message_id/background_message_id em player_links): a imagem em si
 * é reenviada pra um canal fixo do bot (BANNER_STORAGE_CHANNEL_ID) e só o ID
 * da MENSAGEM é guardado — a URL do anexo do Discord expira em ~24h, então é
 * sempre resolvida de novo (channel.messages.fetch) na hora de exibir.
 *
 * Valores selecionáveis vindos deste pool usam o prefixo "pool:<id>" nas
 * colunas selected_photo_key/selected_background_key/selected_badge_key de
 * player_links (e nas chaves de banner strike_banner_key/etc, ver
 * src/utils/customBannerResolver.js), pra distinguir de uma chave estática
 * do imageManager (ex: "title_strike", "foto_perfil_01" — essa segunda
 * continua funcionando pra configs salvas ANTES desta unificação, só saiu
 * do menu de opções) sem precisar de nenhuma coluna nova.
 */
const db = require('../../database/index');

// 'titulo' é o único tipo TEXTO do pool (título de perfil pré-definido pelo
// dono) — todos os outros são backed por um attachment do Discord. Pra uma
// linha 'titulo', a coluna `label` (já texto livre pra todo tipo) guarda o
// TEXTO DO TÍTULO em si, e `message_id` é gravado como string vazia ''
// (nunca null — a coluna é TEXT NOT NULL) porque não existe mensagem/anexo
// pra resolver. Ver addImage() e o guard em resolveImageUrl/Buffer abaixo.
const VALID_TYPES = ['personalizacao', 'badge', 'banner', 'titulo'];
const POOL_PREFIX = 'pool:';

function toPoolValue(id) {
    return `${POOL_PREFIX}${id}`;
}

function isPoolValue(value) {
    return typeof value === 'string' && value.startsWith(POOL_PREFIX);
}

function poolIdFromValue(value) {
    if (!isPoolValue(value)) return null;
    const id = Number(value.slice(POOL_PREFIX.length));
    return Number.isInteger(id) ? id : null;
}

function getById(id) {
    return db.prepare(`SELECT * FROM profile_image_pool WHERE id = ?`).get(id) || null;
}

function getByTypeAndId(type, id) {
    return db.prepare(`SELECT * FROM profile_image_pool WHERE type = ? AND id = ?`).get(type, id) || null;
}

/**
 * @param {string} type - um de VALID_TYPES.
 * @param {string} label - pra avatar/background/badge/banner é o nome de
 *   exibição do item; pra type==='titulo' é o PRÓPRIO TEXTO DO TÍTULO
 *   (não um rótulo separado — não existe imagem, então não há o que rotular).
 * @param {string} messageId - ID da mensagem no canal de armazenamento com o
 *   anexo; pra type==='titulo' passe '' (string vazia, nunca null/undefined —
 *   a coluna é TEXT NOT NULL e não há mensagem/anexo pra um título).
 * @param {string} createdBy - ID do usuário (dono) que criou a entrada.
 */
function addImage(type, label, messageId, createdBy) {
    if (!VALID_TYPES.includes(type)) throw new Error(`Tipo de pool inválido: ${type}`);
    const result = db.prepare(`
        INSERT INTO profile_image_pool (type, label, message_id, created_by, created_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(type, label, messageId, createdBy, Date.now());
    return getById(result.lastInsertRowid);
}

function removeImage(type, id) {
    const row = getByTypeAndId(type, id);
    if (!row) return null;
    db.prepare(`DELETE FROM profile_image_pool WHERE type = ? AND id = ?`).run(type, id);
    return row;
}

/**
 * Liga/desliga a visibilidade pública de uma imagem (pedido do dono: dá pra
 * esconder do menu de escolha sem remover de verdade) — ver setPublic
 * abaixo pra quem grava, e o filtro publicOnly de listImages pra quem lê.
 */
function setPublic(type, id, isPublic) {
    const row = getByTypeAndId(type, id);
    if (!row) return null;
    db.prepare(`UPDATE profile_image_pool SET is_public = ? WHERE type = ? AND id = ?`).run(isPublic ? 1 : 0, type, id);
    return getByTypeAndId(type, id);
}

/**
 * Liga/desliga a flag "Em breve" (pedido do dono, 2026-08-15) — item
 * continua aparecendo na listagem da Loja (se is_public), mas fica sem
 * poder comprar/resgatar até o dono desligar. INDEPENDENTE de is_public,
 * ver o bloqueio server-side em imageShopSystem.js#purchaseImage/redeemItem.
 */
function setComingSoon(type, id, comingSoon) {
    const row = getByTypeAndId(type, id);
    if (!row) return null;
    db.prepare(`UPDATE profile_image_pool SET coming_soon = ? WHERE type = ? AND id = ?`).run(comingSoon ? 1 : 0, type, id);
    return getByTypeAndId(type, id);
}

/**
 * @param {string} type
 * @param {{publicOnly?: boolean}} [opts] - publicOnly:true filtra só
 *   is_public=1 (pickers voltados ao usuário comum); sem isso, devolve TUDO
 *   (a página /dev/Loja do dono, que precisa ver as imagens escondidas
 *   também).
 */
function listImages(type, opts = {}) {
    const { publicOnly = false } = opts;
    if (publicOnly) {
        return db.prepare(`SELECT * FROM profile_image_pool WHERE type = ? AND is_public = 1 ORDER BY id ASC`).all(type);
    }
    return db.prepare(`SELECT * FROM profile_image_pool WHERE type = ? ORDER BY id ASC`).all(type);
}

/**
 * Resolve a URL fresca de uma imagem do pool, refazendo o fetch da mensagem
 * de armazenamento — a URL do anexo nunca é guardada, expira em ~24h. Ver
 * imageStorage.js#resolveStoredImageUrl pra retry/timeout/log (extraído de
 * lá, pedido do dono, 2026-08-15: personalização parando de puxar imagem
 * de vez em quando).
 * @returns {Promise<string|null>}
 */
async function resolveImageUrl(client, type, id) {
    const row = getByTypeAndId(type, id);
    // 'titulo' é texto puro (o texto já está em row.label) — não há
    // mensagem/anexo do Discord pra resolver, então nem tenta.
    if (row && row.type === 'titulo') return null;
    if (!row) return null;
    return require('../../utils/imageStorage').resolveStoredImageUrl(client, row.message_id);
}

/**
 * Mesma resolução acima, devolvendo os bytes crus (Buffer) — usado pelo
 * avatar/foto de perfil (recortado/composto no card, precisa dos bytes),
 * diferente do plano de fundo (só exibido via galeria, URL basta).
 * @returns {Promise<Buffer|null>}
 */
async function resolveImageBuffer(client, type, id) {
    // 'titulo' não tem bytes de imagem pra devolver (ver resolveImageUrl).
    if (type === 'titulo') return null;
    const url = await resolveImageUrl(client, type, id);
    if (!url) return null;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
    } catch (err) {
        return null;
    }
}

/**
 * Cria uma entrada 'personalizacao' enviada por um JOGADOR (marketplace,
 * reforma 2026-08-12) — sempre pending_review=1/is_public=0 (não aparece
 * na loja pra ninguém até o dono aprovar em /dev/Loja), com o valor pago
 * no envio guardado em submission_fee (pra reembolso se reprovado). Ver
 * imageShopSystem.js pro repasse/reprecificação que acontece a cada venda
 * DEPOIS de aprovado.
 * @param {string} label
 * @param {string} messageId
 * @param {string} submittedBy - Discord ID de quem enviou
 * @param {number} submissionFee - Caçadas pagas no envio
 */
function addSubmittedImage(label, messageId, submittedBy, submissionFee) {
    const result = db.prepare(`
        INSERT INTO profile_image_pool (type, label, message_id, created_by, created_at, is_public, submitted_by, pending_review, submission_fee, shop_price, shop_min_tier)
        VALUES ('personalizacao', ?, ?, ?, ?, 0, ?, 1, ?, ?, 'free')
    `).run(label, messageId, submittedBy, Date.now(), submittedBy, submissionFee, submissionFee);
    return getById(result.lastInsertRowid);
}

/**
 * Fila de aprovação (pending_review=1) — sempre itens do marketplace de
 * jogador, nunca curados pelo dono (que já entram direto como públicos).
 */
function getPendingSubmissions() {
    return db.prepare(`SELECT * FROM profile_image_pool WHERE pending_review = 1 ORDER BY created_at ASC`).all();
}

/**
 * Aprova um envio pendente — some da fila e vira comprável de verdade.
 */
function approveSubmission(id) {
    db.prepare(`UPDATE profile_image_pool SET pending_review = 0, is_public = 1 WHERE id = ? AND pending_review = 1`).run(id);
    return getById(id);
}

/**
 * Requisitos de resgate automático (badge/titulo, reforma 2026-08-12,
 * virou LISTA em 2026-08-13 — ver checkRequirementMet) — requirement
 * null/array vazio limpa (volta a ser só concedível na mão, sem resgate
 * automático). Função em si é agnóstica de forma (só JSON.stringify e
 * grava) — quem decide "array de N requisitos, todos obrigatórios" é
 * achievementSystem.js, não aqui.
 * @param {string} type
 * @param {number} id
 * @param {Array<{type: string, value: number, species?: string}>|null} requirement
 */
function setRequirement(type, id, requirement) {
    const row = getByTypeAndId(type, id);
    if (!row) return false;
    db.prepare(`UPDATE profile_image_pool SET requirement = ? WHERE type = ? AND id = ?`)
        .run(requirement ? JSON.stringify(requirement) : null, type, id);
    return true;
}

module.exports = {
    VALID_TYPES,
    toPoolValue,
    isPoolValue,
    poolIdFromValue,
    getById,
    getByTypeAndId,
    addImage,
    addSubmittedImage,
    removeImage,
    setPublic,
    setComingSoon,
    listImages,
    getPendingSubmissions,
    approveSubmission,
    setRequirement,
    resolveImageUrl,
    resolveImageBuffer,
};
