const { MessageFlags } = require('discord.js');

const PoTConfigSystem = require('../../systems/pot/potConfigSystem');
const PoTTokenManager = require('../../integrations/pathoftitans/tokenManager');
const { getInstance } = require('../../integrations/pathoftitans');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

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
        const rconPort = interaction.options.getInteger('rcon_port');
        const serverName = interaction.options.getString('nome');

        const guildName = interaction.guild?.name || 'Servidor';

        try {
            const config = {
                enabled: true,
                server_name: serverName || null,
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

            let rconResult = { success: false, error: 'Erro desconhecido' };
            try {
                rconResult = await potIntegration.initializeForGuild(interaction.guildId, config);
            } catch (err) {
                console.warn('⚠️ RCON erro:', err.message);
                rconResult = { success: false, error: err.message };
            }

            const builder = new AdvancedContainerBuilder({
                accentColor: rconResult.success ? COLORS.SUCCESS : COLORS.DEFAULT
            });

            const guildIconUrl = interaction.guild?.iconURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';

            builder
                .section(
                    [
                        '# PATH OF TITANS - CONFIGURAÇÃO',
                        'Configurações salvas com sucesso!',
                    ].join('\n'),
                    AdvancedContainerBuilder.thumbnail(guildIconUrl)
                )
                .separator()
                .text(serverName ? `${emojis.circleuser || '🏷️'} Nome: ${serverName}` : `${emojis.circleuser || '🏷️'} Nome: (não informado)`)
                .text(`${emojis.wifi || '📡'} IP: ${ip}`)
                .text(`${emojis.tomada || '🔌'} Porta RCON: ${rconPort}`)
                .text(`${emojis.vpnkey || '🔑'} Token: \`${token}\``)
                .text(`-# O token autentica as requisições do SEU servidor de jogo com o bot — ele já vem embutido nas URLs do Game.ini (\`/potserver logs\`). Não compartilhe: quem tiver o token pode enviar eventos falsos como se fossem do seu servidor.`)
                .separator()
                .text(`${emojis.rcon || '🔄'} RCON: ${rconResult.success ? `${emojis.circlecheck || '✅'} Conectado` : `${emojis.trianglealert || '⚠️'} Offline (${rconResult.error})`}`)
                .footer(guildName);

            const payload = builder.build();

            payload.flags =
                MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

            await interaction.editReply(payload);

        } catch (error) {
            const builder = new AdvancedContainerBuilder({
                accentColor: COLORS.ERROR
            });

            builder
                .section(
                    [
                        '# ERRO',
                        error.message,
                    ].join('\n'),
                    builder.assetThumbnail('icone_setup_server') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png')
                )
                .footer(interaction.guild?.name || 'Servidor');

            const payload = builder.build();

            payload.flags =
                MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

            await interaction.editReply(payload);
        }
    }
};
