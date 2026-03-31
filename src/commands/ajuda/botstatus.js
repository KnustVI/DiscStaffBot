const { SlashCommandBuilder, EmbedBuilder, version } = require('discord.js');

module.exports = {
    // Mantive botstatus para seguir o padrão do /ajuda, altere se necessário
    data: new SlashCommandBuilder()
        .setName('botstatus')
        .setDescription('Verifica o estado de saúde do bot e do AutoMod.'),

    async execute(interaction) {
        const { guild, client } = interaction;

        // Problema 2: Acessando sistemas pré-carregados no index.js
        const EMOJIS = client.systems.emojis || {};
        const SystemStatus = client.systems.status; // Certifique-se de carregar systemStatus no index
        const ConfigSystem = client.systems.config;

        try {
            // Problema 6: Removendo await desnecessário se getBotStatus for síncrono
            const status = SystemStatus.getBotStatus(client, guild.id);
            
            if (!status) {
                return interaction.editReply({ 
                    content: "⚠️ Erro ao coletar dados do sistema. Tente novamente." 
                });
            }

            // Criação do Painel Visual (Mantendo sua formatação original)
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
                            `**Latência:** \`${status.ping}${typeof status.ping === 'number' ? 'ms' : ''}\``
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
                        value: `**VPS:** Oracle Cloud | **RAM:** \`${status.memory}\` | **DJS:** \`v${version}\``,
                        inline: false
                    }
                )
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();

            // Usamos editReply pois o interactionCreate já deu o deferReply
            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error("❌ Erro fatal no comando botstatus:", err);
            
            // Logando o erro no nosso sistema de logs
            if (client.systems.logger) {
                client.systems.logger.log('Command_BotStatus', err);
            }

            await interaction.editReply({ 
                content: "❌ Ocorreu um erro crítico ao gerar o relatório. Verifique o console da Oracle Cloud." 
            });
        }
    }
};