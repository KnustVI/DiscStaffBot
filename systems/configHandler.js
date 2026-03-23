const ConfigSystem = require('./configSystem');

const ConfigHandler = {
    async handle(interaction, args) {
        const guildId = interaction.guild.id;
        // O customId é 'config_staff_role' -> args[1] = 'staff', args[2] = 'role'
        const settingKey = `${args[1]}_${args[2]}`; 

        try {
            // 1. Gera a nova visualização (mesma lógica do comando /config)
            const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
            const logsChannelId = ConfigSystem.getSetting(guildId, 'logs_channel');

            const staffDisplay = staffRoleId ? `<@&${staffRoleId}>` : '❌ `Não configurado`';
            const logsDisplay = logsChannelId ? `<#${logsChannelId}>` : '❌ `Não configurado`';

            const newEmbed = new EmbedBuilder()
                .setTitle(`${EMOJIS.STAFF} Painel de Configuração`)
                .setDescription('✅ **Configuração atualizada com sucesso!**')
                .setColor(0x00FF00)
                .addFields(
                    { name: '🛡️ Cargo Staff', value: staffDisplay, inline: true },
                    { name: '📜 Canal de Logs', value: logsDisplay, inline: true }
                );

            // 2. Edita a mensagem original para mostrar o novo valor selecionado
            return await interaction.update({ embeds: [newEmbed] });

        } catch (err) {
            console.error(`[Erro ConfigHandler]`, err);
            
            // Verifica se já respondeu para não dar erro de "Interaction already replenished"
            const errorMsg = { content: `❌ Ocorreu um erro ao salvar a configuração.`, ephemeral: true };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMsg);
            } else {
                await interaction.reply(errorMsg);
            }
        }
    }
};

module.exports = ConfigHandler;