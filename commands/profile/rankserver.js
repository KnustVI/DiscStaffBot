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

            // Busca os 10 melhores apenas DESTE servidor
            const topRanking = db.prepare(`
                SELECT user_id, reputation 
                FROM users 
                WHERE guild_id = ?
                ORDER BY reputation DESC 
                LIMIT 10
            `).all(guildId);

            if (topRanking.length === 0) {
                return interaction.editReply("⚠️ Nenhum registro de reputação encontrado neste servidor.");
            }

            const medalhas = { 0: "🥇", 1: "🥈", 2: "🥉" };
            
            const list = topRanking.map((user, index) => {
                const position = medalhas[index] || `**${index + 1}º**`;
                // Menção simples para evitar carregar membros desnecessários, 
                // o Discord resolve o nome automaticamente no client.
                return `${position} <@${user.user_id}> — \`${user.reputation} pts\``;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setColor(0xf2b705) // Cor dourada para o ranking
                .setDescription(
                    `# 🏆 Melhores do Servidor | ${interaction.guild.name}`+
                    `Confira os jogadores com melhor conduta na nossa comunidade:\n\n${list}`+
                    "📍 O ranking é atualizado em tempo real e é local."
                )
                .setFooter({ 
                text: interaction.guild.name, 
                iconURL: interaction.guild
                .iconURL({ dynamic: true })})
                .setTimestamp();
                
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error("Erro no comando rank:", error);
            await interaction.editReply("❌ Erro ao processar o ranking local.");
        }
    }
};