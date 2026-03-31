const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const SessionManager = require('../../utils/sessionManager');

const DEVELOPER_ID = '203676076189286412'; 

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-db')
        .setDescription('⚠️ LIMPEZA TOTAL: Apaga todos os dados de reputação e punições DESTE servidor.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => 
            opt.setName('confirmar')
                .setDescription('Digite "LIMPAR TUDO" para confirmar a ação')
                .setRequired(true)),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     * @param {import('discord.js').Client} client 
     */
    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, user, options } = interaction;
        const guildId = guild.id;
        const confirmacao = options.getString('confirmar');
        
        // Obter emojis do sistema (se existirem)
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        // 1. VERIFICAR SE É O DESENVOLVEDOR
        if (user.id !== DEVELOPER_ID) {
            // Registrar tentativa não autorizada
            db.logActivity(
                guildId,
                user.id,
                'reset_db_denied',
                null,
                { 
                    command: 'reset-db',
                    reason: 'Usuário não autorizado',
                    userId: user.id,
                    userTag: user.tag
                }
            );
            
            const deniedEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Acesso Negado')
                .setDescription('Este comando é restrito ao desenvolvedor do bot.')
                .addFields(
                    { name: '👤 Seu ID', value: `\`${user.id}\``, inline: true },
                    { name: '🔒 ID Autorizado', value: `\`${DEVELOPER_ID}\``, inline: true }
                )
                .setFooter({ text: 'Caso seja necessário, contate o desenvolvedor.' })
                .setTimestamp();
            
            return await interaction.editReply({ embeds: [deniedEmbed] });
        }
        
        // 2. VALIDAR CONFIRMAÇÃO
        if (confirmacao !== 'LIMPAR TUDO') {
            const cancelEmbed = new EmbedBuilder()
                .setColor(0xFFA500)
                .setTitle('⚠️ Ação Cancelada')
                .setDescription('Digite exatamente **"LIMPAR TUDO"** para confirmar a limpeza total do banco de dados.')
                .addFields(
                    { name: 'Você digitou:', value: `\`${confirmacao}\``, inline: false },
                    { name: 'Esperado:', value: '`LIMPAR TUDO`', inline: false }
                )
                .setTimestamp();
            
            return await interaction.editReply({ embeds: [cancelEmbed] });
        }
        
        try {
            // 3. OBTER SISTEMAS
            const ConfigSystem = require('../../systems/configSystem');
            
            // 4. REGISTRAR SESSÃO DE RESET (para rastreamento)
            const resetUuid = db.generateUUID();
            SessionManager.set(
                user.id,
                guildId,
                'reset_db',
                { 
                    timestamp: Date.now(),
                    resetUuid,
                    guildId,
                    guildName: guild.name
                },
                300000 // 5 minutos
            );
            
            // 5. OBTER ESTATÍSTICAS ANTES DA LIMPEZA (para log)
            const statsBefore = {
                reputation: db.prepare(`SELECT COUNT(*) as count FROM reputation WHERE guild_id = ?`).get(guildId)?.count || 0,
                punishments: db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ?`).get(guildId)?.count || 0,
                tickets: 0,
                feedbacks: 0
            };
            
            // Tentar obter tickets e feedbacks se as tabelas existirem
            try {
                statsBefore.tickets = db.prepare(`SELECT COUNT(*) as count FROM tickets WHERE guild_id = ?`).get(guildId)?.count || 0;
            } catch (err) {}
            
            try {
                statsBefore.feedbacks = db.prepare(`SELECT COUNT(*) as count FROM feedbacks WHERE guild_id = ?`).get(guildId)?.count || 0;
            } catch (err) {}
            
            // 6. EXECUTAR LIMPEZA EM TRANSAÇÃO (Atomicidade)
            const clearDB = db.transaction(() => {
                // Limpar reputação
                db.prepare('DELETE FROM reputation WHERE guild_id = ?').run(guildId);
                
                // Limpar punições
                db.prepare('DELETE FROM punishments WHERE guild_id = ?').run(guildId);
                
                // Limpar tickets (se existir tabela)
                try {
                    db.prepare('DELETE FROM tickets WHERE guild_id = ?').run(guildId);
                } catch (err) {}
                
                // Limpar feedbacks (se existir tabela)
                try {
                    db.prepare('DELETE FROM feedbacks WHERE guild_id = ?').run(guildId);
                } catch (err) {}
                
                // Limpar activity_logs relacionados ao servidor
                try {
                    db.prepare('DELETE FROM activity_logs WHERE guild_id = ?').run(guildId);
                } catch (err) {}
                
                // Limpar staff_analytics (se existir tabela)
                try {
                    db.prepare('DELETE FROM staff_analytics WHERE guild_id = ?').run(guildId);
                } catch (err) {}
            });
            
            clearDB();
            
            // 7. LIMPAR CACHE DO SISTEMA
            if (ConfigSystem.clearCache) {
                ConfigSystem.clearCache(guildId);
            }
            
            // 8. OTIMIZAR BANCO DE DADOS (VACUUM)
            try {
                db.pragma('vacuum');
            } catch (err) {
                console.error('❌ Erro ao executar VACUUM:', err);
            }
            
            // 9. REGISTRAR ATIVIDADE NO LOG (após limpeza)
            const activityId = db.logActivity(
                guildId,
                user.id,
                'reset_db',
                null,
                { 
                    command: 'reset-db',
                    resetUuid,
                    statsBefore,
                    statsAfter: {
                        reputation: 0,
                        punishments: 0,
                        tickets: 0,
                        feedbacks: 0
                    },
                    responseTime: Date.now() - startTime
                }
            );
            
            // 10. ATUALIZAR ANALYTICS DO STAFF
            const AnalyticsSystem = require('../../systems/analyticsSystem');
            await AnalyticsSystem.updateStaffAnalytics(guildId, user.id);
            
            // 11. NOTIFICAÇÃO NO CANAL DE LOGS
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_channel');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const alertEmbed = new EmbedBuilder()
                            .setTitle(`${emojis.WARNING || '⚠️'} ALERTA CRÍTICO: BANCO DE DADOS LIMPO`)
                            .setDescription([
                                `**Desenvolvedor:** ${user} (\`${user.id}\`)`,
                                `**Servidor:** ${guild.name} (\`${guild.id}\`)`,
                                `**Dados removidos:**`,
                                `- Reputação: \`${statsBefore.reputation}\` registros`,
                                `- Punições: \`${statsBefore.punishments}\` registros`,
                                statsBefore.tickets > 0 ? `- Tickets: \`${statsBefore.tickets}\` registros` : null,
                                statsBefore.feedbacks > 0 ? `- Feedbacks: \`${statsBefore.feedbacks}\` registros` : null,
                                `\n**O histórico foi apagado permanentemente.**`,
                                `**ID da Transação:** \`${activityId}\``,
                                `**UUID do Reset:** \`${resetUuid}\``
                            ].filter(Boolean).join('\n'))
                            .setColor(0xFF3C72)
                            .setFooter(ConfigSystem.getFooter(guild.name))
                            .setTimestamp();
                        
                        await logChannel.send({ embeds: [alertEmbed] }).catch(() => null);
                    }
                } catch (err) {
                    console.error('❌ Erro ao enviar log para canal:', err);
                }
            }
            
            // 12. RESPOSTA PARA O DESENVOLVEDOR
            const successEmbed = new EmbedBuilder()
                .setTitle(`${emojis.CLEAN || '🧹'} Database Resetada`)
                .setDescription(`### Operação Concluída com Sucesso\nTodos os dados de **reputação**, **punições** e **registros relacionados** de **${guild.name}** foram removidos.`)
                .addFields(
                    { 
                        name: '📊 Registros Removidos', 
                        value: [
                            `**Reputação:** \`${statsBefore.reputation}\``,
                            `**Punições:** \`${statsBefore.punishments}\``,
                            statsBefore.tickets > 0 ? `**Tickets:** \`${statsBefore.tickets}\`` : null,
                            statsBefore.feedbacks > 0 ? `**Feedbacks:** \`${statsBefore.feedbacks}\`` : null
                        ].filter(Boolean).join('\n'),
                        inline: true 
                    },
                    { 
                        name: '🆔 ID da Transação', 
                        value: `\`${activityId?.slice(0, 8) || 'N/A'}...\``, 
                        inline: true 
                    },
                    { 
                        name: '🔑 UUID do Reset', 
                        value: `\`${resetUuid.slice(0, 8)}...\``, 
                        inline: true 
                    },
                    { 
                        name: '⏱️ Tempo de Execução', 
                        value: `\`${Date.now() - startTime}ms\``, 
                        inline: true 
                    }
                )
                .setColor(0x00FF7F)
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();
            
            await interaction.editReply({ embeds: [successEmbed] });
            
            // Limpar sessão após sucesso
            SessionManager.delete(user.id, guildId, 'reset_db');
            
            // Log silencioso de performance
            console.log(`📊 [RESET-DB] ${user.tag} resetou o banco de ${guild.name} | ${Date.now() - startTime}ms | ${statsBefore.punishments} punições removidas`);
            
        } catch (error) {
            // 13. TRATAMENTO DE ERRO COM LOG DETALHADO
            console.error('❌ Erro no comando reset-db:', error);
            
            // Registrar erro no sistema de logs
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            // Registrar no banco
            db.logActivity(
                guildId,
                user.id,
                'error',
                null,
                { 
                    command: 'reset-db',
                    error: error.message,
                    stack: error.stack
                }
            );
            
            // Limpar sessão em caso de erro
            SessionManager.delete(user.id, guildId, 'reset_db');
            
            // Resposta de erro amigável
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro ao Resetar Banco de Dados')
                .setDescription('Ocorreu um erro crítico durante a operação de reset. O banco de dados pode estar em um estado inconsistente.')
                .addFields(
                    { name: 'Código do Erro', value: `\`${error.message?.slice(0, 100) || 'Desconhecido'}\``, inline: false },
                    { name: 'Ação Recomendada', value: 'Entre em contato com o suporte imediatamente.', inline: false },
                    { name: 'ID da Transação', value: `\`${Date.now()}\``, inline: true }
                )
                .setFooter({ text: 'Verifique os logs do sistema para mais detalhes.' })
                .setTimestamp();
            
            await interaction.editReply({ 
                embeds: [errorEmbed],
                content: null
            }).catch(() => null);
        }
    }
};