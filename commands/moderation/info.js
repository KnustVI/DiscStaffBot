const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('Consulta técnica de um usuário no banco de dados.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário para consulta').setRequired(true)),

    async execute(interaction) {
        const target = interaction.options.getUser('usuario');
        const guildId = interaction.guild.id;

        // Consultas de dados do usuário (Isso continua no DB pois muda sempre)
        const userData = db.prepare(`SELECT * FROM users WHERE user_id = ? AND guild_id = ?`).get(target.id, guildId);
        const lastPunishments = db.prepare(`
            SELECT * FROM punishments 
            WHERE user_id = ? AND guild_id = ? 
            ORDER BY created_at DESC LIMIT 3
        `).all(target.id, guildId);

        if (!userData && lastPunishments.length === 0) {
            return interaction.reply({ content: `${EMOJIS.AVISO} Este usuário não possui nenhum registro.`, ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setAuthor({ name: `Dossiê: ${target.username}`, iconURL: target.displayAvatarURL() })
            .setColor(0x2B2D31)
            .addFields(
                { name: `${EMOJIS.REPUTATION} Reputação`, value: `\`${userData?.reputation ?? 100}/100\``, inline: true },
                { name: `${EMOJIS.STATUS} Punições`, value: `\`${userData?.penalties ?? 0}\``, inline: true },
                { name: `${EMOJIS.STAFF} Última Atividade`, value: userData?.last_penalty ? `<t:${Math.floor(userData.last_penalty / 1000)}:R>` : '\`Nunca\`', inline: true }
            );

        if (lastPunishments.length > 0) {
            const historyText = lastPunishments.map(p => 
                `${p.severity === 0 ? EMOJIS.UP : EMOJIS.DOWN} **ID #${p.id}**: ${p.reason.substring(0, 30)}...`
            ).join('\n');
            embed.addFields({ name: `${EMOJIS.NOTE} Últimos Registros`, value: historyText });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};