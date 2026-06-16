// /home/ubuntu/DiscStaffBot/src/systems/punishmentSystem.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/index.js');
const { EMOJIS } = require('../database/emojis.js');
const { AdvancedContainerBuilder } = require('../utils/containerBuilder');
const SessionManager = require('../utils/sessionManager');
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
        
        const builder = new AdvancedContainerBuilder({ accentColor });
        
        builder.title(`${EMOJIS.History || '📋'} HISTÓRICO`, 1);
        builder.text(`Consulta detalhada do sistema de reputação e punições.`);
        builder.separator();
        builder.text(`**👤 ${target.username}** (\`${target.id}\`)`);
        builder.separator();
        builder.text(`${repEmoji} **Reputação Atual:** ${history.reputation}/100 pontos`);
        builder.text(`${EMOJIS.strike || '⚠️'} **Total de Punições:** ${history.totalRecords}`);
        
        if (history.punishments.length > 0) {
            builder.separator();
            for (const p of history.punishments) {
                const date = `<t:${Math.floor(p.created_at / 1000)}:d>`;
                const severityIcon = ['⚪', '🟢', '🟡', '🟠', '🔴', '💀'][p.severity] || '❓';
                const strikeNum = p.strike_number || p.id;
                builder.text(`${severityIcon} Strike #${strikeNum} | ${date}`);
                builder.text(`┃ Moderador: <@${p.moderator_id}>`);
                if (p.report_id) builder.text(`┃ Report: \`${p.report_id}\``);
                if (p.status === 'revoked') builder.text(`┃ Status: ✅ Anulado`);
                builder.text(`┗━━━━━━━━━━━━━━━━━━━━`);
            }
        } else {
            builder.text(`\`\`\`\nNenhuma punição registrada.\n\`\`\``);
        }
        
        builder.footer(`Página ${page}/${history.totalPages} • Total: ${history.totalRecords} registros`);
        
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
        
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DANGER });
        
        console.log(`🔍 [DEBUG] generateStrikeUnifiedContainer - strikeNumber recebido: ${strikeNumber}`);
        
        builder.title(`${EMOJIS.lose || '❌'} STRIKE! | #${strikeNumber}`, 1);
        builder.separator();
        builder.text(`${severityIcons[severity]} **Severidade:** ${severityNames[severity]}`);
        builder.separator();
        builder.text(`**👤 Usuário:** ${target?.tag || 'Desconhecido'} (\`${target?.id || '?'}\`)`);
        builder.text(`**🛡️ Moderador:** ${moderator.tag} (\`${moderator.id}\`)`);
        builder.text(`**📉 Pontos subtraídos:** -${pointsLost}`);
        builder.text(`**⭐ Reputação:** ${newPoints + pointsLost} → ${newPoints}`);
        builder.separator();
        builder.text(`**📝 Motivo:**`);
        if (reportId) builder.text(`**Report:** ${reportLink ? `[${reportId}](${reportLink})` : reportId}`);
        builder.text(`\`\`\`text\n${reason}\n\`\`\``);
        
        const actions = this.getPunishmentActions(severity, discordAct, discordActionResult);
        if (actions && actions !== '- 📝 **Apenas Registro:** Nenhuma ação automática aplicada') {
            builder.separator();
            builder.text(`**⚠️ Ações Aplicadas:**`);
            for (const action of actions.split('\n')) {
                if (action.trim()) builder.text(action);
            }
        }
        
        builder.footer();
        
        return builder;
    },
    
    generateUnstrikeUnifiedContainer(target, moderator, strikeNumber, reason, pointsRestored, newPoints, originalReason, guildName) {
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS });
        
        builder.title(`${EMOJIS.gain || '✅'} STRIKE ANULADO | #${strikeNumber}`, 1);
        builder.separator();
        builder.text(`**👤 Usuário:** ${target?.tag || 'Desconhecido'} (\`${target?.id || '?'}\`)`);
        builder.text(`**🛡️ Moderador:** ${moderator.tag} (\`${moderator.id}\`)`);
        builder.text(`**📈 Pontos restaurados:** +${pointsRestored}`);
        builder.text(`**⭐ Reputação:** ${newPoints - pointsRestored} → ${newPoints}`);
        builder.separator();
        builder.text(`**📝 Punição Original:**`);
        builder.text(`\`\`\`text\n${originalReason}\n\`\`\``);
        builder.separator();
        builder.text(`**📝 Motivo da Anulação:**`);
        builder.text(`\`\`\`text\n${reason}\n\`\`\``);
        builder.footer();
        
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
            
            const { components, flags } = container.build();
            const replyData = { components, flags: [flags] };
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
            const { components, flags } = container.build();
            await interaction.editReply({ components, flags: [flags] });
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
        
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.WARNING });
        builder.title(`${EMOJIS.Warning || '⚠️'} Confirmar Aplicação de Strike`, 1);
        builder.separator();
        builder.text(`**👤 Usuário:** ${target?.tag || session.targetId}`);
        builder.text(`**⚠️ Severidade:** ${severityNames[severity]}`);
        builder.text(`**📝 Motivo:** ${reason}`);
        builder.text(`**📉 Pontos a perder:** -${pointsLost}`);
        builder.footer();
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`punishment:confirm:confirm`).setLabel('✅ Confirmar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`punishment:confirm:cancel`).setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger)
        );
        
        const { components, flags } = builder.build();
        const replyData = { components, flags: [flags] };
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
        
        const { components, flags } = container.build();
        await interaction.editReply({ components, flags: [flags] });
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
                const maxStrike = db.prepare(`
                    SELECT MAX(strike_number) as max FROM punishments WHERE guild_id = ?
                `).get(guildId);
                const strikeNumber = (maxStrike?.max || 0) + 1;
                
                console.log(`🔍 [DEBUG] strikeNumber calculado: ${strikeNumber}`);
                
                const uuid = require('../database/index').generateUUID();
                
                console.log(`🔍 [DEBUG] Inserindo strike_number: ${strikeNumber}`);
                
                db.prepare(`
                    INSERT INTO punishments (uuid, guild_id, strike_number, user_id, moderator_id, reason, severity, points_deducted, report_id, created_at, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(uuid, guildId, strikeNumber, targetId, moderatorId, reason, severity, points, reportId, Date.now(), 'active');
                
                const saved = db.prepare(`SELECT strike_number FROM punishments WHERE uuid = ?`).get(uuid);
                console.log(`🔍 [DEBUG] strike_number salvo no banco: ${saved?.strike_number}`);
                
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