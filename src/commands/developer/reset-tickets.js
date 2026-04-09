const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');

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
        
        // Verificar se é o desenvolvedor
        if (user.id !== DEVELOPER_ID) {
            db.logActivity(guildId, user.id, 'reset_reports_denied', null, {
                command: 'reset-reports',
                reason: 'Usuário não autorizado'
            });
            
            const deniedEmbed = new EmbedBuilder()
                .setColor(0xF64B4E)
                .setDescription(`# ${emojis.Error || '❌'} Acesso Negado\nEste comando é restrito ao desenvolvedor do bot.`)
                .setTimestamp();
            
            return await ResponseManager.send(interaction, { embeds: [deniedEmbed] });
        }
        
        // Validar confirmação
        if (confirmacao !== 'LIMPAR REPORTS') {
            const cancelEmbed = new EmbedBuilder()
                .setColor(0xFFBD59)
                .setDescription(`# ${emojis.Warning || '⚠️'} Ação Cancelada\nDigite exatamente **"LIMPAR REPORTS"** para confirmar.\n\n**Você digitou:** \`${confirmacao}\``)
                .setTimestamp();
            
            return await ResponseManager.send(interaction, { embeds: [cancelEmbed] });
        }
        
        try {
            // Buscar estatísticas antes da limpeza
            const statsBefore = {
                reports: db.prepare(`SELECT COUNT(*) as count FROM reports WHERE guild_id = ?`).get(guildId)?.count || 0,
                openReports: db.prepare(`SELECT COUNT(*) as count FROM reports WHERE guild_id = ? AND status NOT LIKE 'closed%'`).get(guildId)?.count || 0,
                closedReports: db.prepare(`SELECT COUNT(*) as count FROM reports WHERE guild_id = ? AND status LIKE 'closed%'`).get(guildId)?.count || 0
            };
            
            // Fechar threads abertas antes de deletar
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
            
            // Deletar todos os reports do servidor
            db.prepare(`DELETE FROM reports WHERE guild_id = ?`).run(guildId);
            
            // Resetar a sequência de ID (recriar a tabela)
            db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'reports'`).run();
            
            // Registrar atividade
            const resetUuid = db.generateUUID();
            db.logActivity(guildId, user.id, 'reset_reports', null, {
                command: 'reset-reports',
                resetUuid,
                statsBefore,
                responseTime: Date.now() - startTime
            });
            
            // Notificação no canal de logs
            const ConfigSystem = require('../../systems/configSystem');
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_reports');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const alertEmbed = new EmbedBuilder()
                            .setColor(0xF64B4E)
                            .setDescription(`# ${emojis.Warning || '⚠️'} REPORTS RESETADOS\n**Desenvolvedor:** ${user.tag}\n**Servidor:** ${guild.name}\n\n**Reports removidos:**\n- Total: \`${statsBefore.reports}\`\n- Abertos: \`${statsBefore.openReports}\`\n- Fechados: \`${statsBefore.closedReports}\``)
                            .setTimestamp();
                        await logChannel.send({ embeds: [alertEmbed] });
                    }
                } catch (err) {}
            }
            
            // Resposta de sucesso
            const successEmbed = new EmbedBuilder()
                .setColor(0xBBF96A)
                .setDescription(`# ${emojis.CLEAN || '🧹'} Reports Resetados\nOperação concluída com sucesso em **${guild.name}**.\n\n**Registros removidos:**\n- Total: \`${statsBefore.reports}\`\n- Abertos: \`${statsBefore.openReports}\`\n- Fechados: \`${statsBefore.closedReports}\`\n\n**Contagem reiniciada:** O próximo report será **#R1**`)
                .setFooter({ text: `UUID: ${resetUuid.slice(0, 8)}` })
                .setTimestamp();
            
            await ResponseManager.send(interaction, { embeds: [successEmbed] });
            
            console.log(`📊 [RESET-REPORTS] ${user.tag} resetou reports de ${guild.name} | ${statsBefore.reports} removidos`);
            
        } catch (error) {
            console.error('❌ Erro no reset-reports:', error);
            
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xF64B4E)
                .setDescription(`# ${emojis.Error || '❌'} Erro ao Resetar\nOcorreu um erro ao resetar os reports.\n\n**Código:** \`${error.message?.slice(0, 100) || 'Desconhecido'}\``)
                .setTimestamp();
            
            await ResponseManager.send(interaction, { embeds: [errorEmbed] });
        }
    }
};