const ConfigSystem = require('./configSystem');

const ConfigHandler = {
    async handle(interaction, args) {
        const guildId = interaction.guild.id;
        // O customId é 'config_staff_role' -> args[1] = 'staff', args[2] = 'role'
        const settingKey = `${args[1]}_${args[2]}`; 

        try {
            // 1. Captura o valor independente do tipo de menu
            let selectedValue;
            
            if (interaction.isRoleSelectMenu()) {
                selectedValue = interaction.values[0]; // ID do Cargo
            } else if (interaction.isChannelSelectMenu()) {
                selectedValue = interaction.values[0]; // ID do Canal
            } else {
                selectedValue = interaction.values[0]; // Fallback para StringSelect
            }

            if (!selectedValue) {
                return await interaction.reply({ content: '❌ Nenhum valor selecionado.', ephemeral: true });
            }

            // 2. Salva no Banco e RAM
            ConfigSystem.updateSetting(guildId, settingKey, selectedValue);

            // 3. Feedback visual
            const traducao = {
                'staff_role': 'Cargo de Staff',
                'logs_channel': 'Canal de Logs'
            };

            return await interaction.reply({ 
                content: `✅ **Configuração Salva:** \`${traducao[settingKey] || settingKey}\` atualizado com sucesso!`, 
                ephemeral: true 
            });

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