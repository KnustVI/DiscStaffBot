// src/systems/reportChatSystem.js
const db = require('../database/index');
const ConfigSystem = require('./configSystem');
const ResponseManager = require('../utils/responseManager');
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

    // ==================== HELPERS ====================
    
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

    // ==================== MODAIS ====================

    getOpenModal() {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
        const modal = new ModalBuilder()
            .setCustomId('report_modal')
            .setTitle('Abrir Report');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('regra').setLabel('Qual a regra quebrada?').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: Regra 5 - Flood')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('data_hora').setLabel('Quando aconteceu?').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: 09/04/2026 14:30')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('local').setLabel('Qual local do mapa?').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Ex: Floresta Central')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('descricao').setLabel('Descreva a quebra de regra').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Descreva detalhadamente...')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('termo').setLabel('Termo de boa convivência').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Declaro que as informações são verdadeiras...')
            )
        );
        return modal;
    }

    // Modal para STAFF (com punição)
    getCloseModalStaff() {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
        const modal = new ModalBuilder()
            .setCustomId('close_modal_staff')
            .setTitle('Fechar Report (Staff)');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('motivo').setLabel('Qual motivo do fechamento?').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: Resolvido')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('punicao').setLabel('Punição aplicada (opcional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Ex: Advertência, Strike, Ban')
            )
        );
        return modal;
    }

    // Modal para USUÁRIO (apenas motivo)
    getCloseModalUser() {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
        const modal = new ModalBuilder()
            .setCustomId('close_modal_user')
            .setTitle('Fechar Report');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('motivo').setLabel('Qual motivo do fechamento?').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: Problema resolvido')
            )
        );
        return modal;
    }

    getRatingModal() {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
        const modal = new ModalBuilder()
            .setCustomId('rating_modal')
            .setTitle('Avaliar Atendimento');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('nota').setLabel('Qual nota você dá para o atendimento? (1-5)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ex: 5')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('comentario').setLabel('Observação adicional?').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('Seu feedback...')
            )
        );
        return modal;
    }

    // ==================== PAINEL ====================
    
    getPanel(guildName) {
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(`# ${EMOJIS.chat || '🎫'} Como Reportar um Jogador\n\n- **Abra um Report** – Clique no botão abaixo para abrir um report.\n- **Preencha o Formulário** – Responda o formulário enviado pelo bot.\n- **Descreva a Situação** – Explique o que aconteceu.\n- **Envie as Provas** – Inclua vídeos ou prints.\n- **Aguarde a Análise** – A equipe analisará o caso.`)
            .setFooter({ text: guildName })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_report')
                .setLabel('Reportar Jogador')
                .setStyle(ButtonStyle.Primary)
                .setEmoji(EMOJIS.chat || '🎫')
        );
        return { embeds: [embed], components: [row] };
    }

    // ==================== ABRIR REPORT ====================
    
    async openReport(interaction, data) {
        const { guild, user } = interaction;
        await interaction.reply({ content: '⏳ Criando report...', flags: 64 });
        
        try {
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
            if (!logChannelId) {
                return await interaction.editReply({ content: '❌ Canal de logs não configurado!', flags: 64 });
            }

            const reportId = `#R${this.getNextId(guild.id)}`;
            const threadName = `${reportId}-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
            
            const thread = await interaction.channel.threads.create({
                name: threadName,
                type: ChannelType.PrivateThread,
                invitable: false,
                reason: `Report de ${user.tag}`
            });
            await thread.members.add(user.id);

            const threadEmbed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setDescription(`# REPORTE | ${reportId}\nObrigado por abrir o reporte.\n\n- **Status:** ${this.getStatusText('waiting')}`)
                .setFooter({ text: guild.name })
                .setTimestamp();
            const threadMsg = await thread.send({ embeds: [threadEmbed] });

            await thread.send([
                `**📋 Informações do Report:**`,
                `**Regra quebrada:** ${data.regra}`,
                `**Quando aconteceu:** ${data.dataHora}`,
                `**Local:** ${data.local || 'Não informado'}`,
                `**Descrição:** ${data.descricao}`,
                `**Termo de convivência:** ${data.termo}`
            ].join('\n'));

            const dmEmbed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setDescription(`# REPORTE | ${reportId}\nObrigado por abrir o reporte.\n\n- **Status:** ${this.getStatusText('waiting')}`)
                .setFooter({ text: guild.name })
                .setTimestamp();
            const dmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`close:${reportId}`).setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
                new ButtonBuilder().setCustomId(`close_reason:${reportId}`).setLabel('Fechar com Motivo').setStyle(ButtonStyle.Primary).setEmoji('📝')
            );
            const dmMessage = await user.send({ embeds: [dmEmbed], components: [dmRow] }).catch(() => null);

            const logChannel = await guild.channels.fetch(logChannelId);
            const logEmbed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setDescription(`# REPORTE | ${reportId}\n**Usuário:** ${user.tag}\n- **Status:** ${this.getStatusText('waiting')}\n- **Staffs:** Nenhum`)
                .setFooter({ text: guild.name })
                .setTimestamp();
            const logRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`join:${reportId}`).setLabel('Entrar no Reporte').setStyle(ButtonStyle.Success).setEmoji('👋'),
                new ButtonBuilder().setCustomId(`close:${reportId}`).setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
                new ButtonBuilder().setCustomId(`close_reason:${reportId}`).setLabel('Fechar com Motivo').setStyle(ButtonStyle.Primary).setEmoji('📝')
            );
            const logMessage = await logChannel.send({ embeds: [logEmbed], components: [logRow] });

            db.prepare(`
                INSERT INTO reports (id, guild_id, user_id, thread_id, log_message_id, dm_message_id, thread_message_id, status, created_at, last_message_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(reportId, guild.id, user.id, thread.id, logMessage.id, dmMessage?.id || null, threadMsg.id, 'waiting', Date.now(), Date.now());

            await interaction.editReply({ content: `✅ ${reportId} criado! ${thread.url}`, flags: 64 });
            
        } catch (error) {
            console.error('❌ Erro ao criar report:', error);
            await interaction.editReply({ content: '❌ Erro ao criar report.', flags: 64 });
        }
    }

    // ==================== STAFF ENTRAR ====================
    
    async joinReport(interaction, reportId) {
        const { guild, user, member, channel } = interaction;
        
        try {
            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            if (!member?.roles?.cache?.has(staffRoleId)) {
                await channel.send({ content: `❌ ${user}, você não tem permissão para entrar em reports.` });
                return;
            }

            const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND guild_id = ?`).get(reportId, guild.id);
            if (!report) {
                await channel.send({ content: `❌ Report ${reportId} não encontrado.` });
                return;
            }

            const thread = await guild.channels.fetch(report.thread_id);
            if (thread) await thread.members.add(user.id);

            let staffs = report.staffs ? JSON.parse(report.staffs) : [];
            if (!staffs.includes(user.id)) {
                staffs.push(user.id);
                db.prepare(`UPDATE reports SET staffs = ? WHERE id = ?`).run(JSON.stringify(staffs), reportId);
            }

            const staffsText = staffs.map(s => `<@${s}>`).join(', ');
            
            const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
            if (logChannelId && report.log_message_id) {
                const logChannel = await guild.channels.fetch(logChannelId);
                const logMessage = await logChannel.messages.fetch(report.log_message_id);
                if (logMessage && logMessage.embeds[0]) {
                    const oldDesc = logMessage.embeds[0].description;
                    const newDesc = oldDesc.replace(/- \*\*Staffs:\*\* .+/, `- **Staffs:** ${staffsText}`);
                    const updatedEmbed = EmbedBuilder.from(logMessage.embeds[0]).setDescription(newDesc);
                    await logMessage.edit({ embeds: [updatedEmbed], components: logMessage.components });
                }
            }

            if (report.dm_message_id) {
                const targetUser = await this.client.users.fetch(report.user_id);
                const dmChannel = await targetUser.createDM();
                const dmMessage = await dmChannel.messages.fetch(report.dm_message_id);
                if (dmMessage && dmMessage.embeds[0]) {
                    const oldDesc = dmMessage.embeds[0].description;
                    const newDesc = oldDesc.replace(/- \*\*Staffs:\*\* .+/, `- **Staffs:** ${staffsText}`);
                    const updatedEmbed = EmbedBuilder.from(dmMessage.embeds[0]).setDescription(newDesc);
                    await dmMessage.edit({ embeds: [updatedEmbed], components: dmMessage.components });
                }
            }

            await channel.send({ content: `✅ ${user} entrou no ${reportId}` });
            
        } catch (error) {
            console.error('❌ Erro ao entrar:', error);
            await channel.send({ content: `❌ Erro ao entrar no report ${reportId}.` });
        }
    }

    // ==================== FECHAR REPORT ====================
        async closeReport(interaction, reportId, motivo, punicao, hasReason) {        
            try {
                const report = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(reportId);
                if (!report) {
                    await interaction.channel?.send({ content: `❌ Report ${reportId} não encontrado.` });
                    return;
                }

                // Buscar o servidor a partir do report.guild_id
                const guild = this.client.guilds.cache.get(report.guild_id);
                if (!guild) {
                    await interaction.channel?.send({ content: `❌ Servidor do report ${reportId} não encontrado.` });
                    return;
                }

                const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
                const isStaff = interaction.member?.roles?.cache?.has(staffRoleId);
                const closedByName = isStaff ? `Staff ${interaction.user.tag}` : `Usuário ${interaction.user.tag}`;
                const status = hasReason ? 'closed_with_reason' : 'closed_no_reason';

                // Atualizar banco
                db.prepare(`UPDATE reports SET status = ?, closed_at = ?, closed_by = ?, closed_reason = ?, punishment = ? WHERE id = ?`)
                    .run(status, Date.now(), interaction.user.id, motivo || null, punicao || null, report.id);

                // Arquivar thread
                const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
                if (thread) {
                    await thread.setLocked(true).catch(() => {});
                    await thread.setArchived(true).catch(() => {});
                }

                // ATUALIZAR LOG (editando embed, REMOVENDO botões)
                const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
                if (logChannelId && report.log_message_id) {
                    const logChannel = await guild.channels.fetch(logChannelId);
                    const logMessage = await logChannel.messages.fetch(report.log_message_id);
                    if (logMessage && logMessage.embeds[0]) {
                        const oldEmbed = logMessage.embeds[0];
                        const oldDesc = oldEmbed.description;
                        
                        const statusText = this.getStatusText(status, closedByName, motivo);
                        let newDesc = oldDesc.replace(/- \*\*Status:\*\* .+/, `- **Status:** ${statusText}`);
                        
                        if (!oldDesc.includes('Motivo de fechamento')) {
                            newDesc += `\n\n## 📝 Motivo de fechamento:\n\`\`\`text\n${motivo || 'Sem motivo'}\n\`\`\``;
                        }
                        
                        const updatedEmbed = EmbedBuilder.from(oldEmbed)
                            .setDescription(newDesc)
                            .setColor(0xF64B4E);
                        
                        await logMessage.edit({ embeds: [updatedEmbed], components: [] });
                    }
                }

                // ATUALIZAR DM (editando embed, ADICIONANDO botão de avaliação)
                if (report.dm_message_id) {
                    const targetUser = await this.client.users.fetch(report.user_id);
                    const dmChannel = await targetUser.createDM();
                    const dmMessage = await dmChannel.messages.fetch(report.dm_message_id);
                    const embed = new EmbedBuilder()
                        .setColor(0xF64B4E)
                        .setDescription(`# 🔒 REPORTE | ${report.id} | FINALIZADO\n- **Motivo de fechamento:**\n\`\`\`text\n${motivo || 'Sem motivo'}\n\`\`\``)
                        .setFooter({ text: guild.name })
                        .setTimestamp();
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`rate:${report.id}`)
                            .setLabel('Avaliar Atendimento')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('⭐')
                    );
                    await dmMessage.edit({ embeds: [embed], components: [row] });
                }

                // RESPOSTA (pode ser no canal da interação ou DM)
                const replyTarget = interaction.channel || interaction.user;
                await replyTarget.send({ content: `✅ ${report.id} foi fechado por ${interaction.user}.` });
                
            } catch (error) {
                console.error('❌ Erro ao fechar:', error);
                const replyTarget = interaction.channel || interaction.user;
                await replyTarget.send({ content: `❌ Erro ao fechar o report ${reportId}.` });
            }
        }

    // ==================== AVALIAR ====================
    
    async rateReport(interaction, reportId, nota, comentario) {
        const { channel } = interaction;
        
        try {
            const report = db.prepare(`SELECT * FROM reports WHERE id = ? AND user_id = ?`).get(reportId, interaction.user.id);
            if (!report) {
                await channel.send({ content: `❌ Report ${reportId} não encontrado.` });
                return;
            }
            if (report.rating) {
                await channel.send({ content: `❌ Este report já foi avaliado.` });
                return;
            }

            db.prepare(`UPDATE reports SET rating = ?, rating_comment = ? WHERE id = ?`).run(nota, comentario, reportId);

            const guild = this.client.guilds.cache.get(report.guild_id);
            const logChannelId = ConfigSystem.getSetting(report.guild_id, 'log_reports');
            if (logChannelId && report.log_message_id && guild) {
                const logChannel = await guild.channels.fetch(logChannelId);
                const logMessage = await logChannel.messages.fetch(report.log_message_id);
                if (logMessage && logMessage.embeds[0]) {
                    const oldDesc = logMessage.embeds[0].description;
                    const newDesc = oldDesc + `\n- **Avaliação:** ${'⭐'.repeat(nota)} (${nota}/5)\n- **Comentário:** ${comentario || 'Nenhum'}`;
                    const updatedEmbed = EmbedBuilder.from(logMessage.embeds[0]).setDescription(newDesc);
                    await logMessage.edit({ embeds: [updatedEmbed], components: [] });
                }
            }

            await channel.send({ content: `✅ Avaliação registrada! Obrigado.` });
            
        } catch (error) {
            console.error('❌ Erro ao avaliar:', error);
            await channel.send({ content: `❌ Erro ao avaliar report ${reportId}.` });
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
        const statusText = this.getStatusText(newStatus);

        const logChannelId = ConfigSystem.getSetting(guildId, 'log_reports');
        if (logChannelId && report.log_message_id) {
            const logChannel = await guild.channels.fetch(logChannelId);
            const logMessage = await logChannel.messages.fetch(report.log_message_id);
            if (logMessage && logMessage.embeds[0]) {
                const oldDesc = logMessage.embeds[0].description;
                const newDesc = oldDesc.replace(/- \*\*Status:\*\* .+/, `- **Status:** ${statusText}`);
                const updatedEmbed = EmbedBuilder.from(logMessage.embeds[0]).setDescription(newDesc);
                await logMessage.edit({ embeds: [updatedEmbed], components: logMessage.components });
            }
        }

        if (report.dm_message_id) {
            const targetUser = await this.client.users.fetch(report.user_id);
            const dmChannel = await targetUser.createDM();
            const dmMessage = await dmChannel.messages.fetch(report.dm_message_id);
            if (dmMessage && dmMessage.embeds[0]) {
                const oldDesc = dmMessage.embeds[0].description;
                const newDesc = oldDesc.replace(/- \*\*Status:\*\* .+/, `- **Status:** ${statusText}`);
                const updatedEmbed = EmbedBuilder.from(dmMessage.embeds[0]).setDescription(newDesc);
                await dmMessage.edit({ embeds: [updatedEmbed], components: dmMessage.components });
            }
        }
    }
}

module.exports = ReportChatSystem;