// src/systems/reportChatSystem.js
const db = require('../database/index');
const ReportChatFormatter = require('../utils/reportChatFormatter');
const EmbedFormatter = require('../utils/embedFormatter');
const ConfigSystem = require('./configSystem');
const { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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
                return await interaction.editReply({ 
                    content: `${EMOJIS.Error || '❌'} Apenas staff pode entrar.`, 
                    components: [] 
                });
            }

            const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND guild_id = ? AND status NOT LIKE 'closed%'`).get(reportId, guild.id);
            if (!report) {
                return await interaction.editReply({ 
                    content: `${EMOJIS.Error || '❌'} Report não encontrado.`, 
                    components: [] 
                });
            }

            const thread = await guild.channels.fetch(report.thread_id);
            if (!thread) {
                return await interaction.editReply({ 
                    content: `${EMOJIS.Error || '❌'} Thread não encontrada.`, 
                    components: [] 
                });
            }
            
            await thread.members.add(user.id);

            let staffs = report.staffs ? JSON.parse(report.staffs) : [];
            if (!staffs.includes(user.id)) {
                staffs.push(user.id);
                db.prepare(`UPDATE reports SET staffs = ? WHERE id = ?`).run(JSON.stringify(staffs), reportId);
            }

            const staffsText = staffs.map(s => `<@${s}>`).join(', ');
            
            // Atualizar LOG
            if (report.log_message_id) {
                const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
                if (logChannelId) {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const logMessage = await logChannel.messages.fetch(report.log_message_id).catch(() => null);
                        if (logMessage && logMessage.embeds[0]) {
                            const oldDesc = logMessage.embeds[0].description;
                            const newDesc = oldDesc.replace(/- \*\*Staffs:\*\* .+/, `- **Staffs:** ${staffsText}`);
                            const updatedEmbed = EmbedBuilder.from(logMessage.embeds[0]).setDescription(newDesc);
                            await logMessage.edit({ embeds: [updatedEmbed], components: logMessage.components });
                        }
                    }
                }
            }
            
            await interaction.editReply({ 
                content: `${EMOJIS.Check || '✅'} Você entrou no ${reportId}\n🔗 **Acesse:** ${thread.url}`,
                components: [] 
            });
            
        } catch (error) {
            console.error('❌ Erro ao entrar no report:', error);
            await interaction.editReply({ content: '❌ Erro ao entrar no report.', components: [] });
        }
    }

    async updateStatus(guildId, reportId, newStatus) {
        const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND guild_id = ?`).get(reportId, guildId);
        if (!report) return;

        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;

        const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
        const targetUser = await this.client.users.fetch(report.user_id).catch(() => null);
        if (!targetUser) return;

        const staffs = report.staffs ? JSON.parse(report.staffs) : [];

        // Atualizar LOG
        if (report.log_message_id) {
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_reports');
            if (logChannelId) {
                const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                if (logChannel) {
                    const logMessage = await logChannel.messages.fetch(report.log_message_id).catch(() => null);
                    if (logMessage && logMessage.embeds[0]) {
                        const oldDesc = logMessage.embeds[0].description;
                        const statusMap = {
                            waiting: `${EMOJIS.clock || '⏳'} Aguardando staff`,
                            responded: `${EMOJIS.chat || '💬'} Respondido`,
                            inactive: `${EMOJIS.Warning || '⚠️'} Inativo`
                        };
                        const newStatusText = statusMap[newStatus] || newStatus;
                        const newDesc = oldDesc.replace(/- \*\*Status:\*\* .+/, `- **Status:** ${newStatusText}`);
                        const updatedEmbed = EmbedBuilder.from(logMessage.embeds[0]).setDescription(newDesc);
                        await logMessage.edit({ embeds: [updatedEmbed], components: logMessage.components });
                    }
                }
            }
        }

        // Atualizar DM
        if (report.dm_message_id && targetUser) {
            const dmChannel = await targetUser.createDM().catch(() => null);
            if (dmChannel) {
                const dmMessage = await dmChannel.messages.fetch(report.dm_message_id).catch(() => null);
                if (dmMessage && dmMessage.embeds[0]) {
                    const oldDesc = dmMessage.embeds[0].description;
                    const statusMap = {
                        waiting: `${EMOJIS.clock || '⏳'} Aguardando staff`,
                        responded: `${EMOJIS.chat || '💬'} Respondido`,
                        inactive: `${EMOJIS.Warning || '⚠️'} Inativo`
                    };
                    const newStatusText = statusMap[newStatus] || newStatus;
                    const newDesc = oldDesc.replace(/- \*\*Status:\*\* .+/, `- **Status:** ${newStatusText}`);
                    const updatedEmbed = EmbedBuilder.from(dmMessage.embeds[0]).setDescription(newDesc);
                    await dmMessage.edit({ embeds: [updatedEmbed], components: dmMessage.components });
                }
            }
        }

        // Atualizar THREAD
        if (report.thread_message_id && thread && !thread.archived) {
            const threadMessage = await thread.messages.fetch(report.thread_message_id).catch(() => null);
            if (threadMessage && threadMessage.embeds[0]) {
                const oldDesc = threadMessage.embeds[0].description;
                const statusMap = {
                    waiting: `${EMOJIS.clock || '⏳'} Aguardando staff`,
                    responded: `${EMOJIS.chat || '💬'} Respondido`,
                    inactive: `${EMOJIS.Warning || '⚠️'} Inativo`
                };
                const newStatusText = statusMap[newStatus] || newStatus;
                const newDesc = oldDesc.replace(/- \*\*Status:\*\* .+/, `- **Status:** ${newStatusText}`);
                const updatedEmbed = EmbedBuilder.from(threadMessage.embeds[0]).setDescription(newDesc);
                await threadMessage.edit({ embeds: [updatedEmbed], components: [] });
            }
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
            const closedByName = isStaffUser ? `Staff ${user.tag}` : `Usuário ${user.tag}`;
            const status = hasReason ? 'closed_with_reason' : 'closed_no_reason';
            
            db.prepare(`UPDATE reports SET status = ?, closed_at = ?, closed_by = ?, closed_reason = ?, punishment = ? WHERE id = ?`)
                .run(status, Date.now(), user.id, motivo || null, punicao || null, reportId);

            const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
            const targetUser = await this.client.users.fetch(report.user_id).catch(() => null);
            
            // Atualizar LOG
            if (report.log_message_id) {
                const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
                if (logChannelId) {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const logMessage = await logChannel.messages.fetch(report.log_message_id).catch(() => null);
                        if (logMessage) {
                            const embed = new EmbedBuilder()
                                .setColor(0xF64B4E)
                                .setDescription(`# 🔒 Report Fechado\n**ID:** ${reportId}\n**Usuário:** ${targetUser ? EmbedFormatter.formatUser(targetUser) : 'Desconhecido'}\n**Fechado por:** ${closedByName}\n**Motivo:** ${motivo || 'Sem motivo'}\n${punicao ? `**Punição:** ${punicao}` : ''}`)
                                .setFooter(EmbedFormatter.getFooter(guild.name))
                                .setTimestamp();
                            await logMessage.edit({ embeds: [embed], components: [] });
                        }
                    }
                }
            }
            
            // Atualizar DM com botão de avaliação
            if (report.dm_message_id && targetUser) {
                const dmChannel = await targetUser.createDM().catch(() => null);
                if (dmChannel) {
                    const dmMessage = await dmChannel.messages.fetch(report.dm_message_id).catch(() => null);
                    if (dmMessage) {
                        const embed = new EmbedBuilder()
                            .setColor(0xF64B4E)
                            .setDescription(`# 🔒 Report Fechado\n**ID:** ${reportId}\n**Fechado por:** ${closedByName}\n**Motivo:** ${motivo || 'Sem motivo'}`)
                            .setFooter(EmbedFormatter.getFooter(guild.name))
                            .setTimestamp();
                        
                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`reportchat:rate:${reportId}`)
                                .setLabel('Avaliar Atendimento')
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji('⭐')
                        );
                        
                        await dmMessage.edit({ embeds: [embed], components: [row] });
                    }
                }
            }
            
            // Arquivar thread
            if (thread) {
                await thread.members.remove(report.user_id).catch(() => {});
                await thread.setLocked(true).catch(() => {});
                await thread.setArchived(true).catch(() => {});
                
                const threadMessage = await thread.messages.fetch(report.thread_message_id).catch(() => null);
                if (threadMessage) {
                    const embed = new EmbedBuilder()
                        .setColor(0xF64B4E)
                        .setDescription(`# 🔒 Report Fechado\nEste report foi encerrado.`)
                        .setFooter(EmbedFormatter.getFooter(guild.name))
                        .setTimestamp();
                    await threadMessage.edit({ embeds: [embed], components: [] });
                }
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

            const guild = this.client.guilds.cache.get(report.guild_id);
            
            if (report.log_message_id && guild) {
                const logChannelId = ConfigSystem.getSetting(report.guild_id, 'log_reports');
                if (logChannelId) {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const logMessage = await logChannel.messages.fetch(report.log_message_id).catch(() => null);
                        if (logMessage && logMessage.embeds[0]) {
                            const oldDesc = logMessage.embeds[0].description;
                            const newDesc = oldDesc + `\n- **Avaliação:** ${'⭐'.repeat(nota)} (${nota}/5)\n- **Comentário:** ${comentario || 'Nenhum'}`;
                            const updatedEmbed = EmbedBuilder.from(logMessage.embeds[0]).setDescription(newDesc);
                            await logMessage.edit({ embeds: [updatedEmbed], components: logMessage.components });
                        }
                    }
                }
            }
            
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