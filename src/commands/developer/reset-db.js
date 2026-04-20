const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');

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
        
        // 1. VERIFICAR SE É O DESENVOLVEDOR
        if (user.id !== DEVELOPER_ID) {
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
                .setColor(0xF64B4E)
                .setDescription(`# ${emojis.Error || '❌'} Acesso Negado\nEste comando é restrito ao desenvolvedor do bot.\n\n**Seu ID:** \`${user.id}\`\n**ID Autorizado:** \`${DEVELOPER_ID}\``)
                .setFooter({ text: 'Caso necessário, contate o desenvolvedor.' })
                .setTimestamp();
            
            return await ResponseManager.send(interaction, { embeds: [deniedEmbed] });
        }
        
        // 2. VALIDAR CONFIRMAÇÃO
        if (confirmacao !== 'LIMPAR TUDO') {
            const cancelEmbed = new EmbedBuilder()
                .setColor(0xFFBD59)
                .setDescription(`# ${emojis.Warning || '⚠️'} Ação Cancelada\nDigite exatamente **"LIMPAR TUDO"** para confirmar a limpeza.\n\n**Você digitou:** \`${confirmacao}\``)
                .setTimestamp();
            
            return await ResponseManager.send(interaction, { embeds: [cancelEmbed] });
        }
        
        try {
            const ConfigSystem = require('../../systems/configSystem');
            
            // 3. OBTER ESTATÍSTICAS ANTES DA LIMPEZA
            const statsBefore = {
                reputation: db.prepare(`SELECT COUNT(*) as count FROM reputation WHERE guild_id = ?`).get(guildId)?.count || 0,
                punishments: db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ?`).get(guildId)?.count || 0,
                reports: 0,
                feedbacks: 0
            };
            
            try {
                statsBefore.reports = db.prepare(`SELECT COUNT(*) as count FROM reports WHERE guild_id = ?`).get(guildId)?.count || 0;
            } catch (err) {}
            
            try {
                statsBefore.feedbacks = db.prepare(`SELECT COUNT(*) as count FROM feedbacks WHERE guild_id = ?`).get(guildId)?.count || 0;
            } catch (err) {}
            
            // 4. EXECUTAR LIMPEZA
            const clearDB = db.transaction(() => {
                db.prepare('DELETE FROM reputation WHERE guild_id = ?').run(guildId);
                db.prepare('DELETE FROM punishments WHERE guild_id = ?').run(guildId);
                
                try { db.prepare('DELETE FROM reports WHERE guild_id = ?').run(guildId); } catch (err) {}
                try { db.prepare('DELETE FROM feedbacks WHERE guild_id = ?').run(guildId); } catch (err) {}
                try { db.prepare('DELETE FROM activity_logs WHERE guild_id = ?').run(guildId); } catch (err) {}
                try { db.prepare('DELETE FROM staff_analytics WHERE guild_id = ?').run(guildId); } catch (err) {}
            });
            
            clearDB();
            
            // 5. LIMPAR CACHE
            ConfigSystem.clearCache(guildId);
            
            // 6. OTIMIZAR BANCO
            try {
                db.pragma('vacuum');
            } catch (err) {}
            
            // 7. REGISTRAR ATIVIDADE
            const resetUuid = db.generateUUID();
            const activityId = db.logActivity(
                guildId,
                user.id,
                'reset_db',
                null,
                { 
                    command: 'reset-db',
                    resetUuid,
                    statsBefore,
                    responseTime: Date.now() - startTime
                }
            );
            
            // 8. NOTIFICAÇÃO NO CANAL DE LOGS
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_channel');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const alertEmbed = new EmbedBuilder()
                            .setColor(0xF64B4E)
                            .setDescription(`# ${emojis.Warning || '⚠️'} ALERTA CRÍTICO: BANCO DE DADOS LIMPO\n**Desenvolvedor:** ${user.tag}\n**Servidor:** ${guild.name}\n\n**Dados removidos:**\n- Reputação: \`${statsBefore.reputation}\` registros\n- Punições: \`${statsBefore.punishments}\` registros\n- Reports: \`${statsBefore.reports}\` registros\n\n**ID da Transação:** \`${activityId}\``)
                            .setTimestamp();
                        await logChannel.send({ embeds: [alertEmbed] });
                    }
                } catch (err) {}
            }
            
            // 9. RESPOSTA PARA O DESENVOLVEDOR
            const successEmbed = new EmbedBuilder()
                .setColor(0xBBF96A)
                .setDescription(`# ${emojis.CLEAN || '🧹'} Database Resetada\nOperação concluída com sucesso em **${guild.name}**.\n\n**Registros removidos:**\n- Reputação: \`${statsBefore.reputation}\`\n- Punições: \`${statsBefore.punishments}\`\n- Reports: \`${statsBefore.reports}\`\n\n**Tempo de execução:** \`${Date.now() - startTime}ms\``)
                .setFooter({ text: `UUID: ${resetUuid.slice(0, 8)}` })
                .setTimestamp();
            
            await ResponseManager.send(interaction, { embeds: [successEmbed] });
            
            console.log(`📊 [RESET-DB] ${user.tag} resetou ${guild.name} | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            console.error('❌ Erro no reset-db:', error);
            
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            db.logActivity(guildId, user.id, 'error', null, { 
                command: 'reset-db', error: error.message
            });
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xF64B4E)
                .setDescription(`# ${emojis.Error || '❌'} Erro ao Resetar\nOcorreu um erro crítico. O banco de dados pode estar inconsistente.\n\n**Código:** \`${error.message?.slice(0, 100) || 'Desconhecido'}\``)
                .setFooter({ text: 'Contate o suporte imediatamente.' })
                .setTimestamp();
            
            await ResponseManager.send(interaction, { embeds: [errorEmbed] });
        }
    }
};