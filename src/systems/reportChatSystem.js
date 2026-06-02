// /home/ubuntu/DiscStaffBot/src/systems/reportChatSystem.js
const db = require('../database/index');
const ConfigSystem = require('./configSystem');
const { 
    ChannelType, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    ComponentType,
    MessageFlags,
} = require('discord.js');
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
        const last = db.prepare(`
            SELECT report_number FROM reports 
            WHERE guild_id = ? 
            ORDER BY created_at DESC LIMIT 1
        `).get(guildId);
        
        if (!last) return 1;
        return last.report_number + 1;
    }

    getStatusText(status, closedBy = null, closedReason = null, closedAt = null) {
        const statusMap = {
            waiting: '⏳ Aguardando staff',
            responded: '💬 Respondido',
            inactive: '⚠️ Inativo',
            closed_no_reason: '🔒 Fechado',
            closed_with_reason: '✅ Concluído'
        };
        
        let baseStatus = statusMap[status] || status;
        
        if ((status === 'closed_no_reason' || status === 'closed_with_reason') && closedBy) {
            const closedTime = closedAt ? `<t:${Math.floor(closedAt / 1000)}:R>` : '';
            baseStatus = `${baseStatus} por ${closedBy} ${closedTime}`.trim();
        }
        
        return baseStatus;
    }

    // ==================== BASE CONTAINER ====================

    createBaseContainer(guild, reportNumber, user, status = 'waiting', staffs = [], extraDescription = '') {
        // Buscar informações adicionais do report
        const reportInfo = db.prepare(`
            SELECT last_reply_by, last_reply_at, closed_by, closed_at, closed_reason, punishment, rating, rating_comment, thread_id
            FROM reports 
            WHERE guild_id = ? AND report_number = ?
        `).get(guild.id, reportNumber);
        
        // Determinar a cor baseada no status
        let color;
        if (status === 'closed_no_reason' || status === 'closed_with_reason') {
            color = ContainerFormatter.colors.info;
        } else if (status === 'responded') {
            color = ContainerFormatter.colors.success;
        } else {
            color = ContainerFormatter.colors.error;
        }
        
        const builder = ContainerFormatter.create(guild.name, color);
        const reportIdDisplay = `#R${reportNumber}`;
        
        // ==================== 1. HEADER COM THUMBNAIL ====================
        const thumbnailUrl = user.displayAvatarURL({ size: 64 });
        const thumbnail = {
            type: ComponentType.Thumbnail,
            url: thumbnailUrl
        };
        
        builder.section(
            `# REPORTE | ${reportIdDisplay} │ ${user.toString()}\n${ContainerFormatter.field('Userinfo', `${user.tag} (${user.id})`)}`,
            thumbnail
        );
        builder.line();
        
        // ==================== 2. STATUS ====================
        let statusText = '';
        let closedByName = null;
        let closedAt = null;
        let closedReason = reportInfo?.closed_reason || null;
        let punishment = reportInfo?.punishment || null;
        
        if (reportInfo && reportInfo.closed_by) {
            try {
                const closedUser = this.client.users.cache.get(reportInfo.closed_by);
                closedByName = closedUser ? closedUser.toString() : `Usuário desconhecido`;
                closedAt = reportInfo.closed_at;
            } catch (err) {
                closedByName = `Usuário (${reportInfo.closed_by})`;
            }
        }
        
        const closedTime = closedAt ? `<t:${Math.floor(closedAt / 1000)}:R>` : '';
        
        if (status === 'closed_with_reason') {
            statusText = `### 📊 Status:\n✅ **Concluído por:** ${closedByName} ${closedTime}\n⚠️ **Punição aplicada:** ${punishment || 'Nenhuma'}`;
        } else if (status === 'closed_no_reason') {
            statusText = `### 📊 Status:\n🔒 **Fechado sem motivo por:** ${closedByName} ${closedTime}`;
        } else if (status === 'waiting') {
            statusText = `### 📊 Status:\n⏳ **Aguardando staff**`;
        } else if (status === 'responded') {
            statusText = `### 📊 Status:\n💬 **Respondido**`;
        } else if (status === 'inactive') {
            statusText = `### 📊 Status:\n⚠️ **Inativo** (4h sem mensagens)`;
        }
        
        // Criar botão de link se existir thread
        if (reportInfo?.thread_id) {
            const threadLink = `https://discord.com/channels/${guild.id}/${reportInfo.thread_id}`;
            const linkButton = {
                type: ComponentType.Button,
                style: ButtonStyle.Link,
                label: '🔗 Ir para o chat',
                url: threadLink
            };
            builder.section(statusText, linkButton);
        } else {
            builder.text(statusText);
        }
        builder.line();
        
        // ==================== 3. MOTIVO ====================
        if (closedReason) {
            builder.text(`### 📝 Motivo:\n\`\`\`${closedReason}\`\`\``);
            builder.line();
        }
        
        // ==================== 4. STAFFS ====================
        if (staffs && staffs.length > 0) {
            let staffsText = `### 👥 Staffs:\n`;
            for (const s of staffs) {
                const entryTime = `<t:${Math.floor(s.timestamp / 1000)}:R>`;
                staffsText += `<@${s.id}> (entrou ${entryTime})\n`;
            }
            builder.text(staffsText);
            builder.line();
        }
        
        // ==================== 5. AVALIAÇÃO ====================
        if (reportInfo?.rating && reportInfo.rating > 0) {
            const stars = '⭐'.repeat(reportInfo.rating);
            let ratingText = `### Avaliação: ${reportInfo.rating}/5\n`;
            if (reportInfo.rating_comment) {
                ratingText += `\`\`\`${reportInfo.rating_comment}\`\`\`\n`;
            }
            ratingText += `# ${stars}`;
            builder.text(ratingText);
            builder.line();
        }
        
        // ==================== 6. FOOTER ====================
        builder.footer();
        
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
        const builder = ContainerFormatter.create(guildName, 0xDCA15E);
        
        builder.title(`${EMOJIS.chat || '🎫'} Denúncia de jogador`, 1);
        builder.text([
            `- **Abra um Reporte**: Clique no botão abaixo para abrir uma denúncia.`,
            `- **Preencha o Formulário**: Responda o formulário enviado pelo bot.`,
            `- **Descreva a Situação**: Explique o que aconteceu.`,
            `- **Envie as Provas**: Inclua vídeos ou prints.`,
            `- **Aguarde a Análise**: A equipe analisará o caso.`
        ].join('\n'));
        builder.footer();

        // Botão do painel usando ButtonBuilder
        const reportButton = new ButtonBuilder()
            .setCustomId('open_report')
            .setLabel('Reportar Jogador')
            .setStyle(ButtonStyle.Primary)
            .setEmoji(EMOJIS.chat || '🎫');
        
        // ✅ Container + botão separadamente
        return {
            components: [builder.build(), new ActionRowBuilder().addComponents(reportButton)],
            flags: MessageFlags.IsComponentsV2
        };
    }

    // ==================== ABRIR REPORT ====================
    
    async openReport(interaction, data) {
        const { guild, user } = interaction;
        
        // ✅ Removido content com mensagem temporária
        await interaction.editReply({ 
            content: '⏳ Criando report...',
            flags: MessageFlags.Ephemeral
        });
        
        try {
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
            if (!logChannelId) {
                await interaction.editReply({ content: '❌ Canal de logs não configurado!', flags: MessageFlags.Ephemeral });
                return;
            }

            const reportNumber = this.getNextId(guild.id);
            const reportId = `#R${reportNumber}`;
            const threadName = `【${reportId}】report-${user.username}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
            
            const thread = await interaction.channel.threads.create({
                name: threadName,
                type: ChannelType.PrivateThread,
                invitable: false,
                reason: `Report de ${user.tag}`
            });
            await thread.members.add(user.id);

            // ==================== CONTAINER DA THREAD ====================
            const threadBuilder = ContainerFormatter.create(guild.name, 0xDCA15E);
            threadBuilder.title(`${EMOJIS.chat || '🗨️'} REPORTE | ${reportId}`, 1);
            threadBuilder.text(`Obrigado por abrir o reporte. Um membro da staff irá te atender em breve.\n\nEnquanto aguarda, você pode adicionar mais informações ou provas neste chat.`);
            threadBuilder.footer();
            
            // ✅ Flags corrigida
            const threadMsg = await thread.send({ 
                components: [threadBuilder.build()], 
                flags: MessageFlags.IsComponentsV2 
            });

            // ==================== CONTAINER DE INFORMAÇÕES ====================
            const infoBuilder = ContainerFormatter.create(guild.name, 0xDCA15E);
            infoBuilder.title(`${EMOJIS.chat || '📋'} Informações do Report`, 1);
            infoBuilder.line();
            infoBuilder.text(`**📝 Regra quebrada:** ${data.regra}`);
            infoBuilder.text(`**⏰ Quando aconteceu:** ${data.dataHora}`);
            infoBuilder.text(`**📍 Local:** ${data.local || 'Não informado'}`);
            infoBuilder.text(`**📋 Descrição:** ${data.descricao}`);
            infoBuilder.text(`**⚖️ Termo de convivência:** ${data.termo}`);
            infoBuilder.footer();
            
            await thread.send({ 
                components: [infoBuilder.build()], 
                flags: MessageFlags.IsComponentsV2 
            });

            // ==================== DM DO USUÁRIO ====================
            const dmBuilder = this.createBaseContainer(guild, reportNumber, user, 'waiting', []);
            
            // ✅ Botões dentro do Container usando .buttons()
            const closeButton = new ButtonBuilder()
                .setCustomId(`close:${guild.id}:${reportNumber}`)
                .setLabel('Fechar')
                .setStyle(ButtonStyle.Danger);
                
            const closeReasonButton = new ButtonBuilder()
                .setCustomId(`close_reason:${guild.id}:${reportNumber}`)
                .setLabel('Fechar com Motivo')
                .setStyle(ButtonStyle.Primary);
            
            dmBuilder.buttons(closeButton, closeReasonButton);
            
            const dmMessage = await user.send({ 
                components: [dmBuilder.build()], 
                flags: MessageFlags.IsComponentsV2 
            }).catch(() => null);

            // ==================== LOG DA STAFF ====================
            const logChannel = await guild.channels.fetch(logChannelId);
            const logBuilder = this.createBaseContainer(guild, reportNumber, user, 'waiting', []);
            
            // ✅ Botões no log
            const joinButton = new ButtonBuilder()
                .setCustomId(`join:${reportId}`)
                .setLabel('Entrar no Reporte')
                .setStyle(ButtonStyle.Success);
                
            const logCloseButton = new ButtonBuilder()
                .setCustomId(`close:${reportId}`)
                .setLabel('Fechar')
                .setStyle(ButtonStyle.Danger);
                
            const logCloseReasonButton = new ButtonBuilder()
                .setCustomId(`close_reason:${reportId}`)
                .setLabel('Fechar com Motivo')
                .setStyle(ButtonStyle.Primary);
            
            logBuilder.buttons(joinButton, logCloseButton, logCloseReasonButton);
            
            const logMessage = await logChannel.send({ 
                components: [logBuilder.build()], 
                flags: MessageFlags.IsComponentsV2 
            });

            // ==================== SALVAR NO BANCO ====================
            db.prepare(`
                INSERT INTO reports (guild_id, report_number, user_id, thread_id, log_message_id, dm_message_id, thread_message_id, status, staffs, created_at, last_message_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(guild.id, reportNumber, user.id, thread.id, logMessage.id, dmMessage?.id || null, threadMsg.id, 'waiting', '[]', Date.now(), Date.now());

            // ✅ Resposta final sem content + components misturados
            await interaction.editReply({ 
                content: `✅ ${reportId} criado! ${thread.url}`,
                flags: MessageFlags.Ephemeral
            });
            
        } catch (error) {
            console.error('❌ Erro ao criar report:', error);
            await interaction.editReply({ content: '❌ Erro ao criar report.', flags: MessageFlags.Ephemeral });
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

            const reportNumber = parseInt(reportId.replace('#R', ''));
            const report = db.prepare(`SELECT * FROM reports WHERE guild_id = ? AND report_number = ?`).get(guild.id, reportNumber);
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
                db.prepare(`UPDATE reports SET staffs = ? WHERE guild_id = ? AND report_number = ?`).run(JSON.stringify(staffs), guild.id, reportNumber);
            }

            const targetUser = await this.client.users.fetch(report.user_id);
            
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
            if (logChannelId && report.log_message_id) {
                const logChannel = await guild.channels.fetch(logChannelId);
                const logMessage = await logChannel.messages.fetch(report.log_message_id);
                if (logMessage) {
                    const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, report.status, staffs);
                    
                    // ✅ Preservar botões existentes
                    const existingComponents = logMessage.components;
                    const buttonsToPreserve = existingComponents.slice(1); // Pular o primeiro container
                    
                    await logMessage.edit({ 
                        components: [updatedBuilder.build(), ...buttonsToPreserve],
                        flags: MessageFlags.IsComponentsV2 
                    });
                }
            }

            if (report.dm_message_id) {
                const dmMessage = await user.createDM().then(dm => dm.messages.fetch(report.dm_message_id)).catch(() => null);
                if (dmMessage) {
                    const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, report.status, staffs);
                    const existingComponents = dmMessage.components;
                    const buttonsToPreserve = existingComponents.slice(1);
                    
                    await dmMessage.edit({ 
                        components: [updatedBuilder.build(), ...buttonsToPreserve],
                        flags: MessageFlags.IsComponentsV2 
                    });
                }
            }

            await this.sendTempReply(interaction, `${user} entrou no ${reportId}`, true);
            
        } catch (error) {
            console.error('❌ Erro ao entrar:', error);
            await this.sendTempReply(interaction, `Erro ao entrar no report ${reportId}.`, false);
        }
    }

    // ==================== FECHAR REPORT ====================
    
    async closeReport(interaction, reportNumber, motivo, punicao, hasReason, guildId = null) {
        try {
            const targetGuildId = guildId || interaction.guildId;
            
            const report = db.prepare(`
                SELECT * FROM reports 
                WHERE guild_id = ? AND report_number = ?
            `).get(targetGuildId, reportNumber);
            
            if (!report) {
                const reportId = `#R${reportNumber}`;
                await this.sendTempReply(interaction, `Report ${reportId} não encontrado.`, false);
                return;
            }
            
            const reportId = `#R${reportNumber}`;
            const guild = this.client.guilds.cache.get(report.guild_id);
            
            if (!guild) {
                await this.sendTempReply(interaction, `Servidor do report ${reportId} não encontrado.`, false);
                return;
            }

            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            const isStaff = interaction.member?.roles?.cache?.has(staffRoleId);
            const closedByMention = interaction.user.toString();
            const status = hasReason ? 'closed_with_reason' : 'closed_no_reason';
            const closedAt = Date.now();

            db.prepare(`
                UPDATE reports 
                SET status = ?, closed_at = ?, closed_by = ?, closed_reason = ?, punishment = ? 
                WHERE guild_id = ? AND report_number = ?
            `).run(status, closedAt, interaction.user.id, motivo || null, punicao || null, guild.id, reportNumber);

            const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
            if (thread) {
                await thread.send({
                    content: `🔒 Report fechado por ${closedByMention}`
                }).catch(() => {});
                await thread.setLocked(true).catch(() => {});
                await thread.setArchived(true).catch(() => {});
            }

            const staffs = report.staffs ? JSON.parse(report.staffs) : [];
            const targetUser = await this.client.users.fetch(report.user_id);
            
            // Extra description com motivo de fechamento
            let extraDesc = `\n\n🔒 **Fechado por:** ${closedByMention}\n📅 **Data:** <t:${Math.floor(closedAt / 1000)}:F>`;
            if (motivo) extraDesc += `\n📝 **Motivo:** ${motivo}`;
            
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
            if (logChannelId && report.log_message_id) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId);
                    const logMessage = await logChannel.messages.fetch(report.log_message_id);
                    if (logMessage) {
                        const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, status, staffs, extraDesc);
                        await logMessage.edit({ 
                            components: [updatedBuilder.build()], 
                            flags: MessageFlags.IsComponentsV2 
                        });
                    }
                } catch (err) {}
            }

            if (report.dm_message_id) {
                try {
                    const dmMessage = await targetUser.createDM().then(dm => dm.messages.fetch(report.dm_message_id)).catch(() => null);
                    if (dmMessage) {
                        const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, status, staffs, extraDesc);
                        
                        // ✅ Botão de avaliação dentro do Container
                        const rateButton = new ButtonBuilder()
                            .setCustomId(`rate:${guild.id}:${reportNumber}`)
                            .setLabel('Avaliar Atendimento')
                            .setStyle(ButtonStyle.Secondary);
                        
                        updatedBuilder.buttons(rateButton);
                        
                        await dmMessage.edit({ 
                            components: [updatedBuilder.build()], 
                            flags: MessageFlags.IsComponentsV2 
                        });
                    }
                } catch (err) {}
            }

            await this.sendTempReply(interaction, `${reportId} foi fechado por ${interaction.user}.`, true);
            
        } catch (error) {
            console.error('❌ Erro ao fechar:', error);
            await this.sendTempReply(interaction, `Erro ao fechar o report #${reportNumber}.`, false);
        }
    }

    // ==================== AVALIAR ====================
    
    async rateReport(interaction, reportNumber, nota, comentario, guildId = null) {
        try {
            const targetGuildId = guildId || interaction.guildId;
            
            const report = db.prepare(`
                SELECT * FROM reports 
                WHERE guild_id = ? AND report_number = ? AND user_id = ?
            `).get(targetGuildId, reportNumber, interaction.user.id);
            
            if (!report) {
                const reportId = `#R${reportNumber}`;
                await this.sendTempReply(interaction, `Report ${reportId} não encontrado.`, false);
                return;
            }
            
            const reportId = `#R${reportNumber}`;
            
            if (report.rating) {
                await this.sendTempReply(interaction, `Este report já foi avaliado.`, false);
                return;
            }

            db.prepare(`
                UPDATE reports 
                SET rating = ?, rating_comment = ? 
                WHERE guild_id = ? AND report_number = ?
            `).run(nota, comentario, targetGuildId, reportNumber);

            const guild = this.client.guilds.cache.get(report.guild_id);
            const staffs = report.staffs ? JSON.parse(report.staffs) : [];
            const targetUser = await this.client.users.fetch(report.user_id);
            const extraDesc = `\n\n⭐ **Avaliação:** ${'⭐'.repeat(nota)} (${nota}/5)\n💬 **Comentário:** ${comentario || 'Nenhum'}`;
            
            const logChannelId = ConfigSystem.getSetting(report.guild_id, 'log_reports');
            if (logChannelId && report.log_message_id && guild) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId);
                    const logMessage = await logChannel.messages.fetch(report.log_message_id);
                    if (logMessage) {
                        const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, report.status, staffs, extraDesc);
                        await logMessage.edit({ 
                            components: [updatedBuilder.build()], 
                            flags: MessageFlags.IsComponentsV2 
                        });
                    }
                } catch (err) {}
            }

            await this.sendTempReply(interaction, `Avaliação registrada! Obrigado.`, true);
            
        } catch (error) {
            console.error('❌ Erro ao avaliar:', error);
            await this.sendTempReply(interaction, `Erro ao avaliar report #${reportNumber}.`, false);
        }
    }

    // ==================== RESPOSTA TEMPORÁRIA ====================
    
    async sendTempReply(interaction, content, success = true) {
        const emoji = success ? (EMOJIS.Check || '✅') : (EMOJIS.Error || '❌');
        
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ 
                content: `${emoji} ${content}`,
                flags: MessageFlags.Ephemeral
            });
        } else {
            await interaction.reply({ 
                content: `${emoji} ${content}`, 
                flags: MessageFlags.Ephemeral 
            });
        }
        
        setTimeout(async () => {
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.deleteReply();
                }
            } catch (err) {}
        }, 20000);
    }
    
    // ==================== ATUALIZAR STATUS ====================
    
    async updateStatus(guildId, reportId, newStatus) {
        const reportNumber = parseInt(reportId.replace('#R', ''));
        const report = db.prepare(`SELECT * FROM reports WHERE guild_id = ? AND report_number = ?`).get(guildId, reportNumber);
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
                const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, newStatus, staffs);
                const existingComponents = logMessage.components;
                const buttonsToPreserve = existingComponents.slice(1);
                
                await logMessage.edit({ 
                    components: [updatedBuilder.build(), ...buttonsToPreserve],
                    flags: MessageFlags.IsComponentsV2 
                });
            }
        }

        if (report.dm_message_id) {
            const dmMessage = await targetUser.createDM().then(dm => dm.messages.fetch(report.dm_message_id)).catch(() => null);
            if (dmMessage) {
                const updatedBuilder = this.createBaseContainer(guild, reportNumber, targetUser, newStatus, staffs);
                const existingComponents = dmMessage.components;
                const buttonsToPreserve = existingComponents.slice(1);
                
                await dmMessage.edit({ 
                    components: [updatedBuilder.build(), ...buttonsToPreserve],
                    flags: MessageFlags.IsComponentsV2 
                });
            }
        }
    }
}

module.exports = ReportChatSystem;