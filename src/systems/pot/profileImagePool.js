// src/systems/pot/profileImagePool.js
/**
 * Pool de imagens (avatar/plano de fundo/emblema/banner) usado pelos 3
 * pickers de /perfil-edit E pela galeria de banner de /config personalizar
 * (Strike/Unstrike/Report-Chat, Discord + dashboard) — alimentado pelo dono
 * via /perfil-pool (bot developer), sem precisar editar código/redeployar a
 * cada imagem nova. Unificado (pedido do dono): a galeria de banner usava
 * um array estático à parte (PLAYER_PHOTO_OPTIONS em configSystem.js,
 * resolvido via imageManager/assets/images) até essa mudança — agora os 4
 * tipos vêm 100% daqui. "Padrão do bot" de cada banner continua sendo a
 * única exceção estática (é a imagem oficial do bot, não um item do pool).
 *
 * Cada imagem pode ser marcada pública ou privada (is_public, ver
 * setPublic() abaixo) — controle exclusivo do dono, pela página
 * /dev/image-pool do dashboard, pra esconder uma imagem do menu de escolha
 * sem precisar removê-la de verdade (preparação pro pool ficar mais aberto
 * no futuro). listImages(type, {publicOnly:true}) é o que os pickers
 * voltados ao usuário comum usam; sem esse filtro (developer command
 * /perfil-pool listar, e a própria página /dev/image-pool) o dono vê tudo.
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
const VALID_TYPES = ['avatar', 'background', 'badge', 'banner', 'titulo'];
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
 * @param {string} type
 * @param {{publicOnly?: boolean}} [opts] - publicOnly:true filtra só
 *   is_public=1 (pickers voltados ao usuário comum); sem isso, devolve TUDO
 *   (developer command /perfil-pool listar e a página /dev/image-pool do
 *   dono, que precisam ver as imagens escondidas também).
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
 * de armazenamento — a URL do anexo nunca é guardada, expira em ~24h.
 * @returns {Promise<string|null>}
 */
async function resolveImageUrl(client, type, id) {
    const row = getByTypeAndId(type, id);
    // 'titulo' é texto puro (o texto já está em row.label) — não há
    // mensagem/anexo do Discord pra resolver, então nem tenta.
    if (row && row.type === 'titulo') return null;
    if (!row || !process.env.BANNER_STORAGE_CHANNEL_ID) return null;
    try {
        const storageChannel = await client.channels.fetch(process.env.BANNER_STORAGE_CHANNEL_ID);
        const storedMessage = await storageChannel.messages.fetch(row.message_id);
        return storedMessage.attachments.first()?.url || null;
    } catch (err) {
        return null;
    }
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

module.exports = {
    VALID_TYPES,
    toPoolValue,
    isPoolValue,
    poolIdFromValue,
    getById,
    getByTypeAndId,
    addImage,
    removeImage,
    setPublic,
    listImages,
    resolveImageUrl,
    resolveImageBuffer,
};
