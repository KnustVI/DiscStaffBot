// src/systems/punishmentSystem.js
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/index.js');
const { EMOJIS } = require('../database/emojis.js');
const SessionManager = require('../utils/sessionManager');
const ContainerBuilder = require('../utils/ContainerBuilder');
const ContainerFormatter = require('../utils/ContainerFormatter.js');

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
    
    generateHistoryContainer(target, history, page, guildName) {
        // Determinar cor baseada na reputação
        let accentColor = COLORS.DEFAULT;
        if (history.reputation > 70) accentColor = COLORS.SUCCESS;
        else if (history.reputation < 30) accentColor = COLORS.DANGER;
        else if (history.reputation < 50) accentColor = COLORS.WARNING;
        
        // Determinar emoji de reputação
        const repEmoji = history.reputation >= 90 ? EMOJIS.shinystar || '🌟' : 
                        history.reputation >= 70 ? EMOJIS.star || '⭐' : 
                        history.reputation >= 50 ? EMOJIS.thumbsUP || '👍' : 
                        EMOJIS.Warning || '⚠️';
        
        const builder = ContainerFormatter.createBuilder(guildName, accentColor);
        
        // Título
        builder.addTitle(`${EMOJIS.History || '📋'} HISTÓRICO`, 1);
        builder.addText(`Consulta detalhada do sistema de reputação e punições.`);
        builder.addSeparator();
        
        // Informações do usuário
        builder.addSection([
            `**👤 ${target.username}**`,
            `🆔 \`${target.id}\``
        ]);
        
        builder.addSeparator();
        
        // Reputação e total de punições
        builder.addSection([
            `${repEmoji} **Reputação Atual:** ${history.reputation}/100 pontos`,
            `${EMOJIS.strike || '⚠️'} **Total de Punições:** ${history.totalRecords}`
        ]);
        
        // Lista de punições
        if (history.punishments.length > 0) {
            const punishmentLines = [];
            for (const p of history.punishments) {
                const date = `<t:${Math.floor(p.created_at / 1000)}:d>`;
                const severityIcon = ['⚪', '🟢', '🟡', '🟠', '🔴', '💀'][p.severity] || '❓';
                punishmentLines.push(`${severityIcon} Strike #${p.id} | ${date}`);
                punishmentLines.push(`┃ Moderador: <@${p.moderator_id}>`);
                if (p.report_id) punishmentLines.push(`┃ Report: \`${p.report_id}\``);
                if (p.status === 'revoked') punishmentLines.push(`┃ Status: ${EMOJIS.Check || '✅'} Anulado`);
                punishmentLines.push(`┗━━━━━━━━━━━━━━━━━━━━`);
            }
            builder.addSection(punishmentLines);
        } else {
            builder.addText(`\`\`\`\nNenhuma punição registrada.\n\`\`\``);
        }
        
        // Footer com informações de página
        builder.addFooter(ContainerFormatter.getHistoryFooter(page, history.totalPages, history.totalRecords));
        
        return builder;
    },
    
    generateHistoryButtons(targetId, currentPage, totalPages) {
        if (totalPages <= 1) return null;
        
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`punishment:history:prev:${targetId}:${currentPage - 1}`)
                .setEmoji(EMOJIS.Left || '⬅️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 1),
            new ButtonBuilder()
                .setCustomId(`punishment:history:next:${targetId}:${currentPage + 1}`)
                .setEmoji(EMOJIS.Right || '➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === totalPages)
        );
    },
    
    generateSystemStatusContainer(guildName, stats) {
        const builder = ContainerFormatter.createBuilder(guildName, COLORS.DEFAULT);
        
        builder.addTitle(`${EMOJIS.Config || '⚙️'} Status do Sistema de Punições`, 1);
        builder.addText(`**Servidor:** ${guildName}`);
        builder.addSeparator();
        
        builder.addSection([
            `**📊 Total de Punições:** \`${stats.totalPunishments}\``,
            `**👥 Usuários Penalizados:** \`${stats.totalUsers}\``,
            `**⭐ Reputação Média:** \`${stats.avgReputation}/100\``,
            `**⚠️ Strikes Ativos (30d):** \`${stats.recentStrikes}\``
        ]);
        
        builder.addFooter();
        
        return builder;
    },
    
    // ==================== CONTAINERS UNIFICADOS (DM + LOG) ====================
    
    generateStrikeUnifiedContainer(target, moderator, strikeId, severity, reason, reportId, pointsLost, newPoints, discordAct, discordActionResult, guildName, reportLink) {
        const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
        const severityIcons = ['', '🟢', '🟡', '🟠', '🔴', '💀'];
        const severityIcon = severityIcons[severity] || '❓';
        const severityName = severityNames[severity] || `Nível ${severity}`;
        
        const builder = ContainerFormatter.createBuilder(guildName, COLORS.DANGER);
        
        // Título
        builder.addTitle(`${EMOJIS.lose || '❌'} STRIKE! | #${strikeId}`, 1);
        builder.addText(`Um novo registro de infração foi adicionado ao sistema.`);
        builder.addSeparator();
        
        // Punições aplicadas
        builder.addTitle(`${EMOJIS.strike || '⚠️'} Punições Aplicadas`, 2);
        const actions = this.getPunishmentActions(severity, discordAct, discordActionResult);
        for (const action of actions.split('\n')) {
            if (action.trim()) builder.addText(action);
        }
        
        builder.addSeparator();
        
        // Motivo
        builder.addTitle(`${EMOJIS.Note || '📝'} Motivo`, 2);
        if (reportId) {
            builder.addText(`**Report:** ${reportLink ? `[${reportId}](${reportLink})` : reportId}`);
        }
        builder.addText(`\`\`\`text\n${reason}\n\`\`\``);
        
        builder.addSeparator();
        
        // Informações do usuário e moderador
        builder.addSection([
            `**👤 Usuário:** ${target?.tag || 'Desconhecido'} (\`${target?.id || '?'}\`)`,
            `**🛡️ Moderador:** ${moderator.tag} (\`${moderator.id}\`)`,
            `**📉 Pontos subtraídos:** -${pointsLost}`,
            `**⭐ Reputação:** ${newPoints + pointsLost} → ${newPoints}`
        ]);
        
        builder.addFooter();
        
        return builder;
    },
    
    generateUnstrikeUnifiedContainer(target, moderator, strikeId, reason, pointsRestored, newPoints, originalReason, guildName) {
        const builder = ContainerFormatter.createBuilder(guildName, COLORS.SUCCESS);
        
        // Título
        builder.addTitle(`${EMOJIS.gain || '✅'} STRIKE ANULADO | #${strikeId}`, 1);
        builder.addText(`Uma punição foi removida do sistema.`);
        builder.addSeparator();
        
        // Punição original
        builder.addTitle(`${EMOJIS.History || '📋'} Punição Original`, 2);
        builder.addText(`**Motivo:** ${originalReason}`);
        
        builder.addSeparator();
        
        // Motivo da anulação
        builder.addTitle(`${EMOJIS.Note || '📝'} Motivo da Anulação`, 2);
        builder.addText(`\`\`\`text\n${reason}\n\`\`\``);
        
        builder.addSeparator();
        
        // Informações
        builder.addSection([
            `**👤 Usuário:** ${target?.tag || 'Desconhecido'} (\`${target?.id || '?'}\`)`,
            `**🛡️ Moderador:** ${moderator.tag} (\`${moderator.id}\`)`,
            `**📈 Pontos restaurados:** +${pointsRestored}`,
            `**⭐ Reputação:** ${newPoints - pointsRestored} → ${newPoints}`
        ]);
        
        builder.addFooter();
        
        return builder;
    },
    
    getPunishmentActions(severity, discordAct, discordActionResult) {
        const actions = [];
        
        // Ações baseadas na severidade
        if (severity >= 1 && severity <= 2) {
            actions.push(`- ${EMOJIS.DM || '📝'} **Registro:** Infração registrada no sistema`);
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
            const container = this.generateHistoryContainer(target, history, newPage, interaction.guild.name);
            const buttons = this.generateHistoryButtons(targetId, newPage, history.totalPages);
            
            await interaction.editReply({ 
                components: [container.container],
                ...(buttons ? { components: [container.container, buttons] } : { components: [container.container] })
            });
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
            const { targetId, reason, severity, reportId, discordAct, discordActionResult } = session;
            const pointsLost = this.getPointsBySeverity(severity);
            const currentRep = await this.getUserData(interaction.guildId, targetId);
            const newPoints = Math.max(0, currentRep.reputation - pointsLost);
            
            const strikeId = this.applyPunishment(interaction.guildId, targetId, interaction.user.id, reason, severity, reportId, pointsLost);
            const target = await interaction.client.users.fetch(targetId).catch(() => null);
            
            const container = this.generateStrikeUnifiedContainer(
                target, interaction.user, strikeId, severity, reason, reportId, 
                pointsLost, newPoints, discordAct, discordActionResult, 
                interaction.guild.name, null
            );
            
            SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending');
            await interaction.editReply({ components: [container.container] });
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
            reportId: session.reportId,
            pointsLost,
            discordAct: session.discordAct,
            discordActionResult: session.discordActionResult
        }, 120000);
        
        const target = await interaction.client.users.fetch(session.targetId).catch(() => null);
        const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
        
        const builder = ContainerFormatter.createBuilder(interaction.guild.name, COLORS.WARNING);
        builder.addTitle(`${EMOJIS.Warning || '⚠️'} Confirmar Aplicação de Strike`, 1);
        builder.addSeparator();
        builder.addSection([
            `**👤 Usuário:** ${target?.tag || session.targetId}`,
            `**⚠️ Severidade:** ${severityNames[severity]}`,
            `**📝 Motivo:** ${reason}`,
            `**📉 Pontos a perder:** -${pointsLost}`
        ]);
        builder.addFooter();
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`punishment:confirm:confirm`).setLabel('✅ Confirmar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`punishment:confirm:cancel`).setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger)
        );
        
        await interaction.editReply({ components: [builder.container, row], content: null });
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
        const container = this.generateUnstrikeUnifiedContainer(
            target, interaction.user, session.strikeId, reason, pointsRestored, newPoints, strike.reason, interaction.guild.name
        );
        
        await interaction.editReply({ components: [container.container], content: null });
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
    
    applyPunishment(guildId, targetId, moderatorId, reason, severity, reportId, points) {
        try {
            const trans = db.transaction(() => {
                const uuid = require('../database/index').generateUUID();
                const res = db.prepare(`
                    INSERT INTO punishments (uuid, guild_id, user_id, moderator_id, reason, severity, points_deducted, report_id, created_at, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(uuid, guildId, targetId, moderatorId, reason, severity, points, reportId, Date.now(), 'active');
                
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