const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');

const DEVELOPER_ID = '203676076189286412';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-tickets')
        .setDescription('⚠️ LIMPEZA: Apaga todos os dados de tickets (ReportChat) e reinicia a contagem.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => 
            opt.setName('confirmar')
                .setDescription('Digite "LIMPAR TICKETS" para confirmar')
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
            db.logActivity(guildId, user.id, 'reset_tickets_denied', null, {
                command: 'reset-tickets',
                reason: 'Usuário não autorizado'
            });
            
            const deniedEmbed = new EmbedBuilder()
                .setColor(0xF64B4E)
                .setDescription(`# ${emojis.Error || '❌'} Acesso Negado\nEste comando é restrito ao desenvolvedor do bot.`)
                .setTimestamp();
            
            return await ResponseManager.send(interaction, { embeds: [deniedEmbed] });
        }
        
        // Validar confirmação
        if (confirmacao !== 'LIMPAR TICKETS') {
            const cancelEmbed = new EmbedBuilder()
                .setColor(0xFFBD59)
                .setDescription(`# ${emojis.Warning || '⚠️'} Ação Cancelada\nDigite exatamente **"LIMPAR TICKETS"** para confirmar.\n\n**Você digitou:** \`${confirmacao}\``)
                .setTimestamp();
            
            return await ResponseManager.send(interaction, { embeds: [cancelEmbed] });
        }
        
        try {
            // Buscar estatísticas antes da limpeza
            const statsBefore = {
                tickets: db.prepare(`SELECT COUNT(*) as count FROM tickets WHERE guild_id = ?`).get(guildId)?.count || 0,
                openTickets: db.prepare(`SELECT COUNT(*) as count FROM tickets WHERE guild_id = ? AND status = 'open'`).get(guildId)?.count || 0,
                closedTickets: db.prepare(`SELECT COUNT(*) as count FROM tickets WHERE guild_id = ? AND status = 'closed'`).get(guildId)?.count || 0
            };
            
            // Fechar threads abertas antes de deletar
            const openTickets = db.prepare(`SELECT thread_id FROM tickets WHERE guild_id = ? AND status = 'open'`).all(guildId);
            for (const ticket of openTickets) {
                if (ticket.thread_id) {
                    try {
                        const thread = await guild.channels.fetch(ticket.thread_id).catch(() => null);
                        if (thread) {
                            await thread.setLocked(true);
                            await thread.setArchived(true);
                        }
                    } catch (err) {}
                }
            }
            
            // Deletar todos os tickets do servidor
            db.prepare(`DELETE FROM tickets WHERE guild_id = ?`).run(guildId);
            
            // Resetar a sequência de ID (recriar a tabela)
            db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'tickets'`).run();
            
            // Registrar atividade
            const resetUuid = db.generateUUID();
            db.logActivity(guildId, user.id, 'reset_tickets', null, {
                command: 'reset-tickets',
                resetUuid,
                statsBefore,
                responseTime: Date.now() - startTime
            });
            
            // Notificação no canal de logs
            const ConfigSystem = require('../../systems/configSystem');
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_tickets');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const alertEmbed = new EmbedBuilder()
                            .setColor(0xF64B4E)
                            .setDescription(`# ${emojis.Warning || '⚠️'} TICKETS RESETADOS\n**Desenvolvedor:** ${user.tag}\n**Servidor:** ${guild.name}\n\n**Tickets removidos:**\n- Total: \`${statsBefore.tickets}\`\n- Abertos: \`${statsBefore.openTickets}\`\n- Fechados: \`${statsBefore.closedTickets}\``)
                            .setTimestamp();
                        await logChannel.send({ embeds: [alertEmbed] });
                    }
                } catch (err) {}
            }
            
            // Resposta de sucesso
            const successEmbed = new EmbedBuilder()
                .setColor(0xBBF96A)
                .setDescription(`# ${emojis.CLEAN || '🧹'} Tickets Resetados\nOperação concluída com sucesso em **${guild.name}**.\n\n**Registros removidos:**\n- Total: \`${statsBefore.tickets}\`\n- Abertos: \`${statsBefore.openTickets}\`\n- Fechados: \`${statsBefore.closedTickets}\`\n\n**Contagem reiniciada:** O próximo ticket será **#RC1**`)
                .setFooter({ text: `UUID: ${resetUuid.slice(0, 8)}` })
                .setTimestamp();
            
            await ResponseManager.send(interaction, { embeds: [successEmbed] });
            
            console.log(`📊 [RESET-TICKETS] ${user.tag} resetou tickets de ${guild.name} | ${statsBefore.tickets} removidos`);
            
        } catch (error) {
            console.error('❌ Erro no reset-tickets:', error);
            
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xF64B4E)
                .setDescription(`# ${emojis.Error || '❌'} Erro ao Resetar\nOcorreu um erro ao resetar os tickets.\n\n**Código:** \`${error.message?.slice(0, 100) || 'Desconhecido'}\``)
                .setTimestamp();
            
            await ResponseManager.send(interaction, { embeds: [errorEmbed] });
        }
    }
};