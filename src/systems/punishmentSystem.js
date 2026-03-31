const { EmbedBuilder } = require('discord.js');
const db = require('../database/index.js');
const emojisFile = require('../database/emojis.js');
const EMOJIS = emojisFile.EMOJIS || {};

const PunishmentSystem = {

    /**
     * PONTO 6: Melhoria de Performance.
     * O parse de duração não precisa ser assíncrono.
     */
    parseDuration(durationStr) {
        if (!durationStr || ['0', 'perm'].includes(durationStr.toLowerCase())) return 0;
        const timeValue = parseInt(durationStr);
        const type = durationStr.slice(-1).toLowerCase();
        const multipliers = { 'm': 60000, 'h': 3600000, 'd': 84600000 }; // m, h, d
        return (multipliers[type] || 3600000) * timeValue;
    },

    /**
     * FUNÇÃO MESTRE OTIMIZADA
     */
    async executeFullProcess({ guild, target, moderator, severity, reason, ticketId, discordAct, jogoAct, durationStr }) { 
        try {
            // Ponto 6: Cálculo matemático puro (Síncrono)
            const pointsToSubtract = [0, 10, 25, 40, 60, 100][severity] || 10;
            const durationMs = this.parseDuration(durationStr);
            const endsAt = durationMs > 0 ? Math.floor((Date.now() + durationMs) / 1000) : null; 

            // 1. Banco de Dados (Transação Única = Performance)
            const punishmentId = this.applyPunishment(guild.id, target.id, moderator.id, reason, severity, ticketId, pointsToSubtract);

            const member = await guild.members.fetch(target.id).catch(() => null);

            if (member) {
                // 2 & 3. Processamento em paralelo (Ganha tempo nos 3 segundos)
                await Promise.all([
                    this.syncReputationRoles(member),
                    durationMs > 0 ? this.applyTemporaryStrikeRole(member, durationMs) : Promise.resolve(),
                    (discordAct && discordAct !== 'none') ? this.applyDiscordAction(member, discordAct, durationStr, reason) : Promise.resolve()
                ]);
            }

            // 4. Log e DM (Non-blocking: Não precisamos esperar a DM chegar para confirmar o sucesso)
            this.getUserHistory(guild.id, target.id).then(history => {
                const embed = this.generatePunishmentEmbed({
                    punishmentId, endsAt, durationStr, targetUser: target,
                    moderatorId: moderator.id, pointsToSubtract, reputation: history.reputation,
                    severity, ticketId, reason, guildName: guild.name
                });
                this.dispatch(guild, embed, target, client.systems.config.getSetting(guild.id, 'logs_channel'));
            });
            
            return { success: true };
        } catch (err) {
            client.systems.logger.log('PunishmentSystem_Error', err);
            throw err;
        }
    },

    /**
     * WORKER OTIMIZADO (PONTO 4 & 5)
     * Unificado e eficiente.
     */
    initWorker(client) {
        console.log('⚖️ [Worker] Sistema de Punições Ativo');
        
        setInterval(async () => {
            const now = Date.now();

            // 1. Busca e Remove Roles Expiradas em lote
            const expiredRoles = db.prepare(`SELECT * FROM temporary_roles WHERE expires_at <= ?`).all(now);
            for (const entry of expiredRoles) {
                const guild = client.guilds.cache.get(entry.guild_id);
                if (guild) {
                    guild.members.fetch(entry.user_id)
                        .then(m => m.roles.remove(entry.role_id, "Strike Expirado"))
                        .catch(() => null);
                }
                db.prepare(`DELETE FROM temporary_roles WHERE id = ?`).run(entry.id);
            }

            // 2. Busca e Remove Bans Expirados
            const expiredBans = db.prepare(`SELECT * FROM temporary_punishments WHERE expires_at <= ?`).all(now);
            for (const ban of expiredBans) {
                const guild = client.guilds.cache.get(ban.guild_id);
                if (guild) guild.members.unban(ban.user_id, "Tempo Expirado").catch(() => null);
                db.prepare(`DELETE FROM temporary_punishments WHERE id = ?`).run(ban.id);
            }
        }, 30000); // Checa a cada 30s para precisão
    },

    /**
     * DB: Aplicação de Strike (PONTO 6: Síncrono para o Better-SQLite3)
     */
    applyPunishment(guildId, targetId, moderatorId, reason, severity, ticketId, points) {
        const trans = db.transaction(() => {
            const res = db.prepare(`
                INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, ticket_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(guildId, targetId, moderatorId, reason, severity, ticketId, Date.now());

            db.prepare(`
                INSERT INTO reputation (guild_id, user_id, points) VALUES (?, ?, 100)
                ON CONFLICT(guild_id, user_id) DO UPDATE SET points = MAX(0, points - ?)
            `).run(guildId, targetId, points);

            return res.lastInsertRowid;
        });
        return trans();
    },

};

module.exports = PunishmentSystem;