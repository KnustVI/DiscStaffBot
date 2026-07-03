const { MessageFlags } = require('discord.js');

const PoTConfigSystem = require('../../systems/potConfigSystem');
const PoTTokenManager = require('../../integrations/pathoftitans/tokenManager');
const { getInstance } = require('../../integrations/pathoftitans');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');

let emojis = {};
try {
    emojis = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    emojis = {};
}

module.exports = {
    async execute(interaction, client) {
        const ip = interaction.options.getString('ip');
        const rconPassword = interaction.options.getString('rcon_password');
        const rconPort = interaction.options.getInteger('rcon_port') || 27015;

        const guildName = interaction.guild?.name || 'Servidor';

        try {
            const config = {
                enabled: true,
                server_ip: ip,
                rcon_password: rconPassword,
                rcon_port: rconPort,
                webhook_port: 8080,
                configured_at: Date.now(),
                configured_by: interaction.user.id
            };

            PoTConfigSystem.setServerConfig(interaction.guildId, config, interaction.user.id);

            let token = PoTTokenManager.getToken(interaction.guildId);
            if (!token) token = PoTTokenManager.generateToken(interaction.guildId);

            const potIntegration = getInstance(client);

            let rconStatus = false;
            try {
                rconStatus = await potIntegration.initializeForGuild(interaction.guildId, config);
            } catch (err) {
                console.warn('⚠️ RCON erro:', err.message);
            }

            const builder = new AdvancedContainerBuilder({
                accentColor: rconStatus ? 0x00FF00 : 0xFFA500
            });

            builder
                .title(`${emojis.DinoFootprint || '🎮'} Path of Titans - Configuração`)
                .text('Configurações salvas com sucesso!')
                .separator()
                .text(`${emojis.wifi || '📡'} IP: ${ip}`)
                .text(`🔌 Porta RCON: ${rconPort}`)
                .text(`${emojis.vpnkey || '🔑'} Token: \`${token}\``)
                .separator()
                .text(`${emojis.refreshccw || '🔄'} RCON: ${rconStatus ? `${emojis.circlecheck || '✅'} Conectado` : `${emojis.trianglealert || '⚠️'} Offline`}`)
                .footer(guildName);

            const payload = builder.build();

            payload.flags =
                MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

            await interaction.editReply(payload);

        } catch (error) {
            const builder = new AdvancedContainerBuilder({
                accentColor: 0xFF0000
            });

            builder
                .title(`${emojis.circlealert || '❌'} Erro`)
                .text(error.message)
                .footer(interaction.guild?.name || 'Servidor');

            const payload = builder.build();

            payload.flags =
                MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

            await interaction.editReply(payload);
        }
    }
};
