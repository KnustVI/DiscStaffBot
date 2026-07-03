const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

const PoTConfigSystem = require('../../systems/potConfigSystem');
const PoTTokenManager = require('../../integrations/pathoftitans/tokenManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

let emojis = {};
try {
    emojis = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    emojis = {};
}

module.exports = {
    async execute(interaction, client) {
        const scope = interaction.options.getString('scope');
        const guildId = interaction.guildId;
        const userId = interaction.user.id;

        const guildName = interaction.guild?.name || 'Servidor';

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });

        builder
            .section(
                [
                    '# CONFIRMAR RESET',
                    `Você está prestes a resetar: **${scope}**`,
                    'Esta ação NÃO PODE SER DESFEITA!',
                ].join('\n'),
                builder.assetThumbnail('icone_setup_server') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png')
            )
            .separator()
            .text('Clique em Confirmar Reset para prosseguir.')
            .footer(guildName);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`pot_reset_confirm_${guildId}_${userId}_${scope}`)
                .setLabel('Confirmar Reset')
                .setStyle(ButtonStyle.Danger)
                .setEmoji(emojis.circlecheck || '✅'),
            new ButtonBuilder()
                .setCustomId(`pot_reset_cancel_${guildId}_${userId}`)
                .setLabel('Cancelar')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(emojis.circlealert || '❌')
        );

        const payload = builder.build();
        payload.components = [...payload.components, row];
        payload.flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

        await interaction.editReply(payload);
    },

    async executeReset(guildId, scope) {
        try {
            switch (scope) {
                case 'server':
                    require('../../database/index')
                        .prepare(`DELETE FROM settings WHERE guild_id = ? AND key = ?`)
                        .run(guildId, 'pot_server_config');

                    return {
                        success: true,
                        message: `${emojis.tv || '🖥️'} Configuração removida (token mantido)`
                    };

                case 'logs':
                    require('../../database/index')
                        .prepare(`DELETE FROM settings WHERE guild_id = ? AND key LIKE 'pot_webhook_%'`)
                        .run(guildId);

                    return {
                        success: true,
                        message: `${emojis.mensagem || '📨'} Webhooks removidos`
                    };

                case 'all':
                    PoTConfigSystem.clearAllConfigs(guildId);
                    PoTTokenManager.revokeToken(guildId);

                    return {
                        success: true,
                        message: `${emojis.cleaningservices || '🗑️'} Tudo resetado (incluindo token)`
                    };

                default:
                    return {
                        success: false,
                        message: `${emojis.circlealert || '❌'} Escopo inválido`
                    };
            }
        } catch (error) {
            return {
                success: false,
                message: error.message
            };
        }
    }
};
