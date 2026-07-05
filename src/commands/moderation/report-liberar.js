// src/commands/moderation/report-liberar.js
/**
 * Válvula de segurança manual pro report-chat — libera um report/revisão
 * travado (thread apagada sem o evento pegar, painel quebrado, etc.) mesmo
 * que o fechamento normal não funcione. Disponível pra qualquer staff
 * (Moderar Membros), não é feature premium — proteção operacional básica.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ReportChatSystem = require('../../systems/moderation/reportChatSystem');
const ResponseManager = require('../../utils/responseManager');
const db = require('../../database/index');

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('report-liberar')
        .setDescription('Libera manualmente um report/revisão travado (thread apagada, painel com erro, etc.)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addIntegerOption(opt => opt.setName('numero')
            .setDescription('Número do report (ex: 15 para #R15)')
            .setRequired(true)),

    async execute(interaction, client) {
        const { guild, user, options } = interaction;
        const reportNumber = options.getInteger('numero');

        const reportSystem = new ReportChatSystem(client);
        const result = reportSystem.forceReleaseReport(guild.id, reportNumber, user.id);

        if (!result.success) {
            const messages = {
                NOT_FOUND: `Report #R${reportNumber} não encontrado.`,
                ALREADY_CLOSED: `Report #R${reportNumber} já está fechado.`,
            };
            return await ResponseManager.error(interaction, messages[result.error] || 'Não foi possível liberar o report.');
        }

        db.logActivity(guild.id, user.id, 'report_force_released', null, { reportNumber });

        await ResponseManager.success(interaction, `${EMOJIS.circlecheck || '✅'} Report #R${reportNumber} liberado.`);
    },
};
