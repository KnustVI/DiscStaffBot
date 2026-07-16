// src/commands/utility/perfil-edit.js
/**
 * Personalização de perfil — recurso do Player Premium Compy/Raptor.
 *
 * Sem nenhum anexo, mostra um PAINEL (ConfigSystem.buildPerfilEditPanelPayload)
 * com tudo que dá pra personalizar: foto de perfil, plano de fundo, emblema,
 * esconder KDA e (Raptor) título. Foto/plano de fundo continuam exigindo
 * rodar este comando DE NOVO com o anexo — Discord não permite pedir upload
 * de arquivo a partir de um botão ou modal, só da própria slash command; os
 * botões do painel para esses dois, no caso do Raptor, só explicam isso. Pro
 * Compy (sem upload próprio), os mesmos botões abrem um menu de escolha
 * entre fotos/fundos pré-definidos (ver ConfigSystem.buildPlayerPhotoPickerPayload/
 * buildPlayerBackgroundPickerPayload).
 *
 * Compy: escolhe entre um menu de fotos/fundos pré-definidos (mesmo pool
 * usado no banner do /config reportchat) — nenhum upload próprio. Os
 * parâmetros `arquivo`/`plano_de_fundo` são ignorados pra esse tier (mostra
 * o painel de qualquer forma).
 * Raptor: upload próprio via `arquivo` (foto) e/ou `plano_de_fundo`. Sem
 * anexo enviado em `arquivo`: usa o banner do próprio Discord (se o jogador
 * tiver um configurado). Com anexo: a imagem enviada vira a foto/fundo.
 *
 * A composição de verdade (moldura, nome, badges, estrelas de honra em cima
 * da foto) acontece na hora que o /perfil é exibido, não aqui — ver
 * profileCardRenderer.js/playerRegistrationSystem.sendProfile. Isso é
 * necessário porque parte do que é desenhado por cima (estrelas de honra)
 * muda com o tempo; pré-compor a imagem só uma vez, no upload, deixaria
 * esses dados desatualizados. Aqui só redimensionamos (a foto nunca aparece
 * maior que a moldura do card) e reencodamos em webp antes de guardar — sem
 * cortar/desenhar nada por cima, só evitando guardar um arquivo gigante à
 * toa. O plano de fundo (banner atrás da mensagem inteira) não é recortado
 * do mesmo jeito — só redimensionado/reencodado, mesma lógica.
 *
 * Anexos de interação do Discord (e qualquer anexo de mensagem, na real) têm
 * URL assinada com validade de ~24h (parâmetros ex/is/hm) — guardar a URL
 * direto no banco quebraria depois de um dia. Por isso reenviamos a imagem
 * pra um canal fixo do bot (ver BANNER_STORAGE_CHANNEL_ID no .env) e
 * guardamos só o ID da MENSAGEM — a URL fresca é resolvida na hora, sempre
 * que o /perfil for exibido (refazendo o fetch da mensagem).
 */
const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
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

/**
 * Baixa, redimensiona/reencoda e guarda um anexo no canal de armazenamento
 * — compartilhado entre foto de perfil e plano de fundo (mesmo processo,
 * só muda o texto da mensagem de armazenamento e qual setter é chamado
 * depois pelo chamador).
 *
 * @returns {Promise<{ok: true, messageId: string} | {ok: false, error: string}>}
 */
async function _uploadAndStore(client, user, arquivo, label) {
    if (!arquivo.contentType || !['image/png', 'image/jpeg', 'image/webp'].includes(arquivo.contentType)) {
        return { ok: false, error: 'O arquivo enviado precisa ser uma imagem estática (png, jpg ou webp) — formatos animados (gif) não são aceitos aqui.' };
    }

    const storageChannelId = process.env.BANNER_STORAGE_CHANNEL_ID;
    if (!storageChannelId) {
        return { ok: false, error: 'O armazenamento de imagens ainda não foi configurado pelo desenvolvedor do bot (BANNER_STORAGE_CHANNEL_ID). Tente novamente mais tarde.' };
    }

    const storageChannel = await client.channels.fetch(storageChannelId).catch(() => null);
    if (!storageChannel) {
        return { ok: false, error: 'Não foi possível acessar o canal de armazenamento de imagens. Avise o desenvolvedor do bot.' };
    }

    try {
        const response = await fetch(arquivo.url);
        if (!response.ok) {
            return { ok: false, error: 'Não foi possível baixar a imagem enviada. Tente novamente.' };
        }
        const rawBuffer = Buffer.from(await response.arrayBuffer());
        const optimizedBuffer = await sharp(rawBuffer)
            .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: WEBP_QUALITY })
            .toBuffer();

        const stored = await storageChannel.send({
            content: `${label} de \`${user.tag}\` (\`${user.id}\`)`,
            files: [new AttachmentBuilder(optimizedBuffer, { name: 'imagem.webp' })],
        });

        if (!stored.attachments.first()) {
            return { ok: false, error: 'Erro ao processar a imagem enviada. Tente novamente.' };
        }

        return { ok: true, messageId: stored.id };
    } catch (error) {
        console.error(`❌ [PerfilEdit] Erro ao salvar ${label.toLowerCase()}:`, error);
        return { ok: false, error: 'Erro ao salvar a imagem. Tente novamente em instantes.' };
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('perfil-edit')
        .setDescription('🖼️ Personaliza seu perfil (foto, plano de fundo, título, emblema...) — Player Premium Compy/Raptor.')
        .addAttachmentOption(opt => opt.setName('arquivo')
            .setDescription('[Raptor] Foto de perfil (vazio = remove a atual). Ignorado no Compy.')
            .setRequired(false))
        .addAttachmentOption(opt => opt.setName('plano_de_fundo')
            .setDescription('[Raptor] Plano de fundo atrás da mensagem inteira (vazio = remove o atual). Ignorado no Compy.')
            .setRequired(false)),

    async execute(interaction, client) {
        const { user } = interaction;

        if (!PremiumSystem.isPlayerAtLeast(user.id, 'compy')) {
            return await ResponseManager.error(interaction, 'Personalizar o perfil é um recurso do Player Premium Compy (menus pré-definidos) ou Raptor (upload próprio + título).');
        }

        const link = PlayerRegistry.getPlayerByDiscordId(user.id);
        if (!link) {
            return await ResponseManager.error(interaction, 'Use **/registrar** primeiro para vincular sua conta do Path of Titans.');
        }

        const arquivo = interaction.options.getAttachment('arquivo');
        const planoDeFundo = interaction.options.getAttachment('plano_de_fundo');
        const isRaptor = PremiumSystem.isPlayerAtLeast(user.id, 'raptor');

        // Sem nenhum anexo (ou anexo ignorado por não ser Raptor) — mostra o
        // painel principal, com o estado atual de cada personalização.
        if (!isRaptor || (!arquivo && !planoDeFundo)) {
            const ConfigSystem = require('../../systems/core/configSystem');
            return await interaction.editReply(ConfigSystem.buildPerfilEditPanelPayload(PremiumSystem.getPlayerTier(user.id), link));
        }

        // Daqui pra baixo: Raptor, com pelo menos um anexo (ou explicitamente
        // vazio pra remover) — processa foto e/ou plano de fundo.
        const results = [];

        if (interaction.options.get('arquivo')) {
            if (!arquivo) {
                PlayerRegistry.setBannerMessageId(user.id, null);
                results.push(`${EMOJIS.circlecheck || '✅'} Foto de perfil removida. Se você tiver um banner configurado no próprio Discord, ele volta a aparecer no seu /perfil.`);
            } else {
                const result = await _uploadAndStore(client, user, arquivo, 'Foto de perfil');
                if (result.ok) {
                    PlayerRegistry.setBannerMessageId(user.id, result.messageId);
                    results.push(`${EMOJIS.circlecheck || '✅'} Foto de perfil atualizada!`);
                } else {
                    results.push(`${EMOJIS.circlealert || '❌'} Foto de perfil: ${result.error}`);
                }
            }
        }

        if (interaction.options.get('plano_de_fundo')) {
            if (!planoDeFundo) {
                PlayerRegistry.setBackgroundMessageId(user.id, null);
                results.push(`${EMOJIS.circlecheck || '✅'} Plano de fundo removido.`);
            } else {
                const result = await _uploadAndStore(client, user, planoDeFundo, 'Plano de fundo');
                if (result.ok) {
                    PlayerRegistry.setBackgroundMessageId(user.id, result.messageId);
                    results.push(`${EMOJIS.circlecheck || '✅'} Plano de fundo atualizado!`);
                } else {
                    results.push(`${EMOJIS.circlealert || '❌'} Plano de fundo: ${result.error}`);
                }
            }
        }

        results.push('Use **/perfil** pra ver como ficou.');
        // Sem ResponseManager.success/.error aqui de propósito: cada linha já
        // carrega seu próprio ícone (✅/❌), e um resultado misto (ex: foto
        // deu certo, plano de fundo falhou) não deve ganhar um prefixo único
        // de sucesso ou erro por cima.
        await ResponseManager.send(interaction, { content: results.join('\n'), flags: MessageFlags.Ephemeral });
    },
};
