// /home/ubuntu/DiscStaffBot/src/commands/developer/reset-reports.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');

const DEVELOPER_ID = '203676076189286412';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-reports')
        .setDescription('⚠️ LIMPEZA: Apaga todos os dados de reports (ReportChat) e reinicia a contagem.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => 
            opt.setName('confirmar')
                .setDescription('Digite "LIMPAR REPORTS" para confirmar')
                .setRequired(true)),

    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, user, options } = interaction;
        const guildId = guild.id;
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
            
            const deniedBuilder = new AdvancedContainerBuilder({ accentColor: 0xF64B4E });
            deniedBuilder.title(`${emojis.circlealert || '❌'} Acesso Negado`, 1);
            deniedBuilder.text('Este comando é restrito ao desenvolvedor do bot.');
            deniedBuilder.footer();
            
            const { components, flags } = deniedBuilder.build();
            await interaction.editReply({
                components,
                flags: [flags]
            });
            return;
        }
        
        if (confirmacao !== 'LIMPAR REPORTS') {
            const cancelBuilder = new AdvancedContainerBuilder({ accentColor: 0xFFBD59 });
            cancelBuilder.title(`${emojis.trianglealert || '⚠️'} Ação Cancelada`, 1);
            cancelBuilder.text(`Digite exatamente **"LIMPAR REPORTS"** para confirmar.\n\n**Você digitou:** \`${confirmacao}\``);
            cancelBuilder.footer();
            
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
                        const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
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
            
            const ConfigSystem = require('../../systems/configSystem');
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_reports');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const alertBuilder = new AdvancedContainerBuilder({ accentColor: 0xF64B4E });
                        alertBuilder.title(`${emojis.trianglealert || '⚠️'} REPORTS RESETADOS`, 1);
                        alertBuilder.separator();
                        alertBuilder.text(`**Desenvolvedor:** ${user.tag}`);
                        alertBuilder.text(`**Servidor:** ${guild.name}`);
                        alertBuilder.separator();
                        alertBuilder.text(`**Reports removidos:**`);
                        alertBuilder.text(`- Total: \`${statsBefore.reports}\``);
                        alertBuilder.text(`- Abertos: \`${statsBefore.openReports}\``);
                        alertBuilder.text(`- Fechados: \`${statsBefore.closedReports}\``);
                        alertBuilder.footer();
                        
                        const { components, flags } = alertBuilder.build();
                        await logChannel.send({
                            components,
                            flags: [flags]
                        });
                    }
                } catch (err) {}
            }
            
            const successBuilder = new AdvancedContainerBuilder({ accentColor: 0xBBF96A });
            successBuilder.title(`${emojis.CLEAN || '🧹'} Reports Resetados`, 1);
            successBuilder.separator();
            successBuilder.text(`Operação concluída com sucesso em **${guild.name}**.`);
            successBuilder.separator();
            successBuilder.text(`**Registros removidos:**`);
            successBuilder.text(`- Total: \`${statsBefore.reports}\``);
            successBuilder.text(`- Abertos: \`${statsBefore.openReports}\``);
            successBuilder.text(`- Fechados: \`${statsBefore.closedReports}\``);
            successBuilder.separator();
            successBuilder.text(`**Contagem reiniciada:** O próximo report será **#R1**`);
            successBuilder.footer(`UUID: ${resetUuid.slice(0, 8)}`);
            
            const { components, flags } = successBuilder.build();
            await interaction.editReply({
                components,
                flags: [flags]
            });
            
            console.log(`📊 [RESET-REPORTS] ${user.tag} resetou reports de ${guild.name} | ${statsBefore.reports} removidos`);
            
        } catch (error) {
            console.error('❌ Erro no reset-reports:', error);
            
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            const errorBuilder = new AdvancedContainerBuilder({ accentColor: 0xF64B4E });
            errorBuilder.title(`${emojis.circlealert || '❌'} Erro ao Resetar`, 1);
            errorBuilder.text(`Ocorreu um erro ao resetar os reports.\n\n**Código:** \`${error.message?.slice(0, 100) || 'Desconhecido'}\``);
            errorBuilder.footer();
            
            const { components, flags } = errorBuilder.build();
            await interaction.editReply({
                components,
                flags: [flags]
            });
        }
    }
};