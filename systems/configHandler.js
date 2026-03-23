const ConfigSystem = require('./configSystem');

const ConfigHandler = {
    async handle(interaction, args) {
        try {
            const guildId = interaction.guild.id;
            const settingKey = `${args[1]}_${args[2]}`;
            const selectedValue = interaction.values[0];

            console.log(`[DEBUG] Tentando salvar: Guild: ${guildId}, Key: ${settingKey}, Val: ${selectedValue}`);

            // Executa a gravação
            ConfigSystem.updateSetting(guildId, settingKey, selectedValue);

            return await interaction.reply({ 
                content: `✅ **Configuração Salva:** \`${settingKey}\` atualizado!`, 
                ephemeral: true 
            });

        } catch (err) {
            // ISSO AQUI vai te dizer exatamente o que o SQLite respondeu no terminal:
            console.error(`🔴 ERRO CRÍTICO NO CONFIG_HANDLER:`, err.message);
            
            const msg = { content: `❌ Erro: ${err.message}`, ephemeral: true };
            interaction.replied || interaction.deferred ? await interaction.followUp(msg) : await interaction.reply(msg);
        }
    }
};

module.exports = ConfigHandler;