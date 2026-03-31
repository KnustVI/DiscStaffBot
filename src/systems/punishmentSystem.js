const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/index.js');
const emojisFile = require('../database/emojis.js');
const ErrorLogger = require('./errorLogger');
const ConfigSystem = require('./configSystem');

const PunishmentSystem = {

    /**
     * FUNÇÃO MESTRE: Orquestra todo o processo de punição.
     */
    async executeFullProcess({ guild, target, moderator, severity, reason, ticketId, discordAct, jogoAct, durationStr }) { 
        try {
            const pointsToSubtract = severity === 1 ? 10 : severity === 2 ? 25 : severity === 3 ? 40 : severity === 4 ? 60 : 100;
            const durationMs = this.parseDuration(durationStr);
            const endsAt = durationMs > 0 ? Math.floor((Date.now() + durationMs) / 1000) : null; 

            // 1. Banco de Dados: Aplica Strike e reduz pontos
            const punishmentId = await this.applyPunishment(guild.id, target.id, moderator.id, reason, severity, ticketId, pointsToSubtract);

            // Tenta buscar o membro no cache ou fetch
            const member = await guild.members.fetch(target.id).catch(() => null);

            if (member) {
                // 2. Sincroniza Cargos de Reputação (Exemplar/Problemático)
                await this.syncReputationRoles(member);

                // 3. Aplica Cargo de Strike Temporário (Se houver duração)
                if (durationMs > 0) {
                    await this.applyTemporaryStrikeRole(member, durationStr);
                }

                // 4. Ações Nativas do Discord (Mute/Ban/Kick)
                if (discordAct && discordAct !== 'none') {
                    await this.applyDiscordAction(member, discordAct, durationStr, reason); 
                }
            }

            // 5. Placeholder RCON (Futuro)
            if (jogoAct && jogoAct !== 'none') {
                console.log(`[RCON] Aplicando ${jogoAct} em ${target.id}`);
            }

            // 6. Gera Embed de Log e DM
            const history = await this.getUserHistory(guild.id, target.id);
            const embed = this.generatePunishmentEmbed({
                punishmentId, endsAt, durationStr, targetUser: target,
                moderatorId: moderator.id, pointsToSubtract, reputation: history.reputation,
                severity, ticketId, reason, guildName: guild.name,
                actions: { discord: discordAct, jogo: jogoAct }
            });

            await this.dispatch(guild, embed, target, ConfigSystem.getSetting(guild.id, 'logs_channel'));
            
            return { newPoints: history.reputation };
        } catch (err) {
            ErrorLogger.log('PunishmentSystem_FullProcess', err);
            throw err;
        }
    },

    /**
     * SINCRONIZAÇÃO DINÂMICA DE CARGOS
     */
    async syncReputationRoles(member) {
        try {
            const guildId = member.guild.id;
            const row = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, member.id);
            const points = row ? row.points : 100;

            const config = {
                exemplarRole: ConfigSystem.getSetting(guildId, 'role_exemplar'),
                exemplarLimit: parseInt(ConfigSystem.getSetting(guildId, 'limit_exemplar') || 90),
                badRole: ConfigSystem.getSetting(guildId, 'role_problematico'),
                badLimit: parseInt(ConfigSystem.getSetting(guildId, 'limit_problematico') || 40)
            };

            const toAdd = [];
            const toRemove = [];

            if (points >= config.exemplarLimit && config.exemplarRole) {
                toAdd.push(config.exemplarRole);
                if (config.badRole) toRemove.push(config.badRole);
            } else if (points <= config.badLimit && config.badRole) {
                toAdd.push(config.badRole);
                if (config.exemplarRole) toRemove.push(config.exemplarRole);
            } else {
                if (config.exemplarRole) toRemove.push(config.exemplarRole);
                if (config.badRole) toRemove.push(config.badRole);
            }

            for (const id of toAdd) if (id && !member.roles.cache.has(id)) await member.roles.add(id).catch(() => {});
            for (const id of toRemove) if (id && member.roles.cache.has(id)) await member.roles.remove(id).catch(() => {});
        } catch (err) {
            ErrorLogger.log('SyncRoles_Error', err);
        }
    },

    /**
     * CARGO DE STRIKE TEMPORÁRIO
     */
    async applyTemporaryStrikeRole(member, durationStr) {
        const guildId = member.guild.id;
        const roleStrikeId = ConfigSystem.getSetting(guildId, 'role_strike');
        if (!roleStrikeId) return;

        const durationMs = this.parseDuration(durationStr);
        const expiresAt = Date.now() + durationMs;

        try {
            await member.roles.add(roleStrikeId, "Punição Temporária").catch(() => {});
            db.prepare(`
                INSERT INTO temporary_roles (guild_id, user_id, role_id, expires_at)
                VALUES (?, ?, ?, ?)
            `).run(guildId, member.id, roleStrikeId, expiresAt);
        } catch (err) {
            ErrorLogger.log('ApplyStrikeRole_Error', err);
        }
    },

    /**
     * WORKER: Remove cargos e bans expirados (Chamar no ready do bot)
     */
    initWorker(client) {
        console.log('--- [PunishmentWorker] Monitorando expirações ---');
        setInterval(async () => {
            const now = Date.now();

            // 1. Limpa Cargos
            const expiredRoles = db.prepare(`SELECT * FROM temporary_roles WHERE expires_at <= ?`).all(now);
            for (const entry of expiredRoles) {
                const guild = client.guilds.cache.get(entry.guild_id);
                if (guild) {
                    const member = await guild.members.fetch(entry.user_id).catch(() => null);
                    if (member) await member.roles.remove(entry.role_id, "Strike Expirado").catch(() => {});
                }
                db.prepare(`DELETE FROM temporary_roles WHERE id = ?`).run(entry.id);
            }

            // 2. Limpa Bans
            const expiredBans = db.prepare(`SELECT * FROM temporary_punishments WHERE expires_at <= ?`).all(now);
            for (const ban of expiredBans) {
                const guild = client.guilds.cache.get(ban.guild_id);
                if (guild) await guild.members.unban(ban.user_id, "Ban Temporário Expirado").catch(() => {});
                db.prepare(`DELETE FROM temporary_punishments WHERE id = ?`).run(ban.id);
            }
        }, 60000);
    },

    // --- MÉTODOS AUXILIARES ---

    async applyPunishment(guildId, targetId, moderatorId, reason, severity, ticketId, points) {
        const timestamp = Date.now();
        let lastId;
        const trans = db.transaction(() => {
            const info = db.prepare(`
                INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, ticket_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(guildId, targetId, moderatorId, reason, severity, ticketId, timestamp);
            lastId = info.lastInsertRowid;

            db.prepare(`
                INSERT INTO reputation (guild_id, user_id, points) VALUES (?, ?, 100)
                ON CONFLICT(guild_id, user_id) DO UPDATE SET points = MAX(0, points - ?)
            `).run(guildId, targetId, points);
        });
        trans();
        return lastId;
    },

    parseDuration(durationStr) {
        if (!durationStr || ['0', 'perm'].includes(durationStr.toLowerCase())) return 0;
        const timeValue = parseInt(durationStr);
        const type = durationStr.slice(-1).toLowerCase();
        const multipliers = { 'm': 60000, 'h': 3600000, 'd': 86400000 };
        return multipliers[type] ? timeValue * multipliers[type] : 3600000;
    },

    async applyDiscordAction(member, action, durationStr, reason) {
        const ms = this.parseDuration(durationStr);
        try {
            if (action.includes('timeout')) await member.timeout(ms > 0 ? ms : 3600000, reason);
            else if (action === 'ban') {
                await member.ban({ reason });
                if (ms > 0) db.prepare(`INSERT INTO temporary_punishments (guild_id, user_id, type, expires_at) VALUES (?, ?, 'ban', ?)`).run(member.guild.id, member.id, Date.now() + ms);
            } else if (action === 'kick') await member.kick(reason);
        } catch (e) { ErrorLogger.log('DiscordAction_Error', e); }
    },

    async getUserHistory(guildId, userId, page = 1) {
        const limit = 5;
        const offset = (page - 1) * limit;
        const rep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
        const punishments = db.prepare(`SELECT * FROM punishments WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(guildId, userId, limit, offset);
        const total = db.prepare(`SELECT COUNT(*) as total FROM punishments WHERE guild_id = ? AND user_id = ?`).get(guildId, userId).total;
        return { reputation: rep ? rep.points : 100, punishments, total, totalPages: Math.ceil(total / limit) || 1 };
    },

    generatePunishmentEmbed(data) {
        return new EmbedBuilder()
            .setColor(0xFF4B4B)
            .setThumbnail(data.targetUser.displayAvatarURL({ dynamic: true }))
            .setDescription([
                `# ${EMOJIS.DOWN || '⚖️'} STRIKE! | #${data.punishmentId}`,
                `- **Moderador:** <@${data.moderatorId}>`,
                `### ${EMOJIS.USER || '👤'} ${data.targetUser}`,
                `- **Pontos:** \`-${data.pointsToSubtract}\` (\`${data.reputation}/100\`)`,
                `- **Duração:** \`${data.durationStr || 'Permanente'}\``,
                `### ${EMOJIS.NOTE || '📝'} Motivo`,
                `\`\`\`\n${data.reason}\n\`\`\``,
            ].join('\n'))
            .setFooter(ConfigSystem.getFooter(data.guildName))
            .setTimestamp();
    },

    async dispatch(guild, embed, target, logChannelId) {
        if (logChannelId) {
            const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) await logChannel.send({ embeds: [embed] });
        }
        await target.send({ content: `⚠️ Você recebeu uma punição em **${guild.name}**`, embeds: [embed] }).catch(() => {});
    }
};

module.exports = PunishmentSystem;