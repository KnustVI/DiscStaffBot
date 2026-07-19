// src/commands/utility/perfil-edit.js
/**
 * Personalização de perfil.
 *
 * EMBLEMA é liberado em QUALQUER TIER (inclusive Free — pedido do dono).
 * Foto de perfil, plano de fundo, título e esconder KDA continuam exigindo
 * Player Premium Compy (foto/fundo/esconder KDA) ou Raptor (+ upload
 * próprio + título).
 *
 * Sem nenhum anexo, mostra um PAINEL (ConfigSystem.buildPerfilEditPanelPayload)
 * com tudo que o tier do jogador permite personalizar. Foto/plano de fundo
 * continuam exigindo rodar este comando DE NOVO com o anexo — Discord não
 * permite pedir upload de arquivo a partir de um botão ou modal, só da
 * própria slash command; os botões do painel para esses dois, no caso do
 * Raptor, só explicam isso. Pro Compy (sem upload próprio), os mesmos
 * botões abrem um menu de escolha entre fotos/fundos pré-definidos (ver
 * ConfigSystem.buildPlayerPhotoPickerPayload/buildPlayerBackgroundPickerPayload
 * — o pool de plano de fundo reaproveita as mesmas 12 fotos do pool de foto
 * de perfil).
 *
 * Compy: escolhe entre um menu de fotos/fundos pré-definidos (mesmo pool
 * usado no banner do /config reportchat) — nenhum upload próprio. Os
 * parâmetros `avatar`/`plano_de_fundo` são ignorados pra esse tier (mostra
 * o painel de qualquer forma).
 * Raptor: upload próprio via `avatar` (foto de perfil) e/ou `plano_de_fundo`.
 * Sem anexo enviado em `avatar`: usa o banner do próprio Discord (se o
 * jogador tiver um configurado). Com anexo: a imagem enviada vira a foto/fundo.
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
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const PlayerRegistry = require('../../systems/pot/potPlayerRegistry');
const ResponseManager = require('../../utils/responseManager');
const { uploadAndStoreImage } = require('../../utils/imageStorage');

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

// Fininho em cima de uploadAndStoreImage (src/utils/imageStorage.js) — só
// monta o texto da mensagem de armazenamento (auditoria: de quem é a foto).
// Mesmo helper é usado pelos comandos de developer que alimentam os pools
// de avatar/fundo/emblema (/perfil-pool).
async function _uploadAndStore(client, user, arquivo, label) {
    return uploadAndStoreImage(client, arquivo, `${label} de \`${user.tag}\` (\`${user.id}\`)`);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('perfil-edit')
        .setDescription('🖼️ Personaliza seu perfil (emblema pra todos; foto, plano de fundo e título são Compy/Raptor).')
        .addAttachmentOption(opt => opt.setName('avatar')
            .setDescription('[Raptor] Avatar/foto de perfil (vazio = remove a atual). Ignorado no Compy.')
            .setRequired(false))
        .addAttachmentOption(opt => opt.setName('plano_de_fundo')
            .setDescription('[Raptor] Plano de fundo (ideal 1300x300, máximo aceito). Vazio = remove atual. Ignorado no Compy.')
            .setRequired(false)),

    async execute(interaction, client) {
        const { user } = interaction;

        // Sem gate de tier aqui de propósito — Emblema é liberado pra
        // QUALQUER tier (pedido do dono), então até o Free precisa
        // conseguir abrir o painel. Foto/plano de fundo/título/esconder KDA
        // continuam Compy+/Raptor — checados individualmente mais abaixo e
        // dentro de cada handler do painel (ConfigSystem), não aqui.
        const link = PlayerRegistry.getPlayerByDiscordId(user.id);
        if (!link) {
            return await ResponseManager.error(interaction, 'Use **/registrar** primeiro para vincular sua conta do Path of Titans.');
        }

        const avatar = interaction.options.getAttachment('avatar');
        const planoDeFundo = interaction.options.getAttachment('plano_de_fundo');
        const isRaptor = PremiumSystem.isPlayerAtLeast(user.id, 'raptor');

        // Sem nenhum anexo (ou anexo ignorado por não ser Raptor) — mostra o
        // painel principal, com o estado atual de cada personalização.
        if (!isRaptor || (!avatar && !planoDeFundo)) {
            const ConfigSystem = require('../../systems/core/configSystem');
            return await interaction.editReply(ConfigSystem.buildPerfilEditPanelPayload(PremiumSystem.getPlayerTier(user.id), link));
        }

        // Daqui pra baixo: Raptor, com pelo menos um anexo (ou explicitamente
        // vazio pra remover) — processa foto e/ou plano de fundo.
        const results = [];

        if (interaction.options.get('avatar')) {
            if (!avatar) {
                PlayerRegistry.setBannerMessageId(user.id, null);
                results.push(`${EMOJIS.circlecheck || '✅'} Foto de perfil removida. Se você tiver um banner configurado no próprio Discord, ele volta a aparecer no seu /perfil.`);
            } else {
                const result = await _uploadAndStore(client, user, avatar, 'Foto de perfil');
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
