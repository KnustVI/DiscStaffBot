// src/commands/utility/perfil-edit.js
/**
 * Personalização de perfil — recurso do Player Premium Raptor. Hoje só
 * troca o banner (renomeado de /perfil-banner pra receber mais
 * personalizações futuras sem precisar de um novo comando a cada uma).
 * Sem anexo enviado: usa o banner do próprio Discord (se o jogador tiver um
 * configurado). Com anexo: a imagem enviada vira o FUNDO de um banner gerado
 * (nickname em destaque por cima, ver bannerRenderer.js) — não é mais
 * salva "crua".
 *
 * Anexos de interação do Discord (e qualquer anexo de mensagem, na real) têm
 * URL assinada com validade de ~24h (parâmetros ex/is/hm) — guardar a URL
 * direto no banco quebraria depois de um dia. Por isso reenviamos a imagem
 * (já composta) pra um canal fixo do bot (ver BANNER_STORAGE_CHANNEL_ID no
 * .env) e guardamos só o ID da MENSAGEM — a URL fresca é resolvida na hora,
 * sempre que o /perfil for exibido (refazendo o fetch da mensagem).
 */
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const PlayerRegistry = require('../../systems/pot/potPlayerRegistry');
const ResponseManager = require('../../utils/responseManager');
const { renderProfileBanner } = require('../../utils/bannerRenderer');

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('perfil-edit')
        .setDescription('🖼️ Personaliza seu perfil (banner) — Player Premium Raptor.')
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

        if (!arquivo.contentType || !['image/png', 'image/jpeg', 'image/webp'].includes(arquivo.contentType)) {
            return await ResponseManager.error(interaction, 'O arquivo enviado precisa ser uma imagem estática (png, jpg ou webp) — o texto do seu nickname é desenhado por cima, então formatos animados (gif) não são aceitos aqui.');
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
            const response = await fetch(arquivo.url);
            if (!response.ok) {
                return await ResponseManager.error(interaction, 'Não foi possível baixar a imagem enviada. Tente novamente.');
            }
            const backgroundBuffer = Buffer.from(await response.arrayBuffer());

            const bannerBuffer = await renderProfileBanner({
                backgroundBuffer,
                nickname: link.player_name || user.displayName || user.username,
                subtitle: `@${user.username}`,
                badgeLabel: 'Raptor',
            });

            const stored = await storageChannel.send({
                content: `Banner de \`${user.tag}\` (\`${user.id}\`)`,
                files: [new AttachmentBuilder(bannerBuffer, { name: 'banner.png' })],
            });

            if (!stored.attachments.first()) {
                return await ResponseManager.error(interaction, 'Erro ao processar a imagem enviada. Tente novamente.');
            }

            PlayerRegistry.setBannerMessageId(user.id, stored.id);
            await ResponseManager.success(interaction, `${EMOJIS.circlecheck || '✅'} Banner de perfil atualizado! Use **/perfil** pra ver como ficou.`);
        } catch (error) {
            console.error('❌ [PerfilEdit] Erro ao salvar banner:', error);
            await ResponseManager.error(interaction, 'Erro ao salvar o banner. Tente novamente em instantes.');
        }
    },
};
