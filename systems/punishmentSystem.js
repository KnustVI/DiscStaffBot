const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/database');
const { EMOJIS } = require('../database/emojis');
const ErrorLogger = require('./errorLogger');
const ConfigSystem = require('./configSystem');

const PunishmentSystem = {

    /**
     * FUNÇÃO MESTRE: Orquestra todo o processo de punição.
     */
    async executeFullProcess({ guild, target, moderator, severity, reason, ticketId, discordAct, jogoAct, durationStr }) { 
        try {
            // Cálculo de pontos baseado na gravidade
            const pointsToSubtract = severity === 1 ? 10 : severity === 2 ? 25 : severity === 3 ? 40 : severity === 4 ? 60 : 100;
            
            const durationMs = this.parseDuration(durationStr);
            const endsAt = durationMs > 0 ? Math.floor((Date.now() + durationMs) / 1000) : null; 

            // 1. Aplica no Banco de Dados e retorna o ID único da punição
            const punishmentId = await this.applyPunishment(guild.id, target.id, moderator.id, reason, severity, ticketId, pointsToSubtract);

            // 2. Tenta aplicar a punição no Discord (Timeout/Ban/Kick)
            const member = await guild.members.fetch(target.id).catch(() => null);
            if (member && discordAct && discordAct !== 'none') {
                await this.applyDiscordAction(member, discordAct, durationStr, reason); 
            }

            // 3. Placeholder para RCON (Integração futura)
            if (jogoAct && jogoAct !== 'none') {
                console.log(`[RCON] Aplicando ${jogoAct} em ${target.id}`);
            }

            // 4. Busca histórico atualizado para mostrar na Embed
            const history = await this.getUserHistory(guild.id, target.id);
            
            // 5. Gera a Embed de Log/Sucesso
            const embed = this.generatePunishmentEmbed({
                punishmentId: punishmentId,
                endsAt: endsAt,
                durationStr: durationStr, 
                targetUser: target,
                moderatorId: moderator.id,
                pointsToSubtract,
                reputation: history.reputation,
                severity,
                ticketId,
                reason,
                guildName: guild.name,
                actions: { discord: discordAct, jogo: jogoAct }
            });

            // 6. Envia para o Canal de Logs e DM do usuário
            await this.dispatch(guild, embed, target, ConfigSystem.getSetting(guild.id, 'logs_channel'));
            
            return { newPoints: history.reputation };
        } catch (err) {
            ErrorLogger.log('PunishmentSystem_FullProcess', err);
            throw err;
        }
    },

    async getUserHistory(guildId, userId, page = 1) {
        const limit = 5;
        const offset = (page - 1) * limit;
        try {
            const repRow = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            const reputation = repRow ? repRow.points : 100;

            const punishments = db.prepare(`
                SELECT * FROM punishments WHERE guild_id = ? AND user_id = ? 
                ORDER BY created_at DESC LIMIT ? OFFSET ?
            `).all(guildId, userId, limit, offset);

            const totalRow = db.prepare(`SELECT COUNT(*) as total FROM punishments WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            const total = totalRow ? totalRow.total : 0;

            return { 
                reputation, 
                punishments, 
                total, 
                totalPages: Math.ceil(total / limit) || 1 
            };
        } catch (err) {
            ErrorLogger.log('PunishmentSystem_GetHistory', err);
            return { reputation: 100, punishments: [], total: 0, totalPages: 1 };
        }
    },

    async executeUnstrike({ guild, punishmentId, moderator, reason }) {
        try {
            const punishment = db.prepare(`SELECT user_id, severity FROM punishments WHERE id = ? AND guild_id = ?`).get(punishmentId, guild.id);
            if (!punishment) return null;

            const pointsToReturn = punishment.severity === 1 ? 10 : punishment.severity === 2 ? 25 : punishment.severity === 3 ? 40 : punishment.severity === 4 ? 60 : 100;
            const targetUser = await guild.client.users.fetch(punishment.user_id).catch(() => ({ id: punishment.user_id, username: 'Usuário Desconhecido' }));

            // Transação segura para deletar e devolver pontos
            db.transaction(() => {
                db.prepare(`DELETE FROM punishments WHERE id = ?`).run(punishmentId);
                db.prepare(`
                    INSERT INTO reputation (guild_id, user_id, points) VALUES (?, ?, 100)
                    ON CONFLICT(guild_id, user_id) DO UPDATE SET points = MIN(100, points + ?)
                `).run(guild.id, punishment.user_id, pointsToReturn);
            })();

            const history = await this.getUserHistory(guild.id, punishment.user_id);
            const logChannelId = ConfigSystem.getSetting(guild.id, 'logs_channel');

            const embed = this.generateUnstrikeEmbed({
                targetUser: targetUser,
                moderatorId: moderator.id,
                pointsReturned: pointsToReturn,
                reputation: history.reputation,
                punishmentId: punishmentId,
                guildName: guild.name,
                reason: reason
            });

            await this.dispatch(guild, embed, targetUser, logChannelId);
            return true;
        } catch (err) {
            ErrorLogger.log('PunishmentSystem_Unstrike', err);
            throw err;
        }
    },

    async applyPunishment(guildId, targetId, moderatorId, reason, severity, ticketId = 'N/A', pointsToSubtract) {
        const timestamp = Date.now();
        try {
            let lastId;
            const trans = db.transaction(() => {
                const info = db.prepare(`
                    INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, ticket_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(guildId, targetId, moderatorId, reason, severity, ticketId, timestamp);
                
                lastId = info.lastInsertRowid;

                db.prepare(`
                    INSERT INTO reputation (guild_id, user_id, points)
                    VALUES (?, ?, ?)
                    ON CONFLICT(guild_id, user_id) DO UPDATE SET points = MAX(0, points - ?)
                `).run(guildId, targetId, 100 - pointsToSubtract, pointsToSubtract);
            });
            trans();
            return lastId;
        } catch (err) {
            ErrorLogger.log('PunishmentSystem_Apply', err);
            throw err;
        }
    },

    parseDuration(durationStr) {
        if (!durationStr || durationStr === '0' || durationStr.toLowerCase() === 'perm') return 0;
        const timeValue = parseInt(durationStr);
        const type = durationStr.slice(-1).toLowerCase();
        const multipliers = { 'm': 60000, 'h': 3600000, 'd': 86400000 };
        return multipliers[type] ? timeValue * multipliers[type] : 3600000;
    },

    async applyDiscordAction(member, action, durationStr, reason) {
        const durationMs = this.parseDuration(durationStr);
        try {
            if (action.includes('timeout')) {
                await member.timeout(durationMs > 0 ? durationMs : 3600000, reason);
            } 
            else if (action === 'ban') {
                await member.ban({ reason });
                if (durationMs > 0) {
                    const unbanTime = Date.now() + durationMs;
                    db.prepare(`INSERT INTO temporary_punishments (guild_id, user_id, type, expires_at) VALUES (?, ?, 'ban', ?)`).run(member.guild.id, member.id, unbanTime);
                }
            } else if (action === 'kick') {
                await member.kick(reason);
            }
        } catch (err) {
            ErrorLogger.log('Discord_Action_Error', err);
        }
    },

    generateUnstrikeEmbed(data) {
        return new EmbedBuilder()
            .setColor(0xba0054)
            .setThumbnail(data.targetUser.displayAvatarURL ? data.targetUser.displayAvatarURL({ dynamic: true }) : null)
            .setDescription([
                `# ${EMOJIS.UP || '🛡️'} STRIKE Anulado | ${data.punishmentId}`,
                `Um registro de infração foi removido do sistema por um moderador.`,
                `- **Moderador:** <@${data.moderatorId}> (${data.moderatorId})`,
                `### ${EMOJIS.USER || '👤'} <@${data.targetUser.id}> (${data.targetUser.id})`,
                `- **Pontos Devolvidos:** +${data.pointsReturned} pts`,
                `- **Reputação Atual:** ${data.reputation}/100 pts`,
                `### ${EMOJIS.TICKET || '📝'} Detalhes`,
                `- **ID da Punição Removida:** #${data.punishmentId}`,
                `### ${EMOJIS.NOTE || '📝'} Motivo da Anulação`,
                `\`\`\`\n${data.reason}\n\`\`\``,
                '',
                `> O histórico foi limpo e os pontos restaurados.`
            ].join('\n'))
            .setFooter(ConfigSystem.getFooter(data.guildName))
            .setTimestamp();
    },

    generatePunishmentEmbed(data) {
        const discordLabels = { 'timeout': 'Mute (Tempo definido)', 'kick': 'Expulsão', 'ban': 'Banimento' };
        const jogoLabels = { 'rcon_warn': 'Aviso In-game', 'rcon_kick': 'Kick do Servidor', 'rcon_slay': 'Morte (Slay)', 'rcon_ban': 'Ban do Jogo' };
        
        const actions = [
            data.actions.discord !== 'none' ? `${discordLabels[data.actions.discord] || data.actions.discord}` : null,
            data.actions.jogo !== 'none' ? `${jogoLabels[data.actions.jogo] || data.actions.jogo}` : null
        ].filter(Boolean);

        const actionDesc = actions.length > 0 ? actions.map(a => `- ${a}`).join('\n') : '- Apenas Registro';

        return new EmbedBuilder()
            .setColor(0xba0054)
            .setThumbnail(data.targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
            .setDescription([
                `# ${EMOJIS.DOWN || '⚖️'} STRIKE! | #${data.punishmentId}`,
                `Um novo registro de infração foi adicionado ao sistema.`,
                `- **Moderador:** <@${data.moderatorId}>\n(${data.moderatorId})`,
                `### ${EMOJIS.USER || '👤'} ${data.targetUser}\n (${data.targetUser.id})`,
                `- **Pontos Subtraídos:** -${data.pointsToSubtract} pts`,
                `- **Reputação Final:** ${data.reputation}/100 pts`,
                `### ${EMOJIS.TICKET || '📝'} Detalhes`,
                `- **Gravidade:** Nível ${data.severity}`,
                `- **Ticket:** ${data.ticketId}`,
                `### ${EMOJIS.WARNING || '⚠️'} Punições Aplicadas`, 
                `${actionDesc}`,
                `### ${EMOJIS.NOTE || '📝'} Motivo`,
                `\`\`\`\n${data.reason}\n\`\`\``,
            ].join('\n'))
            .setFooter(ConfigSystem.getFooter(data.guildName))
            .setTimestamp();
    },

    async dispatch(guild, embed, targetUser, logChannelId) {
        if (logChannelId) {
            const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) await logChannel.send({ embeds: [embed] });
        }

        // Tenta enviar a DM. Se falhar (DM fechada), apenas loga.
        if (targetUser && targetUser.send) {
            await targetUser.send({ 
                content: `${EMOJIS.WARNING || '⚠️'} Você recebeu uma punição em **${guild.name}**`, 
                embeds: [embed] 
            }).catch(() => console.log(`DM fechada para ${targetUser.id}`));
        }
    },

    generateHistoryEmbed(targetUser, history, page, guildName) {
        const embed = new EmbedBuilder()
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
            .setColor(0xba0054)
            .setDescription([
                `# ${EMOJIS.REPUTATION || '📊'} HISTÓRICO | ${targetUser.tag || targetUser.username}`,
                `- Exibindo a ficha técnica de`,
                `${targetUser.username} (${targetUser.id})`,
                `- **Reputação:** ${history.reputation}/100 pts`,
                `- **Total de Registros:** ${history.total}`,
                `### ${EMOJIS.TICKET || '📝'} Registros Recentes`,
                `*Página ${page} de ${history.totalPages}*`,
                `> Use os botões abaixo para navegar pelo histórico completo.`,
                '' 
            ].join('\n'))
            .setFooter(ConfigSystem.getFooter(guildName));

        if (history.punishments.length === 0) {
            embed.addFields({ name: 'Limpo', value: 'Nenhum registro encontrado.' });
        } else {
            history.punishments.forEach(p => {
                const date = p.created_at ? `<t:${Math.floor(p.created_at / 1000)}:d>` : 'N/A';
                // REPARO AQUI: Adicionado o motivo de volta no campo value para o admin ver no histórico
                embed.addFields({
                    name: `ID: #${p.id} | ${date} | Nível ${p.severity}`,
                    value: `> **Ticket:** ${p.ticket_id || 'N/A'}\n> **Motivo:** ${p.reason || 'Não informado'}`
                });
            });
        }
        return embed;
    },

    generateHistoryButtons(targetId, currentPage, totalPages) {
        if (totalPages <= 1) return null;
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`hist:set:${targetId}:${currentPage - 1}`)
                .setLabel('⬅️ Anterior')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage <= 1),
            new ButtonBuilder()
                .setCustomId(`hist:set:${targetId}:${currentPage + 1}`)
                .setLabel('➡️ Próxima')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage >= totalPages)
        );
    },

    async setManualReputation(guildId, targetId, newPoints) {
        try {
            const currentData = db.prepare(`SELECT points FROM reputation WHERE user_id = ? AND guild_id = ?`).get(targetId, guildId);
            const oldPoints = currentData ? currentData.points : 100;
            const diff = newPoints - oldPoints;

            db.prepare(`
                INSERT INTO reputation (guild_id, user_id, points)
                VALUES (?, ?, ?)
                ON CONFLICT(guild_id, user_id) DO UPDATE SET points = ?
            `).run(guildId, targetId, newPoints, newPoints);

            return { oldPoints, newPoints, diff };
        } catch (err) {
            ErrorLogger.log('PunishmentSystem_SetManual', err);
            throw err;
        }
    }
};

module.exports = PunishmentSystem;