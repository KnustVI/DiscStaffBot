// src/commands/reportchat/reportchat.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reportchat')
        .setDescription('🎫 Cria o painel de ReportChat')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const reportSystem = new (require('../../systems/reportChatSystem'))(client);
        const panel = reportSystem.getPanel(interaction.guild.name);
        await interaction.channel.send(panel);
        await interaction.reply({ content: '✅ Painel criado!', ephemeral: true });
    }
};