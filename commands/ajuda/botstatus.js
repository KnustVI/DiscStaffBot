const { SlashCommandBuilder, EmbedBuilder, version } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');
const SystemStatus = require('../../systems/systemStatus'); 
const ConfigSystem = require('../../systems/configSystem'); 

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bot-status')
        .setDescription('Verifica o estado de saúde do bot e do AutoMod.'),

    async execute(interaction) {
        const { guild, client } = interaction;

        try {
            // Pede os dados para o analista (SystemStatus)
            const status = SystemStatus.getBotStatus(client, guild.id);
            
            if (!status) {
                return interaction.editReply({ content: "⚠️ Erro ao coletar dados do sistema. Tente novamente." });
            }

            // Criação do Painel Visual
            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.PAINEL || '🖥️'} Painel de Controle do Bot`)
                .setColor(0xBA0054) // Cor Vinho/Rosa forte
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
                // footerData puxa o footer padrão que configuramos com seu nome (KnustVI)
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error("❌ Erro fatal no comando bot-status:", err);
            await interaction.editReply({ 
                content: "❌ Ocorreu um erro crítico ao gerar o relatório. Verifique o console da Oracle Cloud." 
            });
        }
    }
};