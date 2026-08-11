// /home/ubuntu/DiscStaffBot/src/commands/report/reportchat.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ReportChatSystem = require('../../systems/moderation/reportChatSystem');
const ConfigSystem = require('../../systems/core/configSystem');

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
        const panel = await reportSystem.getPanel(interaction.guild.name, interaction.guild.iconURL(), interaction.guild.id);
        
        // Enviar o painel no canal (fora da interação)
        await interaction.channel.send(panel);

        // Guarda ONDE o painel foi publicado (pedido do dono, 2026-08-11:
        // "no comando ajuda para usuários... consegue linkar o canal que
        // esta configurado para atender reportes?") — antes /reportchat
        // não deixava rastro nenhum de qual canal recebeu o painel, então
        // não tinha como /ajuda apontar pra lá. Sobrescreve se o comando
        // for rodado de novo em outro canal (o painel "atual" passa a ser
        // este).
        ConfigSystem.setSetting(interaction.guild.id, 'report_panel_channel_id', interaction.channel.id);

        // Responder a interação com confirmação (usando editReply porque já está deferido)
        await interaction.editReply({ 
            content: `${emojis.circlecheck || '✅'} Painel de ReportChat criado!`,
            components: []
        });
    }
};