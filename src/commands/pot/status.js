const PoTConfigSystem = require('../../systems/potConfigSystem');
const PoTTokenManager = require('../../integrations/pathoftitans/tokenManager');
const { getInstance } = require('../../integrations/pathoftitans');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');

module.exports = {
    async execute(interaction, client) {
        const guildId = interaction.guildId;
        const guildName = interaction.guild.name;

        try {
            const config = PoTConfigSystem.getServerConfig(guildId);
            const token = PoTTokenManager.getToken(guildId);
            const tokenStats = PoTTokenManager.getTokenStats(guildId);
            const webhooks = PoTConfigSystem.getAllWebhookConfigs(guildId);
            
            const potIntegration = getInstance(client);
            const stats = potIntegration.getStats();

            const builder = new AdvancedContainerBuilder({ 
                accentColor: config ? 0x00AAFF : 0xFFA500 
            });

            builder
                .title('📊 Status do Servidor Path of Titans')
                .text('Resumo da integração com seu servidor PoT.')
                .separator();

            if (config) {
                builder.text(`✅ **Servidor:** ${config.server_ip || 'Não configurado'}`);
                builder.text(`🔌 **Porta RCON:** ${config.rcon_port || 'N/A'}`);
                builder.text(`📨 **Webhooks:** ${Object.keys(webhooks).length} configurados`);
            } else {
                builder.text('❌ **Servidor:** Não configurado');
                builder.text('Use `/potserver setup` para configurar');
            }

            builder.separator();

            if (token) {
                const maskedToken = token.length > 20 ? `${token.substring(0, 10)}...${token.substring(token.length - 6)}` : token;
                builder.text(`🔑 **Token:** \`${maskedToken}\``);
                builder.text(`📊 **Usos:** ${tokenStats.usage_count || 0} requisições`);
                
                if (tokenStats.last_used) {
                    builder.text(`🕐 **Último uso:** <t:${Math.floor(tokenStats.last_used / 1000)}:R>`);
                }
            } else {
                builder.text('🔑 **Token:** ❌ Não gerado');
                builder.text('Execute `/potserver setup` para gerar um token');
            }

            builder.separator();

            builder.text(`🔒 **Gateway:** ${stats.gatewayRunning ? '✅ Rodando' : '❌ Parado'}`);
            builder.text(`🔗 **RCON:** ${stats.rconConnections > 0 ? `✅ ${stats.rconConnections} conexão(ões)` : '❌ Nenhuma conexão'}`);

            if (process.env.POT_PUBLIC_URL) {
                builder.text(`🌐 **URL Pública:** \`${process.env.POT_PUBLIC_URL}\``);
            }

            builder.separator();

            if (!config) {
                builder.text('💡 **Dica:** Use `/potserver setup` para configurar o servidor.');
            } else if (Object.keys(webhooks).length === 0) {
                builder.text('💡 **Dica:** Use `/potserver logs` para criar os webhooks.');
            } else {
                builder.text('✅ **Tudo pronto!** O servidor está integrado com o bot.');
            }

            builder.footer(guildName);
            await interaction.editReply(builder.build());

        } catch (error) {
            console.error('❌ [Status] Erro:', error);
            await interaction.editReply({
                content: `❌ Erro ao carregar status: ${error.message}`,
                flags: 64
            });
        }
    }
};
