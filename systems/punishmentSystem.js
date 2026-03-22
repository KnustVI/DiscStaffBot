const db = require('../database/database');

/**
 * PunishmentSystem - O "Cérebro" de Execução do DiscStaffBot
 * Gerencia aplicação, revogação, métricas e persistência de dados.
 */
const PunishmentSystem = {
    
    /**
     * Executa uma punição completa (Discord + Banco de Dados)
     */
    async executePunishment(guild, targetMember, moderatorId, severity, reason, ticketId) {
        const guildId = guild.id;
        const timestamp = Date.now();

        // 1. BUSCA MÉTRICAS (Configuradas no /config ou Padrões do Sistema)
        const getMetric = (type) => db.prepare(
            `SELECT value FROM settings WHERE guild_id = ? AND key = ?`
        ).get(guildId, `punish_${severity}_${type}`)?.value;
        
        const defaults = this.getDefaults(severity);
        const metrics = {
            action: (getMetric('action') || defaults.action).toLowerCase(),
            time: parseInt(getMetric('time') || defaults.time),
            rep: parseInt(getMetric('rep') || defaults.rep)
        };

        // 2. EXECUÇÃO NO DISCORD
        let executionDetail = "Aviso (Advertência)";

        if (targetMember) {
            try {
                if (metrics.action === 'timeout' && metrics.time > 0) {
                    await targetMember.timeout(metrics.time * 60 * 1000, reason);
                    executionDetail = `Timeout (${metrics.time}min)`;
                } else if (metrics.action === 'ban') {
                    await targetMember.ban({ reason });
                    executionDetail = "Banimento Permanente";
                } else if (metrics.action === 'kick') {
                    await targetMember.kick(reason);
                    executionDetail = "Expulsão";
                }
            } catch (err) {
                console.error(`[Erro Discord] Falha ao aplicar ${metrics.action}:`, err);
                executionDetail = "⚠️ Erro na aplicação (Permissão?)";
            }
        } else {
            executionDetail = "⚠️ Usuário não encontrado no servidor";
        }

        // 3. PERSISTÊNCIA ATÔMICA (Tudo ou nada)
        const info = db.transaction(() => {
            // Registrar a punição
            const insert = db.prepare(`
                INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, ticket_id, created_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(guildId, targetMember?.id || '0', moderatorId, reason, severity, ticketId || 'N/A', timestamp);
            
            // Atualizar Perfil do Usuário (Reputação nunca desce de 0)
            db.prepare(`
                INSERT INTO users (user_id, guild_id, reputation, penalties, last_penalty) 
                VALUES (?, ?, 100 - ?, 1, ?) 
                ON CONFLICT(user_id, guild_id) DO UPDATE SET 
                    reputation = MAX(0, reputation - ?), 
                    penalties = penalties + 1, 
                    last_penalty = ?
            `).run(targetMember?.id || '0', guildId, metrics.rep, timestamp, metrics.rep, timestamp);
            
            return { id: insert.lastInsertRowid };
        })();

        const userData = db.prepare(`SELECT reputation FROM users WHERE user_id = ? AND guild_id = ?`)
                          .get(targetMember?.id || '0', guildId);

        return { 
            punishmentId: info.id, 
            repLoss: metrics.rep, 
            currentRep: userData?.reputation || 100, 
            detail: executionDetail 
        };
    },

    /**
     * Revoga uma punição e restaura a reputação do usuário
     */
    async revertPunishment(guildId, punishmentId, revogReason) {
        return db.transaction(() => {
            // 1. Busca a punição original
            const punishment = db.prepare(`SELECT * FROM punishments WHERE id = ? AND guild_id = ?`).get(punishmentId, guildId);

            if (!punishment) throw new Error("Punição não encontrada.");
            if (punishment.severity === 0) throw new Error("Esta punição já foi revogada.");

            // 2. Cálculo de Reputação a restaurar
            const customRep = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`)
                                .get(guildId, `punish_${punishment.severity}_rep`);
            
            const defaults = this.getDefaults(punishment.severity);
            const repToRestore = customRep ? parseInt(customRep.value) : (defaults?.rep || 0);

            // 3. Marca como revogada no histórico
            db.prepare(`UPDATE punishments SET reason = ?, severity = 0 WHERE id = ?`)
              .run(`REVOGADA: ${revogReason}`, punishmentId);

            // 4. Recalcula o 'last_penalty' para não bugar o sistema de recuperação de rep
            const lastValid = db.prepare(`
                SELECT created_at FROM punishments 
                WHERE user_id = ? AND guild_id = ? AND severity > 0 
                ORDER BY created_at DESC LIMIT 1
            `).get(punishment.user_id, guildId);

            const newLastPenalty = lastValid ? lastValid.created_at : 0;

            // 5. Devolve os pontos ao usuário
            db.prepare(`
                UPDATE users 
                SET reputation = MIN(100, reputation + ?),
                    penalties = MAX(0, penalties - 1),
                    last_penalty = ?
                WHERE user_id = ? AND guild_id = ?
            `).run(repToRestore, newLastPenalty, punishment.user_id, guildId);

            const userData = db.prepare(`SELECT reputation FROM users WHERE user_id = ? AND guild_id = ?`)
                              .get(punishment.user_id, guildId);

            return { 
                userId: punishment.user_id, 
                repRestored: repToRestore, 
                currentRep: userData.reputation,
                ticketId: punishment.ticket_id
            };
        })();
    },

    /**
     * Busca o histórico paginado para o comando /historico
     */
    async getUserHistory(guildId, userId, page = 1, limit = 5) {
        const offset = (page - 1) * limit;

        const totalRow = db.prepare(`SELECT COUNT(*) as total FROM punishments WHERE user_id = ? AND guild_id = ?`).get(userId, guildId);
        const total = totalRow ? totalRow.total : 0;
        
        const punishments = db.prepare(`
            SELECT * FROM punishments 
            WHERE user_id = ? AND guild_id = ?
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `).all(userId, guildId, limit, offset);

        const userData = db.prepare(`SELECT reputation FROM users WHERE user_id = ? AND guild_id = ?`).get(userId, guildId);

        return {
            total,
            punishments,
            reputation: userData ? userData.reputation : 100,
            totalPages: Math.ceil(total / limit)
        };
    },

    /**
     * Valores padrão caso a Staff não tenha configurado o /config metricas
     */
    getDefaults(s) {
        const def = {
            1: { action: "aviso", time: 0, rep: 2 },
            2: { action: "timeout", time: 5, rep: 5 },
            3: { action: "timeout", time: 30, rep: 10 },
            4: { action: "timeout", time: 120, rep: 20 },
            5: { action: "ban", time: 0, rep: 35 }
        };
        return def[s] || { action: "aviso", time: 0, rep: 0 };
    },  

    async resetUserFicha(guildId, userId) {
        return db.transaction(() => {
            // Apaga o perfil de reputação
            const userDeleted = db.prepare('DELETE FROM users WHERE user_id = ? AND guild_id = ?').run(userId, guildId);
            // Apaga todo o histórico de punições
            db.prepare('DELETE FROM punishments WHERE user_id = ? AND guild_id = ?').run(userId, guildId);
            
            return userDeleted.changes > 0; // Retorna true se algo foi deletado
        })();
    },
};

module.exports = PunishmentSystem;