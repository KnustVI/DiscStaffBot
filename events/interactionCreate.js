module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        // 1. Slash Commands
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) return;
            try { 
                await command.execute(interaction); 
            } catch (e) { 
                console.error(`[Erro Comando: ${interaction.commandName}]`, e); 
            }
        }

        // 2. Componentes (Botões e Menus) - Lógica Global Otimizada
        if (interaction.isButton() || interaction.isStringSelectMenu()) {
            const args = interaction.customId.split('_');
            const prefix = args[0]; // Primeiro termo: 'hist' ou 'config'

            // --- SISTEMA DE HISTÓRICO ---
            if (prefix === 'hist') {
                const targetId = args[1];
                const page = parseInt(args[2]);
                
                // Importa apenas quando necessário (ajuda na RAM)
                const PunishmentSystem = require('../systems/punishment/punishmentSystem');
                const histCommand = interaction.client.commands.get('historico');

                try {
                    const history = await PunishmentSystem.getUserHistory(interaction.guild.id, targetId, page);
                    const targetUser = await interaction.client.users.fetch(targetId);

                    // ATENÇÃO: Os nomes aqui devem ser IGUAIS aos do comando /historico
                    const embed = histCommand.generateHistoryEmbed(interaction.guild.id, targetUser, history, page);
                    const buttons = histCommand.generateHistoryButtons(targetId, page, history.totalPages);

                    await interaction.update({ embeds: [embed], components: [buttons] });
                } catch (err) {
                    console.error("[Erro Histórico Global]", err);
                }
            }

            // --- SISTEMA DE CONFIGURAÇÃO ---
            if (prefix === 'config') {
                const action = args[1];
                const extra = args[2];
                
                try {
                    const configSystem = require('../systems/config/updateSetting');
                    await configSystem.handle(interaction, action, extra);
                } catch (err) {
                    console.error("[Erro Config Global]", err);
                }
            }
        }
    }
};