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
            const isClosed = report.status === 'closed_no_reason' || report.status === 'closed_with_reason';

            // Atualizar LOG (manter botões se não estiver fechado)
            if (report.log_message_id) {
                const logChannelId = ConfigSystem.getSetting(guildId, 'log_reports');
                if (logChannelId) {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const logMessage = await logChannel.messages.fetch(report.log_message_id).catch(() => null);
                        if (logMessage) {
                            const logContent = ReportChatFormatter.createLogEmbed(
                                reportId, targetUser, threadUrl, staffs, 
                                report.status, report.punishment, report.rating, report.rating_comment, guild.name
                            );
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
                        const dmContent = ReportChatFormatter.createUserDmEmbed(
                            reportId, targetUser, guild.name, threadUrl, staffs, report.status, report.closed_by, report.closed_reason
                        );
                        await dmMessage.edit(dmContent);
                    }
                }
            }

            // Atualizar THREAD (sem botões)
            if (report.thread_message_id && thread && !thread.archived) {
                const threadMessage = await thread.messages.fetch(report.thread_message_id).catch(() => null);
                if (threadMessage) {
                    const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
                    const threadContent = ReportChatFormatter.createThreadEmbed(
                        reportId, targetUser, guild.name, staffRoleId, report.status
                    );
                    await threadMessage.edit(threadContent);
                }
            }
        }

        async openReport(interaction, data) {
        const { guild, user } = interaction;
        
        // 1. RESPONDER IMEDIATAMENTE (evita timeout)
        await interaction.reply({ content: '⏳ Processando sua solicitação...', flags: 64 });
        
        try {
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
            if (!logChannelId) {
                return await interaction.editReply({ content: '❌ Canal de logs não configurado! Use `/config-logs`.', flags: 64 });
            }

            const existing = db.prepare(`SELECT * FROM reports WHERE guild_id = ? AND user_id = ? AND status NOT LIKE 'closed%'`).get(guild.id, user.id);
            if (existing) {
                return await interaction.editReply({ content: `${EMOJIS.Error || '❌'} Você já possui um report aberto!`, flags: 64 });
            }

            const reportId = `#R${this.getNextReportId(guild.id)}`;
            const threadName = `${reportId}│${user.username}`.toLowerCase().replace(/[^a-z0-9│]/g, '-');
            
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

            // Enviar dados do modal na thread
            const modalResponseEmbed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setDescription(`# 📋 Informações do Report\n**Seu nick:** ${data.seuNick}\n**Alvo:** ${data.alvoNick}\n**Data/Hora:** ${data.dataHora}\n**Regra:** ${data.regra}\n\n**Descrição:**\n${data.descricao}`)
                .setTimestamp();
            await thread.send({ embeds: [modalResponseEmbed] });

            // Criar DM
            const dmContent = ReportChatFormatter.createUserDmEmbed(reportId, user, guild.name, thread.url);
            const dmMessage = await user.send(dmContent).catch(() => null);
            const dmMessageId = dmMessage ? dmMessage.id : null;

            // Criar log
            const logChannel = await guild.channels.fetch(logChannelId);
            const logContent = ReportChatFormatter.createLogEmbed(reportId, user, thread.url, [], 'waiting', null, null, null, guild.name);
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

            // EDITAR a mensagem original com sucesso
            await interaction.editReply({ content: `${reportId} criado! Acesse: ${thread.url}`, flags: 64 });
            
        } catch (error) {
            console.error('❌ Erro ao criar report:', error);
            await interaction.editReply({ content: '❌ Erro ao criar report. Tente novamente.', flags: 64 });
        }
    }
        async joinReport(interaction, reportId) {
            const { guild, user, member } = interaction;
            
            try {
                const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
                if (!staffRoleId || !member.roles.cache.has(staffRoleId)) {
                    return await interaction.editReply({ content: `${EMOJIS.Error || '❌'} Apenas staff pode entrar.`, components: [] });
                }

                const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND guild_id = ? AND status NOT LIKE 'closed%'`).get(reportId, guild.id);
                if (!report) {
                    return await interaction.editReply({ content: `${EMOJIS.Error || '❌'} Report não encontrado.`, components: [] });
                }

                const thread = await guild.channels.fetch(report.thread_id);
                await thread.members.add(user.id);

                let staffs = report.staffs ? JSON.parse(report.staffs) : [];
                if (!staffs.includes(user.id)) {
                    staffs.push(user.id);
                    db.prepare(`UPDATE reports SET staffs = ? WHERE id = ?`).run(JSON.stringify(staffs), reportId);
                }

                await this.updateEmbeds(guild.id, reportId);
                
                await interaction.editReply({ content: `${EMOJIS.Check || '✅'} Você entrou no ${reportId}`, components: [] });
                
            } catch (error) {
                console.error('❌ Erro ao entrar no report:', error);
                await interaction.editReply({ content: '❌ Erro ao entrar no report.', components: [] });
            }
        }

        async closeReport(interaction, reportId, motivo, punicao, hasReason, isStaff = true) {
                const { guild, user, member } = interaction;
                
                try {
                    // Verificar se member existe
                    const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
                    const isStaffUser = isStaff && staffRoleId && member?.roles?.cache?.has(staffRoleId);
                    
                    const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND guild_id = ? AND status NOT LIKE 'closed%'`).get(reportId, guild.id);
                    
                    if (!report) {
                        return await interaction.editReply({ content: `${EMOJIS.Error || '❌'} Report não encontrado.`, components: [] });
                    }

                    const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
                    
                    const status = hasReason ? 'closed_with_reason' : 'closed_no_reason';
                    const closedByName = isStaffUser ? `Staff <@${user.id}>` : `Usuário <@${user.id}>`;
                    const closedReasonText = hasReason ? `${closedByName}: ${motivo}` : `${closedByName} (sem motivo)`;
                    
                    db.prepare(`UPDATE reports SET status = ?, closed_at = ?, closed_by = ?, closed_reason = ?, punishment = ? WHERE id = ?`)
                        .run(status, Date.now(), user.id, closedReasonText, punicao || null, reportId);

                    // Atualizar embeds ANTES de arquivar
                    await this.updateEmbeds(guild.id, reportId);
                    
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