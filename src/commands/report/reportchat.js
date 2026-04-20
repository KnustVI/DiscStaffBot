// src/commands/report/reportchat.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ReportChatSystem = require('../../systems/reportChatSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reportchat')
        .setDescription('🎫 Cria o painel de ReportChat')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const reportSystem = new ReportChatSystem(client);
        const panel = reportSystem.getPanel(interaction.guild.name);
        await interaction.channel.send(panel);
        await interaction.reply({ content: '✅ Painel de ReportChat criado!', ephemeral: true });
    }
};