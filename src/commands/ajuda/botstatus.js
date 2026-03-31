const { SlashCommandBuilder, EmbedBuilder, version } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botstatus')
        .setDescription('Verifica o estado de saúde do bot e do AutoMod.'),

    async execute(interaction) {
        const { guild, client } = interaction;

        // Ponto 2: Acesso rápido aos sistemas
        const EMOJIS = client.systems.emojis || {};
        const SystemStatus = client.systems.status; // Referência à CLASSE
        const ConfigSystem = client.systems.config;

        try {
            // AJUSTE AQUI: Como o método é STATIC, chamamos direto da Classe
            // Ponto 6: Sem await, pois o processamento de OS/Date é instantâneo
            const status = interaction.client.systems.status.getBotStatus();
            
            if (!status) {
                return interaction.editReply({ 
                    content: "⚠️ Erro ao coletar dados do sistema. Verifique o ErrorLogger." 
                });
            }

            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.PAINEL || '🖥️'} Painel de Controle do Bot`)
                .setColor(0xDCA15E)
                .setThumbnail(client.user.displayAvatarURL())
                .addFields(
                    { 
                        name: `${EMOJIS.BOT || '🤖'} Status Global (Alcance)`, 
                        value: [
                            `**Servidores:** \`${status.totalGuilds}\``,
                            `**Usuários Totais:** \`${status.totalUsers.toLocaleString('pt-BR')}\``,
                            `**Uptime:** \`${status.uptime}\``,
                            `**Latência:** \`${status.ping}\``
                        ].join('\n'), 
                        inline: false 
                    },
                    { 
                        name: `${EMOJIS.AUTO_MOD || '🛡️'} Contexto de ${guild.name}`, 
                        value: [
                            `**Próximo Ciclo (+1 pt):** <t:${status.nextAutoMod}:R>`,
                            `**Última Execução:** ${status.lastRun ? `<t:${status.lastRun}:f>` : '`Nenhum registro`'}`,
                            `**Canal de Logs:** ${status.logChannel !== "Não configurado" ? `<#${status.logChannel}>` : '`⚠️ Não definido`'}`,
                            `**Status local:** \`🟢 Operacional\``
                        ].join('\n'), 
                        inline: false 
                    },
                    {
                        name: `${EMOJIS.INFRA || '📦'} Hardware & Engine`,
                        value: `**RAM em Uso:** \`${status.memory}\` | **DJS:** \`v${version}\` | **Node:** \`${process.version}\``,
                        inline: false
                    }
                )
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            if (client.systems.logger) client.systems.logger.log('Command_BotStatus_Error', err);
            console.error("❌ Erro no comando botstatus:", err);
            
            await interaction.editReply({ 
                content: "❌ Ocorreu um erro ao gerar o relatório de status." 
            });
        }
    }
};