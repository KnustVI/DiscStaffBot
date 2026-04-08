// src/systems/ticketSystem.js
const db = require('../database/index');
const ResponseManager = require('../utils/responseManager');
const TicketFormatter = require('../utils/ticketFormatter');
const ConfigSystem = require('./configSystem');
const { ChannelType, EmbedBuilder } = require('discord.js');

class TicketSystem {
    constructor(client) {
        this.client = client;
    }

    // Gerar próximo ID sequencial para o servidor
    getNextTicketId(guildId) {
        const lastTicket = db.prepare(`
            SELECT id FROM tickets 
            WHERE guild_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        `).get(guildId);
        
        if (!lastTicket) return 1;
        
        // Extrair número do formato #C1
        const lastNumber = parseInt(lastTicket.id.replace('#C', ''));
        return lastNumber + 1;
    }

    async createTicket(interaction) {
        const { guild, user, member } = interaction;

        // VERIFICAR SE O CANAL DE LOG DE TICKETS ESTÁ CONFIGURADO
    const logChannelId = ConfigSystem.getSetting(guild.id, 'log_tickets');
    if (!logChannelId) {
        return await ResponseManager.error(interaction, 
            '❌ **Canal de logs não configurado!**\n\n' +
            'Um administrador precisa configurar o canal de logs de tickets primeiro.\n\n' +
            'Use `/config-logs` e selecione um canal para **Tickets**.'
        );
    }
        
        // Verificar se já tem ticket aberto
        const existing = db.prepare(`SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'`).get(guild.id, user.id);
        if (existing) {
            return await ResponseManager.error(interaction, 'Você já possui um ticket aberto. Aguarde o fechamento para abrir outro.');
        }

        // Gerar ID sequencial
        const ticketNumber = this.getNextTicketId(guild.id);
        const ticketId = `#C${ticketNumber}`;
        
        // Criar nome da thread com o nome do usuário
        const threadName = user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        
        // Criar thread
        const channel = interaction.channel;
        const thread = await channel.threads.create({
            name: threadName,
            type: ChannelType.PrivateThread,
            invitable: false,
            reason: `Ticket criado por ${user.tag}`
        });

        // Adicionar usuário na thread
        await thread.members.add(user.id);

        // Salvar no banco
        db.prepare(`
            INSERT INTO tickets (id, guild_id, thread_id, user_id, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(ticketId, guild.id, thread.id, user.id, Date.now(), 'open');

        // Enviar DM para o usuário
        const dmEmbed = TicketFormatter.createTicketEmbed(ticketId, user);
        await user.send(dmEmbed).catch(() => null);

         // ENVIAR LOG PARA O CANAL CONFIGURADO
        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (logChannel) {
            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            const mention = staffRoleId ? `<@&${staffRoleId}>` : '';
            
            const logEmbed = TicketFormatter.createLogEmbed(ticketId, user, thread.url);
            await logChannel.send({ content: mention || '', ...logEmbed });
        } else {
            console.error(`❌ Canal de log não encontrado: ${logChannelId}`);
        }


        // Enviar embed na thread
        const threadEmbed = TicketFormatter.createTicketEmbed(ticketId, user);
        await thread.send({ content: `<@${user.id}>`, ...threadEmbed });

        // Resposta
        await ResponseManager.success(interaction, `Ticket ${ticketId} criado! Acesse: ${thread.url}`);
    }

    async joinTicket(interaction, ticketId) {
        const { guild, user, member } = interaction;
        
        // Verificar se é staff
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        if (!staffRoleId || !member.roles.cache.has(staffRoleId)) {
            return await ResponseManager.error(interaction, 'Apenas staff pode entrar em tickets.');
        }

        // Buscar ticket
        const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ? AND guild_id = ? AND status = 'open'`).get(ticketId, guild.id);
        if (!ticket) {
            return await ResponseManager.error(interaction, 'Ticket não encontrado ou já fechado.');
        }

        // Buscar thread
        const thread = await guild.channels.fetch(ticket.thread_id).catch(() => null);
        if (!thread) {
            return await ResponseManager.error(interaction, 'Thread não encontrada.');
        }

        // Adicionar staff na thread
        await thread.members.add(user.id);

        

        // Atualizar log
        const logChannelId = ConfigSystem.getSetting(guild.id, 'log_tickets');
    if (logChannelId) {
        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (logChannel) {
            const targetUser = await this.client.users.fetch(ticket.user_id);
            const logEmbed = TicketFormatter.createLogEmbed(ticketId, targetUser, thread.url, user, 'update');
            await logChannel.send(logEmbed);
        }
    }

        // Atualizar DM
        const targetUser = await this.client.users.fetch(ticket.user_id);
        const dmEmbed = TicketFormatter.createTicketEmbed(ticketId, targetUser, user);
        await targetUser.send(dmEmbed).catch(() => null);

        // Atualizar thread
        const threadEmbed = TicketFormatter.createTicketEmbed(ticketId, targetUser, user);
        await thread.send({ content: `<@${targetUser.id}>`, ...threadEmbed });

        await ResponseManager.success(interaction, `Você entrou no ticket ${ticketId}`);
    }

    async closeTicket(interaction, ticketId, motivo, resumo, punicao) {
        const { guild, user, member } = interaction;
        
        // Verificar se é staff
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        if (!staffRoleId || !member.roles.cache.has(staffRoleId)) {
            return await ResponseManager.error(interaction, 'Apenas staff pode fechar tickets.');
        }

        // Buscar ticket
        const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ? AND guild_id = ? AND status = 'open'`).get(ticketId, guild.id);
        if (!ticket) {
            return await ResponseManager.error(interaction, 'Ticket não encontrado.');
        }

        // Buscar thread
        const thread = await guild.channels.fetch(ticket.thread_id).catch(() => null);
        if (thread) {
            // Remover usuário
            await thread.members.remove(ticket.user_id).catch(() => null);
            // Travar thread
            await thread.setLocked(true);
            await thread.setArchived(true);
        }

        // Atualizar banco
        db.prepare(`
            UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ?, closed_reason = ?
            WHERE id = ?
        `).run(Date.now(), user.id, motivo, ticketId);

        // Enviar DM para usuário com avaliação
        const targetUser = await this.client.users.fetch(ticket.user_id);
        const ratingEmbed = TicketFormatter.createRatingEmbed();
        await targetUser.send(ratingEmbed).catch(() => null);

        // Enviar log
        const logChannelId = ConfigSystem.getSetting(guild.id, 'log_tickets');
        if (logChannelId) {
            const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                const embed = new EmbedBuilder()
                    .setColor(0xF64B4E)
                    .setDescription(`# 🔒 Ticket Fechado\n**ID:** ${ticketId}\n**Usuário:** ${targetUser.tag}\n**Fechado por:** ${user.tag}\n**Motivo:** ${motivo}\n**Resumo:** ${resumo}\n**Punição:** ${punicao || 'Nenhuma'}`)
                    .setTimestamp();
                await logChannel.send({ embeds: [embed] });
            }
        }

        await ResponseManager.success(interaction, `Ticket ${ticketId} fechado com sucesso.`);
    }

    async rateTicket(interaction, nota, comentario) {
        const { user } = interaction;

        // Buscar último ticket do usuário
        const ticket = db.prepare(`SELECT * FROM tickets WHERE user_id = ? AND status = 'closed' ORDER BY closed_at DESC LIMIT 1`).get(user.id);
        if (!ticket) {
            return await ResponseManager.error(interaction, 'Nenhum ticket encontrado para avaliar.');
        }

        if (ticket.rating) {
            return await ResponseManager.error(interaction, 'Este ticket já foi avaliado.');
        }

        // Atualizar avaliação
        db.prepare(`UPDATE tickets SET rating = ?, rating_comment = ? WHERE id = ?`).run(nota, comentario, ticket.id);

        // Enviar para log
        const guild = this.client.guilds.cache.get(ticket.guild_id);
        const logChannelId = ConfigSystem.getSetting(ticket.guild_id, 'log_tickets');
        
        if (logChannelId && guild) {
            const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                const embed = new EmbedBuilder()
                    .setColor(0xBBF96A)
                    .setDescription(`# ⭐ Avaliação Recebida\n**Ticket:** ${ticket.id}\n**Usuário:** ${user.tag}\n**Nota:** ${'⭐'.repeat(nota)} (${nota}/5)\n**Comentário:** ${comentario || 'Nenhum'}`)
                    .setTimestamp();
                await logChannel.send({ embeds: [embed] });
            }
        }

        await ResponseManager.success(interaction, 'Avaliação registrada! Obrigado pelo feedback.');
    }
}

module.exports = TicketSystem;