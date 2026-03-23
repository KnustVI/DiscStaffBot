const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/database');
const { EMOJIS } = require('../database/emojis');
const ErrorLogger = require('./errorLogger'); 

const PunishmentSystem = {
    /**
     * Aplica a punição e atualiza a reputação no banco
     */
    async applyPunishment(guildId, targetId, moderatorId, reason, severity) {
        const pointsToSubtract = severity === 1 ? 10 : severity === 2 ? 25 : severity === 3 ? 40 : severity === 4 ? 60 : 100;

        try {
            const insertPunishment = db.prepare(`
                INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            insertPunishment.run(guildId, targetId, moderatorId, reason, severity, new Date().toISOString());

            db.prepare(`
                INSERT INTO reputation (guild_id, user_id, points)
                VALUES (?, ?, ?)
                ON CONFLICT(guild_id, user_id) DO UPDATE SET points = MAX(0, points - ?)
            `).run(guildId, targetId, 100 - pointsToSubtract, pointsToSubtract);

            return true;
        } catch (err) {
    ErrorLogger.log('PunishmentSystem_Apply', err);
    throw err;
}
    },

    /**
     * Puxa o histórico formatado para o comando /historico
     */
    async getUserHistory(guildId, userId, page = 1) {
        const limit = 5;
        const offset = (page - 1) * limit;

        const repRow = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
        const reputation = repRow ? repRow.points : 100;

        const punishments = db.prepare(`
            SELECT * FROM punishments 
            WHERE guild_id = ? AND user_id = ? 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `).all(guildId, userId, limit, offset);

        const totalRow = db.prepare(`SELECT COUNT(*) as total FROM punishments WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
        const total = totalRow ? totalRow.total : 0;

        return {
            reputation,
            punishments,
            total,
            totalPages: Math.ceil(total / limit)
        };
    },

    /**
     * Gera a Embed Universal para ser usada em qualquer lugar
     */
    generatePunishmentEmbed(data) {
        return new EmbedBuilder()
            .setAuthor({ name: `Punição | Registro #${data.id || '?' }`, iconURL: data.targetUser.displayAvatarURL() })
            .setColor(0xFF3C72)
            .addFields(
                { name: `${EMOJIS.USUARIO} Infrator`, value: `${data.targetUser}`, inline: true },
                { name: `${EMOJIS.ACTION} Gravidade`, value: `\`Nível ${data.severity}\``, inline: true },
                { name: `${EMOJIS.DOWN} Reputação`, value: `\`${data.reputation} pts\``, inline: true },
                { name: `${EMOJIS.TICKET} Ticket`, value: `\`#${data.ticketId}\``, inline: true },
                { name: `${EMOJIS.NOTE} Motivo`, value: `\`\`\`${data.reason}\`\`\`` } // Ajustado para data.reason
            )
            .setTimestamp();
    },

    /**
     * Despachante: Envia para Log e tenta enviar para DM
     */
    async dispatch(guild, embed, targetUser, logChannelId) {
        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (logChannel) await logChannel.send({ embeds: [embed] });

        await targetUser.send({ 
            content: `⚠️ Você recebeu uma punição em **${guild.name}**`, 
            embeds: [embed] 
        }).catch(() => console.log(`DM fechada para ${targetUser.tag}`));
    },

    /**
     * Gera a Embed de Histórico Paginada
     */
    generateHistoryEmbed(targetUser, history, page) {
        const embed = new EmbedBuilder()
            .setAuthor({ name: `Histórico: ${targetUser.tag}`, iconURL: targetUser.displayAvatarURL() })
            .setColor(history.reputation < 50 ? 0xFF0000 : 0x00FF00)
            .setDescription(`${EMOJIS.REPUTATION} **Reputação:** \`${history.reputation}/100\`\n${EMOJIS.NOTE} **Total de Registros:** \`${history.total}\``)
            .setFooter({ text: `Página ${page} de ${history.totalPages}` });

        if (history.punishments.length === 0) {
            embed.addFields({ name: 'Limpo', value: 'Nenhum registro encontrado para este usuário.' });
        } else {
            history.punishments.forEach(p => {
                const date = new Date(p.created_at).toLocaleDateString('pt-BR');
                embed.addFields({
                    name: `ID: #${p.id} | ${date}`,
                    value: `**Nível:** ${p.severity} | **Motivo:** ${p.reason.substring(0, 50)}${p.reason.length > 50 ? '...' : ''}`
                });
            });
        }
        return embed;
    },

    /**
     * Gera os botões de navegação
     */
    generateHistoryButtons(targetId, currentPage, totalPages) {
        if (totalPages <= 1) return null;

        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`hist_${targetId}_${currentPage - 1}`)
                .setLabel('⬅️ Anterior')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage <= 1),
            new ButtonBuilder()
                .setCustomId(`hist_${targetId}_${currentPage + 1}`)
                .setLabel('Próxima ➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage >= totalPages)
        );
    }
};

module.exports = PunishmentSystem;