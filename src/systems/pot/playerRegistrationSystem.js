// src/systems/pot/playerRegistrationSystem.js

/**
 * playerRegistrationSystem.js
 *
 * Cadastro MANUAL de jogador via painel + modal (comando /registrar).
 * Complementa o cadastro automático por webhook (ver potPlayerRegistry.js) —
 * funciona independente de o jogador ter linkado o Discord pelo site oficial
 * do Path of Titans ou não.
 *
 * Campos obrigatórios no perfil:
 *  - Discord: username/ID — sempre o de quem executa o comando, nunca
 *    perguntado (não faz sentido cadastrar em nome de outra pessoa aqui).
 *  - Path of Titans: nome do personagem + Alderon ID (AGID) — pedidos via
 *    modal, únicos dados que o usuário realmente precisa digitar.
 *
 * Verificação em jogo (RCON): ainda NÃO ativada — ver o bloco correspondente
 * em potPlayerRegistry.js. Por enquanto o cadastro aceita o Alderon ID
 * informado sem confirmar no jogo, e o painel deixa isso claro.
 */

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
} = require('discord.js');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const PlayerRegistry = require('./potPlayerRegistry');

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
     * avatar, username, Discord ID, e o status do vínculo com o Path of
     * Titans (personagem + Alderon ID, se houver).
     *
     * @param {AdvancedContainerBuilder} builder
     * @param {import('discord.js').User} targetUser
     * @param {object|null} player - linha de pot_players, ou null se não registrado
     */
    _appendProfileCard(builder, targetUser, player) {
        builder.section(
            `## ${targetUser.toString()}\n${targetUser.username}\n(\`${targetUser.id}\`)`,
            AdvancedContainerBuilder.thumbnail(targetUser.displayAvatarURL({ size: 256 })),
        );
        builder.separator();

        if (player) {
            builder.text(`${EMOJIS.circlecheck || '✅'} **Registrado no Path of Titans**`);
            builder.text(`${EMOJIS.user || '👤'} **Personagem:** ${player.player_name}`);
            builder.text(`${EMOJIS.idcard || '🆔'} **Alderon ID:** \`${player.alderon_id}\``);
        } else {
            builder.text(`${EMOJIS.circlealert || '❌'} **Ainda não registrado no Path of Titans**`);
        }

        return builder;
    }

    // ==================== PAINEL DE CADASTRO (/registrar) ====================

    /**
     * Monta e envia o painel de status/cadastro (sempre efêmero — é uma
     * consulta/ação pessoal, não faz sentido ser pública no canal).
     */
    async sendPanel(interaction) {
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const guildName = interaction.guild?.name || 'Servidor';

        const player = PlayerRegistry.getPlayerByDiscordId(guildId, userId);

        const builder = new AdvancedContainerBuilder({ accentColor: player ? COLORS.SUCCESS : COLORS.DEFAULT });
        builder.text('# CADASTRO DE JOGADOR');
        builder.text('Vincula sua conta do Discord ao seu personagem no Path of Titans (Alderon ID), para a staff identificar você nos reports, punições e no histórico.');
        builder.separator();

        this._appendProfileCard(builder, interaction.user, player);

        builder.separator();
        if (player) {
            builder.text(`${EMOJIS.messagesquare || 'ℹ️'} Pode atualizar quando quiser — por exemplo, se trocou de personagem principal.`);
        } else {
            builder.text(`${EMOJIS.messagesquare || 'ℹ️'} Clique no botão abaixo pra vincular seu personagem.`);
        }
        builder.separator();
        builder.text(
            `${EMOJIS.trianglealert || '⚠️'} **Importante:** por enquanto o Alderon ID informado não é verificado dentro do jogo — é você quem garante que é o dono desse personagem. Cadastro falso pode ser tratado como violação pela staff.`
        );
        builder.footer(guildName);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('player_register:open')
                .setLabel(player ? 'Atualizar Cadastro' : 'Cadastrar')
                .setStyle(player ? ButtonStyle.Secondary : ButtonStyle.Success)
                .setEmoji(EMOJIS.idcard || '🆔'),
        );

        const payload = builder.build();
        payload.components = [...payload.components, row];
        payload.flags = payload.flags | MessageFlags.Ephemeral;

        await interaction.editReply(payload);
    }

    // ==================== PERFIL (/perfil) ====================

    /**
     * Monta e envia o cartão de perfil de um usuário (o próprio ou outro).
     * Só leitura — sem botão de ação; para cadastrar/atualizar é sempre
     * /registrar (evita ter dois fluxos de escrita fazendo a mesma coisa).
     *
     * @param {import('discord.js').CommandInteraction} interaction
     * @param {import('discord.js').User} targetUser
     */
    async sendProfile(interaction, targetUser) {
        const guildId = interaction.guildId;
        const guildName = interaction.guild?.name || 'Servidor';
        const isSelf = targetUser.id === interaction.user.id;

        const player = PlayerRegistry.getPlayerByDiscordId(guildId, targetUser.id);

        const builder = new AdvancedContainerBuilder({ accentColor: player ? COLORS.SUCCESS : COLORS.DEFAULT });
        builder.text('# PERFIL');
        builder.separator();

        this._appendProfileCard(builder, targetUser, player);

        if (!player) {
            builder.separator();
            builder.text(
                isSelf
                    ? `${EMOJIS.messagesquare || 'ℹ️'} Use **/registrar** para vincular seu personagem do Path of Titans.`
                    : `${EMOJIS.messagesquare || 'ℹ️'} Esse usuário ainda não usou **/registrar** para vincular um personagem.`
            );
        }

        builder.separator();
        builder.text(`${EMOJIS.sparkles || '✨'} *Perfis personalizáveis (títulos, emblemas, banners) chegando em breve!*`);
        builder.footer(guildName);

        const payload = builder.build();
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
                    .setLabel('Nome do seu personagem no jogo')
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
        const player = PlayerRegistry.getPlayerByDiscordId(interaction.guildId, interaction.user.id);
        await interaction.showModal(this.getRegisterModal(player));
    }

    async handleModalSubmit(interaction) {
        const guildId = interaction.guildId;
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

        const result = PlayerRegistry.registerPlayerManually(guildId, userId, alderonIdRaw, playerName);

        if (!result.success) {
            const messages = {
                MISSING_FIELDS: 'Preencha os dois campos corretamente.',
                ALDERON_TAKEN: 'Esse Alderon ID já está vinculado a outra conta do Discord neste servidor. Se isso for um engano, peça para a staff verificar.',
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
        builder.text(`${EMOJIS.user || '👤'} **Personagem:** ${playerName}`);
        builder.text(`${EMOJIS.idcard || '🆔'} **Alderon ID:** \`${alderonIdRaw}\``);
        builder.footer(guildName);

        await interaction.editReply(builder.build());
    }

    _simpleReply(text, color, guildName) {
        return new AdvancedContainerBuilder({ accentColor: color }).text(text).footer(guildName).build();
    }
}

module.exports = PlayerRegistrationSystem;
