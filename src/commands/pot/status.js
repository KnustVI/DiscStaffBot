const PoTConfigSystem = require('../../systems/potConfigSystem');
const PoTTokenManager = require('../../integrations/pathoftitans/tokenManager');
const { getInstance } = require('../../integrations/pathoftitans');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');
const { MessageFlags } = require('discord.js'); // ✅ FIX

module.exports = {
    async execute(interaction, client) {
        const guildId = interaction.guildId;
        const guildName = interaction.guild?.name || 'Servidor';

        try {
            const config = PoTConfigSystem.getServerConfig(guildId);
            const token = PoTTokenManager.getToken(guildId);
            const tokenStats = PoTTokenManager.getTokenStats(guildId);
            const webhooks = PoTConfigSystem.getAllWebhookConfigs(guildId);

            const potIntegration = getInstance(client);
            const stats = potIntegration.getStats();

            // ✅ NOVO: teste de RCON AO VIVO. initializeForGuild recria o
            // cliente RCON e envia o comando 'status' de verdade — diferente
            // de stats.rconConnections, que só conta instâncias em memória
            // (fica zerado/desatualizado se o bot reiniciar).
            let rconLiveOk = null;
            if (config) {
                try {
                    rconLiveOk = await potIntegration.initializeForGuild(guildId, config);
                } catch (err) {
                    rconLiveOk = false;
                }
            }

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
                const maskedToken =
                    token.length > 20
                        ? `${token.substring(0, 10)}...${token.substring(token.length - 6)}`
                        : token;

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

            // ✅ Linha de RCON agora mostra o teste ao vivo, não a contagem em memória.
            let rconText;
            if (rconLiveOk === null) {
                rconText = '⚪ Não testado (servidor não configurado)';
            } else if (rconLiveOk) {
                rconText = '✅ Conectado (testado agora)';
            } else {
                rconText = '❌ Falhou (sem resposta do servidor — verifique IP/porta/senha RCON)';
            }
            builder.text(`🔗 **RCON:** ${rconText}`);

            if (process.env.POT_PUBLIC_URL) {
                builder.text(`🌐 **URL Pública:** \`${process.env.POT_PUBLIC_URL}\``);
            }

            builder.separator();

            if (!config) {
                builder.text('💡 **Dica:** Use `/potserver setup` para configurar o servidor.');
            } else if (Object.keys(webhooks).length === 0) {
                builder.text('💡 **Dica:** Use `/potserver logs` para criar os webhooks.');
            } else if (!rconLiveOk) {
                builder.text('💡 **Dica:** RCON falhou — confirme se o servidor PoT está online e se IP/porta/senha estão corretos em `/potserver setup`.');
            } else {
                builder.text('✅ **Tudo pronto!** O servidor está integrado com o bot.');
            }

            builder.footer(guildName);

            const payload = builder.build();

            payload.flags =
                MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

            await interaction.editReply(payload);

        } catch (error) {
            console.error('❌ [Status] Erro:', error);

            const builder = new AdvancedContainerBuilder({
                accentColor: 0xFF0000
            });

            builder
                .title('❌ Erro')
                .text(`Erro ao carregar status: ${error.message}`)
                .footer(interaction.guild?.name || 'Servidor');

            const payload = builder.build();

            payload.flags =
                MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

            await interaction.editReply(payload);
        }
    }
};