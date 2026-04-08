// src/systems/reportChatSystem.js
const db = require('../database/index');
const ResponseManager = require('../utils/responseManager');
const ReportChatFormatter = require('../utils/reportChatFormatter');
const ConfigSystem = require('./configSystem');
const { ChannelType } = require('discord.js');

// Carregar emojis
let EMOJIS = {};
try {
    const emojisFile = require('../database/emojis.js');
    EMOJIS = emojisFile.EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

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
        return isNaN(lastNumber) ? 1 : lastNumber + 1;
    }

        async createTicket(interaction) {
        const { guild, user } = interaction;
        
        // Já tem deferReply do interactionCreate, então usamos editReply
        try {
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_tickets');
            if (!logChannelId) {
                return await interaction.editReply({ 
                    content: '❌ **Canal de logs não configurado!**\n\nUse `/config-logs` e selecione um canal para **ReportChat**.',
                    flags: 64
                });
            }
            
            // Verificar se já existe ticket aberto
            const existing = db.prepare(`SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'`).get(guild.id, user.id);
            if (existing) {
                return await interaction.editReply({ 
                    content: `${EMOJIS.Error || '❌'} Você já possui um ticket aberto!\n\nAguarde o fechamento para abrir um novo.`,
                    flags: 64
                });
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
                INSERT INTO tickets (id, guild_id, user_id, thread_id, created_at, status)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(ticketId, guild.id, user.id, thread.id, Date.now(), 'open');

            const threadUrl = thread.url;

            // DM do usuário (não precisa de await para não travar)
            const dmContent = ReportChatFormatter.createUserDmEmbed(ticketId, user, threadUrl);
            user.send(dmContent).catch(() => null);

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

            // Resposta usando editReply (já que teve defer)
            await interaction.editReply({ 
                content: `${ticketId} criado! Acesse: ${threadUrl}`,
                flags: 64
            });
            
        } catch (error) {
            console.error('❌ Erro ao criar ticket:', error);
            await interaction.editReply({ 
                content: '❌ Ocorreu um erro ao criar o ticket. Tente novamente.',
                flags: 64
            });
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

        const targetUser = await this.client.users.fetch(ticket.user_id);
        const threadUrl = thread.url;

        // Atualizar DM
        const dmContent = ReportChatFormatter.createUserDmEmbed(ticketId, targetUser, threadUrl, user);
        await targetUser.send(dmContent).catch(() => null);

        // Atualizar thread
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

    async _closeTicket(interaction, ticketId, staff, motivo, punicao, hasReason, nota = null) {
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

        // Atualizar usando a estrutura simplificada
        db.prepare(`
            UPDATE tickets SET 
                status = 'closed', 
                closed_at = ?, 
                closed_by = ?, 
                closed_reason = ?,
                rating = ?
            WHERE id = ?
        `).run(Date.now(), staff.id, hasReason ? motivo : null, nota || null, ticketId);

        const targetUser = await this.client.users.fetch(ticket.user_id);
        const logChannelId = ConfigSystem.getSetting(guild.id, 'log_tickets');

        // Atualizar DM
        const dmContent = ReportChatFormatter.createUserDmClosedEmbed(ticketId, targetUser, threadUrl, staff, motivo, punicao);
        await targetUser.send(dmContent).catch(() => null);

        // Atualizar thread
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
        await this._closeTicket(interaction, ticketId, user, 'Avaliado pelo usuário', 'Nenhuma', true, nota);
    }

    async getTicketLink(guildId, ticketId) {
        const ticket = db.prepare(`
            SELECT thread_id FROM tickets 
            WHERE id = ? AND guild_id = ?
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