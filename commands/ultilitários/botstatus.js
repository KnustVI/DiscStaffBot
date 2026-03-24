const { SlashCommandBuilder, EmbedBuilder, version } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');
const ConfigSystem = require('../../systems/configSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Verifica o estado de saúde do bot e do AutoMod.'),

    async execute(interaction) {
        const { guild, client } = interaction;

        // Chamamos o System para pegar os dados processados
        const status = ConfigSystem.getBotStatus(client, guild.id);

        const lastRunText = status.lastRun 
            ? `<t:${Math.floor(new Date(status.lastRun).getTime() / 1000)}:f>` 
            : '`Nenhum registro recente`';

        const embed = new EmbedBuilder()
            .setTitle(`${EMOJIS.PAINEL || '🖥️'} Status do Sistema`)
            .setColor(0xc1ff72) // O verde que você escolheu
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
            .setFooter(ConfigSystem.getFooter(guild.name))
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};