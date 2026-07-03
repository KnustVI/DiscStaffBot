// /home/ubuntu/DiscStaffBot/src/commands/report/reportchat.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ReportChatSystem = require('../../systems/moderation/reportChatSystem');

let emojis = {};
try {
    emojis = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    emojis = {};
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reportchat')
        .setDescription('🎫 Cria o painel de ReportChat')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        
        const reportSystem = new ReportChatSystem(client);
        const panel = reportSystem.getPanel(interaction.guild.name, interaction.guild.iconURL());
        
        // Enviar o painel no canal (fora da interação)
        await interaction.channel.send(panel);
        
        // Responder a interação com confirmação (usando editReply porque já está deferido)
        await interaction.editReply({ 
            content: `${emojis.circlecheck || '✅'} Painel de ReportChat criado!`,
            components: []
        });
    }
};