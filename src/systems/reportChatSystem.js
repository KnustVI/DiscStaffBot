// src/systems/reportChatSystem.js
const db = require('../database/index');
const ReportChatFormatter = require('../utils/reportChatFormatter');
const ConfigSystem = require('./configSystem');
const { ChannelType } = require('discord.js');

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

    getNextReportId(guildId) {
        const lastReport = db.prepare(`SELECT id FROM reports WHERE guild_id = ? ORDER BY created_at DESC LIMIT 1`).get(guildId);
        if (!lastReport) return 1;
        const lastNumber = parseInt(lastReport.id.replace('#R', ''));  // ← #R
        return isNaN(lastNumber) ? 1 : lastNumber + 1;
    }

    async updateEmbeds(guildId, reportId) {
        const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND guild_id = ?`).get(reportId, guildId);
        if (!report) return;

        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;

        const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
        const threadUrl = thread ? thread.url : '#';
        const targetUser = await this.client.users.fetch(report.user_id).catch(() => null);
        if (!targetUser) return;

        const staffs = report.staffs ? JSON.parse(report.staffs) : [];

        // Atualizar log
        if (report.log_message_id) {
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_reports'); // ← CORRIGIDO
            if (logChannelId) {
                const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                if (logChannel) {
                    const logMessage = await logChannel.messages.fetch(report.log_message_id).catch(() => null);
                    if (logMessage) {
                        const logContent = ReportChatFormatter.createLogEmbed(reportId, targetUser, threadUrl, staffs, report.status, report.punishment, report.rating, report.rating_comment);
                        await logMessage.edit(logContent);
                    }
                }
            }
        }

        // Atualizar DM
        if (report.dm_message_id) {
            const dmChannel = await targetUser.createDM().catch(() => null);
            if (dmChannel) {
                const dmMessage = await dmChannel.messages.fetch(report.dm_message_id).catch(() => null);
                if (dmMessage) {
                    const dmContent = ReportChatFormatter.createUserDmEmbed(reportId, targetUser, guild.name, threadUrl, staffs, report.status);
                    await dmMessage.edit(dmContent);
                }
            }
        }

        // Atualizar thread
        if (report.thread_message_id && thread) {
            const threadMessage = await thread.messages.fetch(report.thread_message_id).catch(() => null);
            if (threadMessage) {
                const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
                const threadContent = ReportChatFormatter.createThreadEmbed(reportId, targetUser, guild.name, staffRoleId, report.status);
                await threadMessage.edit(threadContent);
            }
        }
    }

    async openReport(interaction, data) {
        const { guild, user } = interaction;
        
        const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports'); // ← CORRIGIDO
        if (!logChannelId) {
            return await interaction.reply({ content: '❌ Canal de logs não configurado! Use `/config-logs`.', flags: 64 });
        }

        const existing = db.prepare(`SELECT * FROM reports WHERE guild_id = ? AND user_id = ? AND status NOT LIKE 'closed%'`).get(guild.id, user.id);
        if (existing) {
            return await interaction.reply({ content: `${EMOJIS.Error || '❌'} Você já possui um report aberto!`, flags: 64 });
        }

        const reportId = `#R${this.getNextReportId(guild.id)}`;
        const threadName = `report-${reportId.substring(1)}-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        
        const channel = interaction.channel;
        const thread = await channel.threads.create({
            name: threadName,
            type: ChannelType.PrivateThread,
            invitable: false,
            reason: `ReportChat criado por ${user.tag}`
        });

        await thread.members.add(user.id);

        // Criar embed na thread
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        const threadContent = ReportChatFormatter.createThreadEmbed(reportId, user, guild.name, staffRoleId);
        const threadMessage = await thread.send(threadContent);
        const threadMessageId = threadMessage.id;

        // Criar DM
        const dmContent = ReportChatFormatter.createUserDmEmbed(reportId, user, guild.name, thread.url);
        const dmMessage = await user.send(dmContent).catch(() => null);
        const dmMessageId = dmMessage ? dmMessage.id : null;

        // Criar log
        const logChannel = await guild.channels.fetch(logChannelId);
        const logContent = ReportChatFormatter.createLogEmbed(reportId, user, thread.url);
        const logMessage = await logChannel.send(logContent);
        const logMessageId = logMessage.id;

        // Salvar no banco
        db.prepare(`
            INSERT INTO reports (id, guild_id, user_id, thread_id, log_message_id, dm_message_id, thread_message_id, status, created_at, last_message_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(reportId, guild.id, user.id, thread.id, logMessageId, dmMessageId, threadMessageId, 'waiting', Date.now(), Date.now());

        // Salvar informações do modal
        const modalData = JSON.stringify(data);
        db.prepare(`UPDATE reports SET description = ? WHERE id = ?`).run(modalData, reportId);

        await interaction.reply({ content: `${reportId} criado! Acesse: ${thread.url}`, flags: 64 });
    }

    async joinReport(interaction, reportId) {
        const { guild, user, member } = interaction;
        
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        if (!staffRoleId || !member.roles.cache.has(staffRoleId)) {
            return await interaction.reply({ content: `${EMOJIS.Error || '❌'} Apenas staff pode entrar.`, flags: 64 });
        }

        const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND guild_id = ? AND status NOT LIKE 'closed%'`).get(reportId, guild.id);
        if (!report) {
            return await interaction.reply({ content: `${EMOJIS.Error || '❌'} Report não encontrado.`, flags: 64 });
        }

        const thread = await guild.channels.fetch(report.thread_id);
        await thread.members.add(user.id);

        let staffs = report.staffs ? JSON.parse(report.staffs) : [];
        if (!staffs.includes(user.id)) {
            staffs.push(user.id);
            db.prepare(`UPDATE reports SET staffs = ? WHERE id = ?`).run(JSON.stringify(staffs), reportId);
        }

        await this.updateEmbeds(guild.id, reportId);
        await interaction.reply({ content: `${EMOJIS.Check || '✅'} Você entrou no ${reportId}`, flags: 64 });
    }

    async closeReport(interaction, reportId, motivo, punicao, hasReason) {
        const { guild, user, member } = interaction;
        
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        const isStaff = staffRoleId && member.roles.cache.has(staffRoleId);
        const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND guild_id = ? AND status NOT LIKE 'closed%'`).get(reportId, guild.id);
        
        if (!report) {
            return await interaction.reply({ content: `${EMOJIS.Error || '❌'} Report não encontrado.`, flags: 64 });
        }

        const thread = await guild.channels.fetch(report.thread_id);
        await thread.members.remove(report.user_id);
        await thread.setLocked(true);
        await thread.setArchived(true);

        const status = hasReason ? 'closed_with_reason' : 'closed_no_reason';
        db.prepare(`UPDATE reports SET status = ?, closed_at = ?, closed_by = ?, closed_reason = ?, punishment = ? WHERE id = ?`)
            .run(status, Date.now(), user.id, motivo || null, punicao || null, reportId);

        await this.updateEmbeds(guild.id, reportId);
        
        const responseText = hasReason ? `${reportId} fechado com motivo: ${motivo}` : `${reportId} fechado sem motivo`;
        await interaction.reply({ content: `${EMOJIS.Check || '✅'} ${responseText}`, flags: 64 });
    }

    async rateReport(interaction, reportId, nota, comentario) {
        const { user } = interaction;
        
        const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND user_id = ? AND status LIKE 'closed%'`).get(reportId, user.id);
        if (!report) {
            return await interaction.reply({ content: `${EMOJIS.Error || '❌'} Report não encontrado.`, flags: 64 });
        }

        if (report.rating) {
            return await interaction.reply({ content: `${EMOJIS.Error || '❌'} Este report já foi avaliado.`, flags: 64 });
        }

        db.prepare(`UPDATE reports SET rating = ?, rating_comment = ? WHERE id = ?`).run(nota, comentario, reportId);
        await this.updateEmbeds(report.guild_id, reportId);
        
        await interaction.reply({ content: `${EMOJIS.Check || '✅'} Avaliação registrada! Obrigado pelo feedback.`, flags: 64 });
    }

    async updateStatus(reportId, status) {
        const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND status NOT LIKE 'closed%'`).get(reportId);
        if (report) {
            db.prepare(`UPDATE reports SET status = ?, last_message_at = ? WHERE id = ?`).run(status, Date.now(), reportId);
            await this.updateEmbeds(report.guild_id, reportId);
        }
    }

    // Método para buscar link do report (usado no strike)
    async getReportLink(guildId, reportId) {
        const report = db.prepare(`SELECT thread_id FROM reports WHERE id = ? AND guild_id = ?`).get(reportId, guildId);
        if (!report) return null;
        
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return null;
        
        const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
        if (!thread) return null;
        
        return thread.url;
    }
}

module.exports = ReportChatSystem;