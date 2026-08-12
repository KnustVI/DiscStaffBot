// /home/ubuntu/DiscStaffBot/src/commands/report/reportchat.js
const { SlashCommandBuilder } = require('discord.js');
const ReportChatSystem = require('../../systems/moderation/reportChatSystem');
const ResponseManager = require('../../utils/responseManager');
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
        // null, não Administrator — mesmo raciocínio do /strike (ver
        // comentário completo em strike/index.js). Checagem real já dentro
        // de execute() (nunca tinha uma antes — o comando dependia SÓ do
        // default nativo do Discord, que bloqueava até quem tem o cargo
        // Administrativo do Dashboard sem Administrator de verdade).
        .setDefaultMemberPermissions(null),

    async execute(interaction, client) {
        if (!ConfigSystem.memberIsGuildAdmin(interaction.guild.id, interaction.member)) {
            return await ResponseManager.error(interaction, 'Este comando é restrito a Administradores (ou ao cargo Administrativo do Dashboard, ver /config geral do servidor).');
        }

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