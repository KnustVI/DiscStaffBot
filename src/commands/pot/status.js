const PoTConfigSystem = require('../../systems/pot/potConfigSystem');
const PoTTokenManager = require('../../integrations/pathoftitans/tokenManager');
const { getInstance } = require('../../integrations/pathoftitans');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const { MessageFlags } = require('discord.js'); // ✅ FIX

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
            const token = PoTTokenManager.getToken(guildId);
            const tokenStats = PoTTokenManager.getTokenStats(guildId);
            const webhooks = PoTConfigSystem.getAllWebhookConfigs(guildId);

            const potIntegration = getInstance(client);
            const stats = potIntegration.getStats();

            // ✅ NOVO: teste de RCON AO VIVO. initializeForGuild recria o
            // cliente RCON e envia o comando 'status' de verdade — diferente
            // de stats.rconConnections, que só conta instâncias em memória
            // (fica zerado/desatualizado se o bot reiniciar).
            let rconResult = null;
            if (config) {
                try {
                    rconResult = await potIntegration.initializeForGuild(guildId, config);
                } catch (err) {
                    rconResult = { success: false, error: err.message };
                }
            }

            let statusAccentColor = COLORS.DEFAULT;
            if (config) {
                statusAccentColor = rconResult?.success ? COLORS.SUCCESS : COLORS.ERROR;
            }
            const builder = new AdvancedContainerBuilder({
                accentColor: statusAccentColor
            });

            builder
                .section(
                    [
                        '# STATUS DO SERVIDOR PATH OF TITANS',
                        'Resumo da integração com seu servidor PoT.',
                    ].join('\n'),
                    builder.assetThumbnail('icone_setup_server') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png')
                )
                .separator();

            if (config) {
                if (config.server_name) {
                    builder.text(`${emojis.circleuser || '🏷️'} **Nome:** ${config.server_name}`);
                }
                builder.text(`${emojis.circlecheck || '✅'} **Servidor:** ${config.server_ip || 'Não configurado'}`);
                builder.text(`${emojis.tomada || '🔌'} **Porta RCON:** ${config.rcon_port || 'N/A'}`);
                builder.text(`${emojis.mensagem || '📨'} **Webhooks:** ${Object.keys(webhooks).length} configurados`);
            } else {
                builder.text(`${emojis.circlealert || '❌'} **Servidor:** Não configurado`);
                builder.text('Use `/potserver setup` para configurar');
            }

            builder.separator();

            if (token) {
                const maskedToken =
                    token.length > 20
                        ? `${token.substring(0, 10)}...${token.substring(token.length - 6)}`
                        : token;

                builder.text(`${emojis.vpnkey || '🔑'} **Token:** \`${maskedToken}\``);
                builder.text(`${emojis.gauge || '📊'} **Usos:** ${tokenStats.usage_count || 0} requisições`);

                if (tokenStats.last_used) {
                    builder.text(`${emojis.clock || '🕐'} **Último uso:** <t:${Math.floor(tokenStats.last_used / 1000)}:R>`);
                }
            } else {
                builder.text(`${emojis.vpnkey || '🔑'} **Token:** ${emojis.circlealert || '❌'} Não gerado`);
                builder.text('Execute `/potserver setup` para gerar um token');
            }

            builder.separator();

            builder.text(`${emojis.lock || '🔒'} **Gateway:** ${stats.gatewayRunning ? `${emojis.circlecheck || '✅'} Rodando` : `${emojis.circlealert || '❌'} Parado`}`);

            // ✅ Linha de RCON agora mostra o teste ao vivo, não a contagem em memória.
            let rconText;
            if (rconResult === null) {
                rconText = `${emojis.thumbsup || '⚪'} Não testado (servidor não configurado)`;
            } else if (rconResult.success) {
                rconText = `${emojis.circlecheck || '✅'} Conectado (testado agora)`;
            } else {
                rconText = `${emojis.circlealert || '❌'} Falhou: ${rconResult.error || 'sem resposta do servidor'} — verifique IP/porta/senha RCON`;
            }
            builder.text(`${emojis.rcon || '🔗'} **RCON:** ${rconText}`);

            if (process.env.POT_PUBLIC_URL) {
                builder.text(`${emojis.globo || '🌐'} **URL Pública:** \`${process.env.POT_PUBLIC_URL}\``);
            }

            builder.separator();

            if (!config) {
                builder.text(`${emojis.luz || '💡'} **Dica:** Use \`/potserver setup\` para configurar o servidor.`);
            } else if (Object.keys(webhooks).length === 0) {
                builder.text(`${emojis.luz || '💡'} **Dica:** Use \`/potserver logs\` para criar os webhooks.`);
            } else if (!rconResult?.success) {
                builder.text(`${emojis.luz || '💡'} **Dica:** RCON falhou — confirme se o servidor PoT está online e se IP/porta/senha estão corretos em \`/potserver setup\`.`);
            } else {
                builder.text(`${emojis.circlecheck || '✅'} **Tudo pronto!** O servidor está integrado com o bot.`);
            }

            builder.footer(guildName);

            const payload = builder.build();

            payload.flags =
                MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

            await interaction.editReply(payload);

        } catch (error) {
            console.error('❌ [Status] Erro:', error);

            const builder = new AdvancedContainerBuilder({
                accentColor: COLORS.ERROR
            });

            builder
                .section(
                    [
                        '# ERRO',
                        `Erro ao carregar status: ${error.message}`,
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