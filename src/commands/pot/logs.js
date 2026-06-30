const { MessageFlags } = require('discord.js');

const PoTWebhookSystem = require('../../systems/potWebhookSystem');
const PoTConfigSystem = require('../../systems/potConfigSystem');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');

module.exports = {
    async execute(interaction, client) {
        const guildId = interaction.guildId;
        const guildName = interaction.guild?.name || 'Servidor';

        try {
            const config = PoTConfigSystem.getServerConfig(guildId);

            if (!config) {
                const builder = new AdvancedContainerBuilder({ accentColor: 0xFFA500 });
                builder.title('⚠️ Servidor não configurado').text('Use /potserver setup primeiro').footer(guildName);

                const payload = builder.build();
                payload.flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
                return interaction.editReply(payload);
            }

            const payload = PoTWebhookSystem.buildPanelPayload(interaction, 0);
            await interaction.editReply(payload);

        } catch (error) {
            console.error('❌ [Logs] Erro:', error);
            const builder = new AdvancedContainerBuilder({ accentColor: 0xFF0000 });
            builder.title('❌ Erro').text(error.message).footer(guildName);

            const payload = builder.build();
            payload.flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
            await interaction.editReply(payload);
        }
    }
};