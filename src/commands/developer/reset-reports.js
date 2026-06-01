// /home/ubuntu/DiscStaffBot/src/commands/developer/reset-reports.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const ContainerFormatter = require('../../utils/ContainerFormatter');

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
            
            const deniedBuilder = ContainerFormatter.create(guild.name, 0xF64B4E);
            deniedBuilder.title(`${emojis.Error || '❌'} Acesso Negado`, 1);
            deniedBuilder.text('Este comando é restrito ao desenvolvedor do bot.');
            deniedBuilder.footer();
            
            await interaction.editReply({
                components: [deniedBuilder.build()],
                flags: ['IsComponentsV2']
            });
            return;
        }
        
        if (confirmacao !== 'LIMPAR REPORTS') {
            const cancelBuilder = ContainerFormatter.create(guild.name, 0xFFBD59);
            cancelBuilder.title(`${emojis.Warning || '⚠️'} Ação Cancelada`, 1);
            cancelBuilder.text(`Digite exatamente **"LIMPAR REPORTS"** para confirmar.\n\n**Você digitou:** \`${confirmacao}\``);
            cancelBuilder.footer();
            
            await interaction.editReply({
                components: [cancelBuilder.build()],
                flags: ['IsComponentsV2']
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
                        const alertBuilder = ContainerFormatter.create(guild.name, 0xF64B4E);
                        alertBuilder.title(`${emojis.Warning || '⚠️'} REPORTS RESETADOS`, 1);
                        alertBuilder.line();
                        alertBuilder.text(`**Desenvolvedor:** ${user.tag}`);
                        alertBuilder.text(`**Servidor:** ${guild.name}`);
                        alertBuilder.line();
                        alertBuilder.text(`**Reports removidos:**`);
                        alertBuilder.text(`- Total: \`${statsBefore.reports}\``);
                        alertBuilder.text(`- Abertos: \`${statsBefore.openReports}\``);
                        alertBuilder.text(`- Fechados: \`${statsBefore.closedReports}\``);
                        alertBuilder.footer();
                        
                        await logChannel.send({
                            components: [alertBuilder.build()],
                            flags: ['IsComponentsV2']
                        });
                    }
                } catch (err) {}
            }
            
            const successBuilder = ContainerFormatter.create(guild.name, 0xBBF96A);
            successBuilder.title(`${emojis.CLEAN || '🧹'} Reports Resetados`, 1);
            successBuilder.line();
            successBuilder.text(`Operação concluída com sucesso em **${guild.name}**.`);
            successBuilder.line();
            successBuilder.text(`**Registros removidos:**`);
            successBuilder.text(`- Total: \`${statsBefore.reports}\``);
            successBuilder.text(`- Abertos: \`${statsBefore.openReports}\``);
            successBuilder.text(`- Fechados: \`${statsBefore.closedReports}\``);
            successBuilder.line();
            successBuilder.text(`**Contagem reiniciada:** O próximo report será **#R1**`);
            successBuilder.footer(`UUID: ${resetUuid.slice(0, 8)}`);
            
            await interaction.editReply({
                components: [successBuilder.build()],
                flags: ['IsComponentsV2']
            });
            
            console.log(`📊 [RESET-REPORTS] ${user.tag} resetou reports de ${guild.name} | ${statsBefore.reports} removidos`);
            
        } catch (error) {
            console.error('❌ Erro no reset-reports:', error);
            
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            const errorBuilder = ContainerFormatter.create(guild.name, 0xF64B4E);
            errorBuilder.title(`${emojis.Error || '❌'} Erro ao Resetar`, 1);
            errorBuilder.text(`Ocorreu um erro ao resetar os reports.\n\n**Código:** \`${error.message?.slice(0, 100) || 'Desconhecido'}\``);
            errorBuilder.footer();
            
            await interaction.editReply({
                components: [errorBuilder.build()],
                flags: ['IsComponentsV2']
            });
        }
    }
};