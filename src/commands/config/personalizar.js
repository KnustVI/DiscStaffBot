// src/commands/config/personalizar.js — subcomando /config personalizar
/**
 * Personalização de banners de /strike, /unstrike e do report-chat
 * (Caçador). Sem nenhum anexo, abre o painel "vivo" de sempre (escolher
 * banner por MENU entre o padrão do bot + o pool de 12 fotos genéricas).
 *
 * Com um ou mais dos 3 attachments opcionais (banner_strike/
 * banner_unstrike/banner_reportchat): envia a imagem própria pro canal de
 * armazenamento (mesma receita do upload próprio do Player Premium Raptor
 * em /perfil-edit, ver src/utils/imageStorage.js) e grava o valor-sentinela
 * 'custom_upload' na chave de banner correspondente — a resolução na hora
 * de mostrar o banner de verdade fica em src/utils/customBannerResolver.js.
 */
const { PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const { uploadAndStoreImage } = require('../../utils/imageStorage');

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

// Cada attachment opcional -> qual par de settings ele alimenta (mesmas
// chaves lidas por customBannerResolver.js) e em qual aba do painel
// reabrir depois.
const BANNER_UPLOAD_FIELDS = [
    { option: 'banner_strike', keySetting: 'strike_banner_key', messageIdSetting: 'strike_banner_message_id', label: 'Banner do /strike', tab: 'strike' },
    { option: 'banner_unstrike', keySetting: 'unstrike_banner_key', messageIdSetting: 'unstrike_banner_message_id', label: 'Banner do /unstrike', tab: 'strike' },
    { option: 'banner_reportchat', keySetting: 'report_chat_banner_key', messageIdSetting: 'report_chat_banner_message_id', label: 'Banner do report-chat', tab: 'reportchat' },
];

module.exports = {
    async execute(interaction, client) {
        const { guild, user, member } = interaction;

        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
        }

        if (!PremiumSystem.isGuildAtLeast(guild.id, 'cacador')) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guild.id));
        }

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        const ConfigSystem = require('../../systems/core/configSystem');

        const uploads = BANNER_UPLOAD_FIELDS
            .map(field => ({ field, attachment: interaction.options.getAttachment(field.option) }))
            .filter(({ attachment }) => attachment);

        // Um ou mais anexos enviados — processa cada um (mesmo padrão
        // multi-anexo de /perfil-edit) e junta o resultado numa mensagem só
        // antes de reabrir o painel, em vez do fluxo normal de menu abaixo.
        if (uploads.length > 0) {
            const results = [];
            let lastTab = 'strike';
            for (const { field, attachment } of uploads) {
                const result = await uploadAndStoreImage(client, attachment, `${field.label} de \`${guild.name}\` (\`${guild.id}\`)`);
                if (result.ok) {
                    ConfigSystem.setSetting(guild.id, field.keySetting, 'custom_upload');
                    ConfigSystem.setSetting(guild.id, field.messageIdSetting, result.messageId);
                    await ConfigSystem.logConfigChange(interaction, `${EMOJIS.imagem || '🖼️'} ${field.label}: imagem própria enviada.`);
                    results.push(`${EMOJIS.circlecheck || '✅'} ${field.label} atualizado com sua imagem.`);
                } else {
                    results.push(`${EMOJIS.circlealert || '❌'} ${field.label}: ${result.error}`);
                }
                lastTab = field.tab;
            }
            ConfigSystem.clearCache(guild.id);
            return await ConfigSystem.refreshPersonalizarPanel(interaction, results.join('\n'), guild.name, lastTab);
        }

        // Sem anexo — usa o MESMO painel "vivo" que os selects/botões usam
        // pra editar depois, assim comando e componentes nunca ficam
        // dessincronizados.
        await ConfigSystem.refreshPersonalizarPanel(interaction, null, guild.name);
    },
};
