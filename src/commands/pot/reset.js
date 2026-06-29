const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

const PoTConfigSystem = require('../../systems/potConfigSystem');
const PoTTokenManager = require('../../integrations/pathoftitans/tokenManager');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');

module.exports = {
    async execute(interaction, client) {
        const scope = interaction.options.getString('scope');
        const guildId = interaction.guildId;
        const userId = interaction.user.id;

        const guildName = interaction.guild?.name || 'Servidor';

        const builder = new AdvancedContainerBuilder({ accentColor: 0xFF4444 });

        builder
            .title('⚠️ CONFIRMAR RESET')
            .text(`Você está prestes a resetar: **${scope}**`)
            .text('Esta ação NÃO PODE SER DESFEITA!')
            .separator()
            .text('Clique em Confirmar Reset para prosseguir.')
            .footer(guildName);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`pot_reset_confirm_${guildId}_${userId}_${scope}`)
                .setLabel('✅ Confirmar Reset')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`pot_reset_cancel_${guildId}_${userId}`)
                .setLabel('❌ Cancelar')
                .setStyle(ButtonStyle.Secondary)
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
                        message: '🖥️ Configuração removida (token mantido)'
                    };

                case 'logs':
                    require('../../database/index')
                        .prepare(`DELETE FROM settings WHERE guild_id = ? AND key LIKE 'pot_webhook_%'`)
                        .run(guildId);

                    return {
                        success: true,
                        message: '📨 Webhooks removidos'
                    };

                case 'all':
                    PoTConfigSystem.clearAllConfigs(guildId);
                    PoTTokenManager.revokeToken(guildId);

                    return {
                        success: true,
                        message: '🗑️ Tudo resetado (incluindo token)'
                    };

                default:
                    return {
                        success: false,
                        message: '❌ Escopo inválido'
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
