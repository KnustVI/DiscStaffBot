const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Exibe o Top 10 de reputação DESTE servidor'),

    async execute(interaction) {
        try {
            await interaction.deferReply();
            const guildId = interaction.guild.id;

            // Busca apenas usuários DESTE servidor
            const topRanking = db.prepare(`
                SELECT user_id, reputation 
                FROM users 
                WHERE guild_id = ?
                ORDER BY reputation DESC 
                LIMIT 10
            `).all(guildId);

            if (topRanking.length === 0) {
                return interaction.editReply("⚠️ Nenhum registro de reputação neste servidor.");
            }

            const medalhas = { 0: "🥇", 1: "🥈", 2: "🥉" };
            let description = topRanking.map((user, index) => {
                const medal = medalhas[index] || `**${index + 1}.**`;
                return `${medal} <@${user.user_id}> — **${user.reputation} Rep**`;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`🏆 Ranking Local: ${interaction.guild.name}`)
                .setDescription(description)
                .setColor(0xf2b705)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.editReply("❌ Erro ao processar o ranking local.");
        }
    }
};