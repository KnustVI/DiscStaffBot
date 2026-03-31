const { SlashCommandBuilder, EmbedBuilder, version } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botstatus')
        .setDescription('Verifica o estado de saúde do bot e do AutoMod.'),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     */
    async execute(interaction) {
        const { guild, client, guildId } = interaction;

        // Acesso aos sistemas centralizados (Lookup em RAM)
        const { emojis, config, logger, status: statusSystem } = client.systems;
        const EMOJIS = emojis || {};

        try {
            // 1. Coleta de dados via System (Lógica isolada em src/systems/systemStatus.js)
            // Note: Chamada síncrona se o sistema usar cache ou propriedades do client
            const status = statusSystem.getBotStatus(client, guildId);
            
            if (!status) {
                return await interaction.editReply({ 
                    content: `${EMOJIS.ERRO || '❌'} Erro ao coletar dados do sistema. Verifique o ErrorLogger.`
                });
            }

            // 2. Construção da UI
            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.PAINEL || '🖥️'} Painel de Controle do Bot`)
                .setColor(0xDCA15E)
                .setThumbnail(client.user.displayAvatarURL())
                .addFields(
                    { 
                        name: `${EMOJIS.BOT || '🤖'} Status Global`, 
                        value: [
                            `**Servidores:** \`${status.totalGuilds}\``,
                            `**Usuários:** \`${status.totalUsers.toLocaleString('pt-BR')}\``,
                            `**Uptime:** \`${status.uptime}\``,
                            `**Latência:** \`${status.ping}ms\``
                        ].join('\n'), 
                        inline: true 
                    },
                    { 
                        name: `${EMOJIS.INFRA || '📦'} Hardware`, 
                        value: [
                            `**RAM:** \`${status.memory}\``,
                            `**Node:** \`${process.version}\``,
                            `**DJS:** \`v${version}\``
                        ].join('\n'), 
                        inline: true 
                    },
                    { 
                        name: `${EMOJIS.AUTO_MOD || '🛡️'} Contexto Local: ${guild.name}`, 
                        value: [
                            `**Próximo Ciclo:** <t:${status.nextAutoMod}:R>`,
                            `**Última Execução:** ${status.lastRun ? `<t:${status.lastRun}:f>` : '`Nenhum registro`'}`,
                            `**Logs:** ${status.logChannel !== "Não configurado" ? `<#${status.logChannel}>` : '`⚠️ Não definido`'}`,
                            `**Status:** \`🟢 Operacional\``
                        ].join('\n'), 
                        inline: false 
                    }
                )
                .setFooter({ 
                    text: config.getSetting(guildId, 'footer_text') || guild.name,
                    iconURL: guild.iconURL() 
                })
                .setTimestamp();

            // 3. Finalização (Contrato: Slash usa editReply)
            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            if (logger) logger.log('Command_BotStatus_Error', err);
            
            // SafeExecute: Resposta de erro padronizada
            await interaction.editReply({ 
                content: `${EMOJIS.ERRO || '❌'} Ocorreu um erro ao gerar o relatório de status.`
            }).catch(() => null);
        }
    }
};