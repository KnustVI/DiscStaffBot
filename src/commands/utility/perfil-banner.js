// src/commands/utility/perfil-banner.js
/**
 * Banner personalizado de perfil — recurso do Player Premium Raptor.
 * Sem anexo enviado: usa o banner do próprio Discord (se o jogador tiver um
 * configurado). Com anexo: substitui pelo arquivo enviado.
 *
 * Anexos de interação do Discord (e qualquer anexo de mensagem, na real) têm
 * URL assinada com validade de ~24h (parâmetros ex/is/hm) — guardar a URL
 * direto no banco quebraria depois de um dia. Por isso reenviamos a imagem
 * pra um canal fixo do bot (ver BANNER_STORAGE_CHANNEL_ID no .env) e
 * guardamos só o ID da MENSAGEM — a URL fresca é resolvida na hora, sempre
 * que o /perfil for exibido (refazendo o fetch da mensagem).
 */
const { SlashCommandBuilder } = require('discord.js');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const PlayerRegistry = require('../../systems/pot/potPlayerRegistry');
const ResponseManager = require('../../utils/responseManager');

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('perfil-banner')
        .setDescription('🖼️ Define ou remove o banner personalizado do seu perfil (Player Premium Raptor).')
        .addAttachmentOption(opt => opt.setName('arquivo')
            .setDescription('Imagem para usar como banner (deixe vazio para remover o banner personalizado)')
            .setRequired(false)),

    async execute(interaction, client) {
        const { user } = interaction;

        if (!PremiumSystem.isPlayerAtLeast(user.id, 'raptor')) {
            return await ResponseManager.error(interaction, 'Banner de perfil personalizado é um recurso exclusivo do Player Premium Raptor.');
        }

        const link = PlayerRegistry.getPlayerByDiscordId(user.id);
        if (!link) {
            return await ResponseManager.error(interaction, 'Use **/registrar** primeiro para vincular sua conta do Path of Titans.');
        }

        const arquivo = interaction.options.getAttachment('arquivo');

        if (!arquivo) {
            PlayerRegistry.setBannerMessageId(user.id, null);
            return await ResponseManager.success(interaction, `${EMOJIS.circlecheck || '✅'} Banner personalizado removido. Se você tiver um banner configurado no próprio Discord, ele volta a aparecer no seu /perfil.`);
        }

        if (!arquivo.contentType || !arquivo.contentType.startsWith('image/')) {
            return await ResponseManager.error(interaction, 'O arquivo enviado precisa ser uma imagem (png, jpg, webp, gif).');
        }

        const storageChannelId = process.env.BANNER_STORAGE_CHANNEL_ID;
        if (!storageChannelId) {
            return await ResponseManager.error(interaction, 'O armazenamento de banners ainda não foi configurado pelo desenvolvedor do bot (BANNER_STORAGE_CHANNEL_ID). Tente novamente mais tarde.');
        }

        const storageChannel = await client.channels.fetch(storageChannelId).catch(() => null);
        if (!storageChannel) {
            return await ResponseManager.error(interaction, 'Não foi possível acessar o canal de armazenamento de banners. Avise o desenvolvedor do bot.');
        }

        try {
            const stored = await storageChannel.send({
                content: `Banner de \`${user.tag}\` (\`${user.id}\`)`,
                files: [{ attachment: arquivo.url, name: arquivo.name || 'banner.png' }],
            });

            if (!stored.attachments.first()) {
                return await ResponseManager.error(interaction, 'Erro ao processar a imagem enviada. Tente novamente.');
            }

            PlayerRegistry.setBannerMessageId(user.id, stored.id);
            await ResponseManager.success(interaction, `${EMOJIS.circlecheck || '✅'} Banner de perfil atualizado! Use **/perfil** pra ver como ficou.`);
        } catch (error) {
            console.error('❌ [PerfilBanner] Erro ao salvar banner:', error);
            await ResponseManager.error(interaction, 'Erro ao salvar o banner. Tente novamente em instantes.');
        }
    },
};
