// /home/ubuntu/DiscStaffBot/src/commands/developer/reset-reports.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

const DEVELOPER_ID = '203676076189286412';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-reports')
        .setDescription('⚠️ LIMPEZA: Apaga todos os dados de reports (ReportChat) de um servidor e reinicia a contagem.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt =>
            opt.setName('servidor_id')
                .setDescription('ID do servidor Discord a limpar')
                .setRequired(true))
        .addStringOption(opt =>
            opt.setName('confirmar')
                .setDescription('Digite "LIMPAR REPORTS" para confirmar')
                .setRequired(true)),

    // client aqui é sempre o bot PRINCIPAL (já em todo servidor de cliente),
    // não o bot developer que recebeu a interação — ver src/systems/core/
    // devBot.js. interaction.guild não existe (o comando roda no servidor
    // privado do dono, não no servidor alvo), por isso o alvo vem inteiro do
    // parâmetro servidor_id, resolvido via client.guilds.
    async execute(interaction, client) {
        const startTime = Date.now();
        const { user, options } = interaction;
        const guildId = options.getString('servidor_id');
        const confirmacao = options.getString('confirmar');

        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }

        if (user.id !== DEVELOPER_ID) {
            db.logActivity(guildId, user.id, 'reset_reports_denied', null, {
                command: 'reset-reports',
                reason: 'Usuário não autorizado'
            });

            const deniedBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });
            deniedBuilder.text('# ACESSO NEGADO');
            deniedBuilder.text('Este comando é restrito ao desenvolvedor do bot.');
            deniedBuilder.footer('Bot de Developer');

            const { components, flags } = deniedBuilder.build();
            await interaction.editReply({
                components,
                flags: [flags]
            });
            return;
        }

        const targetGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (!targetGuild) {
            const errBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });
            errBuilder.text(`${emojis.circlealert || '❌'} O bot principal não está no servidor \`${guildId}\` (ou o ID está errado).`);
            errBuilder.footer('Bot de Developer');
            const { components, flags } = errBuilder.build();
            await interaction.editReply({ components, flags: [flags] });
            return;
        }

        if (confirmacao !== 'LIMPAR REPORTS') {
            const cancelBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
            cancelBuilder.section(
                [
                    '# AÇÃO CANCELADA',
                    `Digite exatamente **"LIMPAR REPORTS"** para confirmar.\n\n**Você digitou:** \`${confirmacao}\``,
                ].join('\n'),
                AdvancedContainerBuilder.thumbnail(targetGuild.iconURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png')
            );
            cancelBuilder.footer(targetGuild.name);

            const { components, flags } = cancelBuilder.build();
            await interaction.editReply({
                components,
                flags: [flags]
            });
            return;
        }

        try {
            const statsBefore = {
                reports: db.prepare(`SELECT COUNT(*) as count FROM reports WHERE guild_id = ?`).get(guildId)?.count || 0,
                openReports: db.prepare(`SELECT COUNT(*) as count FROM reports WHERE guild_id = ? AND status NOT LIKE 'closed%'`).get(guildId)?.count || 0,
                closedReports: db.prepare(`SELECT COUNT(*) as count FROM reports WHERE guild_id = ? AND status LIKE 'closed%'`).get(guildId)?.count || 0
            };

            const openReports = db.prepare(`SELECT thread_id FROM reports WHERE guild_id = ? AND status NOT LIKE 'closed%'`).all(guildId);
            for (const report of openReports) {
                if (report.thread_id) {
                    try {
                        const thread = await targetGuild.channels.fetch(report.thread_id).catch(() => null);
                        if (thread) {
                            await thread.setLocked(true);
                            await thread.setArchived(true);
                        }
                    } catch (err) {}
                }
            }

            try {
                db.prepare(`DELETE FROM report_messages WHERE guild_id = ?`).run(guildId);
            } catch (err) {
                console.log('⚠️ Tabela report_messages não existe ou erro:', err.message);
            }

            db.prepare(`DELETE FROM reports WHERE guild_id = ?`).run(guildId);

            try {
                db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'reports'`).run();
            } catch (err) {}

            try {
                const SequenceManager = require('../../database/sequences');
                SequenceManager.resetAllSequences(guildId);
            } catch (err) {}

            const resetUuid = db.generateUUID();
            db.logActivity(guildId, user.id, 'reset_reports', null, {
                command: 'reset-reports',
                resetUuid,
                statsBefore,
                responseTime: Date.now() - startTime
            });

            const ConfigSystem = require('../../systems/core/configSystem');
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_reports');
            if (logChannelId) {
                try {
                    const logChannel = await targetGuild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const alertBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });
                        alertBuilder.section(
                            [
                                '# REPORTS RESETADOS',
                                `**Desenvolvedor:** ${user.tag}`,
                                `**Servidor:** ${targetGuild.name}`,
                            ].join('\n'),
                            AdvancedContainerBuilder.thumbnail(targetGuild.iconURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png')
                        );
                        alertBuilder.separator();
                        alertBuilder.text(`**Reports removidos:**`);
                        alertBuilder.text(`- Total: \`${statsBefore.reports}\``);
                        alertBuilder.text(`- Abertos: \`${statsBefore.openReports}\``);
                        alertBuilder.text(`- Fechados: \`${statsBefore.closedReports}\``);
                        alertBuilder.footer(targetGuild.name);

                        const { components, flags } = alertBuilder.build();
                        await logChannel.send({
                            components,
                            flags: [flags]
                        });
                    }
                } catch (err) {}
            }

            const successBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });
            successBuilder.section(
                [
                    '# REPORTS RESETADOS',
                    `Operação concluída com sucesso em **${targetGuild.name}**.`,
                ].join('\n'),
                AdvancedContainerBuilder.thumbnail(targetGuild.iconURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png')
            );
            successBuilder.separator();
            successBuilder.text(`**Registros removidos:**`);
            successBuilder.text(`- Total: \`${statsBefore.reports}\``);
            successBuilder.text(`- Abertos: \`${statsBefore.openReports}\``);
            successBuilder.text(`- Fechados: \`${statsBefore.closedReports}\``);
            successBuilder.separator();
            successBuilder.text(`**Contagem reiniciada:** O próximo report será **#R1**`);
            successBuilder.footer(targetGuild.name, `UUID: ${resetUuid.slice(0, 8)}`);

            const { components, flags } = successBuilder.build();
            await interaction.editReply({
                components,
                flags: [flags]
            });

            console.log(`📊 [RESET-REPORTS] ${user.tag} resetou reports de ${targetGuild.name} | ${statsBefore.reports} removidos`);

        } catch (error) {
            console.error('❌ Erro no reset-reports:', error);

            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');

            const errorBuilder = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR });
            errorBuilder.section(
                [
                    '# ERRO AO RESETAR',
                    `Ocorreu um erro ao resetar os reports.\n\n**Código:** \`${error.message?.slice(0, 100) || 'Desconhecido'}\``,
                ].join('\n'),
                AdvancedContainerBuilder.thumbnail(targetGuild.iconURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png')
            );
            errorBuilder.footer(targetGuild.name);

            const { components, flags } = errorBuilder.build();
            await interaction.editReply({
                components,
                flags: [flags]
            });
        }
    }
};
