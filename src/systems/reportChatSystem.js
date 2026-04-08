// src/systems/reportChatSystem.js
const db = require('../database/index');
const ResponseManager = require('../utils/responseManager');
const ReportChatFormatter = require('../utils/reportChatFormatter');
const ConfigSystem = require('./configSystem');
const { ChannelType, EmbedBuilder } = require('discord.js');

class ReportChatSystem {
    constructor(client) {
        this.client = client;
    }

    getNextTicketId(guildId) {
        const lastTicket = db.prepare(`
            SELECT id FROM tickets 
            WHERE guild_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        `).get(guildId);
        
        if (!lastTicket) return 1;
        const lastNumber = parseInt(lastTicket.id.replace('#RC', ''));
        return lastNumber + 1;
    }

    async createTicket(interaction) {
        const { guild, user } = interaction;
        
        // Verificar se a interação ainda é válida
        if (!interaction.isRepliable()) {
            console.error('❌ Interação não pode ser respondida');
            return;
        }
        
        const logChannelId = ConfigSystem.getSetting(guild.id, 'log_tickets');
        if (!logChannelId) {
            return await ResponseManager.error(interaction, 
                '❌ **Canal de logs não configurado!**\n\nUse `/config-logs` e selecione um canal para **ReportChat**.'
            );
        }
        
        const existing = db.prepare(`SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'`).get(guild.id, user.id);
        if (existing) {
            return await ResponseManager.error(interaction, 'Você já possui um canal aberto.');
        }

        const ticketNumber = this.getNextTicketId(guild.id);
        const ticketId = `#RC${ticketNumber}`;
        
        const threadName = `${ticketId}-${user.username}`.toLowerCase().replace(/[^a-z0-9-#]/g, '-');
        
        const channel = interaction.channel;
        const thread = await channel.threads.create({
            name: threadName,
            type: ChannelType.PrivateThread,
            invitable: false,
            reason: `ReportChat criado por ${user.tag}`
        });

        await thread.members.add(user.id);

        db.prepare(`
            INSERT INTO tickets (id, guild_id, thread_id, user_id, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(ticketId, guild.id, thread.id, user.id, Date.now(), 'open');

        // DM do usuário
        const dmContent = ReportChatFormatter.createUserDmEmbed(ticketId, user);
        await user.send(dmContent).catch(() => null);

        // Log no canal
        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (logChannel) {
            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            const mention = staffRoleId ? `<@&${staffRoleId}>` : '';
            const logContent = ReportChatFormatter.createLogEmbed(ticketId, user, thread.url);
            await logChannel.send({ content: mention || '', ...logContent });
        }

        // Embed na thread
        const threadContent = ReportChatFormatter.createThreadEmbed(ticketId, user);
        await thread.send({ content: `<@${user.id}>`, ...threadContent });

        // Responder ao comando (sem editar a mensagem original)
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: `${ticketId} criado! Acesse: ${thread.url}`, flags: 64 });
        } else if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content: `${ticketId} criado! Acesse: ${thread.url}` });
        }
    }

    async joinTicket(interaction, ticketId) {
        const { guild, user, member } = interaction;
        
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        if (!staffRoleId || !member.roles.cache.has(staffRoleId)) {
            return await ResponseManager.error(interaction, 'Apenas staff pode entrar.');
        }

        const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ? AND guild_id = ? AND status = 'open'`).get(ticketId, guild.id);
        if (!ticket) {
            return await ResponseManager.error(interaction, 'ReportChat não encontrado.');
        }

        const thread = await guild.channels.fetch(ticket.thread_id).catch(() => null);
        if (!thread) {
            return await ResponseManager.error(interaction, 'Canal não encontrado.');
        }

        await thread.members.add(user.id);

        const logChannelId = ConfigSystem.getSetting(guild.id, 'log_tickets');
        if (logChannelId) {
            const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                const targetUser = await this.client.users.fetch(ticket.user_id);
                const logContent = ReportChatFormatter.createLogEmbed(ticketId, targetUser, thread.url, user, 'update');
                await logChannel.send(logContent);
            }
        }

        const targetUser = await this.client.users.fetch(ticket.user_id);
        
        // Atualizar DM
        const dmContent = ReportChatFormatter.createUserDmEmbed(ticketId, targetUser, user);
        await targetUser.send(dmContent).catch(() => null);

        // Atualizar thread
        const threadContent = ReportChatFormatter.createThreadEmbed(ticketId, targetUser, user);
        await thread.send({ content: `<@${targetUser.id}>`, ...threadContent });

        // Responder ao botão
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: `Você entrou no ${ticketId}`, flags: 64 });
        } else if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content: `Você entrou no ${ticketId}` });
        }
    }

    async closeTicketWithReason(interaction, ticketId, motivo, punicao) {
        const { guild, user, member } = interaction;
        
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        if (!staffRoleId || !member.roles.cache.has(staffRoleId)) {
            return await ResponseManager.error(interaction, 'Apenas staff pode fechar.');
        }

        await this._closeTicket(interaction, ticketId, user, motivo, punicao, true);
    }

    async closeTicketWithoutReason(interaction, ticketId) {
        const { guild, user, member } = interaction;
        
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        if (!staffRoleId || !member.roles.cache.has(staffRoleId)) {
            return await ResponseManager.error(interaction, 'Apenas staff pode fechar.');
        }

        await this._closeTicket(interaction, ticketId, user, 'Fechado sem motivo', 'Nenhuma', false);
    }

    async closeTicketWithRating(interaction, ticketId, nota, comentario) {
        const { guild, user, member } = interaction;
        
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        if (!staffRoleId || !member.roles.cache.has(staffRoleId)) {
            return await ResponseManager.error(interaction, 'Apenas staff pode fechar.');
        }

        await this._closeTicket(interaction, ticketId, user, 'Avaliado pelo usuário', 'Nenhuma', true, nota, comentario);
    }

    async _closeTicket(interaction, ticketId, staff, motivo, punicao, hasReason, nota = null, comentario = null) {
        const { guild } = interaction;

        const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ? AND guild_id = ? AND status = 'open'`).get(ticketId, guild.id);
        if (!ticket) {
            return await ResponseManager.error(interaction, 'ReportChat não encontrado.');
        }

        const thread = await guild.channels.fetch(ticket.thread_id).catch(() => null);
        if (thread) {
            await thread.members.remove(ticket.user_id).catch(() => null);
            await thread.setLocked(true);
            await thread.setArchived(true);
        }

        db.prepare(`
            UPDATE tickets SET 
                status = 'closed', 
                closed_at = ?, 
                closed_by = ?, 
                closed_reason = ?,
                rating = ?, 
                rating_comment = ?
            WHERE id = ?
        `).run(Date.now(), staff.id, hasReason ? motivo : null, nota || null, comentario || null, ticketId);

        const targetUser = await this.client.users.fetch(ticket.user_id);
        const logChannelId = ConfigSystem.getSetting(guild.id, 'log_tickets');

        // Atualizar DM do usuário
        const dmContent = ReportChatFormatter.createUserDmEmbed(ticketId, targetUser, staff, true, motivo, punicao);
        await targetUser.send(dmContent).catch(() => null);

        // Atualizar thread (se existir)
        if (thread) {
            const threadContent = ReportChatFormatter.createThreadEmbed(ticketId, targetUser, staff, true, motivo, punicao);
            await thread.send(threadContent);
        }

        // Enviar log
        if (logChannelId) {
            const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                const logContent = ReportChatFormatter.createLogEmbed(ticketId, targetUser, thread ? thread.url : 'Canal deletado', staff, 'close', motivo, punicao);
                await logChannel.send(logContent);
            }
        }

        // Responder ao botão/modal
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: `${ticketId} fechado com sucesso!`, flags: 64 });
        } else if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content: `${ticketId} fechado com sucesso!` });
        }
    }
}

module.exports = ReportChatSystem;