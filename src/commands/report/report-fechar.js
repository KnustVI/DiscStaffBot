// src/commands/report/report-fechar.js
/**
 * Fecha um report/revisão de punição por comando — alternativa aos botões
 * "Fechar"/"Fechar com Motivo" do painel de logs (pedido do dono,
 * 2026-08-09: "houve um painel que os botões pararam de funcionar, logo
 * não permitiu fechar o report... adicione um slash comando para fechar o
 * report"). Reaproveita ReportChatSystem.closeReport (mesma função que os
 * botões chamam) — motivo/punicao são opcionais: sem motivo, fecha "sem
 * motivo" (igual ao botão "Fechar"); com motivo, fecha "com motivo" (igual
 * ao modal do botão "Fechar com Motivo").
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ConfigSystem = require('../../systems/core/configSystem');
const ResponseManager = require('../../utils/responseManager');
const ReportChatSystem = require('../../systems/moderation/reportChatSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('report-fechar')
        .setDescription('Fecha um report/revisão de punição — alternativa aos botões do painel de logs.')
        .addIntegerOption(opt => opt.setName('numero').setDescription('Número do report a fechar (o N em "Report #REPn").').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do fechamento (opcional — sem isso, fecha sem motivo).').setRequired(false))
        .addStringOption(opt => opt.setName('punicao').setDescription('Punição aplicada, se houver (só considerado se "motivo" for informado).').setRequired(false))
        // null, não ModerateMembers — mesmo raciocínio do /strike (ver
        // comentário completo em strike/index.js). Checagem real já dentro
        // de execute().
        .setDefaultMemberPermissions(null),

    async execute(interaction, client) {
        const { guild, member, options } = interaction;

        if (!ConfigSystem.memberHasModOrSupervisorRole(guild.id, member) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await ResponseManager.error(interaction, 'Este comando é restrito à equipe do servidor (cargo Moderador ou Supervisor, ver /config roles) ou a Administradores.');
        }

        const reportNumber = options.getInteger('numero');
        const motivo = options.getString('motivo');
        const punicao = options.getString('punicao');

        const report = db.prepare(`SELECT status FROM reports WHERE guild_id = ? AND report_number = ?`).get(guild.id, reportNumber);
        if (!report) {
            return await ResponseManager.error(interaction, `Report #REP${reportNumber} não encontrado neste servidor.`);
        }
        if (report.status === 'closed_no_reason' || report.status === 'closed_with_reason') {
            return await ResponseManager.error(interaction, `Report #REP${reportNumber} já está fechado.`);
        }

        const reportSystem = new ReportChatSystem(client);
        await reportSystem.closeReport(interaction, reportNumber, motivo, punicao, Boolean(motivo), guild.id);
    },
};
