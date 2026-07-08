// src/systems/pot/playerRegistrationSystem.js

/**
 * playerRegistrationSystem.js
 *
 * Vínculo MANUAL de conta via painel + modal (comando /registrar) — liga o
 * Discord do usuário à conta dele no Path of Titans (Alderon ID). Complementa
 * o vínculo automático por webhook (ver potPlayerRegistry.js), que acontece
 * sozinho quando o jogador já conectou o Discord pelo site oficial da
 * Alderon Games e entra em qualquer servidor com o bot configurado — essa é
 * a forma mais segura, já que a própria Alderon confirma a titularidade da
 * conta. O cadastro manual aqui é o caminho alternativo pra quem ainda não
 * fez esse link oficial.
 *
 * Campos obrigatórios no vínculo:
 *  - Discord: username/ID — sempre o de quem executa o comando, nunca
 *    perguntado (não faz sentido vincular em nome de outra pessoa aqui).
 *  - Path of Titans: nome de exibição no jogo + Alderon ID (AGID) — pedidos
 *    via modal, únicos dados que o usuário realmente precisa digitar.
 *
 * Verificação em jogo (RCON): ainda NÃO ativada — ver o bloco correspondente
 * em potPlayerRegistry.js. Por enquanto o vínculo manual aceita o Alderon ID
 * informado sem confirmar no jogo, e o painel deixa isso claro.
 */

const path = require('path');
const fs = require('fs');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    AttachmentBuilder,
} = require('discord.js');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const PlayerRegistry = require('./potPlayerRegistry');
const imageManager = require('../../utils/imageManager');
const { buildIdentityBlock } = require('../../utils/userIdentity');
const { renderProfileCard } = require('../../utils/profileCardRenderer');
const PunishmentSystem = require('../moderation/punishmentSystem');

const DEFAULT_CARD_PHOTOS = {
    free: path.join(__dirname, '..', '..', '..', 'assets', 'images', 'BANNER PERFIL FREE.webp'),
    compy: path.join(__dirname, '..', '..', '..', 'assets', 'images', 'BANNER PERFIL COMPY.webp'),
    raptor: path.join(__dirname, '..', '..', '..', 'assets', 'images', 'BANNER PERFIL RAPTOR.webp'),
};

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

const ALDERON_ID_REGEX = /^\d{3}-\d{3}-\d{3}$/;

class PlayerRegistrationSystem {
    constructor(client) {
        this.client = client;
    }

    // ==================== CARD COMPARTILHADO (avatar + identificação + status) ====================

    /**
     * Bloco reutilizado tanto pelo painel de /registrar quanto pelo /perfil:
     * avatar, username, Discord ID, e o status do vínculo com a conta do
     * Path of Titans (Alderon ID, se houver).
     *
     * @param {AdvancedContainerBuilder} builder
     * @param {import('discord.js').User} targetUser
     * @param {object|null} player - linha de pot_players, ou null se não registrado
     */
    _appendProfileCard(builder, targetUser, player) {
        let text = buildIdentityBlock(targetUser);
        if (!player) {
            text += `\n${EMOJIS.circlealert || '❌'} Conta ainda não linkada, use /registrar para linkar sua conta ao bot Titan's Pass.`;
        }

        builder.section(
            text,
            AdvancedContainerBuilder.thumbnail(targetUser.displayAvatarURL({ size: 256 })),
        );

        return builder;
    }

    /**
     * Imagem de rodapé por tier (assets footer_free/compy/raptor) — usada no
     * lugar do footer de texto ("Produzido por...") em todo container
     * relacionado a premium/perfil do jogador. Retorna os attachments extras
     * que o chamador precisa mesclar em payload.files.
     */
    _appendFooterImage(builder, playerTier) {
        const footerKey = `footer_${playerTier}`;
        const footerUrl = imageManager.getUrl(footerKey);
        const footerAttachment = imageManager.getAttachment(footerKey);
        const extraFiles = [];
        if (footerUrl) {
            builder.gallery([footerUrl]);
            if (footerAttachment) extraFiles.push(footerAttachment);
        }
        return extraFiles;
    }

    // ==================== PAINEL DE CADASTRO (/registrar) ====================

    /**
     * Monta e envia o painel de status/cadastro (sempre efêmero — é uma
     * consulta/ação pessoal, não faz sentido ser pública no canal).
     */
    async sendPanel(interaction) {
        const userId = interaction.user.id;
        const guildName = interaction.guild?.name || 'Servidor';

        const player = PlayerRegistry.getPlayerByDiscordId(userId);

        const builder = new AdvancedContainerBuilder({ accentColor: player ? COLORS.SUCCESS : COLORS.DEFAULT });
        builder.text('# CADASTRO DE JOGADOR');
        builder.text('Vincula sua conta do Discord à sua conta do Path of Titans (Alderon ID) no nosso banco de dados, pra que o bot possa reconhecer você e liberar recursos exclusivos.');
        builder.text(`${EMOJIS.globo || '🌐'} **Esse vínculo é global** — funciona em qualquer servidor que tiver o bot, não precisa registrar de novo em cada comunidade.`);
        builder.separator();

        this._appendProfileCard(builder, interaction.user, player);

        builder.separator();
        if (player) {
            builder.text(`${EMOJIS.messagesquare || 'ℹ️'} Pode atualizar quando quiser — por exemplo, se vinculou uma conta diferente do Path of Titans.`);
        } else {
            builder.text(`${EMOJIS.messagesquare || 'ℹ️'} Clique no botão abaixo pra vincular sua conta.`);
        }
        builder.separator();
        builder.text(
            `${EMOJIS.shieldcheck || '🛡️'} **Forma mais segura:** conecte sua conta do Discord pelo site oficial da Alderon Games e entre em um servidor com o bot configurado — o vínculo é feito automaticamente, sem precisar preencher o cadastro manual abaixo.`
        );
        builder.separator();
        builder.text(
            `${EMOJIS.trianglealert || '⚠️'} **Importante:** o cadastro manual abaixo não é verificado dentro do jogo — é você quem garante que é o dono dessa conta. Vínculo falso pode ser tratado como violação pela staff.`
        );

        const PremiumSystem = require('../premium/premiumSystem');
        const playerTier = PremiumSystem.getPlayerTier(userId);
        builder.separator();
        const extraFiles = this._appendFooterImage(builder, playerTier);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('player_register:open')
                .setLabel(player ? 'Atualizar Cadastro' : 'Cadastrar')
                .setStyle(player ? ButtonStyle.Secondary : ButtonStyle.Success)
                .setEmoji(EMOJIS.idcard || '🆔'),
        );

        const payload = builder.build();
        payload.components = [...payload.components, row];
        payload.files = [...(payload.files || []), ...extraFiles];
        payload.flags = payload.flags | MessageFlags.Ephemeral;

        await interaction.editReply(payload);
    }

    // ==================== PERFIL (/perfil) ====================

    /**
     * Resolve os bytes da foto de fundo do card, em ordem de prioridade:
     * foto personalizada (Raptor, via /perfil-edit) → banner do próprio
     * Discord (só Raptor) → foto padrão do tier. Nunca guarda a URL de um
     * anexo do Discord no banco (expira em ~24h) — só o ID da mensagem de
     * armazenamento, resolvido de novo a cada /perfil.
     */
    async _resolveCardPhotoBuffer(interaction, targetUser, player, playerTier) {
        if (playerTier === 'raptor') {
            if (player?.banner_message_id && process.env.BANNER_STORAGE_CHANNEL_ID) {
                try {
                    const storageChannel = await interaction.client.channels.fetch(process.env.BANNER_STORAGE_CHANNEL_ID);
                    const storedMessage = await storageChannel.messages.fetch(player.banner_message_id);
                    const url = storedMessage.attachments.first()?.url;
                    if (url) {
                        const res = await fetch(url);
                        if (res.ok) return Buffer.from(await res.arrayBuffer());
                    }
                } catch (err) {
                    // segue pro próximo fallback
                }
            }

            try {
                const fullUser = await targetUser.fetch();
                const url = fullUser.bannerURL({ size: 512 });
                if (url) {
                    const res = await fetch(url);
                    if (res.ok) return Buffer.from(await res.arrayBuffer());
                }
            } catch (err) {
                // segue pro fallback padrão do tier
            }
        }

        return fs.readFileSync(DEFAULT_CARD_PHOTOS[playerTier] || DEFAULT_CARD_PHOTOS.free);
    }

    /**
     * Monta e envia o cartão de perfil de um usuário (o próprio ou outro).
     * Só leitura — sem botão de ação; para cadastrar/atualizar é sempre
     * /registrar (evita ter dois fluxos de escrita fazendo a mesma coisa).
     *
     * @param {import('discord.js').CommandInteraction} interaction
     * @param {import('discord.js').User} targetUser
     */
    async sendProfile(interaction, targetUser) {
        const player = PlayerRegistry.getPlayerByDiscordId(targetUser.id);

        const PremiumSystem = require('../premium/premiumSystem');
        const playerTier = PremiumSystem.getPlayerTier(targetUser.id);

        const builder = new AdvancedContainerBuilder({ accentColor: player ? COLORS.SUCCESS : COLORS.DEFAULT });
        const extraFiles = [];

        // ── Card de perfil (moldura + foto + badges + estrelas de honra),
        // entra no lugar do título "# PERFIL". Só existe pra quem já linkou
        // a conta — sem Alderon ID/nome no jogo não tem o que desenhar no
        // card. Quando renderiza o card, a identificação (Alderon ID/Discord)
        // já vem NELE, então o bloco de identificação abaixo não repete essa
        // parte (só o avatar some; sem vínculo, cai no fallback de sempre). ──
        let cardRendered = false;
        if (player) {
            try {
                const photoBuffer = await this._resolveCardPhotoBuffer(interaction, targetUser, player, playerTier);
                const cardBuffer = await renderProfileCard({
                    tier: playerTier,
                    photoBuffer,
                    nickname: player.player_name || targetUser.username,
                    alderonId: player.alderon_id,
                    discordUsername: targetUser.username,
                    titleLabel: 'Em breve (missões)',
                    levelLabel: 'Nível 1',
                    speciesLabel: PlayerRegistry.getLatestDinosaurType(player.alderon_id) || 'Ainda sem registro',
                    honorStars: PunishmentSystem.getGlobalHonorStars(targetUser.id),
                });
                extraFiles.push(new AttachmentBuilder(cardBuffer, { name: 'perfil-card.png' }));
                builder.gallery(['attachment://perfil-card.png']);
                builder.separator();
                cardRendered = true;
            } catch (error) {
                console.error('❌ [PlayerRegistration] Erro ao gerar card de perfil:', error);
            }
        }

        if (!cardRendered) {
            // Sem vínculo (ou falha ao gerar o card) — volta pro banner estático
            // padrão do tier + bloco de identificação completo de sempre.
            const bannerKey = `banner_perfil_${playerTier}`;
            const bannerUrl = imageManager.getUrl(bannerKey);
            const bannerAttachment = imageManager.getAttachment(bannerKey);
            if (bannerAttachment) extraFiles.push(bannerAttachment);
            if (bannerUrl) {
                builder.gallery([bannerUrl]);
                builder.separator();
            }
            this._appendProfileCard(builder, targetUser, player);
            builder.separator();
            builder.text(`${EMOJIS.sparkles || '✨'} *Títulos e emblemas exclusivos chegando em breve!*`);
        }

        if (playerTier !== 'free') {
            builder.separator();
            const tierLabel = playerTier === 'raptor' ? 'Raptor' : 'Compy';
            builder.text(`${EMOJIS.badge || '🏅'} **Player Premium:** ${tierLabel}`);
        }

        // ── Imagem de rodapé, também por tier (assets footer_free/compy/raptor) —
        // substitui o footer de texto ("Produzido por..."), não usado aqui. ──────
        builder.separator();
        extraFiles.push(...this._appendFooterImage(builder, playerTier));

        const payload = builder.build();
        payload.files = [...(payload.files || []), ...extraFiles];
        payload.flags = payload.flags | MessageFlags.Ephemeral;

        await interaction.editReply(payload);
    }

    // ==================== MODAL ====================

    getRegisterModal(existingPlayer) {
        const modal = new ModalBuilder().setCustomId('player_register_modal').setTitle('Cadastro de Jogador');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('nome_jogo')
                    .setLabel('Seu nome no Path of Titans')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100)
                    .setValue(existingPlayer?.player_name || '')
                    .setPlaceholder('Ex: Rexy'),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('alderon_id')
                    .setLabel('Seu Alderon ID (AGID)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMinLength(11)
                    .setMaxLength(11)
                    .setValue(existingPlayer?.alderon_id || '')
                    .setPlaceholder('Formato: 048-236-424'),
            ),
        );
        return modal;
    }

    async handleOpenModal(interaction) {
        const player = PlayerRegistry.getPlayerByDiscordId(interaction.user.id);
        await interaction.showModal(this.getRegisterModal(player));
    }

    async handleModalSubmit(interaction) {
        const userId = interaction.user.id;
        const guildName = interaction.guild?.name || 'Servidor';

        const playerName = interaction.fields.getTextInputValue('nome_jogo').trim();
        const alderonIdRaw = interaction.fields.getTextInputValue('alderon_id').trim();

        if (!ALDERON_ID_REGEX.test(alderonIdRaw)) {
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} Alderon ID inválido. Use o formato \`xxx-xxx-xxx\` (só números), exatamente como aparece no jogo. Você digitou: \`${alderonIdRaw}\`.`,
                COLORS.ERROR, guildName,
            ));
        }

        const result = PlayerRegistry.registerPlayerManually(userId, alderonIdRaw, playerName);

        if (!result.success) {
            const messages = {
                MISSING_FIELDS: 'Preencha os dois campos corretamente.',
                ALDERON_TAKEN: 'Esse Alderon ID já está vinculado a outra conta do Discord (o vínculo é global, vale em qualquer servidor). Se isso for um engano, peça para a staff verificar.',
                DB_ERROR: 'Erro interno ao salvar o cadastro. Tente novamente em instantes.',
            };
            return await interaction.editReply(this._simpleReply(
                `${EMOJIS.circlealert || '❌'} ${messages[result.error] || 'Não foi possível concluir o cadastro.'}`,
                COLORS.ERROR, guildName,
            ));
        }

        const summary = result.created
            ? `${EMOJIS.circlecheck || '✅'} **Cadastro criado!**`
            : result.relinked
                ? `${EMOJIS.circlecheck || '✅'} **Cadastro atualizado** para o novo Alderon ID.`
                : `${EMOJIS.circlecheck || '✅'} **Cadastro atualizado!**`;

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });
        builder.text(summary);
        builder.text(`${EMOJIS.user || '👤'} **Nome no jogo:** ${playerName}`);
        builder.text(`${EMOJIS.PotLogo || '🦖'} **Alderon ID:** \`${alderonIdRaw}\``);
        builder.footer(guildName);

        await interaction.editReply(builder.build());
    }

    _simpleReply(text, color, guildName) {
        return new AdvancedContainerBuilder({ accentColor: color }).text(text).footer(guildName).build();
    }
}

module.exports = PlayerRegistrationSystem;
