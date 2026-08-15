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
 * Núcleo de verdade: recebe um Buffer cru (já em mãos, de onde quer que
 * tenha vindo — attachment do Discord baixado, ou arquivo de um upload web
 * via multer), reencoda e reenvia pro canal fixo de armazenamento. Extraído
 * de uploadAndStoreImage() pra dar pro dashboard web usar direto (o arquivo
 * já chega como Buffer via multer, sem nenhum Attachment do Discord.js
 * envolvido) sem duplicar a lógica de resize/webp/envio.
 *
 * @param {import('discord.js').Client} client
 * @param {Buffer} buffer - bytes crus da imagem (qualquer formato aceito pelo sharp)
 * @param {string} storageMessageContent - texto da mensagem no canal de armazenamento (auditoria)
 * @returns {Promise<{ok: true, messageId: string} | {ok: false, error: string}>}
 */
async function storeImageBuffer(client, buffer, storageMessageContent) {
    const storageChannelId = process.env.BANNER_STORAGE_CHANNEL_ID;
    if (!storageChannelId) {
        return { ok: false, error: 'O armazenamento de imagens ainda não foi configurado (BANNER_STORAGE_CHANNEL_ID). Avise o desenvolvedor do bot.' };
    }

    const storageChannel = await client.channels.fetch(storageChannelId).catch(() => null);
    if (!storageChannel) {
        return { ok: false, error: 'Não foi possível acessar o canal de armazenamento de imagens. Avise o desenvolvedor do bot.' };
    }

    try {
        const optimizedBuffer = await sharp(buffer)
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

/**
 * Wrapper fino sobre storeImageBuffer() pro caso de origem Discord (attachment
 * de uma interação) — valida o contentType, baixa os bytes de attachment.url
 * (URL assinada, só vale por ~24h, por isso baixa e reenvia em vez de guardar
 * o link) e delega o resto.
 *
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Attachment} attachment
 * @param {string} storageMessageContent - texto da mensagem no canal de armazenamento (auditoria)
 * @returns {Promise<{ok: true, messageId: string} | {ok: false, error: string}>}
 */
async function uploadAndStoreImage(client, attachment, storageMessageContent) {
    if (!attachment.contentType || !['image/png', 'image/jpeg', 'image/webp'].includes(attachment.contentType)) {
        return { ok: false, error: 'O arquivo enviado precisa ser uma imagem estática (png, jpg ou webp) — formatos animados (gif) não são aceitos aqui.' };
    }

    let rawBuffer;
    try {
        const response = await fetch(attachment.url);
        if (!response.ok) {
            return { ok: false, error: 'Não foi possível baixar a imagem enviada. Tente novamente.' };
        }
        rawBuffer = Buffer.from(await response.arrayBuffer());
    } catch (error) {
        console.error('❌ [ImageStorage] Erro ao baixar imagem enviada:', error);
        return { ok: false, error: 'Não foi possível baixar a imagem enviada. Tente novamente.' };
    }

    return storeImageBuffer(client, rawBuffer, storageMessageContent);
}

const RESOLVE_TIMEOUT_MS = 10000;
const RESOLVE_RETRY_DELAY_MS = 500;

function _withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout após ${ms}ms`)), ms)),
    ]);
}

/**
 * Resolve a URL fresca do anexo de UMA mensagem guardada no canal de
 * armazenamento (BANNER_STORAGE_CHANNEL_ID) — todo consumidor de
 * personalização (foto/plano de fundo, banner de /strike, /unstrike,
 * ReportChat, e o pool de personalização/banner/emblema) passava por
 * essa MESMA sequência de 2 chamadas (channels.fetch + messages.fetch)
 * copiada em 3 lugares (profileImagePool.js#resolveImageUrl,
 * customBannerResolver.js#resolveBanner/resolveBannerUrl), cada um com
 * seu próprio try/catch silencioso — SEM retry e SEM log nenhum.
 *
 * Extraído aqui (pedido do dono, 2026-08-15: "em alguns momentos o
 * perfil e as personalizações de comando nos servers param de puxar as
 * imagens... reiniciar o bot [resolve]") pra dar resiliência de verdade:
 * - 1 retry curto (RESOLVE_RETRY_DELAY_MS) cobre soluços passageiros de
 *   rede/rate limit do Discord — antes, UM request que desse ruim
 *   derrubava a imagem daquela renderização específica por completo,
 *   mesmo com o arquivo intacto no canal de armazenamento (por isso
 *   reiniciar o bot "resolvia" — zera qualquer fila/estado travado do
 *   processo, não porque a imagem tivesse sido perdida de verdade; ver
 *   memória [[vps_low_memory_no_swap_freeze]] — mesmo tipo de sintoma já
 *   diagnosticado uma vez, causado por pressão de memória na VPS
 *   travando temporariamente chamadas assíncronas).
 * - timeout de RESOLVE_TIMEOUT_MS por tentativa — sem isso, uma
 *   requisição que trava (em vez de falhar rápido) prende a resolução
 *   indefinidamente em vez de desistir e cair no fallback.
 * - loga a falha final (depois do retry) via ErrorLogger — antes não
 *   havia NENHUM registro de quando/por que isso acontecia, impossível
 *   confirmar se era rate limit, timeout, ou outra coisa sem isso.
 *
 * @param {import('discord.js').Client} client
 * @param {string} messageId
 * @returns {Promise<string|null>}
 */
async function resolveStoredImageUrl(client, messageId) {
    const storageChannelId = process.env.BANNER_STORAGE_CHANNEL_ID;
    if (!messageId || !storageChannelId) return null;

    const attempt = async () => {
        const storageChannel = await _withTimeout(client.channels.fetch(storageChannelId), RESOLVE_TIMEOUT_MS);
        const storedMessage = await _withTimeout(storageChannel.messages.fetch(messageId), RESOLVE_TIMEOUT_MS);
        return storedMessage.attachments.first()?.url || null;
    };

    try {
        return await attempt();
    } catch (firstError) {
        await new Promise((resolve) => setTimeout(resolve, RESOLVE_RETRY_DELAY_MS));
        try {
            return await attempt();
        } catch (secondError) {
            try {
                const ErrorLogger = require('../systems/core/errorLogger');
                ErrorLogger.error('image_storage', 'resolveStoredImageUrl', secondError, {
                    messageId,
                    firstErrorMessage: firstError?.message,
                });
            } catch (logErr) {
                // Nunca deixa uma falha no próprio log derrubar a resolução.
            }
            return null;
        }
    }
}

module.exports = { uploadAndStoreImage, storeImageBuffer, resolveStoredImageUrl, MAX_DIMENSION, WEBP_QUALITY };
