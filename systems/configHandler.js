const { EmbedBuilder } = require('discord.js');
const ConfigSystem = require('./configSystem');
const { EMOJIS } = require('../database/emojis');

const ConfigHandler = {
    async handle(interaction, args) {
        const guildId = interaction.guild.id;
        // Monta a chave (Ex: staff_role) baseada no customID do menu
        const settingKey = `${args[1]}_${args[2]}`;
        const selectedValue = interaction.values[0];

        try {
            // 1. Salva a nova configuração no Banco e no Cache
            ConfigSystem.updateSetting(guildId, settingKey, selectedValue);

            // 2. Busca valores atualizados para remontar a Embed
            const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
            const logsChannelId = ConfigSystem.getSetting(guildId, 'logs_channel');

            const staffDisplay = staffRoleId ? `<@&${staffRoleId}>` : '❌ `Não configurado`';
            const logsDisplay = logsChannelId ? `<#${logsChannelId}>` : '❌ `Não configurado`';

            const updatedEmbed = new EmbedBuilder()
                .setTitle(`${EMOJIS.STAFF} Painel de Configuração`)
                .setDescription('✅ **Configuração atualizada com sucesso!**')
                .setColor(0x00FF00)
                .addFields(
                    { name: `${EMOJIS.STAFF} Cargo Staff`, value: staffDisplay, inline: true },
                    { name: `${EMOJIS.LOGS} Canal de Logs`, value: logsDisplay, inline: true }
                )
                .setFooter({ text: 'Você pode continuar alterando se desejar.' });

            // 3. Atualiza a mensagem original (remove o delay visual)
            await interaction.update({ embeds: [updatedEmbed] });

        } catch (err) {
            console.error(`[ConfigHandler Error]`, err.message);
            const errorMsg = { content: `❌ Erro ao salvar: ${err.message}`, ephemeral: true };
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMsg);
            } else {
                await interaction.reply(errorMsg);
            }
        }
    }
};

module.exports = ConfigHandler;