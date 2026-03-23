const { EmbedBuilder } = require('discord.js');
const ConfigSystem = require('../systems/configSystem'); // Verifique se o caminho está correto
const { EMOJIS } = require('../database/emojis');
const ErrorLogger = require('../systems/errorLogger');

const ConfigHandler = {
    async handle(interaction, args) {
        const guildId = interaction.guild.id;
        const guildName = interaction.guild.name; // <--- Definimos aqui para facilitar
        
        // Monta a chave (Ex: staff_role) baseada no customID do menu
        const settingKey = `${args[1]}_${args[2]}`;
        const selectedValue = interaction.values[0];

        try {
            // 1. Salva a nova configuração no Banco e no Cache
            ConfigSystem.updateSetting(guildId, settingKey, selectedValue);

            // 2. Busca valores atualizados para remontar a Embed
            const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
            const logsChannelId = ConfigSystem.getSetting(guildId, 'logs_channel');

            const staffDisplay = staffRoleId ? `<@&${staffRoleId}>` : `${EMOJIS.ERRO || '❌'} \`Não configurado\``;
            const logsDisplay = logsChannelId ? `<#${logsChannelId}>` : `${EMOJIS.ERRO || '❌'} \`Não configurado\``;

            const updatedEmbed = new EmbedBuilder()
                .setDescription(`# ${EMOJIS.CONFIG || '⚙️'} Painel de Configuração \n`+
                    `> **Configuração atualizada com sucesso!**\n\n
                    ${EMOJIS.REPUTATION || '📊'} Verifique os novos valores abaixo:`)
                .setColor(0xba0054)
                .addFields(
                    { name: `${EMOJIS.STAFF || '👤'} Cargo Staff`, value: staffDisplay, inline: true },
                    { name: `${EMOJIS.TICKET || '📁'} Canal de Logs`, value: logsDisplay, inline: true }
                )
                .setFooter(ConfigSystem.getFooter(interaction.guild.name))
                .setTimestamp();

            // 3. Atualiza a mensagem original
            await interaction.update({ embeds: [updatedEmbed], components: interaction.message.components });

        } catch (err) {
            ErrorLogger.log('ConfigHandler', err);
            
            const errorMsg = { content: `${EMOJIS.ERRO || '❌'} Ocorreu um erro ao salvar a configuração no banco.`, ephemeral: true };
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMsg);
            } else {
                await interaction.reply(errorMsg);
            }
        }
    }
};

module.exports = ConfigHandler;