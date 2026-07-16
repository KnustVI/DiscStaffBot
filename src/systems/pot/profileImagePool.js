// src/systems/pot/profileImagePool.js
/**
 * Pool de imagens (avatar/plano de fundo/emblema) usado pelos 3 pickers de
 * /perfil-edit — alimentado pelo dono via /perfil-pool (bot developer),
 * sem precisar editar código/redeployar a cada imagem nova. PLAYER_PHOTO_
 * OPTIONS (configSystem.js) continua existindo à parte, mas hoje só serve
 * os banners de /config reportchat/strike/unstrike — as 12 fotos que antes
 * também apareciam como avatar/plano de fundo foram migradas pra cá (tipo
 * 'background', ver migrate-fotos-plano-fundo.js na raiz do projeto).
 *
 * Mesmo padrão de armazenamento já usado pro upload próprio do Raptor
 * (banner_message_id/background_message_id em player_links): a imagem em si
 * é reenviada pra um canal fixo do bot (BANNER_STORAGE_CHANNEL_ID) e só o ID
 * da MENSAGEM é guardado — a URL do anexo do Discord expira em ~24h, então é
 * sempre resolvida de novo (channel.messages.fetch) na hora de exibir.
 *
 * Valores selecionáveis vindos deste pool usam o prefixo "pool:<id>" nas
 * colunas selected_photo_key/selected_background_key/selected_badge_key de
 * player_links, pra distinguir de uma chave estática do imageManager
 * (ex: "foto_perfil_01", ainda usada pelos banners citados acima) sem
 * precisar de nenhuma coluna nova.
 */
const db = require('../../database/index');

const VALID_TYPES = ['avatar', 'background', 'badge'];
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

function listImages(type) {
    return db.prepare(`SELECT * FROM profile_image_pool WHERE type = ? ORDER BY id ASC`).all(type);
}

/**
 * Resolve a URL fresca de uma imagem do pool, refazendo o fetch da mensagem
 * de armazenamento — a URL do anexo nunca é guardada, expira em ~24h.
 * @returns {Promise<string|null>}
 */
async function resolveImageUrl(client, type, id) {
    const row = getByTypeAndId(type, id);
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
    listImages,
    resolveImageUrl,
    resolveImageBuffer,
};
