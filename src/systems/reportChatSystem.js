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

    // ==================== LIMPAR REPORTS ÓRFÃOS ====================
    async limparReportsOrfaos(guildId, userId) {
        const reports = db.prepare(`
            SELECT id, thread_id FROM reports 
            WHERE guild_id = ? AND user_id = ? AND status NOT LIKE 'closed%'
        `).all(guildId, userId);
        
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return 0;
        
        let fechados = 0;
        
        for (const report of reports) {
            try {
                const thread = await guild.channels.fetch(report.thread_id);
                if (!thread) {
                    db.prepare(`UPDATE reports SET status = 'closed_no_reason', closed_at = ?, closed_by = ?, closed_reason = ? WHERE id = ?`)
                        .run(Date.now(), 'system', 'Thread deletada - recuperação automática', report.id);
                    fechados++;
                }
            } catch (error) {
                if (error.code === 10008) {
                    db.prepare(`UPDATE reports SET status = 'closed_no_reason', closed_at = ?, closed_by = ?, closed_reason = ? WHERE id = ?`)
                        .run(Date.now(), 'system', 'Thread deletada - recuperação automática', report.id);
                    fechados++;
                }
            }
        }
        
        return fechados;
    }

    // ==================== ABRIR REPORT ====================
            async openReport(interaction, data) {
            const { guild, user } = interaction;
            
            await interaction.reply({ content: '⏳ Processando...', flags: 64 });
            
            try {
                const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
                if (!logChannelId) {
                    return await interaction.editReply({ content: '❌ Canal de logs não configurado!', flags: 64 });
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

                const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
                const threadContent = ReportChatFormatter.createThreadEmbed(reportId, user, guild.name, staffRoleId);
                const threadMessage = await thread.send(threadContent);
                
                const infoEmbed = new EmbedBuilder()
                    .setColor(0xDCA15E)
                    .setDescription(`# 📋 Informações do Report\n**Seu nick:** ${data.seuNick}\n**Alvo:** ${data.alvoNick}\n**Data/Hora:** ${data.dataHora}\n**Regra:** ${data.regra}\n\n**Descrição:**\n${data.descricao}`)
                    .setTimestamp();
                await thread.send({ embeds: [infoEmbed] });

                const dmContent = ReportChatFormatter.createUserDmEmbed(reportId, user, guild.name, thread.url);
                const dmMessage = await user.send(dmContent).catch(() => null);

                const logChannel = await guild.channels.fetch(logChannelId);
                const logContent = ReportChatFormatter.createLogEmbed(reportId, user, thread.url, [], 'waiting', null, null, null, guild.name);
                const logMessage = await logChannel.send(logContent);

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

    // ==================== STAFF ENTRAR NO REPORT ====================
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

    // ==================== FECHAR REPORT ====================
    // src/systems/reportChatSystem.js
// Substitua o método closeReport por este:

async closeReport(interaction, reportId, motivo, punicao, hasReason, isStaff = true) {
    // Para DMs, interaction.guild pode ser null
    const guild = interaction.guild;
    const user = interaction.user;
    const member = interaction.member;
    
    try {
        // Buscar report no banco (não depende de guild)
        const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND user_id = ? AND status NOT LIKE 'closed%'`).get(reportId, user.id);
        
        if (!report) {
            // Tentar buscar sem filtrar por user_id (caso staff esteja fechando)
            const reportByStaff = db.prepare(`SELECT * FROM reports WHERE id = ? AND status NOT LIKE 'closed%'`).get(reportId);
            if (!reportByStaff) {
                // Se for modal, precisa responder
                if (interaction.isModalSubmit()) {
                    await interaction.reply({ content: `${EMOJIS.Error || '❌'} Report não encontrado.`, flags: 64 });
                } else {
                    await interaction.editReply({ content: `${EMOJIS.Error || '❌'} Report não encontrado.`, components: [] });
                }
                return;
            }
            // Usar o report encontrado sem user_id
            Object.assign(report, reportByStaff);
        }

        // Obter guild real do banco (já que interaction.guild pode ser null em DM)
        const realGuild = guild || this.client.guilds.cache.get(report.guild_id);
        if (!realGuild) {
            const errorMsg = '❌ Servidor não encontrado.';
            if (interaction.isModalSubmit()) {
                await interaction.reply({ content: errorMsg, flags: 64 });
            } else {
                await interaction.editReply({ content: errorMsg, components: [] });
            }
            return;
        }

        const staffRoleId = ConfigSystem.getSetting(realGuild.id, 'staff_role');
        const isStaffUser = isStaff && member?.roles?.cache?.has(staffRoleId);
        const closedByName = isStaffUser ? `Staff ${user.tag}` : `Usuário ${user.tag}`;
        const status = hasReason ? 'closed_with_reason' : 'closed_no_reason';
        
        // Atualizar banco
        db.prepare(`UPDATE reports SET status = ?, closed_at = ?, closed_by = ?, closed_reason = ?, punishment = ? WHERE id = ?`)
            .run(status, Date.now(), user.id, motivo || null, punicao || null, report.id);

        const thread = await realGuild.channels.fetch(report.thread_id).catch(() => null);
        const targetUser = await this.client.users.fetch(report.user_id).catch(() => null);
        
        // ATUALIZAR LOG (só se tiver log_message_id e guild real)
        if (report.log_message_id && realGuild) {
            const logChannelId = ConfigSystem.getSetting(realGuild.id, 'log_reports');
            if (logChannelId) {
                const logChannel = await realGuild.channels.fetch(logChannelId).catch(() => null);
                if (logChannel) {
                    const logMessage = await logChannel.messages.fetch(report.log_message_id).catch(() => null);
                    if (logMessage) {
                        const embed = new EmbedBuilder()
                            .setColor(0xF64B4E)
                            .setDescription(`# 🔒 Report Fechado\n**ID:** ${report.id}\n**Usuário:** ${targetUser ? EmbedFormatter.formatUser(targetUser) : 'Desconhecido'}\n**Fechado por:** ${closedByName}\n**Motivo:** ${motivo || 'Sem motivo'}\n${punicao ? `**Punição:** ${punicao}` : ''}`)
                            .setFooter(EmbedFormatter.getFooter(realGuild.name))
                            .setTimestamp();
                        await logMessage.edit({ embeds: [embed], components: [] });
                    }
                }
            }
        }
        
        // Arquivar thread
        if (thread) {
            await thread.members.remove(report.user_id).catch(() => {});
            await thread.setLocked(true).catch(() => {});
            await thread.setArchived(true).catch(() => {});
        }
        
        // Responder conforme o tipo de interação
        if (interaction.isModalSubmit()) {
            await interaction.reply({ content: `${EMOJIS.Check || '✅'} ${report.id} fechado com sucesso!`, flags: 64 });
        } else {
            await interaction.editReply({ content: `${EMOJIS.Check || '✅'} ${report.id} fechado com sucesso!`, components: [] });
        }
        
    } catch (error) {
        console.error('❌ Erro ao fechar report:', error);
        try {
            if (interaction.isModalSubmit()) {
                await interaction.reply({ content: '❌ Erro ao fechar report.', flags: 64 });
            } else {
                await interaction.editReply({ content: '❌ Erro ao fechar report.', components: [] });
            }
        } catch (err) {
            console.error('❌ Falha ao responder:', err);
        }
    }
}

    // ==================== AVALIAR REPORT ====================
                async rateReport(interaction, reportId, nota, comentario) {
            const { user } = interaction;
            
            try {
                const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND user_id = ? AND status LIKE 'closed%'`).get(reportId, user.id);
                if (!report) {
                    await interaction.reply({ content: `${EMOJIS.Error || '❌'} Report não encontrado.`, flags: 64 });
                    return;
                }

                if (report.rating) {
                    await interaction.reply({ content: `${EMOJIS.Error || '❌'} Este report já foi avaliado.`, flags: 64 });
                    return;
                }

                db.prepare(`UPDATE reports SET rating = ?, rating_comment = ? WHERE id = ?`).run(nota, comentario, report.id);

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
                                await logMessage.edit({ embeds: [updatedEmbed], components: [] });
                            }
                        }
                    }
                }
                
                await interaction.reply({ content: `${EMOJIS.Check || '✅'} Avaliação registrada! Obrigado.`, flags: 64 });
                
            } catch (error) {
                console.error('❌ Erro ao avaliar report:', error);
                await interaction.reply({ content: '❌ Erro ao avaliar report.', flags: 64 });
            }
        }

    // ==================== ATUALIZAR STATUS ====================
    async updateStatus(guildId, reportId, newStatus) {
        const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND guild_id = ?`).get(reportId, guildId);
        if (!report) return;

        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;

        const staffs = report.staffs ? JSON.parse(report.staffs) : [];
        const staffsText = staffs.length > 0 ? staffs.map(s => `<@${s}>`).join(', ') : 'Nenhum staff';
        
        const statusMap = {
            waiting: `${EMOJIS.clock || '⏳'} Aguardando staff`,
            responded: `${EMOJIS.chat || '💬'} Respondido`,
            inactive: `${EMOJIS.Warning || '⚠️'} Inativo`
        };
        const newStatusText = statusMap[newStatus] || newStatus;

        if (report.log_message_id) {
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_reports');
            if (logChannelId) {
                const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                if (logChannel) {
                    const logMessage = await logChannel.messages.fetch(report.log_message_id).catch(() => null);
                    if (logMessage && logMessage.embeds[0]) {
                        const oldDesc = logMessage.embeds[0].description;
                        const newDesc = oldDesc.replace(/- \*\*Status:\*\* .+/, `- **Status:** ${newStatusText}`);
                        const updatedEmbed = EmbedBuilder.from(logMessage.embeds[0]).setDescription(newDesc);
                        await logMessage.edit({ embeds: [updatedEmbed], components: logMessage.components });
                    }
                }
            }
        }

        if (report.dm_message_id) {
            const targetUser = await this.client.users.fetch(report.user_id).catch(() => null);
            if (targetUser) {
                const dmChannel = await targetUser.createDM().catch(() => null);
                if (dmChannel) {
                    const dmMessage = await dmChannel.messages.fetch(report.dm_message_id).catch(() => null);
                    if (dmMessage && dmMessage.embeds[0]) {
                        const oldDesc = dmMessage.embeds[0].description;
                        const newDesc = oldDesc.replace(/- \*\*Status:\*\* .+/, `- **Status:** ${newStatusText}`);
                        const updatedEmbed = EmbedBuilder.from(dmMessage.embeds[0]).setDescription(newDesc);
                        await dmMessage.edit({ embeds: [updatedEmbed], components: dmMessage.components });
                    }
                }
            }
        }
    }
}

module.exports = ReportChatSystem;