// src/systems/reportChatSystem.js
const db = require('../database/index');
const ReportChatFormatter = require('../utils/reportChatFormatter');
const ConfigSystem = require('./configSystem');
const { ChannelType, EmbedBuilder } = require('discord.js');

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
        const lastNumber = parseInt(lastReport.id.replace('#R', ''));
        return isNaN(lastNumber) ? 1 : lastNumber + 1;
    }

    async updateAllEmbeds(guildId, reportId) {
        const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND guild_id = ?`).get(reportId, guildId);
        if (!report) return;

        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;

        const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
        const threadUrl = thread ? thread.url : '#';
        const targetUser = await this.client.users.fetch(report.user_id).catch(() => null);
        if (!targetUser) return;

        const staffs = report.staffs ? JSON.parse(report.staffs) : [];
        const isClosed = report.status === 'closed_no_reason' || report.status === 'closed_with_reason';

        // Atualizar LOG
        if (report.log_message_id) {
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_reports');
            if (logChannelId) {
                const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                if (logChannel) {
                    const logMessage = await logChannel.messages.fetch(report.log_message_id).catch(() => null);
                    if (logMessage) {
                        const logContent = ReportChatFormatter.createLogEmbed(
                            reportId, targetUser, threadUrl, staffs, 
                            report.status, report.punishment, report.rating, report.rating_comment, guild.name,
                            report.closed_by, report.closed_reason
                        );
                        await logMessage.edit({ embeds: logContent.embeds, components: logContent.components });
                    }
                }
            }
        }

        // Atualizar DM
        if (report.dm_message_id && targetUser) {
            const dmChannel = await targetUser.createDM().catch(() => null);
            if (dmChannel) {
                const dmMessage = await dmChannel.messages.fetch(report.dm_message_id).catch(() => null);
                if (dmMessage) {
                    const dmContent = ReportChatFormatter.createUserDmEmbed(
                        reportId, targetUser, guild.name, threadUrl, staffs, report.status, report.closed_by, report.closed_reason
                    );
                    await dmMessage.edit({ embeds: dmContent.embeds, components: dmContent.components });
                }
            }
        }

        // Atualizar THREAD
        if (report.thread_message_id && thread && !thread.archived) {
            const threadMessage = await thread.messages.fetch(report.thread_message_id).catch(() => null);
            if (threadMessage) {
                const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
                const threadContent = ReportChatFormatter.createThreadEmbed(reportId, targetUser, guild.name, staffRoleId, report.status);
                await threadMessage.edit({ embeds: threadContent.embeds, components: threadContent.components });
            }
        }
    }

    async openReport(interaction, data) {
        const { guild, user } = interaction;
        
        await interaction.reply({ content: '⏳ Processando...', flags: 64 });
        
        try {
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
            if (!logChannelId) {
                return await interaction.editReply({ content: '❌ Canal de logs não configurado!', flags: 64 });
            }

            const existing = db.prepare(`SELECT * FROM reports WHERE guild_id = ? AND user_id = ? AND status NOT LIKE 'closed%'`).get(guild.id, user.id);
            if (existing) {
                return await interaction.editReply({ content: `${EMOJIS.Error || '❌'} Você já possui um report aberto!`, flags: 64 });
            }

            const reportId = `#R${this.getNextReportId(guild.id)}`;
            const threadName = `${reportId}-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
            
            const thread = await interaction.channel.threads.create({
                name: threadName,
                type: ChannelType.PrivateThread,
                invitable: false,
                reason: `ReportChat criado por ${user.tag}`
            });

            await thread.members.add(user.id);

            // Thread embed
            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            const threadContent = ReportChatFormatter.createThreadEmbed(reportId, user, guild.name, staffRoleId);
            const threadMessage = await thread.send(threadContent);
            
            // Informações do modal na thread
            const infoEmbed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setDescription(`# 📋 Informações do Report\n**Seu nick:** ${data.seuNick}\n**Alvo:** ${data.alvoNick}\n**Data/Hora:** ${data.dataHora}\n**Regra:** ${data.regra}\n\n**Descrição:**\n${data.descricao}`)
                .setTimestamp();
            await thread.send({ embeds: [infoEmbed] });

            // DM
            const dmContent = ReportChatFormatter.createUserDmEmbed(reportId, user, guild.name, thread.url);
            const dmMessage = await user.send(dmContent).catch(() => null);

            // Log
            const logChannel = await guild.channels.fetch(logChannelId);
            const logContent = ReportChatFormatter.createLogEmbed(reportId, user, thread.url, [], 'waiting', null, null, null, guild.name);
            const logMessage = await logChannel.send(logContent);

            // Salvar
            db.prepare(`
                INSERT INTO reports (id, guild_id, user_id, thread_id, log_message_id, dm_message_id, thread_message_id, status, created_at, last_message_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(reportId, guild.id, user.id, thread.id, logMessage.id, dmMessage?.id || null, threadMessage.id, 'waiting', Date.now(), Date.now());

            await interaction.editReply({ content: `${reportId} criado! Acesse: ${thread.url}`, flags: 64 });
            
        } catch (error) {
            console.error('❌ Erro ao criar report:', error);
            await interaction.editReply({ content: '❌ Erro ao criar report.', flags: 64 });
        }
    }

    async joinReport(interaction, reportId) {
        const { guild, user, member } = interaction;
        
        try {
            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            if (!member?.roles?.cache?.has(staffRoleId)) {
                return await interaction.editReply({ content: `${EMOJIS.Error || '❌'} Apenas staff pode entrar.`, components: [] });
            }

            const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND guild_id = ?`).get(reportId, guild.id);
            if (!report || report.status.includes('closed')) {
                return await interaction.editReply({ content: `${EMOJIS.Error || '❌'} Report não encontrado.`, components: [] });
            }

            const thread = await guild.channels.fetch(report.thread_id);
            if (!thread) return await interaction.editReply({ content: `${EMOJIS.Error || '❌'} Thread não encontrada.`, components: [] });
            
            await thread.members.add(user.id);

            let staffs = report.staffs ? JSON.parse(report.staffs) : [];
            if (!staffs.includes(user.id)) {
                staffs.push(user.id);
                db.prepare(`UPDATE reports SET staffs = ? WHERE id = ?`).run(JSON.stringify(staffs), reportId);
            }

            await this.updateAllEmbeds(guild.id, reportId);
            await interaction.editReply({ content: `${EMOJIS.Check || '✅'} Você entrou no ${reportId}`, components: [] });
            
        } catch (error) {
            console.error('❌ Erro ao entrar no report:', error);
            await interaction.editReply({ content: '❌ Erro ao entrar no report.', components: [] });
        }
    }

    async closeReport(interaction, reportId, motivo, punicao, hasReason, isStaff = true) {
        const { guild, user, member } = interaction;
        
        try {
            const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND guild_id = ? AND status NOT LIKE 'closed%'`).get(reportId, guild.id);
            if (!report) {
                return await interaction.editReply({ content: `${EMOJIS.Error || '❌'} Report não encontrado.`, components: [] });
            }

            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            const isStaffUser = isStaff && member?.roles?.cache?.has(staffRoleId);
            
            const status = hasReason ? 'closed_with_reason' : 'closed_no_reason';
            const closedByName = isStaffUser ? `Staff <@${user.id}>` : `Usuário <@${user.id}>`;
            const closedReason = hasReason ? motivo : null;
            
            db.prepare(`UPDATE reports SET status = ?, closed_at = ?, closed_by = ?, closed_reason = ?, punishment = ? WHERE id = ?`)
                .run(status, Date.now(), user.id, closedReason, punicao || null, reportId);

            // Buscar dados atualizados
            const updatedReport = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(reportId);
            const staffs = updatedReport.staffs ? JSON.parse(updatedReport.staffs) : [];
            const targetUser = await this.client.users.fetch(report.user_id).catch(() => null);
            const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
            const threadUrl = thread ? thread.url : '#';

            // Atualizar LOG
            if (updatedReport.log_message_id) {
                const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
                if (logChannelId) {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const logMessage = await logChannel.messages.fetch(updatedReport.log_message_id).catch(() => null);
                        if (logMessage) {
                            const logContent = ReportChatFormatter.createLogEmbed(
                                reportId, targetUser, threadUrl, staffs, status, punicao, 
                                updatedReport.rating, updatedReport.rating_comment, guild.name, closedByName, closedReason
                            );
                            await logMessage.edit({ embeds: logContent.embeds, components: logContent.components });
                        }
                    }
                }
            }

            // Atualizar DM
            if (updatedReport.dm_message_id && targetUser) {
                const dmChannel = await targetUser.createDM().catch(() => null);
                if (dmChannel) {
                    const dmMessage = await dmChannel.messages.fetch(updatedReport.dm_message_id).catch(() => null);
                    if (dmMessage) {
                        const dmContent = ReportChatFormatter.createUserDmEmbed(
                            reportId, targetUser, guild.name, threadUrl, staffs, status, closedByName, closedReason
                        );
                        await dmMessage.edit({ embeds: dmContent.embeds, components: dmContent.components });
                    }
                }
            }

            // Arquivar thread
            if (thread) {
                await thread.members.remove(report.user_id).catch(() => null);
                await thread.setLocked(true);
                await thread.setArchived(true);
            }

            const responseText = hasReason ? `${reportId} fechado com motivo: ${motivo}` : `${reportId} fechado sem motivo`;
            await interaction.editReply({ content: `${EMOJIS.Check || '✅'} ${responseText}`, components: [] });
            
        } catch (error) {
            console.error('❌ Erro ao fechar report:', error);
            await interaction.editReply({ content: '❌ Erro ao fechar report.', components: [] });
        }
    }

    async rateReport(interaction, reportId, nota, comentario) {
        const { user } = interaction;
        
        try {
            const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND user_id = ? AND status LIKE 'closed%'`).get(reportId, user.id);
            if (!report) {
                return await interaction.editReply({ content: `${EMOJIS.Error || '❌'} Report não encontrado.`, flags: 64 });
            }

            if (report.rating) {
                return await interaction.editReply({ content: `${EMOJIS.Error || '❌'} Este report já foi avaliado.`, flags: 64 });
            }

            db.prepare(`UPDATE reports SET rating = ?, rating_comment = ? WHERE id = ?`).run(nota, comentario, reportId);
            await this.updateAllEmbeds(report.guild_id, reportId);
            
            await interaction.editReply({ content: `${EMOJIS.Check || '✅'} Avaliação registrada! Obrigado.`, flags: 64 });
            
        } catch (error) {
            console.error('❌ Erro ao avaliar report:', error);
            await interaction.editReply({ content: '❌ Erro ao avaliar report.', flags: 64 });
        }
    }

    async getReportLink(guildId, reportId) {
        const report = db.prepare(`SELECT thread_id FROM reports WHERE id = ? AND guild_id = ?`).get(reportId, guildId);
        if (!report) return null;
        
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return null;
        
        const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
        return thread ? thread.url : null;
    }
}

module.exports = ReportChatSystem;