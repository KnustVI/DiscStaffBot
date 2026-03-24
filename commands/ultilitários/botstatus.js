const { SlashCommandBuilder, EmbedBuilder, version } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');

// Importamos os dois separadamente agora:
const SystemStatus = require('../../systems/systemStatus'); 
const ConfigSystem = require('../../systems/configSystem'); 

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Verifica o estado de saúde do bot e do AutoMod.'),

    async execute(interaction) {
        // 1. DeferReply imediato para garantir que o Discord não dê timeout
        await interaction.deferReply({ ephemeral: true });

        const { guild, client } = interaction;

        try {
            // 2. Coleta os dados técnicos do sistema de Status
            const status = SystemStatus.getBotStatus(client, guild.id);

            if (!status) throw new Error("Falha ao recuperar dados do SystemStatus.");

            const lastRunText = status.lastRun 
                ? `<t:${Math.floor(new Date(status.lastRun).getTime() / 1000)}:f>` 
                : '`Nenhum registro recente`';

            // 3. Montagem da Embed usando o ConfigSystem para o Footer
            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.PAINEL || '🖥️'} Status do Sistema`)
                .setColor(0xc1ff72)
                .setThumbnail(client.user.displayAvatarURL())
                .addFields(
                    { 
                        name: `${EMOJIS.BOT || '🤖'} Bot Info`, 
                        value: [
                            `- **Uptime:** \`${status.uptime}\``,
                            `- **Latência:** \`${status.ping}ms\``,
                            `- **Versão:** \`v${version}\``
                        ].join('\n'), 
                        inline: false 
                    },
                    { 
                        name: `${EMOJIS.AUTO_MOD || '🛡️'} AutoModeration`, 
                        value: [
                            `- **Próximo Ponto (+1):** <t:${status.nextAutoMod}:R>`,
                            `- **Última Execução:** ${lastRunText}`,
                            `- **Canal de Logs:** ${status.lastChannel ? `<#${status.lastChannel}>` : '`Não definido`'}`,
                            `- **Status:** \`Operacional (12:00)\``
                        ].join('\n'), 
                        inline: false 
                    },
                    {
                        name: `${EMOJIS.INFRA || '📦'} Infraestrutura`,
                        value: `**VPS:** \`Oracle Cloud\` | **RAM:** \`${status.memory} MB\``,
                        inline: false
                    }
                )
                // Usando o sistema de configuração para pegar o rodapé padrão
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error("Erro no comando Status:", err);
            await interaction.editReply({ content: "❌ Erro ao processar os dados do sistema. Verifique o console da Oracle." });
        }
    }
};