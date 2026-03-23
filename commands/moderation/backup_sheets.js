const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { exportToSheets } = require('../../systems/sheetsService');
const { EMOJIS } = require('../../database/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('backup_sheets')
        .setDescription('Sincroniza o histórico completo do servidor com o Google Sheets.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        // Responde como efêmero para não poluir o chat e garantir privacidade
        await interaction.deferReply({ ephemeral: true });

        try {
            // Executa a função de exportação
            await exportToSheets(guildId);

            await interaction.editReply({ 
                content: `${EMOJIS.CHECK} **Sincronização concluída!** O histórico de punições foi enviado para a sua planilha do Google.` 
            });

        } catch (error) {
            console.error("Erro no backup_sheets:", error);

            if (error.message === "Sem dados para exportar.") {
                return interaction.editReply(`${EMOJIS.AVISO} Não há nenhuma punição registrada para exportar.`);
            }

            await interaction.editReply({ 
                content: `${EMOJIS.ERRO} Falha na sincronização. Verifique se o Bot tem permissão de **Editor** na planilha e se o ID está correto.` 
            });
        }
    }
};