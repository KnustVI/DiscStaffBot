const { PoTWebhookSystem } = require('../../systems/potWebhookSystem');
const PoTConfigSystem = require('../../systems/potConfigSystem');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');

module.exports = {
    async execute(interaction, client) {
        const guildId = interaction.guildId;
        const guildName = interaction.guild.name;

        try {
            const config = PoTConfigSystem.getServerConfig(guildId);
            if (!config) {
                const builder = new AdvancedContainerBuilder({ accentColor: 0xFFA500 });
                builder
                    .title('⚠️ Servidor não configurado')
                    .text('Configure o servidor primeiro usando `/potserver setup`')
                    .footer(guildName);
                
                const payload = builder.build();
                payload.flags = 64;
                await interaction.editReply(payload);
                return;
            }

            const builder = PoTWebhookSystem.getLogsPanelContainer(guildId, guildName, 0, 5);
            
            const payload = builder.build();
            payload.flags = 64;
            await interaction.editReply(payload);

        } catch (error) {
            console.error('❌ [Logs] Erro:', error);
            const builder = new AdvancedContainerBuilder({ accentColor: 0xFF0000 });
            builder
                .title('❌ Erro')
                .text(`Erro ao carregar painel de logs: ${error.message}`)
                .footer(guildName);
            
            const payload = builder.build();
            payload.flags = 64;
            await interaction.editReply(payload);
        }
    }
};