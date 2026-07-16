// src/utils/imageStorage.js
/**
 * Baixa, redimensiona/reencoda (webp) e reenvia um attachment do Discord pro
 * canal fixo de armazenamento do bot (BANNER_STORAGE_CHANNEL_ID), devolvendo
 * só o ID da mensagem armazenada — nunca a URL do anexo em si, que expira em
 * ~24h. Usado tanto pelo upload próprio do Raptor (foto de perfil/plano de
 * fundo, ver /perfil-edit) quanto pelos comandos de developer que alimentam
 * os pools de avatar/fundo/emblema (/perfil-pool, ver profileImagePool.js).
 */
const sharp = require('sharp');
const { AttachmentBuilder } = require('discord.js');

// A foto só é exibida recortada num retângulo pequeno (moldura do card) ou
// como plano de fundo — não faz sentido guardar um arquivo de vários MB/4K
// só pra isso. Reduz pra um teto generoso (ainda nítido em telas HiDPI) e
// reencoda em webp antes de guardar, sem alterar a foto que o usuário vê.
const MAX_DIMENSION = 1200;
const WEBP_QUALITY = 88;

/**
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Attachment} attachment
 * @param {string} storageMessageContent - texto da mensagem no canal de armazenamento (auditoria)
 * @returns {Promise<{ok: true, messageId: string} | {ok: false, error: string}>}
 */
async function uploadAndStoreImage(client, attachment, storageMessageContent) {
    if (!attachment.contentType || !['image/png', 'image/jpeg', 'image/webp'].includes(attachment.contentType)) {
        return { ok: false, error: 'O arquivo enviado precisa ser uma imagem estática (png, jpg ou webp) — formatos animados (gif) não são aceitos aqui.' };
    }

    const storageChannelId = process.env.BANNER_STORAGE_CHANNEL_ID;
    if (!storageChannelId) {
        return { ok: false, error: 'O armazenamento de imagens ainda não foi configurado (BANNER_STORAGE_CHANNEL_ID). Avise o desenvolvedor do bot.' };
    }

    const storageChannel = await client.channels.fetch(storageChannelId).catch(() => null);
    if (!storageChannel) {
        return { ok: false, error: 'Não foi possível acessar o canal de armazenamento de imagens. Avise o desenvolvedor do bot.' };
    }

    try {
        const response = await fetch(attachment.url);
        if (!response.ok) {
            return { ok: false, error: 'Não foi possível baixar a imagem enviada. Tente novamente.' };
        }
        const rawBuffer = Buffer.from(await response.arrayBuffer());
        const optimizedBuffer = await sharp(rawBuffer)
            // .rotate() sem argumento = auto-orienta pela tag EXIF Orientation
            // antes de qualquer outra coisa. Sem isso, uma foto tirada em pé
            // (comum em celular) mas gravada em disco "deitada" + a tag EXIF
            // dizendo "gire 90°" fica com pixels na orientação ERRADA aqui —
            // o sharp por padrão NÃO aplica a rotação sozinho, só respeita a
            // tag se pedido — e o resultado final (webp) não carrega mais a
            // tag, então todo mundo rio abaixo (inclusive o corte no card do
            // /perfil) vê a imagem já "torta"/com proporção errada.
            .rotate()
            .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: WEBP_QUALITY })
            .toBuffer();

        const stored = await storageChannel.send({
            content: storageMessageContent,
            files: [new AttachmentBuilder(optimizedBuffer, { name: 'imagem.webp' })],
        });

        if (!stored.attachments.first()) {
            return { ok: false, error: 'Erro ao processar a imagem enviada. Tente novamente.' };
        }

        return { ok: true, messageId: stored.id };
    } catch (error) {
        console.error('❌ [ImageStorage] Erro ao salvar imagem:', error);
        return { ok: false, error: 'Erro ao salvar a imagem. Tente novamente em instantes.' };
    }
}

module.exports = { uploadAndStoreImage, MAX_DIMENSION, WEBP_QUALITY };
