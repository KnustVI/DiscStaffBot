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
        
        const logChannelId = ConfigSystem.getSetting(guild.id, 'log_tickets');
        if (!logChannelId) {
            return await ResponseManager.error(interaction, 
                '❌ **Canal de logs não configurado!**\n\n' +
                'Um administrador precisa configurar o canal de logs de ReportChat primeiro.\n\n' +
                'Use `/config-logs` e selecione um canal para **ReportChat**.'
            );
        }
        
        const existing = db.prepare(`SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'`).get(guild.id, user.id);
        if (existing) {
            return await ResponseManager.error(interaction, 'Você já possui um canal aberto. Aguarde o fechamento para abrir outro.');
        }

        const ticketNumber = this.getNextTicketId(guild.id);
        const ticketId = `#RC${ticketNumber}`;
        
        const threadName = user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        
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

        const dmEmbed = ReportChatFormatter.createTicketEmbed(ticketId, user);
        await user.send(dmEmbed).catch(() => null);

        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (logChannel) {
            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            const mention = staffRoleId ? `<@&${staffRoleId}>` : '';
            const logEmbed = ReportChatFormatter.createLogEmbed(ticketId, user, thread.url);
            await logChannel.send({ content: mention || '', ...logEmbed });
        }

        const threadEmbed = ReportChatFormatter.createTicketEmbed(ticketId, user);
        await thread.send({ content: `<@${user.id}>`, ...threadEmbed });

        await ResponseManager.success(interaction, `ReportChat ${ticketId} criado! Acesse: ${thread.url}`);
    }

    async joinTicket(interaction, ticketId) {
        const { guild, user, member } = interaction;
        
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        if (!staffRoleId || !member.roles.cache.has(staffRoleId)) {
            return await ResponseManager.error(interaction, 'Apenas staff pode entrar em ReportChats.');
        }

        const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ? AND guild_id = ? AND status = 'open'`).get(ticketId, guild.id);
        if (!ticket) {
            return await ResponseManager.error(interaction, 'ReportChat não encontrado ou já fechado.');
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
                const logEmbed = ReportChatFormatter.createLogEmbed(ticketId, targetUser, thread.url, user, 'update');
                await logChannel.send(logEmbed);
            }
        }

        const targetUser = await this.client.users.fetch(ticket.user_id);
        const dmEmbed = ReportChatFormatter.createTicketEmbed(ticketId, targetUser, user);
        await targetUser.send(dmEmbed).catch(() => null);

        const threadEmbed = ReportChatFormatter.createTicketEmbed(ticketId, targetUser, user);
        await thread.send({ content: `<@${targetUser.id}>`, ...threadEmbed });

        await ResponseManager.success(interaction, `Você entrou no ReportChat ${ticketId}`);
    }

    async closeTicket(interaction, ticketId, nota = null, comentario = null) {
        const { guild, user, member } = interaction;
        
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        if (!staffRoleId || !member.roles.cache.has(staffRoleId)) {
            return await ResponseManager.error(interaction, 'Apenas staff pode fechar ReportChats.');
        }

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
                rating = ?, 
                rating_comment = ?
            WHERE id = ?
        `).run(Date.now(), user.id, nota || null, comentario || null, ticketId);

        const targetUser = await this.client.users.fetch(ticket.user_id);
        
        if (nota) {
            const embed = new EmbedBuilder()
                .setColor(0xBBF96A)
                .setDescription(`# ⭐ ReportChat Fechado com Avaliação\n**ID:** ${ticketId}\n**Staff:** ${user.tag}\n**Sua nota:** ${'⭐'.repeat(nota)} (${nota}/5)\n**Comentário:** ${comentario || 'Nenhum'}\n\nObrigado pelo feedback!`)
                .setTimestamp();
            await targetUser.send({ embeds: [embed] }).catch(() => null);
        } else {
            const embed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setDescription(`# 🔒 ReportChat Fechado\n**ID:** ${ticketId}\n**Staff:** ${user.tag}\n\nO canal foi fechado sem avaliação.`)
                .setTimestamp();
            await targetUser.send({ embeds: [embed] }).catch(() => null);
        }

        const logChannelId = ConfigSystem.getSetting(guild.id, 'log_tickets');
        if (logChannelId) {
            const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                const embed = new EmbedBuilder()
                    .setColor(0xF64B4E)
                    .setDescription(`# 🔒 ReportChat Fechado\n**ID:** ${ticketId}\n**Usuário:** ${targetUser.tag}\n**Fechado por:** ${user.tag}\n**Avaliação:** ${nota ? `${'⭐'.repeat(nota)} (${nota}/5)` : 'Sem avaliação'}\n**Comentário:** ${comentario || 'Nenhum'}`)
                    .setTimestamp();
                await logChannel.send({ embeds: [embed] });
            }
        }

        await ResponseManager.success(interaction, `ReportChat ${ticketId} fechado com sucesso.`);
    }
}

module.exports = ReportChatSystem;