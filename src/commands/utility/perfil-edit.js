// src/commands/utility/perfil-edit.js
/**
 * Personalização de perfil — recurso do Player Premium Raptor. Hoje só
 * troca a foto de fundo do card de perfil (renomeado de /perfil-banner pra
 * receber mais personalizações futuras sem precisar de um novo comando a
 * cada uma). Sem anexo enviado: usa o banner do próprio Discord (se o
 * jogador tiver um configurado). Com anexo: a imagem enviada vira a foto de
 * fundo do card.
 *
 * A composição de verdade (moldura, nome, badges, estrelas de honra em cima
 * da foto) acontece na hora que o /perfil é exibido, não aqui — ver
 * profileCardRenderer.js/playerRegistrationSystem.sendProfile. Isso é
 * necessário porque parte do que é desenhado por cima (estrelas de honra)
 * muda com o tempo; pré-compor a imagem só uma vez, no upload, deixaria
 * esses dados desatualizados. Aqui só redimensionamos (a foto nunca aparece
 * maior que a moldura do card) e reencodamos em webp antes de guardar — sem
 * cortar/desenhar nada por cima, só evitando guardar um arquivo gigante à
 * toa.
 *
 * Anexos de interação do Discord (e qualquer anexo de mensagem, na real) têm
 * URL assinada com validade de ~24h (parâmetros ex/is/hm) — guardar a URL
 * direto no banco quebraria depois de um dia. Por isso reenviamos a imagem
 * pra um canal fixo do bot (ver BANNER_STORAGE_CHANNEL_ID no .env) e
 * guardamos só o ID da MENSAGEM — a URL fresca é resolvida na hora, sempre
 * que o /perfil for exibido (refazendo o fetch da mensagem).
 */
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const PlayerRegistry = require('../../systems/pot/potPlayerRegistry');
const ResponseManager = require('../../utils/responseManager');

// A foto só é exibida recortada num retângulo de ~356x268 (moldura do card,
// ver profileCardRenderer.js) — não faz sentido guardar um arquivo de vários
// MB/4K só pra isso. Reduz pra um teto generoso (ainda nítido em telas HiDPI)
// e reencoda em webp antes de guardar, sem alterar a foto que o usuário vê.
const MAX_DIMENSION = 1200;
const WEBP_QUALITY = 88;

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('perfil-edit')
        .setDescription('🖼️ Personaliza seu perfil (foto do card) — Player Premium Raptor.')
        .addAttachmentOption(opt => opt.setName('arquivo')
            .setDescription('Imagem para usar como foto do card (deixe vazio para remover a personalizada)')
            .setRequired(false)),

    async execute(interaction, client) {
        const { user } = interaction;

        if (!PremiumSystem.isPlayerAtLeast(user.id, 'raptor')) {
            return await ResponseManager.error(interaction, 'Foto de perfil personalizada é um recurso exclusivo do Player Premium Raptor.');
        }

        const link = PlayerRegistry.getPlayerByDiscordId(user.id);
        if (!link) {
            return await ResponseManager.error(interaction, 'Use **/registrar** primeiro para vincular sua conta do Path of Titans.');
        }

        const arquivo = interaction.options.getAttachment('arquivo');

        if (!arquivo) {
            PlayerRegistry.setBannerMessageId(user.id, null);
            return await ResponseManager.success(interaction, `${EMOJIS.circlecheck || '✅'} Foto personalizada removida. Se você tiver um banner configurado no próprio Discord, ele volta a aparecer no seu /perfil.`);
        }

        if (!arquivo.contentType || !['image/png', 'image/jpeg', 'image/webp'].includes(arquivo.contentType)) {
            return await ResponseManager.error(interaction, 'O arquivo enviado precisa ser uma imagem estática (png, jpg ou webp) — as estrelas de honra são desenhadas por cima dela, então formatos animados (gif) não são aceitos aqui.');
        }

        const storageChannelId = process.env.BANNER_STORAGE_CHANNEL_ID;
        if (!storageChannelId) {
            return await ResponseManager.error(interaction, 'O armazenamento de fotos ainda não foi configurado pelo desenvolvedor do bot (BANNER_STORAGE_CHANNEL_ID). Tente novamente mais tarde.');
        }

        const storageChannel = await client.channels.fetch(storageChannelId).catch(() => null);
        if (!storageChannel) {
            return await ResponseManager.error(interaction, 'Não foi possível acessar o canal de armazenamento de fotos. Avise o desenvolvedor do bot.');
        }

        try {
            const response = await fetch(arquivo.url);
            if (!response.ok) {
                return await ResponseManager.error(interaction, 'Não foi possível baixar a imagem enviada. Tente novamente.');
            }
            const rawBuffer = Buffer.from(await response.arrayBuffer());
            const optimizedBuffer = await sharp(rawBuffer)
                .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: WEBP_QUALITY })
                .toBuffer();

            const stored = await storageChannel.send({
                content: `Foto de perfil de \`${user.tag}\` (\`${user.id}\`)`,
                files: [new AttachmentBuilder(optimizedBuffer, { name: 'foto.webp' })],
            });

            if (!stored.attachments.first()) {
                return await ResponseManager.error(interaction, 'Erro ao processar a imagem enviada. Tente novamente.');
            }

            PlayerRegistry.setBannerMessageId(user.id, stored.id);
            await ResponseManager.success(interaction, `${EMOJIS.circlecheck || '✅'} Foto de perfil atualizada! Use **/perfil** pra ver como ficou.`);
        } catch (error) {
            console.error('❌ [PerfilEdit] Erro ao salvar foto:', error);
            await ResponseManager.error(interaction, 'Erro ao salvar a foto. Tente novamente em instantes.');
        }
    },
};
