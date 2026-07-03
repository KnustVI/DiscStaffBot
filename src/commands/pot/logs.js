const { MessageFlags } = require('discord.js');

const PoTWebhookSystem = require('../../systems/potWebhookSystem');
const PoTConfigSystem = require('../../systems/potConfigSystem');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

let emojis = {};
try {
    emojis = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    emojis = {};
}

module.exports = {
    async execute(interaction, client) {
        const guildId = interaction.guildId;
        const guildName = interaction.guild?.name || 'Servidor';

        try {
            const config = PoTConfigSystem.getServerConfig(guildId);

            if (!config) {
                const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
                builder.section(
                    [
                        '# SERVIDOR NÃO CONFIGURADO',
                        'Use /potserver setup primeiro',
                    ].join('\n'),
                    builder.assetThumbnail('icone_setup_server') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png')
                ).footer(guildName);

                const payload = builder.build();
                payload.flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
                return interaction.editReply(payload);
            }

            const payload = PoTWebhookSystem.buildPanelPayload(interaction, 0);
            await interaction.editReply(payload);

        } catch (error) {
            console.error('❌ [Logs] Erro:', error);
            const builder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });
            builder.section(
                [
                    '# ERRO',
                    error.message,
                ].join('\n'),
                builder.assetThumbnail('icone_setup_server') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png')
            ).footer(guildName);

            const payload = builder.build();
            payload.flags = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
            await interaction.editReply(payload);
        }
    }
};