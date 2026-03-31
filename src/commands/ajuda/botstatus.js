const { SlashCommandBuilder, EmbedBuilder, version, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botstatus')
        .setDescription('Verifica o estado de saúde do bot e do AutoMod.'),

    async execute(interaction) {
        // O deferReply deve ser usado se o comando demorar, 
        // mas como as infos de OS são rápidas, usamos reply direto com flags.
        const { guild, client, guildId } = interaction;

        // Acesso aos sistemas centralizados no client
        const EMOJIS = client.systems.emojis || {};
        const ConfigSystem = client.systems.config;

        try {
            // CORREÇÃO: Passando o client e guildId para a função estática
            const status = client.systems.status.getBotStatus(client, guildId);
            
            if (!status) {
                return interaction.reply({ 
                    content: "⚠️ Erro ao coletar dados do sistema. Verifique o ErrorLogger.",
                    flags: [MessageFlags.Ephemeral]
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
                .setFooter(ConfigSystem.getFooter ? ConfigSystem.getFooter(guild.name) : { text: guild.name })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

        } catch (err) {
            if (client.systems.logger) client.systems.logger.log('Command_BotStatus_Error', err);
            console.error("❌ Erro no comando botstatus:", err);
            
            await interaction.reply({ 
                content: "❌ Ocorreu um erro ao gerar o relatório de status.",
                flags: [MessageFlags.Ephemeral]
            });
        }
    }
};