const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/database');
const { EMOJIS } = require('../database/emojis');
const ErrorLogger = require('./errorLogger');
const ConfigSystem = require('./configSystem');

const PunishmentSystem = {
    /**
     * FUNÇÃO MESTRE: Orquestra todo o processo de punição de forma limpa.
     */
    async executeFullProcess({ guild, target, moderator, severity, reason, ticketId }) {
        try {
            // 1. Aplica no Banco (Retorna true se OK)
            await this.applyPunishment(guild.id, target.id, moderator.id, reason, severity, ticketId);

            // 2. Busca dados atualizados para a Embed
            const history = await this.getUserHistory(guild.id, target.id);
            const logChannelId = ConfigSystem.getSetting(guild.id, 'logs_channel');

            // 3. Gera a Embed formatada
            const embed = this.generatePunishmentEmbed({
                targetUser: target,
                severity,
                reputation: history.reputation,
                ticketId,
                reason
            });

            // 4. Despacha (Log no Discord e DM ao Player)
            await this.dispatch(guild, embed, target, logChannelId);

            return { newPoints: history.reputation };
        } catch (err) {
            ErrorLogger.log('PunishmentSystem_FullProcess', err);
            throw err;
        }
    },

    /**
     * Aplica a punição e atualiza a reputação no banco (Agora com ticket_id)
     */
    async applyPunishment(guildId, targetId, moderatorId, reason, severity, ticketId = 'N/A') {
        const pointsToSubtract = severity === 1 ? 10 : severity === 2 ? 25 : severity === 3 ? 40 : severity === 4 ? 60 : 100;
        const timestamp = Date.now(); // Salva em milissegundos (padrão JS)

        try {
            const transaction = db.transaction(() => {
                // Insere Histórico com a coluna ticket_id que criamos no init_db
                db.prepare(`
                    INSERT INTO punishments (guild_id, user_id, moderator_id, reason, severity, ticket_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(guildId, targetId, moderatorId, reason, severity, ticketId, timestamp);

                // Atualiza Reputação (Tabela correta: reputation)
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
                SELECT * FROM punishments 
                WHERE guild_id = ? AND user_id = ? 
                ORDER BY created_at DESC LIMIT ? OFFSET ?
            `).all(guildId, userId, limit, offset);

            const totalRow = db.prepare(`SELECT COUNT(*) as total FROM punishments WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
            const total = totalRow ? totalRow.total : 0;

            return { reputation, punishments, total, totalPages: Math.ceil(total / limit) };
        } catch (err) {
            ErrorLogger.log('PunishmentSystem_GetHistory', err);
            return { reputation: 100, punishments: [], total: 0, totalPages: 0 };
        }
    },

    generatePunishmentEmbed(data) {
        return new EmbedBuilder()
            .setColor(data.severity >= 4 ? 0xFF3C72 : 0xFFA500)
            .setDescription([
                `# ${EMOJIS.PUNIR || '⚖️'} Punição Aplicada`,
                `Um novo registro de infração foi adicionado ao sistema.`,
                '',
                `### 👤 Infrator`,
                `- **Usuário:** ${data.targetUser} (\`${data.targetUser.id}\`)`,
                `- **Reputação Final:** \`${data.reputation}/100 pts\``,
                '',
                `### 📝 Detalhes`,
                `- **Gravidade:** \`Nível ${data.severity}\``,
                `- **Ticket:** \`${data.ticketId}\``,
                `- **Motivo:** \`${data.reason}\``,
                '',
                `> O histórico completo pode ser visto com \`/historico\`.`
            ].join('\n'))
            .setTimestamp();
    },

    async dispatch(guild, embed, targetUser, logChannelId) {
        // Log para Staff
        if (logChannelId) {
            const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) await logChannel.send({ embeds: [embed] });
        }

        // DM para Player
        await targetUser.send({ 
            content: `⚠️ Você recebeu uma punição em **${guild.name}**`, 
            embeds: [embed] 
        }).catch(() => {});
    },

    // ... Mantenha suas funções de generateHistoryEmbed e Buttons como estão ...
    generateHistoryEmbed(targetUser, history, page) {
        const embed = new EmbedBuilder()
            .setAuthor({ name: `Histórico: ${targetUser.tag}`, iconURL: targetUser.displayAvatarURL() })
            .setColor(history.reputation < 50 ? 0xFF3C72 : 0x2ECC71)
            .setDescription([
                `# ${EMOJIS.REPUTATION} Ficha de Cadastro`,
                `- **Reputação:** \`${history.reputation}/100 pts\``,
                `- **Total de Registros:** \`${history.total}\``,
                '',
                `### 📝 Registros Recentes (Página ${page}/${history.totalPages})`
            ].join('\n'))
            .setFooter({ text: `Use os botões para navegar.` });

        if (history.punishments.length === 0) {
            embed.addFields({ name: 'Limpo', value: 'Nenhum registro encontrado.' });
        } else {
            history.punishments.forEach(p => {
                const date = p.created_at ? `<t:${Math.floor(p.created_at / 1000)}:d>` : 'N/A';
                embed.addFields({
                    name: `ID: #${p.id} | ${date}`,
                    value: `> **Motivo:** ${p.reason.substring(0, 60)}...\n> **Ticket:** \`${p.ticket_id || 'N/A'}\``
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
                .setLabel('⬅️ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(currentPage <= 1),
            new ButtonBuilder()
                .setCustomId(`hist_${targetId}_${currentPage + 1}`)
                .setLabel('Próxima ➡️').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages)
        );
    }
};

module.exports = PunishmentSystem;