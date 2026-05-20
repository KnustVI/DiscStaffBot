// /home/ubuntu/DiscStaffBot/src/systems/reportChatSystem.js
const db = require('../database/index');
const ConfigSystem = require('./configSystem');
const { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const ContainerFormatter = require('../utils/ContainerFormatter');

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

    getNextId(guildId) {
        const last = db.prepare(`SELECT id FROM reports WHERE guild_id = ? ORDER BY created_at DESC LIMIT 1`).get(guildId);
        if (!last) return 1;
        const num = parseInt(last.id.replace('#R', ''));
        return isNaN(num) ? 1 : num + 1;
    }

    getStatusText(status, closedBy = null, closedReason = null) {
        const statusMap = {
            waiting: '⏳ Aguardando staff',
            responded: '💬 Respondido',
            inactive: '⚠️ Inativo',
            closed_no_reason: `🔒 Fechado sem motivo${closedBy ? ` por ${closedBy}` : ''}`,
            closed_with_reason: `✅ Fechado!${closedReason ? ` "${closedReason}"` : ''}${closedBy ? ` por ${closedBy}` : ''}`
        };
        return statusMap[status] || status;
    }

    // ==================== BASE CONTAINER ====================
    
    createBaseContainer(guild, reportId, user, status = 'waiting', staffs = [], extraDescription = '') {
    const statusText = this.getStatusText(status);
    const staffsText = staffs.length > 0 ? staffs.map(s => {
        const time = `<t:${Math.floor(s.timestamp / 1000)}:R>`;
        return `<@${s.id}> (entrou ${time})`;
    }).join('\n') : 'Nenhum';
    
    let accentColor;
    if (status === 'closed_no_reason' || status === 'closed_with_reason') {
        accentColor = 0xDCA15E;
    } else if (status === 'responded') {
        accentColor = 0x57F287;
    } else {
        accentColor = 0xF64B4E;
    }
    
    const builder = ContainerFormatter.createBuilder(guild.name, accentColor);
    
    // HEADER
    builder.addTitle(`${EMOJIS.chat || '🗨️'} REPORTE | ${reportId}`, 1);
    if (extraDescription) builder.addText(extraDescription);
    builder.addSeparator();
    
    // STATUS SECTION
    builder.addSection([`**📊 Status:** ${statusText}`]);
    builder.addSeparator();
    
    // INFORMAÇÕES PRINCIPAIS SECTION
    builder.addSection([`**👤 Userinfo:** ${user.tag} (${user.id})`]);
    builder.addSection([`**👥 Staffs:** ${staffsText}`]);
    builder.addSeparator();
    
    // RESUMO
    builder.addText(`Report de ${user.toString()}.`);
    builder.addFooter();
    
    return builder;
}

    // ==================== MODAIS ====================

    getOpenModal() {
        const modal = new ModalBuilder().setCustomId('report_modal').setTitle('Abrir Report');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('regra').setLabel('Qual a regra quebrada?').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: Regra 5 - Flood')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('data_hora').setLabel('Quando aconteceu?').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: 09/04/2026 14:30')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('local').setLabel('Qual local do mapa?').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Ex: Floresta Central')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('descricao').setLabel('Descreva a quebra de regra').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Descreva detalhadamente...')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('termo').setLabel('Termo de boa convivência').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Declaro que as informações são verdadeiras...'))
        );
        return modal;
    }

    getCloseModalStaff() {
        const modal = new ModalBuilder().setCustomId('close_modal_staff').setTitle('Fechar Report (Staff)');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('motivo').setLabel('Qual motivo do fechamento?').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: Resolvido')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('punicao').setLabel('Punição aplicada (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Ex: Advertência, Strike, Ban'))
        );
        return modal;
    }

    getCloseModalUser() {
        const modal = new ModalBuilder().setCustomId('close_modal_user').setTitle('Fechar Report');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('motivo').setLabel('Qual motivo do fechamento?').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: Problema resolvido')));
        return modal;
    }

    getRatingModal() {
        const modal = new ModalBuilder().setCustomId('rating_modal').setTitle('Avaliar Atendimento');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nota').setLabel('Qual nota você dá para o atendimento? (1-5)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: 5')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('comentario').setLabel('Observação adicional?').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('Seu feedback...'))
        );
        return modal;
    }

    // ==================== PAINEL ====================
    
    getPanel(guildName, guildIcon) {
        const builder = ContainerFormatter.createBuilder(guildName, 0xDCA15E);
        builder.addTitle(`${EMOJIS.chat || '🎫'} Denúncia de jogador`, 1);
        builder.addText([
            `- **Abra um Reporte**: Clique no botão abaixo para abrir uma denúncia.`,
            `- **Preencha o Formulário**: Responda o formulário enviado pelo bot.`,
            `- **Descreva a Situação**: Explique o que aconteceu.`,
            `- **Envie as Provas**: Inclua vídeos ou prints.`,
            `- **Aguarde a Análise**: A equipe analisará o caso.`
        ].join('\n'));
        builder.addFooter();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_report')
                .setLabel('Reportar Jogador')
                .setStyle(ButtonStyle.Primary)
                .setEmoji(EMOJIS.chat || '🎫')
        );
        
        return { components: [builder.build(), row] };
    }

    // ==================== ABRIR REPORT ====================
    
    async openReport(interaction, data) {
        const { guild, user } = interaction;
        await interaction.editReply({ content: '⏳ Criando report...' });
        
        try {
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
            if (!logChannelId) {
                return await interaction.editReply({ content: '❌ Canal de logs não configurado!' });
            }

            const reportId = `#R${this.getNextId(guild.id)}`;
            const threadName = `【${reportId}】report-${user.username}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
            
            const thread = await interaction.channel.threads.create({
                name: threadName,
                type: ChannelType.PrivateThread,
                invitable: false,
                reason: `Report de ${user.tag}`
            });
            await thread.members.add(user.id);

            const threadBuilder = ContainerFormatter.createBuilder(guild.name, 0xDCA15E);
            threadBuilder.addTitle(`${EMOJIS.chat || '🗨️'} REPORTE | ${reportId}`, 1);
            threadBuilder.addText(`Obrigado por abrir o reporte. Um membro da staff irá te atender em breve.\n\nEnquanto aguarda, você pode adicionar mais informações ou provas neste chat.`);
            threadBuilder.addFooter();
            const threadMsg = await thread.send({ components: [threadBuilder.build()], flags: ['IsComponentsV2'] });

            const infoBuilder = ContainerFormatter.createBuilder(guild.name, 0xDCA15E);
            infoBuilder.addTitle(`${EMOJIS.chat || '📋'} Informações do Report`, 1);
            infoBuilder.addSeparator();
            infoBuilder.addText(`**📝 Regra quebrada:** ${data.regra}`);
            infoBuilder.addText(`**⏰ Quando aconteceu:** ${data.dataHora}`);
            infoBuilder.addText(`**📍 Local:** ${data.local || 'Não informado'}`);
            infoBuilder.addText(`**📋 Descrição:** ${data.descricao}`);
            infoBuilder.addText(`**⚖️ Termo de convivência:** ${data.termo}`);
            infoBuilder.addFooter();
            await thread.send({ components: [infoBuilder.build()], flags: ['IsComponentsV2'] });

            const dmBuilder = this.createBaseContainer(guild, reportId, user, 'waiting', []);
            const dmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`close:${reportId}`).setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
                new ButtonBuilder().setCustomId(`close_reason:${reportId}`).setLabel('Fechar com Motivo').setStyle(ButtonStyle.Primary).setEmoji('📝')
            );
            const dmPayload = { components: [dmBuilder.build()], flags: ['IsComponentsV2'] };
            dmPayload.components.push(dmRow);
            const dmMessage = await user.send(dmPayload).catch(() => null);

            const logChannel = await guild.channels.fetch(logChannelId);
            const logBuilder = this.createBaseContainer(guild, reportId, user, 'waiting', []);
            const logRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`join:${reportId}`).setLabel('Entrar no Reporte').setStyle(ButtonStyle.Success).setEmoji('👋'),
                new ButtonBuilder().setCustomId(`close:${reportId}`).setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
                new ButtonBuilder().setCustomId(`close_reason:${reportId}`).setLabel('Fechar com Motivo').setStyle(ButtonStyle.Primary).setEmoji('📝')
            );
            const logPayload = { components: [logBuilder.build()], flags: ['IsComponentsV2'] };
            logPayload.components.push(logRow);
            const logMessage = await logChannel.send(logPayload);

            db.prepare(`
                INSERT INTO reports (id, guild_id, user_id, thread_id, log_message_id, dm_message_id, thread_message_id, status, staffs, created_at, last_message_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(reportId, guild.id, user.id, thread.id, logMessage.id, dmMessage?.id || null, threadMsg.id, 'waiting', '[]', Date.now(), Date.now());

            await interaction.editReply({ content: `✅ ${reportId} criado! ${thread.url}` });
            
        } catch (error) {
            console.error('❌ Erro ao criar report:', error);
            await interaction.editReply({ content: '❌ Erro ao criar report.' });
        }
    }
    
    // ==================== STAFF ENTRAR ====================
    
    async joinReport(interaction, reportId) {
        const { guild, user, member } = interaction;
        
        try {
            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            if (!member?.roles?.cache?.has(staffRoleId)) {
                await this.sendTempReply(interaction, `Você não tem permissão para entrar em reports.`, false);
                return;
            }

            const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND guild_id = ?`).get(reportId, guild.id);
            if (!report) {
                await this.sendTempReply(interaction, `Report ${reportId} não encontrado.`, false);
                return;
            }

            const thread = await guild.channels.fetch(report.thread_id);
            if (thread) await thread.members.add(user.id);

            let staffs = report.staffs ? JSON.parse(report.staffs) : [];
            const existingStaff = staffs.find(s => s.id === user.id);
            if (!existingStaff) {
                staffs.push({ id: user.id, name: user.tag, timestamp: Date.now() });
                db.prepare(`UPDATE reports SET staffs = ? WHERE id = ?`).run(JSON.stringify(staffs), reportId);
            }

            const targetUser = await this.client.users.fetch(report.user_id);
            
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
            if (logChannelId && report.log_message_id) {
                const logChannel = await guild.channels.fetch(logChannelId);
                const logMessage = await logChannel.messages.fetch(report.log_message_id);
                if (logMessage) {
                    const updatedBuilder = this.createBaseContainer(guild, report.id, targetUser, report.status, staffs);
                    const updatedPayload = { components: [updatedBuilder.build()], flags: ['IsComponentsV2'] };
                    updatedPayload.components.push(...logMessage.components.slice(1));
                    await logMessage.edit(updatedPayload);
                }
            }

            if (report.dm_message_id) {
                const dmMessage = await user.createDM().then(dm => dm.messages.fetch(report.dm_message_id)).catch(() => null);
                if (dmMessage) {
                    const updatedBuilder = this.createBaseContainer(guild, report.id, targetUser, report.status, staffs);
                    const updatedPayload = { components: [updatedBuilder.build()], flags: ['IsComponentsV2'] };
                    updatedPayload.components.push(...dmMessage.components.slice(1));
                    await dmMessage.edit(updatedPayload);
                }
            }

            await this.sendTempReply(interaction, `${user} entrou no ${reportId}`, true);
            
        } catch (error) {
            console.error('❌ Erro ao entrar:', error);
            await this.sendTempReply(interaction, `Erro ao entrar no report ${reportId}.`, false);
        }
    }

    // ==================== FECHAR REPORT ====================
    
    async closeReport(interaction, reportId, motivo, punicao, hasReason) {
        try {
            const report = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(reportId);
            if (!report) {
                await this.sendTempReply(interaction, `Report ${reportId} não encontrado.`, false);
                return;
            }

            const guild = this.client.guilds.cache.get(report.guild_id);
            if (!guild) {
                await this.sendTempReply(interaction, `Servidor do report ${reportId} não encontrado.`, false);
                return;
            }

            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            const isStaff = interaction.member?.roles?.cache?.has(staffRoleId);
            const closedByName = isStaff ? `Staff ${interaction.user.tag}` : `Usuário ${interaction.user.tag}`;
            const status = hasReason ? 'closed_with_reason' : 'closed_no_reason';

            db.prepare(`UPDATE reports SET status = ?, closed_at = ?, closed_by = ?, closed_reason = ?, punishment = ? WHERE id = ?`)
                .run(status, Date.now(), interaction.user.id, motivo || null, punicao || null, report.id);

            const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
            if (thread) {
                await thread.setLocked(true).catch(() => {});
                await thread.setArchived(true).catch(() => {});
            }

            const staffs = report.staffs ? JSON.parse(report.staffs) : [];
            const targetUser = await this.client.users.fetch(report.user_id);
            const extraDesc = `\n## 📝 Motivo de fechamento:\n\`\`\`text\n${motivo || 'Sem motivo'}\n\`\`\``;
            
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
            if (logChannelId && report.log_message_id) {
                const logChannel = await guild.channels.fetch(logChannelId);
                const logMessage = await logChannel.messages.fetch(report.log_message_id);
                if (logMessage) {
                    const updatedBuilder = this.createBaseContainer(guild, report.id, targetUser, status, staffs, extraDesc);
                    await logMessage.edit({ components: [updatedBuilder.build()], flags: ['IsComponentsV2'] });
                }
            }

            if (report.dm_message_id) {
                const dmMessage = await targetUser.createDM().then(dm => dm.messages.fetch(report.dm_message_id)).catch(() => null);
                if (dmMessage) {
                    const updatedBuilder = this.createBaseContainer(guild, report.id, targetUser, status, staffs, extraDesc);
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`rate:${report.id}`).setLabel('Avaliar Atendimento').setStyle(ButtonStyle.Secondary).setEmoji('⭐')
                    );
                    const updatedPayload = { components: [updatedBuilder.build()], flags: ['IsComponentsV2'] };
                    updatedPayload.components.push(row);
                    await dmMessage.edit(updatedPayload);
                }
            }

            await this.sendTempReply(interaction, `${report.id} foi fechado por ${interaction.user}.`, true);
            
        } catch (error) {
            console.error('❌ Erro ao fechar:', error);
            await this.sendTempReply(interaction, `Erro ao fechar o report ${reportId}.`, false);
        }
    }

    // ==================== AVALIAR ====================
    
    async rateReport(interaction, reportId, nota, comentario) {
        try {
            const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND user_id = ?`).get(reportId, interaction.user.id);
            if (!report) {
                await this.sendTempReply(interaction, `Report ${reportId} não encontrado.`, false);
                return;
            }
            if (report.rating) {
                await this.sendTempReply(interaction, `Este report já foi avaliado.`, false);
                return;
            }

            db.prepare(`UPDATE reports SET rating = ?, rating_comment = ? WHERE id = ?`).run(nota, comentario, reportId);

            const guild = this.client.guilds.cache.get(report.guild_id);
            const staffs = report.staffs ? JSON.parse(report.staffs) : [];
            const targetUser = await this.client.users.fetch(report.user_id);
            const extraDesc = `\n- **Avaliação:** ${'⭐'.repeat(nota)} (${nota}/5)\n- **Comentário:** ${comentario || 'Nenhum'}`;
            
            const logChannelId = ConfigSystem.getSetting(report.guild_id, 'log_reports');
            if (logChannelId && report.log_message_id && guild) {
                const logChannel = await guild.channels.fetch(logChannelId);
                const logMessage = await logChannel.messages.fetch(report.log_message_id);
                if (logMessage) {
                    const updatedBuilder = this.createBaseContainer(guild, report.id, targetUser, report.status, staffs, extraDesc);
                    await logMessage.edit({ components: [updatedBuilder.build()], flags: ['IsComponentsV2'] });
                }
            }

            await this.sendTempReply(interaction, `Avaliação registrada! Obrigado.`, true);
            
        } catch (error) {
            console.error('❌ Erro ao avaliar:', error);
            await this.sendTempReply(interaction, `Erro ao avaliar report ${reportId}.`, false);
        }
    }

    async sendTempReply(interaction, content, success = true) {
        const emoji = success ? (EMOJIS.Check || '✅') : (EMOJIS.Error || '❌');
        
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content: `${emoji} ${content}` });
        } else {
            await interaction.reply({ content: `${emoji} ${content}`, flags: 64 });
        }
        
        setTimeout(async () => {
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.deleteReply();
                }
            } catch (err) {}
        }, 20000);
    }
    
    async updateStatus(guildId, reportId, newStatus) {
        const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND guild_id = ?`).get(reportId, guildId);
        if (!report) return;

        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;

        const staffs = report.staffs ? JSON.parse(report.staffs) : [];
        const targetUser = await this.client.users.fetch(report.user_id);
        
        const logChannelId = ConfigSystem.getSetting(guildId, 'log_reports');
        if (logChannelId && report.log_message_id) {
            const logChannel = await guild.channels.fetch(logChannelId);
            const logMessage = await logChannel.messages.fetch(report.log_message_id);
            if (logMessage) {
                const updatedBuilder = this.createBaseContainer(guild, report.id, targetUser, newStatus, staffs);
                const updatedPayload = { components: [updatedBuilder.build()], flags: ['IsComponentsV2'] };
                updatedPayload.components.push(...logMessage.components.slice(1));
                await logMessage.edit(updatedPayload);
            }
        }

        if (report.dm_message_id) {
            const dmMessage = await targetUser.createDM().then(dm => dm.messages.fetch(report.dm_message_id)).catch(() => null);
            if (dmMessage) {
                const updatedBuilder = this.createBaseContainer(guild, report.id, targetUser, newStatus, staffs);
                const updatedPayload = { components: [updatedBuilder.build()], flags: ['IsComponentsV2'] };
                updatedPayload.components.push(...dmMessage.components.slice(1));
                await dmMessage.edit(updatedPayload);
            }
        }
    }
}

module.exports = ReportChatSystem;