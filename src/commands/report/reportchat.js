// src/commands/reportchat/reportchat.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ResponseManager = require('../../utils/responseManager');
const ReportChatFormatter = require('../../utils/reportChatFormatter');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reportchat')
        .setDescription('🎫 Cria o painel de ReportChat')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const { guild, member } = interaction;
        
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem criar o painel.');
        }

        const panel = ReportChatFormatter.createMainPanel(guild.name);
        await interaction.channel.send(panel);
        await ResponseManager.success(interaction, 'Painel de ReportChat criado!');
    }
};