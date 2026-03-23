const ConfigSystem = require('./configSystem');

/**
 * Especialista em processar interações do painel de configuração
 */
const ConfigHandler = {
    async handle(interaction, args) {
        // args[0] é o prefixo 'config', args[1] é a chave (staff_role, logs_channel, etc)
        const settingKey = args[1]; 
        const guildId = interaction.guild.id;

        // Pega o valor selecionado (seja de cargo ou canal)
        const selectedValue = interaction.values[0];

        try {
            // 1. Salva no Banco e RAM via ConfigSystem
            ConfigSystem.updateSetting(guildId, settingKey, selectedValue);

            // 2. Feedback visual
            const type = settingKey.includes('role') ? 'Cargo' : 'Canal';
            
            return await interaction.reply({ 
                content: `✅ **Configuração Salva:** O ${type} foi atualizado com sucesso no sistema.`, 
                ephemeral: true 
            });

        } catch (err) {
            console.error(`[Erro ConfigHandler]`, err);
            return await interaction.reply({ 
                content: `❌ Ocorreu um erro ao salvar a configuração.`, 
                ephemeral: true 
            });
        }
    }
};

module.exports = ConfigHandler;