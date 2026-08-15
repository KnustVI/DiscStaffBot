// src/utils/customBannerResolver.js
/**
 * Resolve o banner de /strike, /unstrike e do report-chat (Caçador,
 * /config personalizar) — cada um pode estar configurado como:
 *   - uma chave estática do ImageManager (só o banner padrão do bot hoje,
 *     ex: "title_strike" — configs salvas ANTES da unificação com o pool
 *     dinâmico também podem ter uma chave de foto antiga aqui, ex:
 *     "foto_perfil_05", ainda resolvida do mesmo jeito);
 *   - um valor "pool:<id>" (imagem do pool dinâmico, ver
 *     src/systems/pot/profileImagePool.js — mesmo pool usado pelos pickers
 *     de avatar/plano de fundo/emblema do /perfil-edit, unificado aqui a
 *     pedido do dono);
 *   - ou o valor-sentinela 'custom_upload', quando o dono do servidor
 *     enviou uma imagem própria (via /config personalizar no Discord ou
 *     upload no dashboard) — nesse caso o arquivo de verdade fica guardado
 *     como mensagem no canal fixo BANNER_STORAGE_CHANNEL_ID (mesma receita
 *     já usada pelo upload próprio do Player Premium Raptor, ver
 *     playerRegistrationSystem.js _resolveCardPhotoBuffer/_resolveBackgroundBuffer).
 *
 * Único lugar que sabe fazer essa resolução — usado tanto por
 * punishmentSystem.js (banner de /strike e /unstrike) quanto por
 * reportChatSystem.js (banner do painel e da thread de report-chat),
 * evita duplicar a lógica de fetch nos dois.
 *
 * A checagem de tier acontece AQUI na leitura (não só na escrita do painel
 * de /config personalizar) — se o servidor perder o Caçador, o banner volta
 * sozinho pro padrão do bot, sem precisar resetar nada (mesmo critério já
 * usado por toda a personalização, ver configSystem.js getPanelPersonalization).
 */
const FIELD_CONFIG = {
    strike: { keySetting: 'strike_banner_key', messageIdSetting: 'strike_banner_message_id', defaultKey: 'title_strike' },
    unstrike: { keySetting: 'unstrike_banner_key', messageIdSetting: 'unstrike_banner_message_id', defaultKey: 'title_strike_removido' },
    reportchat: { keySetting: 'report_chat_banner_key', messageIdSetting: 'report_chat_banner_message_id', defaultKey: 'title_report_chat' },
};

function _fieldConfig(field) {
    const cfg = FIELD_CONFIG[field];
    if (!cfg) throw new Error(`customBannerResolver: campo desconhecido "${field}" (use 'strike'/'unstrike'/'reportchat')`);
    return cfg;
}

/**
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {'strike'|'unstrike'|'reportchat'} field
 * @returns {Promise<{type: 'key', value: string} | {type: 'buffer', value: Buffer}>}
 *   'key' -> passar pra builder.banner(value) (comportamento de sempre).
 *   'buffer' -> passar pra builder.bannerFromBuffer(value) (upload próprio).
 *   Qualquer falha ao buscar o upload próprio cai silenciosamente pro
 *   banner padrão do bot ({type:'key', value: defaultKey}) — nunca quebra
 *   o painel por causa disso.
 */
async function resolveBanner(client, guildId, field) {
    const cfg = _fieldConfig(field);
    const ConfigSystem = require('../systems/core/configSystem');
    const PremiumSystem = require('../systems/premium/premiumSystem');
    const ProfileImagePool = require('../systems/pot/profileImagePool');

    const isCustomizable = guildId && PremiumSystem.isGuildAtLeast(guildId, 'cacador');
    const bannerKey = (isCustomizable && ConfigSystem.getSetting(guildId, cfg.keySetting)) || cfg.defaultKey;

    if (ProfileImagePool.isPoolValue(bannerKey)) {
        const poolId = ProfileImagePool.poolIdFromValue(bannerKey);
        const buffer = await ProfileImagePool.resolveImageBuffer(client, 'banner', poolId);
        return buffer ? { type: 'buffer', value: buffer } : { type: 'key', value: cfg.defaultKey };
    }

    if (bannerKey !== 'custom_upload') {
        return { type: 'key', value: bannerKey };
    }

    const messageId = ConfigSystem.getSetting(guildId, cfg.messageIdSetting);
    const storageChannelId = process.env.BANNER_STORAGE_CHANNEL_ID;
    if (!messageId || !storageChannelId) return { type: 'key', value: cfg.defaultKey };

    // resolveStoredImageUrl já tem retry/timeout/log embutidos (ver
    // imageStorage.js) — antes essa resolução era feita aqui na mão, sem
    // nenhum dos dois (pedido do dono, 2026-08-15: personalização parando
    // de puxar imagem de vez em quando).
    const url = await require('./imageStorage').resolveStoredImageUrl(client, messageId);
    if (!url) return { type: 'key', value: cfg.defaultKey };

    try {
        const res = await fetch(url);
        if (!res.ok) return { type: 'key', value: cfg.defaultKey };

        return { type: 'buffer', value: Buffer.from(await res.arrayBuffer()) };
    } catch (err) {
        return { type: 'key', value: cfg.defaultKey };
    }
}

/**
 * Versão leve pro dashboard web mostrar a PRÉVIA da imagem própria sem
 * precisar baixar os bytes (o navegador busca direto da URL retornada) —
 * só devolve a URL fresca do attachment guardado, ou null se não houver
 * upload próprio ativo pra esse campo. Sem checagem de tier aqui: quem
 * chama (dashboard.js) já só usa isso dentro de um bloco isCacador no
 * template.
 *
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {'strike'|'unstrike'|'reportchat'} field
 * @returns {Promise<string|null>}
 */
async function resolveBannerUrl(client, guildId, field) {
    const cfg = _fieldConfig(field);
    const ConfigSystem = require('../systems/core/configSystem');
    const ProfileImagePool = require('../systems/pot/profileImagePool');

    const bannerKey = ConfigSystem.getSetting(guildId, cfg.keySetting);

    if (ProfileImagePool.isPoolValue(bannerKey)) {
        const poolId = ProfileImagePool.poolIdFromValue(bannerKey);
        return await ProfileImagePool.resolveImageUrl(client, 'banner', poolId);
    }

    if (bannerKey !== 'custom_upload') return null;

    const messageId = ConfigSystem.getSetting(guildId, cfg.messageIdSetting);
    const storageChannelId = process.env.BANNER_STORAGE_CHANNEL_ID;
    if (!messageId || !storageChannelId) return null;

    return require('./imageStorage').resolveStoredImageUrl(client, messageId);
}

module.exports = { resolveBanner, resolveBannerUrl };
