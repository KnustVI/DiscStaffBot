const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/index.js');
const { EMOJIS } = require('../database/emojis.js');
const SessionManager = require('../utils/sessionManager');
const EmbedFormatter = require('../utils/embedFormatter');

// Cores padrão do sistema
const COLORS = {
    DEFAULT: 0xDCA15E,
    SUCCESS: 0xBBF96A,
    DANGER: 0xF64B4E,
    WARNING: 0xFFBD59
};

const PunishmentSystem = {
    
    // ==================== FUNÇÕES DE BUSCA E BANCO ====================
    
    async getUserHistory(guildId, userId, page = 1) {
        try {
            const limit = 5;
            const offset = (page - 1) * limit;

            let rep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            const points = rep ? rep.points : 100;

            const total = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            const totalRecords = total.count;
            const totalPages = Math.ceil(totalRecords / limit);

            const punishments = db.prepare(`
                SELECT * FROM punishments 
                WHERE guild_id = ? AND user_id = ? 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `).all(guildId, userId, limit, offset);

            return { reputation: points, punishments, totalRecords, totalPages };
        } catch (error) {
            console.error('❌ Erro ao buscar histórico:', error);
            return { reputation: 100, punishments: [], totalRecords: 0, totalPages: 0 };
        }
    },
    
    async getUserData(guildId, userId) {
        try {
            const rep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            const points = rep ? rep.points : 100;
            
            const lastPunishments = db.prepare(`
                SELECT * FROM punishments 
                WHERE guild_id = ? AND user_id = ? 
                ORDER BY created_at DESC LIMIT 3
            `).all(guildId, userId);
            
            const totalStrikes = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            
            return { reputation: points, lastPunishments, totalStrikes: totalStrikes?.count || 0 };
        } catch (error) {
            console.error('❌ Erro ao buscar dados:', error);
            return { reputation: 100, lastPunishments: [], totalStrikes: 0 };
        }
    },
    
    // ==================== GERADORES DE UI (HISTÓRICO) ====================
    
        generateHistoryEmbed(target, history, page) {
        const { EMOJIS } = require('../database/emojis.js');
        
        // Determinar cor baseada na reputação
        let color = COLORS.DEFAULT;
        if (history.reputation > 70) color = COLORS.SUCCESS;
        else if (history.reputation < 30) color = COLORS.DANGER;
        else if (history.reputation < 50) color = COLORS.WARNING;
        
        // Determinar emoji de reputação
        const repEmoji = history.reputation >= 90 ? EMOJIS.shinystar || '🌟' : 
                        history.reputation >= 70 ? EMOJIS.star || '⭐' : 
                        history.reputation >= 50 ? EMOJIS.thumbsUP || '👍' : 
                        EMOJIS.Warning || '⚠️';

        // Usando EmbedFormatter para formatar o usuário com menção
        const userMention = EmbedFormatter.formatUser(target);
        
        // Construir descrição com headers
        const description = [
            `# ${EMOJIS.History || '📋'} HISTÓRICO`,
            `${userMention}`,
            `Consulta detalhada do sistema de reputação e punições.`,
        ].join('\n');
        
        const embed = new EmbedBuilder()
            .setColor(color)
            .setDescription(description)
            .setThumbnail(target.displayAvatarURL())
            .setTimestamp();
            embed.setFooter({ text: EmbedFormatter.getHistoryFooter(page, history.totalPages, history.totalRecords) });

                // Fields com informações
            embed.addFields(

                { 
                    name: `${repEmoji} Reputação Atual`, 
                    value: `${history.reputation}/100 pontos`,
                    inline: true 
                },
                { 
                    name: `${EMOJIS.strike || '⚠️'} Total de Punições`, 
                    value: `${history.totalRecords}`,
                    inline: true 
                }
            );
            
            // Lista de punições
            if (history.punishments.length > 0) {
                embed.addFields({ 
                    name: 'Registros', 
                    value: this.buildPunishmentsList(history.punishments, EMOJIS),
                    inline: false 
                });
            } else {
                embed.addFields({ 
                    name: 'Registros', 
                    value: '```\nNenhuma punição registrada.\n```',
                    inline: false 
                });
            }
        
        return embed;
    },

        /**
         * Constrói a lista de punições para o histórico
         */
        buildPunishmentsList(punishments, EMOJIS) {
            if (punishments.length === 0) {
                return `\`\`\`\nNenhuma punição registrada.\n\`\`\``;
            }
            
            const listItems = [];
            
            for (const p of punishments) {
                const date = `<t:${Math.floor(p.created_at / 1000)}:d>`;
                const severityIcon = ['⚪', '🟢', '🟡', '🟠', '🔴', '💀'][p.severity] || '❓';
                
                listItems.push(`╭ ${severityIcon} Strike #${p.id} | ${date}`);
                listItems.push(`┃**Moderador:** <@${p.moderator_id}>`);
                
                if (p.ticket_id) {
                    listItems.push(`┃**Ticket:** \`${p.ticket_id}\``);
                }
                
                if (p.status === 'revoked') {
                    listItems.push(`┃**Status:** ${EMOJIS.Check || '✅'} Anulado`);
                }
                
                listItems.push(`╰━━━━━━━━━━━━━━━━━━━━`);
            }
            
            return listItems.join('\n');
        },
    
    generateHistoryButtons(targetId, currentPage, totalPages) {
        if (totalPages <= 1) return null;
        
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`punishment:history:prev:${targetId}:${currentPage - 1}`)
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`punishment:history:next:${targetId}:${currentPage + 1}`)
                .setEmoji('➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === totalPages)
        );
    },
    
    generateSystemStatusEmbed(guildName, stats) {
        const embed = new EmbedBuilder()
            .setTitle(`${EMOJIS.Config || '⚙️'} Status do Sistema de Punições`)
            .setColor(COLORS.DEFAULT)
            .setDescription(`**Servidor:** ${guildName}`)
            .addFields(
                { name: '📊 Total de Punições', value: `\`${stats.totalPunishments}\``, inline: true },
                { name: '👥 Usuários Penalizados', value: `\`${stats.totalUsers}\``, inline: true },
                { name: '⭐ Reputação Média', value: `\`${stats.avgReputation}/100\``, inline: true },
                { name: '⚠️ Strikes Ativos (30d)', value: `\`${stats.recentStrikes}\``, inline: true }
            )
            .setTimestamp();
            embed.setFooter(EmbedFormatter.getFooter(guild.name));
    },
    
    // ==================== EMBEDS UNIFICADOS (DM + LOG) ====================
    
    generateStrikeUnifiedEmbed(target, moderator, strikeId, severity, reason, ticketId, pointsLost, newPoints, discordAct, discordActionResult) {
        const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
        const severityIcons = ['', '🟢', '🟡', '🟠', '🔴', '💀'];
        const severityIcon = severityIcons[severity] || '❓';
        const severityName = severityNames[severity] || `Nível ${severity}`;
        const description = [
            `# ${EMOJIS.lose || '❌'} STRIKE! | #${strikeId}`,
            `Um novo registro de infração foi adicionado ao sistema.`,
            `## ${EMOJIS.strike || '⚠️'} Punições Aplicadas`,
            this.getPunishmentActions(severity, discordAct, discordActionResult),
            `## ${EMOJIS.Note || '📝'} Motivo`,
            `\`\`\`text\n${reason}\n\`\`\``
        ].join('\n');
        
        const embed = new EmbedBuilder()
            .setColor(COLORS.DANGER)
            .setDescription(description)
            .setTimestamp();

            // 4 FIELDS INLINE usando EmbedFormatter
        EmbedFormatter.addFields(embed, [
            EmbedFormatter.userField(target, null),           // inline: true
            EmbedFormatter.moderatorField(moderator, null),   // inline: true
            EmbedFormatter.pointsField('Pontos subtraídos', -pointsLost, `${emoji.lose || '📉'}`),  // inline: true
            EmbedFormatter.reputationField(newPoints + pointsLost, newPoints)     // inline: true
        ]);
        
        embed.setFooter(EmbedFormatter.getFooter(guildName));
        return embed;

        },
    
    generateUnstrikeUnifiedEmbed(target, moderator, strikeId, reason, pointsRestored, newPoints, originalReason) {
        const description = [
            `# ${EMOJIS.gain || '✅'} STRIKE ANULADO | #${strikeId}`,
            `Uma punição foi removida do sistema.`,
            `### ${EMOJIS.History || '📋'} Punição Original`,
            `- **Motivo:** ${originalReason}`,
            `### ${EMOJIS.Note || '📝'} Motivo da Anulação`,
            `\`\`\`text\n${reason}\n\`\`\``
        ].join('\n');
        
        const embed = new EmbedBuilder()
            .setColor(COLORS.SUCCESS)
            .setDescription(description)
            .setTimestamp();

            // 4 FIELDS INLINE usando EmbedFormatter
    EmbedFormatter.addFields(embed, [
        EmbedFormatter.userField(target, null),           // inline: true
        EmbedFormatter.moderatorField(moderator, null),   // inline: true
        EmbedFormatter.pointsField('Pontos restaurados', pointsRestored, '📈'),  // inline: true
        EmbedFormatter.reputationField(newPoints - pointsRestored, newPoints)    // inline: true
    ]);
    
            embed.setFooter(EmbedFormatter.getFooter(guild.name));
            return embed;
    },
    
    getPunishmentActions(severity, discordAct, discordActionResult) {
        const actions = [];
        
        // Ações baseadas na severidade
        if (severity >= 1 && severity <= 2) {
            actions.push(`- ${EMOJIS.edit || '📝'} **Registro:** Infração registrada no sistema`);
        }
        if (severity >= 3) {
            actions.push(`- ${EMOJIS.Warning || '⚠️'} **Aviso Formal:** Comportamento inadequado registrado`);
        }
        if (severity >= 4) {
            actions.push(`- ${EMOJIS.mute || '🔇'} **Mute Temporário:** Usuário silenciado por tempo determinado`);
        }
        if (severity >= 5) {
            actions.push(`- ${EMOJIS.ban || '🚫'} **Banimento Permanente:** Usuário removido permanentemente`);
        }
        
        // Ação do Discord (se houver)
        if (discordAct && discordAct !== 'none') {
            const actIcons = {
                timeout: EMOJIS.mute || '🔇',
                kick: '👢',
                ban: EMOJIS.ban || '🚫'
            };
            const actNames = {
                timeout: 'Timeout (Silenciamento)',
                kick: 'Expulsão do Servidor',
                ban: 'Banimento do Servidor'
            };
            
            const icon = actIcons[discordAct] || '⚡';
            const name = actNames[discordAct] || discordAct;
            
            if (discordActionResult && !discordActionResult.includes('Erro')) {
                actions.push(`- ${icon} **${name}:** ${discordActionResult}`);
            } else if (discordActionResult && discordActionResult.includes('Erro')) {
                actions.push(`- ${EMOJIS.Error || '❌'} **${name}:** ${discordActionResult}`);
            } else {
                actions.push(`- ${icon} **${name}:** Aplicado com sucesso`);
            }
        }
        
        // Se não houver nenhuma ação específica
        if (actions.length === 0) {
            actions.push(`- ${EMOJIS.Note || '📝'} **Apenas Registro:** Nenhuma ação automática aplicada`);
        }
        
        return actions.join('\n');
    },
    
    // ==================== MÉTODOS PARA HANDLER CENTRAL ====================
    
    async handleComponent(interaction, action, param) {
        try {
            const [subAction, targetId, page] = param ? param.split(':') : [];
            switch (action) {
                case 'history':
                    await this.handleHistoryPagination(interaction, subAction, targetId, parseInt(page));
                    break;
                case 'confirm':
                    await this.handleStrikeConfirmation(interaction, subAction);
                    break;
                default:
                    await interaction.editReply({ content: `❌ Ação "${action}" não reconhecida.`, components: [] });
            }
        } catch (error) {
            console.error('❌ Erro no handleComponent:', error);
            await interaction.editReply({ content: '❌ Ocorreu um erro.', components: [] });
        }
    },
    
    async handleModal(interaction, action) {
        try {
            switch (action) {
                case 'strike':
                    await this.processStrikeModal(interaction);
                    break;
                case 'unstrike':
                    await this.processUnstrikeModal(interaction);
                    break;
                default:
                    await interaction.editReply({ content: `❌ Modal "${action}" não reconhecido.`, flags: 64 });
            }
        } catch (error) {
            console.error('❌ Erro no handleModal:', error);
            await interaction.editReply({ content: '❌ Ocorreu um erro.', flags: 64 });
        }
    },
    
    async handleHistoryPagination(interaction, direction, targetId, newPage) {
        try {
            const target = await interaction.client.users.fetch(targetId).catch(() => null);
            if (!target) return await interaction.editReply({ content: '❌ Usuário não encontrado.', components: [] });
            
            const history = await this.getUserHistory(interaction.guildId, targetId, newPage);
            const embed = this.generateHistoryEmbed(target, history, newPage);
            const buttons = this.generateHistoryButtons(targetId, newPage, history.totalPages);
            
            await interaction.editReply({ embeds: [embed], components: buttons ? [buttons] : [] });
        } catch (error) {
            console.error('❌ Erro na paginação:', error);
            await interaction.editReply({ content: '❌ Erro ao carregar página.', components: [] });
        }
    },
    
    async handleStrikeConfirmation(interaction, action) {
        const session = SessionManager.get(interaction.user.id, interaction.guildId, 'strike_pending');
        if (!session) {
            return await interaction.editReply({ content: '❌ Sessão expirada.', components: [] });
        }
        
        if (action === 'cancel') {
            SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending');
            return await interaction.editReply({ content: '❌ Cancelado.', components: [], embeds: [] });
        }
        
        if (action === 'confirm') {
            const { targetId, reason, severity, ticketId, discordAct, discordActionResult } = session;
            const pointsLost = this.getPointsBySeverity(severity);
            const currentRep = await this.getUserData(interaction.guildId, targetId);
            const newPoints = Math.max(0, currentRep.reputation - pointsLost);
            
            const strikeId = this.applyPunishment(interaction.guildId, targetId, interaction.user.id, reason, severity, ticketId, pointsLost);
            const target = await interaction.client.users.fetch(targetId).catch(() => null);
            
            const embed = this.generateStrikeUnifiedEmbed(target, interaction.user, strikeId, severity, reason, ticketId, pointsLost, newPoints, discordAct, discordActionResult);
            
            SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending');
            await interaction.editReply({ embeds: [embed], components: [] });
        }
    },
    
    async processStrikeModal(interaction) {
        const session = SessionManager.get(interaction.user.id, interaction.guildId, 'strike_modal');
        if (!session) {
            return await interaction.editReply({ content: '❌ Sessão expirada.', flags: 64 });
        }
        
        const reason = interaction.fields.getTextInputValue('reason');
        const severity = parseInt(session.severity);
        const pointsLost = this.getPointsBySeverity(severity);
        
        SessionManager.set(interaction.user.id, interaction.guildId, 'strike_pending', {
            targetId: session.targetId,
            reason,
            severity,
            ticketId: session.ticketId,
            pointsLost,
            discordAct: session.discordAct,
            discordActionResult: session.discordActionResult
        }, 120000);
        
        const target = await interaction.client.users.fetch(session.targetId).catch(() => null);
        const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
        
        const embed = new EmbedBuilder()
            .setTitle(`${EMOJIS.Warning || '⚠️'} Confirmar Aplicação de Strike`)
            .setColor(COLORS.WARNING)
            .setDescription(`**Usuário:** ${target?.tag || session.targetId}\n**Severidade:** ${severityNames[severity]}\n**Motivo:** ${reason}\n**Pontos a perder:** \`-${pointsLost}\``);
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`punishment:confirm:confirm`).setLabel('✅ Confirmar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`punishment:confirm:cancel`).setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger)
        );
        
        await interaction.editReply({ embeds: [embed], components: [row], content: null });
        SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_modal');
    },
    
    async processUnstrikeModal(interaction) {
        const session = SessionManager.get(interaction.user.id, interaction.guildId, 'unstrike_modal');
        if (!session) {
            return await interaction.editReply({ content: '❌ Sessão expirada.', flags: 64 });
        }
        
        const reason = interaction.fields.getTextInputValue('reason');
        const strike = db.prepare(`SELECT * FROM punishments WHERE id = ? AND guild_id = ?`).get(session.strikeId, interaction.guildId);
        
        if (!strike) {
            return await interaction.editReply({ content: '❌ Strike não encontrado.', flags: 64 });
        }
        
        const pointsRestored = this.getPointsBySeverity(strike.severity);
        const currentRep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(interaction.guildId, strike.user_id)?.points || 100;
        const newPoints = Math.min(100, currentRep + pointsRestored);
        
        db.prepare(`DELETE FROM punishments WHERE id = ? AND guild_id = ?`).run(session.strikeId, interaction.guildId);
        db.prepare(`UPDATE reputation SET points = ? WHERE guild_id = ? AND user_id = ?`).run(newPoints, interaction.guildId, strike.user_id);
        
        const target = await interaction.client.users.fetch(strike.user_id).catch(() => null);
        const embed = this.generateUnstrikeUnifiedEmbed(target, interaction.user, session.strikeId, reason, pointsRestored, newPoints, strike.reason);
        
        await interaction.editReply({ embeds: [embed], content: null });
        SessionManager.delete(interaction.user.id, interaction.guildId, 'unstrike_modal');
    },
    
    // ==================== MÉTODOS DE NEGÓCIO ====================
    
    parseDuration(durationStr) {
        if (!durationStr || ['0', 'perm'].includes(durationStr.toLowerCase())) return 0;
        const timeValue = parseInt(durationStr);
        const type = durationStr.slice(-1).toLowerCase();
        const multipliers = { 'm': 60000, 'h': 3600000, 'd': 86400000 };
        return (multipliers[type] || 3600000) * timeValue;
    },
    
    getPointsBySeverity(severity) {
        const pointsMap = { 0: 0, 1: 5, 2: 15, 3: 30, 4: 50, 5: 100 };
        return pointsMap[severity] || 10;
    },
    
    applyPunishment(guildId, targetId, moderatorId, reason, severity, ticketId, points) {
        try {
            const trans = db.transaction(() => {
                const uuid = require('../database/index').generateUUID();
                const res = db.prepare(`
                    INSERT INTO punishments (uuid, guild_id, user_id, moderator_id, reason, severity, points_deducted, ticket_id, created_at, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(uuid, guildId, targetId, moderatorId, reason, severity, points, ticketId, Date.now(), 'active');
                
                db.prepare(`
                    INSERT INTO reputation (guild_id, user_id, points) VALUES (?, ?, 100)
                    ON CONFLICT(guild_id, user_id) DO UPDATE SET points = MAX(0, points - ?)
                `).run(guildId, targetId, points);
                
                return res.lastInsertRowid;
            });
            return trans();
        } catch (error) {
            console.error('❌ Erro ao aplicar punição:', error);
            return null;
        }
    },
    
    initWorker(client) {
        console.log('⚖️ [Worker] Sistema de Punições Ativo');
        global.client = client;
        
        setInterval(async () => {
            try {
                const now = Date.now();
                const expiredRoles = db.prepare(`SELECT * FROM temporary_roles WHERE expires_at <= ?`).all(now);
                for (const entry of expiredRoles) {
                    const guild = client.guilds.cache.get(entry.guild_id);
                    if (guild) {
                        try {
                            const member = await guild.members.fetch(entry.user_id);
                            await member.roles.remove(entry.role_id, "Strike Expirado");
                        } catch (err) {}
                    }
                    db.prepare(`DELETE FROM temporary_roles WHERE id = ?`).run(entry.id);
                }
            } catch (error) {
                console.error('❌ Erro no worker:', error);
            }
        }, 30000);
    }
};

module.exports = PunishmentSystem;