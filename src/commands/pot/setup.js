const PoTConfigSystem = require('../../systems/potConfigSystem');
const PoTTokenManager = require('../../integrations/pathoftitans/tokenManager');
const { getInstance } = require('../../integrations/pathoftitans');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');

module.exports = {
    async execute(interaction, client) {
        const ip = interaction.options.getString('ip');
        const rconPassword = interaction.options.getString('rcon_password');
        const rconPort = interaction.options.getInteger('rcon_port') || 27015;

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
            if (!token) {
                token = PoTTokenManager.generateToken(interaction.guildId);
            }

            const potIntegration = getInstance(client);
            let rconStatus = false;
            
            try {
                rconStatus = await potIntegration.initializeForGuild(interaction.guildId, config);
            } catch (rconError) {
                console.warn('⚠️ [Setup] Erro ao conectar RCON:', rconError.message);
                rconStatus = false;
            }

            const builder = new AdvancedContainerBuilder({ 
                accentColor: rconStatus ? 0x00FF00 : 0xFFA500 
            });

            builder
                .title('🎮 Path of Titans - Configuração')
                .text('Configurações do servidor salvas com sucesso!')
                .separator()
                .text(`📡 **IP:** ${ip}`)
                .text(`🔌 **Porta RCON:** ${rconPort}`)
                .text(`🔑 **Token:** \`${token}\``)
                .separator()
                .text(`🔄 **Status RCON:** ${rconStatus ? '✅ Conectado' : '⚠️ Offline (configure depois)'}`)
                .separator()
                .text('📋 **Próximos passos:**')
                .text('1. Use `/potserver logs` para criar os webhooks')
                .text('2. Use `/potserver logs` e clique em "Gerar Game.ini"')
                .text('3. Cole a configuração no arquivo Game.ini do servidor')
                .footer(interaction.guild.name);

            await interaction.editReply(builder.build());

        } catch (error) {
            console.error('❌ [Setup] Erro:', error);
            await interaction.editReply({
                content: `❌ Erro ao configurar servidor: ${error.message}`,
                flags: 64
            });
        }
    }
};
