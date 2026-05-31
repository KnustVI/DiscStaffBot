// /home/ubuntu/DiscStaffBot/src/systems/punishmentSystem.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/index.js');
const { EMOJIS } = require('../database/emojis.js');
const SessionManager = require('../utils/sessionManager');
const ContainerFormatter = require('../utils/ContainerFormatter');
const SequenceManager = require('../database/sequences');

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

    getNextStrikeNumber(guildId) {
        const nextValue = SequenceManager.getNextValue(guildId, 'punishments');
        console.log(`🔍 [DEBUG] getNextStrikeNumber - próximo valor para ${guildId}: ${nextValue}`);
        return nextValue;
    },
    
    // ==================== GERADORES DE UI (CONTAINER) ====================
    
    generateHistoryContainer(target, history, page, guildName) {
        let accentColor = COLORS.DEFAULT;
        if (history.reputation > 70) accentColor = COLORS.SUCCESS;
        else if (history.reputation < 30) accentColor = COLORS.DANGER;
        else if (history.reputation < 50) accentColor = COLORS.WARNING;
        
        const repEmoji = history.reputation >= 90 ? '🌟' : 
                        history.reputation >= 70 ? '⭐' : 
                        history.reputation >= 50 ? '👍' : '⚠️';
        
        const builder = ContainerFormatter.createBuilder(guildName, accentColor);
        
        builder.addTitle(`${EMOJIS.History || '📋'} HISTÓRICO`, 1);
        builder.addText(`Consulta detalhada do sistema de reputação e punições.`);
        builder.addSeparator();
        builder.addText(`**👤 ${target.username}** (\`${target.id}\`)`);
        builder.addSeparator();
        builder.addText(`${repEmoji} **Reputação Atual:** ${history.reputation}/100 pontos`);
        builder.addText(`${EMOJIS.strike || '⚠️'} **Total de Punições:** ${history.totalRecords}`);
        
        if (history.punishments.length > 0) {
            builder.addSeparator();
            for (const p of history.punishments) {
                const date = `<t:${Math.floor(p.created_at / 1000)}:d>`;
                const severityIcon = ['⚪', '🟢', '🟡', '🟠', '🔴', '💀'][p.severity] || '❓';
                // CORRIGIDO: usar strike_number em vez de id
                const strikeNum = p.strike_number || p.id;
                builder.addText(`${severityIcon} Strike #${strikeNum} | ${date}`);
                builder.addText(`┃ Moderador: <@${p.moderator_id}>`);
                if (p.report_id) builder.addText(`┃ Report: \`${p.report_id}\``);
                if (p.status === 'revoked') builder.addText(`┃ Status: ✅ Anulado`);
                builder.addText(`┗━━━━━━━━━━━━━━━━━━━━`);
            }
        } else {
            builder.addText(`\`\`\`\nNenhuma punição registrada.\n\`\`\``);
        }
        
        builder.addFooter(ContainerFormatter.getHistoryFooter(page, history.totalPages, history.totalRecords));
        
        return builder;
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
    
    generateStrikeUnifiedContainer(target, moderator, strikeNumber, severity, reason, reportId, pointsLost, newPoints, discordAct, discordActionResult, guildName, reportLink) {
        const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
        const severityIcons = ['', '🟢', '🟡', '🟠', '🔴', '💀'];
        
        const builder = ContainerFormatter.createBuilder(guildName, COLORS.DANGER);
        
        // CORREÇÃO: garantir que strikeNumber está sendo usado
        console.log(`🔍 [DEBUG] generateStrikeUnifiedContainer - strikeNumber recebido: ${strikeNumber}`);
        
        builder.addTitle(`${EMOJIS.lose || '❌'} STRIKE! | #${strikeNumber}`, 1);
        builder.addSeparator();
        builder.addText(`${severityIcons[severity]} **Severidade:** ${severityNames[severity]}`);
        builder.addSeparator();
        builder.addText(`**👤 Usuário:** ${target?.tag || 'Desconhecido'} (\`${target?.id || '?'}\`)`);
        builder.addText(`**🛡️ Moderador:** ${moderator.tag} (\`${moderator.id}\`)`);
        builder.addText(`**📉 Pontos subtraídos:** -${pointsLost}`);
        builder.addText(`**⭐ Reputação:** ${newPoints + pointsLost} → ${newPoints}`);
        builder.addSeparator();
        builder.addText(`**📝 Motivo:**`);
        if (reportId) builder.addText(`**Report:** ${reportLink ? `[${reportId}](${reportLink})` : reportId}`);
        builder.addText(`\`\`\`text\n${reason}\n\`\`\``);
        
        const actions = this.getPunishmentActions(severity, discordAct, discordActionResult);
        if (actions && actions !== '- 📝 **Apenas Registro:** Nenhuma ação automática aplicada') {
            builder.addSeparator();
            builder.addText(`**⚠️ Ações Aplicadas:**`);
            for (const action of actions.split('\n')) {
                if (action.trim()) builder.addText(action);
            }
        }
        
        builder.addFooter();
        
        return builder;
    },
    
    generateUnstrikeUnifiedContainer(target, moderator, strikeNumber, reason, pointsRestored, newPoints, originalReason, guildName) {
        const builder = ContainerFormatter.createBuilder(guildName, COLORS.SUCCESS);
        
        builder.addTitle(`${EMOJIS.gain || '✅'} STRIKE ANULADO | #${strikeNumber}`, 1);
        builder.addSeparator();
        builder.addText(`**👤 Usuário:** ${target?.tag || 'Desconhecido'} (\`${target?.id || '?'}\`)`);
        builder.addText(`**🛡️ Moderador:** ${moderator.tag} (\`${moderator.id}\`)`);
        builder.addText(`**📈 Pontos restaurados:** +${pointsRestored}`);
        builder.addText(`**⭐ Reputação:** ${newPoints - pointsRestored} → ${newPoints}`);
        builder.addSeparator();
        builder.addText(`**📝 Punição Original:**`);
        builder.addText(`\`\`\`text\n${originalReason}\n\`\`\``);
        builder.addSeparator();
        builder.addText(`**📝 Motivo da Anulação:**`);
        builder.addText(`\`\`\`text\n${reason}\n\`\`\``);
        builder.addFooter();
        
        return builder;
    },
    
    getPunishmentActions(severity, discordAct, discordActionResult) {
        const actions = [];
        
        if (severity >= 1 && severity <= 2) {
            actions.push(`- 📝 **Registro:** Infração registrada no sistema`);
        }
        if (severity >= 3) {
            actions.push(`- ⚠️ **Aviso Formal:** Comportamento inadequado registrado`);
        }
        if (severity >= 4) {
            actions.push(`- 🔇 **Mute Temporário:** Usuário silenciado por tempo determinado`);
        }
        if (severity >= 5) {
            actions.push(`- 🚫 **Banimento Permanente:** Usuário removido permanentemente`);
        }
        
        if (discordAct && discordAct !== 'none') {
            const actIcons = { timeout: '🔇', kick: '👢', ban: '🚫' };
            const actNames = { timeout: 'Timeout (Silenciamento)', kick: 'Expulsão do Servidor', ban: 'Banimento do Servidor' };
            const icon = actIcons[discordAct] || '⚡';
            const name = actNames[discordAct] || discordAct;
            
            if (discordActionResult && !discordActionResult.includes('Erro')) {
                actions.push(`- ${icon} **${name}:** ${discordActionResult}`);
            } else if (discordActionResult && discordActionResult.includes('Erro')) {
                actions.push(`- ❌ **${name}:** ${discordActionResult}`);
            } else {
                actions.push(`- ${icon} **${name}:** Aplicado com sucesso`);
            }
        }
        
        if (actions.length === 0) {
            actions.push(`- 📝 **Apenas Registro:** Nenhuma ação automática aplicada`);
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
            
            const replyData = { components: [container.build()], flags: ['IsComponentsV2'] };
            if (buttons) replyData.components.push(buttons);
            await interaction.editReply(replyData);
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
            return await interaction.editReply({ content: '❌ Cancelado.', components: [] });
        }
        
        if (action === 'confirm') {
            const { targetId, reason, severity, reportId, discordAct, discordActionResult } = session;
            const pointsLost = this.getPointsBySeverity(severity);
            const currentRep = await this.getUserData(interaction.guildId, targetId);
            const newPoints = Math.max(0, currentRep.reputation - pointsLost);
            
            const strikeNumber = this.applyPunishment(interaction.guildId, targetId, interaction.user.id, reason, severity, reportId, pointsLost);
            const target = await interaction.client.users.fetch(targetId).catch(() => null);
            
            const container = this.generateStrikeUnifiedContainer(target, interaction.user, strikeNumber, severity, reason, reportId, pointsLost, newPoints, discordAct, discordActionResult, interaction.guild.name, null);
            
            SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_pending');
            await interaction.editReply({ components: [container.build()], flags: ['IsComponentsV2'] });
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
        builder.addText(`**👤 Usuário:** ${target?.tag || session.targetId}`);
        builder.addText(`**⚠️ Severidade:** ${severityNames[severity]}`);
        builder.addText(`**📝 Motivo:** ${reason}`);
        builder.addText(`**📉 Pontos a perder:** -${pointsLost}`);
        builder.addFooter();
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`punishment:confirm:confirm`).setLabel('✅ Confirmar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`punishment:confirm:cancel`).setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger)
        );
        
        const replyData = { components: [builder.build()], flags: ['IsComponentsV2'] };
        replyData.components.push(row);
        await interaction.editReply(replyData);
        SessionManager.delete(interaction.user.id, interaction.guildId, 'strike_modal');
    },
    
    async processUnstrikeModal(interaction) {
        const session = SessionManager.get(interaction.user.id, interaction.guildId, 'unstrike_modal');
        if (!session) {
            return await interaction.editReply({ content: '❌ Sessão expirada.', flags: 64 });
        }
        
        const reason = interaction.fields.getTextInputValue('reason');
        const strikeNumber = session.strikeId;
        
        const strike = db.prepare(`SELECT * FROM punishments WHERE guild_id = ? AND strike_number = ?`).get(interaction.guildId, strikeNumber);
        
        if (!strike) {
            return await interaction.editReply({ content: '❌ Strike não encontrado.', flags: 64 });
        }
        
        const pointsRestored = this.getPointsBySeverity(strike.severity);
        const currentRep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(interaction.guildId, strike.user_id)?.points || 100;
        const newPoints = Math.min(100, currentRep + pointsRestored);
        
        db.prepare(`DELETE FROM punishments WHERE guild_id = ? AND strike_number = ?`).run(interaction.guildId, strikeNumber);
        db.prepare(`UPDATE reputation SET points = ? WHERE guild_id = ? AND user_id = ?`).run(newPoints, interaction.guildId, strike.user_id);
        
        const target = await interaction.client.users.fetch(strike.user_id).catch(() => null);
        const container = this.generateUnstrikeUnifiedContainer(target, interaction.user, strikeNumber, reason, pointsRestored, newPoints, strike.reason, interaction.guild.name);
        
        await interaction.editReply({ components: [container.build()], flags: ['IsComponentsV2'] });
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
                const strikeNumber = this.getNextStrikeNumber(guildId);
                console.log(`🔍 [DEBUG] applyPunishment - strikeNumber gerado: ${strikeNumber}`);
                
                const uuid = require('../database/index').generateUUID();
                
                db.prepare(`
                    INSERT INTO punishments (uuid, guild_id, strike_number, user_id, moderator_id, reason, severity, points_deducted, report_id, created_at, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(uuid, guildId, strikeNumber, targetId, moderatorId, reason, severity, points, reportId, Date.now(), 'active');
                
                db.prepare(`
                    INSERT INTO reputation (guild_id, user_id, points) VALUES (?, ?, 100)
                    ON CONFLICT(guild_id, user_id) DO UPDATE SET points = MAX(0, points - ?)
                `).run(guildId, targetId, points);
                
                return strikeNumber;
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