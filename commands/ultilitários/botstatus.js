const { SlashCommandBuilder, EmbedBuilder, version } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');
const SystemStatus = require('../../systems/systemStatus'); 
const ConfigSystem = require('../../systems/configSystem'); 

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bot.status')
        .setDescription('Verifica o estado de saúde do bot e do AutoMod.'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const { guild, client } = interaction;

        try {
            const status = ystemStatus.getBotStatus(client, guild.id);
            if (!status) throw new Error("Falha ao recuperar dados.");

            const lastRunDate = status.lastRun ? new Date(status.lastRun) : null;
            const lastRunText = (lastRunDate && !isNaN(lastRunDate)) 
                ? `<t:${Math.floor(lastRunDate.getTime() / 1000)}:f>` 
                : 'Nenhum registro recente';

            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.PAINEL || '🖥️'} Status do Sistema`)
                .setColor(0xba0054)
                .setThumbnail(client.user.displayAvatarURL())
                .addFields(
                    { 
                        name: `${EMOJIS.BOT || '🤖'} Bot Info`, 
                        // Removidas as crases para tirar o fundo cinza/preto
                        value: [
                            `**Uptime:** ${status.uptime}`,
                            `**Latência:** ${status.ping}ms`,
                            `**Versão:** v${version}`
                        ].join('\n'), 
                        inline: false 
                    },
                    { 
                        name: `${EMOJIS.AUTO_MOD || '🛡️'} AutoModeration`, 
                        value: [
                            `**Próximo Ponto (+1):** <t:${status.nextAutoMod}:R>`,
                            `**Última Execução:** ${lastRunText}`,
                            `**Canal de Logs:** ${status.lastChannel ? `<#${status.lastChannel}>` : 'Não definido'}`,
                            `**Status:** Operacional (12:00)`
                        ].join('\n'), 
                        inline: false 
                    },
                    {
                        name: `${EMOJIS.INFRA || '📦'} Infraestrutura`,
                        value: `**VPS:** Oracle Cloud | **RAM:** ${status.memory} MB`,
                        inline: false
                    }
                )
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            await interaction.editReply({ content: "❌ Erro ao processar os dados do sistema." });
        }
    }
};