const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/database');
const { EMOJIS } = require('../database/emojis');
const ErrorLogger = require('./errorLogger');
const ConfigSystem = require('./configSystem');

const PunishmentSystem = {
    /**
     * FUNÇÃO MESTRE: Orquestra todo o processo de punição.
     */
    async executeFullProcess({ guild, target, moderator, severity, reason, ticketId }) {
        try {
            // 1. Calcula os pontos baseado na severidade (Centralizado)
            const pointsToSubtract = severity === 1 ? 10 : severity === 2 ? 25 : severity === 3 ? 40 : severity === 4 ? 60 : 100;

            // 2. Aplica no Banco
            await this.applyPunishment(guild.id, target.id, moderator.id, reason, severity, ticketId, pointsToSubtract);

            // 3. Busca dados atualizados
            const history = await this.getUserHistory(guild.id, target.id);
            const logChannelId = ConfigSystem.getSetting(guild.id, 'logs_channel');

            // 4. Gera a Embed formatada (Passando tudo que o template precisa)
            const embed = this.generatePunishmentEmbed({
                targetUser: target,
                moderatorId: moderator.id,
                pointsToSubtract: pointsToSubtract,
                severity,
                reputation: history.reputation,
                ticketId,
                reason,
                guildName: guild.name // Enviando o nome para o footer
            });

            // 5. Despacha
            await this.dispatch(guild, embed, target, logChannelId);

            return { newPoints: history.reputation };
        } catch (err) {
            ErrorLogger.log('PunishmentSystem_FullProcess', err);
            throw err;
        }
    },

    async applyPunishment(guildId, targetId, moderatorId, reason, severity, ticketId = 'N/A', pointsToSubtract) {
        const timestamp = Date.now();
        try {
            const transaction = db.transaction(() => {
                db.prepare(`
                    INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, ticket_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(guildId, targetId, moderatorId, reason, severity, ticketId, timestamp);

                db.prepare(`
                    INSERT INTO reputation (guild_id, user_id, points)
                    VALUES (?, ?, ?)
                    ON CONFLICT(guild_id, user_id) DO UPDATE SET points = MAX(0, points - ?)
                `).run(guildId, targetId, 100 - pointsToSubtract, pointsToSubtract);
            });
            transaction();
            return true;
        } catch (err) {
            ErrorLogger.log('PunishmentSystem_Apply', err);
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

            return { reputation, punishments, total, totalPages: Math.ceil(total / limit) || 1 };
        } catch (err) {
            ErrorLogger.log('PunishmentSystem_GetHistory', err);
            return { reputation: 100, punishments: [], total: 0, totalPages: 1 };
        }
    },

    generatePunishmentEmbed(data) {
        return new EmbedBuilder()
            .setColor(0xba0054)
            .setDescription([
                `# ${EMOJIS.DOWN || '⚖️'} Strike!`,
                `Um novo registro de infração foi adicionado ao sistema.`,
                `- **Moderador:** <@${data.moderatorId}> (\`${data.moderatorId}\`)`,
                `## ${EMOJIS.USER || '👤'} ${data.targetUser} (\`${data.targetUser.id}\`)`,
                `- **Usuário:** ${data.targetUser} (\`${data.targetUser.id}\`)`,
                `- **Pontos Subtraídos:** \`-${data.pointsToSubtract} pts\``,
                `- **Reputação Final:** \`${data.reputation}/100 pts\``,
                `### ${EMOJIS.TICKET || '📝'} Detalhes`,
                `- **Gravidade:** \`Nível ${data.severity}\``,
                `- **Ticket:** \`${data.ticketId}\``,
                `- **Motivo:** \`${data.reason}\``,
                '',
                `> O histórico completo pode ser visto com \`/historico\`.`
            ].join('\n'))
            .setFooter({ 
                text: `✧ BOT by: KnustVI | Em: ${data.guildName}`, 
                iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' 
            })
            .setTimestamp();
    },

    async dispatch(guild, embed, targetUser, logChannelId) {
        if (logChannelId) {
            const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) await logChannel.send({ embeds: [embed] });
        }

        await targetUser.send({ 
            content: `${EMOJIS.WARNING || '⚠️'} Você recebeu uma punição em **${guild.name}**`, 
            embeds: [embed] 
        }).catch(() => console.log(`DM fechada para ${targetUser.tag}`));
    },

    generateHistoryEmbed(targetUser, history, page, guildName) {
        const embed = new EmbedBuilder()
            .setAuthor({ name: `Histórico: ${targetUser.tag}`, iconURL: targetUser.displayAvatarURL() })
            .setColor(0xba0054)
            .setDescription([
                `# ${EMOJIS.REPUTATION || '📊'} Ficha de Cadastro`,
                `- **Reputação:** \`${history.reputation}/100 pts\``,
                `- **Total de Registros:** \`${history.total}\``,
                `### ${EMOJIS.TICKET || '📝'} Registros Recentes (Página ${page}/${history.totalPages})`,
                `> Use os botões abaixo para navegar pelo histórico completo.`,
            ].join('\n'))
            .setFooter({ 
                text: `✧ BOT by: KnustVI | Em: ${data.guildName}`, 
                iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' 
            });

        if (history.punishments.length === 0) {
            embed.addFields({ name: 'Limpo', value: 'Nenhum registro encontrado.' });
        } else {
            history.punishments.forEach(p => {
                const date = p.created_at ? `<t:${Math.floor(p.created_at / 1000)}:d>` : 'N/A';
                embed.addFields({
                    name: `ID: #${p.id} | ${date}`,
                    value: `> **Motivo:** ${p.reason.substring(0, 60)}${p.reason.length > 60 ? '...' : ''}\n> **Ticket:** \`${p.ticket_id || 'N/A'}\``
                });
            });
        }
        return embed;
    },

    generateHistoryButtons(targetId, currentPage, totalPages) {
        if (totalPages <= 1) return null;
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`hist_${targetId}_${currentPage - 1}`)
                .setLabel(`${EMOJIS.RIGTH || '⬅️'} Anterior`).setStyle(ButtonStyle.Secondary).setDisabled(currentPage <= 1),
            new ButtonBuilder()
                .setCustomId(`hist_${targetId}_${currentPage + 1}`)
                .setLabel(`${EMOJIS.LEFT || '➡️'} Próxima`).setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages)
        );
    }
};

module.exports = PunishmentSystem;