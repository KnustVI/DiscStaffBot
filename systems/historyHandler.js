const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const PunishmentSystem = require('./punishmentSystem');
const { EMOJIS } = require('../database/emojis');

const HistoryHandler = {
    async handle(interaction, args) {
        const targetId = args[1];
        const page = parseInt(args[2]) || 1;
        const guildId = interaction.guild.id;

        try {
            // Busca os dados no sistema de punição
            const history = await PunishmentSystem.getUserHistory(guildId, targetId, page);
            const targetUser = await interaction.client.users.fetch(targetId);

            // Gera a interface
            const embed = this.generateEmbed(guildId, targetUser, history, page);
            const buttons = this.generateButtons(targetId, page, history.totalPages);

            // Se a interação for um botão, usamos o update
            if (interaction.isButton()) {
                await interaction.update({ embeds: [embed], components: [buttons] });
            } else {
                await interaction.reply({ embeds: [embed], components: [buttons], ephemeral: true });
            }

        } catch (err) {
            console.error("[HistoryHandler Error]", err);
            const errorMsg = { content: "❌ Erro ao processar histórico.", ephemeral: true };
            interaction.replied || interaction.deferred ? await interaction.followUp(errorMsg) : await interaction.reply(errorMsg);
        }
    },

    generateEmbed(guildId, user, history, page) {
        const embed = new EmbedBuilder()
            .setAuthor({ name: `Histórico de ${user.tag}`, iconURL: user.displayAvatarURL() })
            .setColor(history.reputation < 50 ? 0xFF0000 : 0x00FF00)
            .setDescription(`${EMOJIS.REPUTATION} **Reputação Atual:** \`${history.reputation}/100\``)
            .setFooter({ text: `Página ${page} de ${history.totalPages} • Total: ${history.total}` });

        if (history.punishments.length === 0) {
            embed.addFields({ name: 'Clean!', value: 'Este usuário não possui registros negativos.' });
        } else {
            history.punishments.forEach(p => {
                const date = new Date(p.created_at).toLocaleDateString('pt-BR');
                const status = p.severity === 0 ? '~~REVOGADA~~' : `Nível ${p.severity}`;
                embed.addFields({
                    name: `ID: #${p.id} | ${date}`,
                    value: `**Status:** ${status}\n**Motivo:** ${p.reason}\n**Staff:** <@${p.moderator_id}>`
                });
            });
        }
        return embed;
    },

    generateButtons(targetId, currentPage, totalPages) {
        const row = new ActionRowBuilder();

        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`hist_${targetId}_${currentPage - 1}`)
                .setLabel('⬅️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage <= 1),
            new ButtonBuilder()
                .setCustomId(`hist_${targetId}_${currentPage + 1}`)
                .setLabel('➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage >= totalPages)
        );

        return row;
    }
};

module.exports = HistoryHandler;