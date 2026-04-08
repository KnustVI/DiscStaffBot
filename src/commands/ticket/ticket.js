// src/commands/ticket/ticket.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ResponseManager = require('../../utils/responseManager');
const TicketFormatter = require('../../utils/ticketFormatter');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('🎫 Cria o painel de tickets')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const { guild, member } = interaction;
        
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem criar o painel.');
        }

        const panel = TicketFormatter.createPanelEmbed(guild.name);
        
        // Enviar o painel no canal (não como resposta do comando)
        await interaction.channel.send(panel);
        
        // Responder o comando como ephemeral
        await ResponseManager.success(interaction, 'Painel de tickets criado!');
    }
};