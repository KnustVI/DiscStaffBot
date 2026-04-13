// src/systems/reportChatSystem.js
const db = require('../database/index');
const ConfigSystem = require('./configSystem');
const { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

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

    // ==================== MODAL DE ABERTURA ====================
    getOpenModal() {
        const modal = new ModalBuilder()
            .setCustomId('report_modal')
            .setTitle('Abrir Report');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('seu_nick')
                    .setLabel('Seu nick/ID Alderon')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('Ex: KnustVI')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('alvo_nick')
                    .setLabel('Nick/ID do infrator')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('Ex: LupusSaurus')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('data_hora')
                    .setLabel('Data e hora')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('Ex: 09/04/2026 14:30')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('regra')
                    .setLabel('Regra quebrada')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('Ex: Regra 5 - Flood')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('descricao')
                    .setLabel('Descrição')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setPlaceholder('Descreva o ocorrido...')
            )
        );
        return modal;
    }

    // ==================== MODAL DE FECHAMENTO ====================
    getCloseModal() {
        const modal = new ModalBuilder()
            .setCustomId('close_modal')
            .setTitle('Fechar Report');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('motivo')
                    .setLabel('Motivo')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('Ex: Resolvido')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('punicao')
                    .setLabel('Punição (opcional)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('Ex: Advertência')
            )
        );
        return modal;
    }

    // ==================== MODAL DE AVALIAÇÃO ====================
    getRatingModal() {
        const modal = new ModalBuilder()
            .setCustomId('rating_modal')
            .setTitle('Avaliar');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('nota')
                    .setLabel('Nota (1-5)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('5')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('comentario')
                    .setLabel('Comentário')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setPlaceholder('Seu feedback...')
            )
        );
        return modal;
    }

    // ==================== PAINEL ====================
    getPanel(guildName) {
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setDescription(`# 🎫 ReportChat\nClique no botão abaixo para abrir um report.`)
            .setFooter({ text: guildName })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_report')
                .setLabel('Abrir Report')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎫')
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
            const threadName = `report-${reportId}-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
            
            // Criar thread
            const thread = await interaction.channel.threads.create({
                name: threadName,
                type: ChannelType.PrivateThread,
                invitable: false,
                reason: `Report de ${user.tag}`
            });
            await thread.members.add(user.id);

            // Mensagem na thread
            await thread.send(`# 🎫 Report ${reportId}\n**Criado por:** ${user.tag}\n\n**Seu nick:** ${data.seuNick}\n**Alvo:** ${data.alvoNick}\n**Data/Hora:** ${data.dataHora}\n**Regra:** ${data.regra}\n\n**Descrição:**\n${data.descricao}`);

            // Botões da thread (só fechar)
            const closeBtn = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`close_${reportId}`)
                    .setLabel('Fechar Report')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒')
            );
            await thread.send({ components: [closeBtn] });

            // DM do usuário
            const dmEmbed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setDescription(`# 🎫 Report ${reportId}\n**Status:** Aberto\n**Thread:** ${thread.url}`)
                .setFooter({ text: guild.name })
                .setTimestamp();
            
            const dmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`close_${reportId}`)
                    .setLabel('Fechar Report')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒')
            );
            const dmMessage = await user.send({ embeds: [dmEmbed], components: [dmRow] }).catch(() => null);

            // Log da staff
            const logChannel = await guild.channels.fetch(logChannelId);
            const logEmbed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setDescription(`# 🎫 Report ${reportId}\n**Usuário:** ${user.tag}\n**Thread:** ${thread.url}`)
                .setFooter({ text: guild.name })
                .setTimestamp();
            
            const logRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`join_${reportId}`)
                    .setLabel('Entrar na Thread')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('👋'),
                new ButtonBuilder()
                    .setCustomId(`close_${reportId}`)
                    .setLabel('Fechar Report')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒')
            );
            const logMessage = await logChannel.send({ embeds: [logEmbed], components: [logRow] });

            // Salvar
            db.prepare(`
                INSERT INTO reports (id, guild_id, user_id, thread_id, log_message_id, dm_message_id, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(reportId, guild.id, user.id, thread.id, logMessage.id, dmMessage?.id || null, 'open', Date.now());

            await interaction.editReply({ content: `✅ ${reportId} criado! ${thread.url}`, flags: 64 });
            
        } catch (error) {
            console.error('❌ Erro:', error);
            await interaction.editReply({ content: '❌ Erro ao criar report.', flags: 64 });
        }
    }

    // ==================== ENTRAR NA THREAD ====================
    async joinThread(interaction, reportId) {
        const { guild, user, member } = interaction;
        
        try {
            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            if (!member?.roles?.cache?.has(staffRoleId)) {
                return await interaction.editReply({ content: '❌ Apenas staff pode entrar.', components: [] });
            }

            const report = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(reportId);
            if (!report) {
                return await interaction.editReply({ content: '❌ Report não encontrado.', components: [] });
            }

            const thread = await guild.channels.fetch(report.thread_id);
            if (thread) {
                await thread.members.add(user.id);
                await interaction.editReply({ content: `✅ Você entrou na thread: ${thread.url}`, components: [] });
            } else {
                await interaction.editReply({ content: '❌ Thread não encontrada.', components: [] });
            }
            
        } catch (error) {
            console.error('❌ Erro:', error);
            await interaction.editReply({ content: '❌ Erro ao entrar.', components: [] });
        }
    }

    // ==================== FECHAR REPORT ====================
    async closeReport(interaction, reportId, motivo, punicao) {
        try {
            const report = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(reportId);
            
            if (!report) {
                await interaction.reply({ content: '❌ Report não encontrado.', flags: 64 });
                return;
            }

            const guild = this.client.guilds.cache.get(report.guild_id);
            if (!guild) {
                await interaction.reply({ content: '❌ Servidor não encontrado.', flags: 64 });
                return;
            }

            // Atualizar banco
            db.prepare(`UPDATE reports SET status = 'closed', closed_at = ?, closed_by = ?, closed_reason = ?, punishment = ? WHERE id = ?`)
                .run(Date.now(), interaction.user.id, motivo || null, punicao || null, report.id);

            // Arquivar thread
            const thread = await guild.channels.fetch(report.thread_id).catch(() => null);
            if (thread) {
                await thread.setLocked(true).catch(() => {});
                await thread.setArchived(true).catch(() => {});
            }
            
            // Atualizar DM com avaliação
            if (report.dm_message_id) {
                const user = await this.client.users.fetch(report.user_id);
                const dmChannel = await user.createDM();
                const dmMessage = await dmChannel.messages.fetch(report.dm_message_id);
                
                const embed = new EmbedBuilder()
                    .setColor(0xF64B4E)
                    .setDescription(`# 🔒 Report Fechado\n**ID:** ${report.id}\n**Motivo:** ${motivo || 'Sem motivo'}`)
                    .setFooter({ text: guild.name })
                    .setTimestamp();
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`rate_${report.id}`)
                        .setLabel('Avaliar Atendimento')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('⭐')
                );
                
                await dmMessage.edit({ embeds: [embed], components: [row] });
            }
            
            // Atualizar LOG
            if (report.log_message_id) {
                const logChannelId = ConfigSystem.getSetting(guild.id, 'log_reports');
                if (logChannelId) {
                    const logChannel = await guild.channels.fetch(logChannelId);
                    const logMessage = await logChannel.messages.fetch(report.log_message_id);
                    const embed = new EmbedBuilder()
                        .setColor(0xF64B4E)
                        .setDescription(`# 🔒 Report Fechado\n**ID:** ${report.id}\n**Fechado por:** ${interaction.user.tag}\n**Motivo:** ${motivo || 'Sem motivo'}`)
                        .setFooter({ text: guild.name })
                        .setTimestamp();
                    await logMessage.edit({ embeds: [embed], components: [] });
                }
            }
            
            const msg = `✅ ${report.id} fechado com sucesso!`;
            if (interaction.isModalSubmit()) {
                await interaction.reply({ content: msg, flags: 64 });
            } else {
                await interaction.editReply({ content: msg, components: [] });
            }
            
        } catch (error) {
            console.error('❌ Erro ao fechar:', error);
            await interaction.reply({ content: '❌ Erro ao fechar.', flags: 64 });
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

            db.prepare(`UPDATE reports SET rating = ?, rating_comment = ? WHERE id = ?`).run(nota, comentario, reportId);
            
            await interaction.reply({ content: `✅ Avaliação registrada! Obrigado.`, flags: 64 });
            
        } catch (error) {
            console.error('❌ Erro ao avaliar:', error);
            await interaction.reply({ content: '❌ Erro ao avaliar.', flags: 64 });
        }
    }
}

module.exports = ReportChatSystem;