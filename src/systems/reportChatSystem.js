// src/systems/reportChatSystem.js
const db = require('../database/index');
const ReportChatFormatter = require('../utils/reportChatFormatter');
const EmbedFormatter = require('../utils/embedFormatter');
const ConfigSystem = require('./configSystem');
const sessionManager = require('../utils/sessionManager');
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
            
            // Embed da thread
            const threadEmbed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setDescription(`# 🎫 Report ${reportId}\n## Bem vindo ao ReportChat ${user.toString()}!\nStaff: ${staffRoleId ? `<@&${staffRoleId}>` : 'a staff'}\n\n**Status:** Aguardando staff`)
                .setFooter(EmbedFormatter.getFooter(guild.name))
                .setTimestamp();
            
            const threadMessage = await thread.send({ embeds: [threadEmbed] });
            
            // Informações do modal
            const infoEmbed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setDescription(`# 📋 Informações\n**Seu nick:** ${data.seuNick}\n**Alvo:** ${data.alvoNick}\n**Data/Hora:** ${data.dataHora}\n**Regra:** ${data.regra}\n\n**Descrição:**\n${data.descricao}`)
                .setTimestamp();
            await thread.send({ embeds: [infoEmbed] });

            // DM do usuário (COM botões)
            const dmEmbed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setDescription(`# 🎫 Report ${reportId}\n**Status:** Aguardando staff\n**Staff:** Nenhum`)
                .setFooter(EmbedFormatter.getFooter(guild.name))
                .setTimestamp();
            
            const dmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`close:${reportId}`)
                    .setLabel('Fechar')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒'),
                new ButtonBuilder()
                    .setCustomId(`close_reason:${reportId}`)
                    .setLabel('Fechar com Motivo')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📝')
            );
            
            const dmMessage = await user.send({ embeds: [dmEmbed], components: [dmRow] }).catch(() => null);

            // Log da staff (COM botões)
            const logChannel = await guild.channels.fetch(logChannelId);
            const logEmbed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setDescription(`# 🎫 Report ${reportId}\n**Usuário:** ${user.tag}\n**Status:** Aguardando staff\n**Staff:** Nenhum`)
                .setFooter(EmbedFormatter.getFooter(guild.name))
                .setTimestamp();
            
            const logRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`join:${reportId}`)
                    .setLabel('Entrar')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('👋'),
                new ButtonBuilder()
                    .setCustomId(`close:${reportId}`)
                    .setLabel('Fechar')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒'),
                new ButtonBuilder()
                    .setCustomId(`close_reason:${reportId}`)
                    .setLabel('Fechar com Motivo')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📝')
            );
            
            const logMessage = await logChannel.send({ embeds: [logEmbed], components: [logRow] });

            // Salvar
            db.prepare(`
                INSERT INTO reports (id, guild_id, user_id, thread_id, log_message_id, dm_message_id, thread_message_id, status, created_at, last_message_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(reportId, guild.id, user.id, thread.id, logMessage.id, dmMessage?.id || null, threadMessage.id, 'open', Date.now(), Date.now());

            await interaction.editReply({ content: `${reportId} criado! Acesse: ${thread.url}`, flags: 64 });
            
        } catch (error) {
            console.error('❌ Erro ao criar report:', error);
            await interaction.editReply({ content: '❌ Erro ao criar report.', flags: 64 });
        }
    }

    // ==================== STAFF ENTRAR ====================
        async joinReport(interaction, reportId) {
        const { guild, user, member } = interaction;
        
        try {
            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            if (!member?.roles?.cache?.has(staffRoleId)) {
                return await interaction.editReply({ content: '❌ Apenas staff pode entrar.', components: [] });
            }

            const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND guild_id = ?`).get(reportId, guild.id);
            if (!report) {
                return await interaction.editReply({ content: '❌ Report não encontrado.', components: [] });
            }

            const thread = await guild.channels.fetch(report.thread_id);
            if (thread) {
                await thread.members.add(user.id);
            }

            // Atualizar lista de staffs
            let staffs = report.staffs ? JSON.parse(report.staffs) : [];
            if (!staffs.includes(user.id)) {
                staffs.push(user.id);
                db.prepare(`UPDATE reports SET staffs = ? WHERE id = ?`).run(JSON.stringify(staffs), reportId);
            }

            const staffsText = staffs.map(s => `<@${s}>`).join(', ');
            
            // ATUALIZAR LOG - MANTENDO OS BOTÕES ORIGINAIS
            if (report.log_message_id) {
                const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
                if (logChannelId) {
                    const logChannel = await guild.channels.fetch(logChannelId);
                    const logMessage = await logChannel.messages.fetch(report.log_message_id);
                    
                    if (logMessage && logMessage.embeds[0]) {
                        const oldDesc = logMessage.embeds[0].description;
                        // Atualizar apenas a linha do Staff
                        const newDesc = oldDesc.replace(/- \*\*Staff:\*\* .+/, `- **Staff:** ${staffsText}`);
                        const newEmbed = EmbedBuilder.from(logMessage.embeds[0]).setDescription(newDesc);
                        
                        // IMPORTANTE: mantém os COMPONENTES (botões) originais
                        await logMessage.edit({ 
                            embeds: [newEmbed], 
                            components: logMessage.components 
                        });
                    }
                }
            }
            
            // Resposta para o staff
            await interaction.editReply({ 
                content: `✅ Você entrou no ${reportId}`, 
                components: [] 
            });
            
        } catch (error) {
            console.error('❌ Erro ao entrar:', error);
            await interaction.editReply({ content: '❌ Erro ao entrar.', components: [] });
        }
    }

    // ==================== FECHAR REPORT ====================
    async closeReport(interaction, reportId, motivo, punicao, hasReason, isStaff = true) {
        try {
            const report = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(reportId);
            
            if (!report) {
                const msg = '❌ Report não encontrado.';
                if (interaction.isModalSubmit()) {
                    await interaction.reply({ content: msg, flags: 64 });
                } else {
                    await interaction.editReply({ content: msg, components: [] });
                }
                return;
            }

            if (report.status === 'closed') {
                const msg = '❌ Este report já está fechado.';
                if (interaction.isModalSubmit()) {
                    await interaction.reply({ content: msg, flags: 64 });
                } else {
                    await interaction.editReply({ content: msg, components: [] });
                }
                return;
            }

            const guild = this.client.guilds.cache.get(report.guild_id);
            if (!guild) {
                const msg = '❌ Servidor não encontrado.';
                if (interaction.isModalSubmit()) {
                    await interaction.reply({ content: msg, flags: 64 });
                } else {
                    await interaction.editReply({ content: msg, components: [] });
                }
                return;
            }

            const closedByName = isStaff ? `Staff ${interaction.user.tag}` : `Usuário ${interaction.user.tag}`;
            
            db.prepare(`UPDATE reports SET status = 'closed', closed_at = ?, closed_by = ?, closed_reason = ?, punishment = ? WHERE id = ?`)
                .run(Date.now(), interaction.user.id, motivo || null, punicao || null, report.id);

            const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
            if (thread) {
                await thread.setLocked(true).catch(() => {});
                await thread.setArchived(true).catch(() => {});
            }
            
            if (report.log_message_id) {
                const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
                if (logChannelId) {
                    const logChannel = await guild.channels.fetch(logChannelId);
                    const logMessage = await logChannel.messages.fetch(report.log_message_id);
                    const embed = new EmbedBuilder()
                        .setColor(0xF64B4E)
                        .setDescription(`# 🔒 Report Fechado\n**ID:** ${report.id}\n**Fechado por:** ${closedByName}\n**Motivo:** ${motivo || 'Sem motivo'}`)
                        .setFooter(EmbedFormatter.getFooter(guild.name))
                        .setTimestamp();
                    await logMessage.edit({ embeds: [embed], components: [] });
                }
            }
            
            if (report.dm_message_id) {
                const targetUser = await this.client.users.fetch(report.user_id);
                const dmChannel = await targetUser.createDM();
                const dmMessage = await dmChannel.messages.fetch(report.dm_message_id);
                const embed = new EmbedBuilder()
                    .setColor(0xF64B4E)
                    .setDescription(`# 🔒 Report Fechado\n**ID:** ${report.id}\n**Motivo:** ${motivo || 'Sem motivo'}`)
                    .setFooter(EmbedFormatter.getFooter(guild.name))
                    .setTimestamp();
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`rate:${report.id}`)
                        .setLabel('Avaliar')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('⭐')
                );
                
                await dmMessage.edit({ embeds: [embed], components: [row] });
            }
            
            const msg = `✅ ${report.id} fechado com sucesso!`;
            if (interaction.isModalSubmit()) {
                await interaction.reply({ content: msg, flags: 64 });
            } else {
                await interaction.editReply({ content: msg, components: [] });
            }
            
        } catch (error) {
            console.error('❌ Erro ao fechar:', error);
            try {
                const msg = '❌ Erro ao fechar report.';
                if (interaction.isModalSubmit()) {
                    await interaction.reply({ content: msg, flags: 64 });
                } else {
                    await interaction.editReply({ content: msg, components: [] });
                }
            } catch (err) {}
        }
    }

    // ==================== AVALIAR ====================
    async rateReport(interaction, reportId, nota, comentario) {
        try {
            const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND user_id = ?`).get(reportId, interaction.user.id);
            
            if (!report) {
                await interaction.reply({ content: '❌ Report não encontrado.', flags: 64 });
                return;
            }

            if (report.rating) {
                await interaction.reply({ content: '❌ Este report já foi avaliado.', flags: 64 });
                return;
            }

            db.prepare(`UPDATE reports SET rating = ?, rating_comment = ? WHERE id = ?`).run(nota, comentario, reportId);
            
            await interaction.reply({ content: `✅ Avaliação registrada! Obrigado.`, flags: 64 });
            
        } catch (error) {
            console.error('❌ Erro ao avaliar:', error);
            await interaction.reply({ content: '❌ Erro ao avaliar.', flags: 64 });
        }
    }

    // ==================== INTERFACE COM INTERACTIONHANDLER ====================
    
    async handleComponent(interaction, action, param) {
        const customId = interaction.customId;
        
        if (customId === 'reportchat:create') {
            const modal = ReportChatFormatter.createOpenModal();
            await interaction.showModal(modal);
            return;
        }
        
        if (customId.startsWith('join:')) {
            await interaction.deferUpdate();
            const reportId = customId.split(':')[1];
            await this.joinReport(interaction, reportId);
            return;
        }
        
        if (customId.startsWith('close:') && !customId.includes('reason')) {
            await interaction.deferUpdate();
            const reportId = customId.split(':')[1];
            await this.closeReport(interaction, reportId, null, null, false, true);
            return;
        }
        
        if (customId.startsWith('close_reason:')) {
            const reportId = customId.split(':')[1];
            sessionManager.set(interaction.user.id, interaction.guildId || 'dm', 'closing', { reportId }, 300000);
            await interaction.showModal(ReportChatFormatter.createCloseReasonModal());
            return;
        }
        
        if (customId.startsWith('rate:')) {
            const reportId = customId.split(':')[1];
            sessionManager.set(interaction.user.id, interaction.guildId || 'dm', 'rating', { reportId }, 300000);
            await interaction.showModal(ReportChatFormatter.createRatingModal());
            return;
        }
    }
    
    async handleModal(interaction, action) {
        const customId = interaction.customId;
        
        if (customId === 'reportchat:open:modal') {
            const data = {
                seuNick: interaction.fields.getTextInputValue('seu_nick'),
                alvoNick: interaction.fields.getTextInputValue('alvo_nick'),
                dataHora: interaction.fields.getTextInputValue('data_hora'),
                regra: interaction.fields.getTextInputValue('regra'),
                descricao: interaction.fields.getTextInputValue('descricao')
            };
            await this.openReport(interaction, data);
            return;
        }
        
        if (customId === 'reportchat:close:reason:modal') {
            await interaction.deferReply({ flags: 64 });
            const session = sessionManager.get(interaction.user.id, interaction.guildId || 'dm', 'closing');
            if (session?.reportId) {
                const motivo = interaction.fields.getTextInputValue('motivo');
                const punicao = interaction.fields.getTextInputValue('punicao');
                await this.closeReport(interaction, session.reportId, motivo, punicao, true, true);
                sessionManager.delete(interaction.user.id, interaction.guildId || 'dm', 'closing');
            }
            return;
        }
        
        if (customId === 'reportchat:rating') {
            await interaction.deferReply({ flags: 64 });
            const session = sessionManager.get(interaction.user.id, interaction.guildId || 'dm', 'rating');
            if (session?.reportId) {
                const nota = parseInt(interaction.fields.getTextInputValue('nota'));
                const comentario = interaction.fields.getTextInputValue('comentario');
                await this.rateReport(interaction, session.reportId, nota, comentario);
                sessionManager.delete(interaction.user.id, interaction.guildId || 'dm', 'rating');
            }
            return;
        }
    }
}

module.exports = ReportChatSystem;