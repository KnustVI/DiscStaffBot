// src/systems/reportChatSystem.js
const db = require('../database/index');
const ResponseManager = require('../utils/responseManager');
const ReportChatFormatter = require('../utils/reportChatFormatter');
const ConfigSystem = require('./configSystem');
const { ChannelType } = require('discord.js');

class ReportChatSystem {
    constructor(client) {
        this.client = client;
        this.userMessages = new Map(); // Armazenar IDs das mensagens enviadas para editar depois
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

        const threadUrl = thread.url;

        // DM do usuário - enviar e guardar referência
        const dmContent = ReportChatFormatter.createUserDmEmbed(ticketId, user, threadUrl);
        const dmMessage = await user.send(dmContent).catch(() => null);
        
        // Salvar ID da mensagem da DM para editar depois
        if (dmMessage) {
            db.prepare(`UPDATE tickets SET dm_message_id = ? WHERE id = ?`).run(dmMessage.id, ticketId);
        }

        // Embed na thread
        const threadContent = ReportChatFormatter.createThreadEmbed(ticketId, user, threadUrl);
        await thread.send({ content: `<@${user.id}>`, ...threadContent });

        // Log no canal
        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (logChannel) {
            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            const mention = staffRoleId ? `<@&${staffRoleId}>` : '';
            const logContent = ReportChatFormatter.createLogEmbed(ticketId, user, threadUrl);
            await logChannel.send({ content: mention || '', ...logContent });
        }

        await ResponseManager.success(interaction, `${ticketId} criado! Acesse: ${threadUrl}`);
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

        const targetUser = await this.client.users.fetch(ticket.user_id);
        const threadUrl = thread.url;

        // ATUALIZAR DM existente (editar em vez de criar novo)
        if (ticket.dm_message_id) {
            try {
                const dmChannel = await targetUser.createDM();
                const dmMessage = await dmChannel.messages.fetch(ticket.dm_message_id).catch(() => null);
                if (dmMessage) {
                    const dmContent = ReportChatFormatter.createUserDmEmbed(ticketId, targetUser, threadUrl, user);
                    await dmMessage.edit(dmContent);
                }
            } catch (err) {
                // Se não conseguir editar, envia novo
                const dmContent = ReportChatFormatter.createUserDmEmbed(ticketId, targetUser, threadUrl, user);
                await targetUser.send(dmContent).catch(() => null);
            }
        } else {
            const dmContent = ReportChatFormatter.createUserDmEmbed(ticketId, targetUser, threadUrl, user);
            await targetUser.send(dmContent).catch(() => null);
        }

        // ATUALIZAR thread
        const threadContent = ReportChatFormatter.createThreadEmbed(ticketId, targetUser, threadUrl, user);
        await thread.send({ content: `<@${targetUser.id}>`, ...threadContent });

        // Log no canal
        const logChannelId = ConfigSystem.getSetting(guild.id, 'log_tickets');
        if (logChannelId) {
            const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                const logContent = ReportChatFormatter.createLogEmbed(ticketId, targetUser, threadUrl, user, 'update');
                await logChannel.send(logContent);
            }
        }

        await ResponseManager.success(interaction, `Você entrou no ${ticketId}`);
    }

    async _closeTicket(interaction, ticketId, staff, motivo, punicao, hasReason, nota = null, comentario = null) {
        const { guild } = interaction;

        const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ? AND guild_id = ? AND status = 'open'`).get(ticketId, guild.id);
        if (!ticket) {
            return await ResponseManager.error(interaction, 'ReportChat não encontrado.');
        }

        const thread = await guild.channels.fetch(ticket.thread_id).catch(() => null);
        const threadUrl = thread ? thread.url : 'Canal deletado';
        
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

        // EDITAR DM existente (em vez de criar novo)
        if (ticket.dm_message_id) {
            try {
                const dmChannel = await targetUser.createDM();
                const dmMessage = await dmChannel.messages.fetch(ticket.dm_message_id).catch(() => null);
                if (dmMessage) {
                    const dmContent = ReportChatFormatter.createUserDmClosedEmbed(ticketId, targetUser, threadUrl, staff, motivo, punicao);
                    await dmMessage.edit(dmContent);
                }
            } catch (err) {
                // Fallback: enviar novo
                const dmContent = ReportChatFormatter.createUserDmClosedEmbed(ticketId, targetUser, threadUrl, staff, motivo, punicao);
                await targetUser.send(dmContent).catch(() => null);
            }
        } else {
            const dmContent = ReportChatFormatter.createUserDmClosedEmbed(ticketId, targetUser, threadUrl, staff, motivo, punicao);
            await targetUser.send(dmContent).catch(() => null);
        }

        // EDITAR thread (se existir)
        if (thread) {
            const threadContent = ReportChatFormatter.createThreadClosedEmbed(ticketId, targetUser, threadUrl, staff, motivo, punicao);
            await thread.send(threadContent);
        }

        // Enviar log
        if (logChannelId) {
            const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                const logContent = ReportChatFormatter.createLogEmbed(ticketId, targetUser, threadUrl, staff, 'close', motivo, punicao);
                await logChannel.send(logContent);
            }
        }

        await ResponseManager.success(interaction, `${ticketId} fechado com sucesso!`);
    }

    async closeTicketWithReason(interaction, ticketId, motivo, punicao) {
        const { user, member } = interaction;
        const staffRoleId = ConfigSystem.getSetting(interaction.guild.id, 'staff_role');
        if (!staffRoleId || !member.roles.cache.has(staffRoleId)) {
            return await ResponseManager.error(interaction, 'Apenas staff pode fechar.');
        }
        await this._closeTicket(interaction, ticketId, user, motivo, punicao, true);
    }

    async closeTicketWithoutReason(interaction, ticketId) {
        const { user, member } = interaction;
        const staffRoleId = ConfigSystem.getSetting(interaction.guild.id, 'staff_role');
        if (!staffRoleId || !member.roles.cache.has(staffRoleId)) {
            return await ResponseManager.error(interaction, 'Apenas staff pode fechar.');
        }
        await this._closeTicket(interaction, ticketId, user, 'Fechado sem motivo', 'Nenhuma', false);
    }

    async closeTicketWithRating(interaction, ticketId, nota, comentario) {
        const { user, member } = interaction;
        const staffRoleId = ConfigSystem.getSetting(interaction.guild.id, 'staff_role');
        if (!staffRoleId || !member.roles.cache.has(staffRoleId)) {
            return await ResponseManager.error(interaction, 'Apenas staff pode fechar.');
        }
        await this._closeTicket(interaction, ticketId, user, 'Avaliado pelo usuário', 'Nenhuma', true, nota, comentario);
    }

    async getTicketLink(guildId, ticketId) {
        const ticket = db.prepare(`
            SELECT thread_id FROM tickets 
            WHERE id = ? AND guild_id = ? AND status = 'closed'
        `).get(ticketId, guildId);
        
        if (!ticket) return null;
        
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return null;
        
        const thread = await guild.channels.fetch(ticket.thread_id).catch(() => null);
        if (!thread) return null;
        
        return thread.url;
    }

}

module.exports = ReportChatSystem;