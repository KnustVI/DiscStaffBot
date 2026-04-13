// src/commands/report/reportchat.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ReportChatSystem = require('../../systems/reportChatSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reportchat')
        .setDescription('🎫 Cria o painel de ReportChat')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        // NÃO usar deferReply aqui! Já foi deferido no interactionCreate.js
        // Use editReply em vez de reply
        
        try {
            const reportSystem = new ReportChatSystem(client);
            const panel = reportSystem.getPanel(interaction.guild.name);
            await interaction.channel.send(panel);
            
            // Usar editReply porque já está deferido
            await interaction.editReply({ content: '✅ Painel de ReportChat criado com sucesso!' });
            
        } catch (error) {
            console.error('❌ Erro no comando reportchat:', error);
            await interaction.editReply({ content: '❌ Erro ao criar o painel. Verifique as configurações.' });
        }
    }
};