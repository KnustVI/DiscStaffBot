const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('globalrank')
        .setDescription('Exibe o Top 10 de reputação de TODOS os servidores'),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            // Busca os 10 maiores registros globais
            const topGlobal = db.prepare(`
                SELECT user_id, reputation 
                FROM users 
                ORDER BY reputation DESC 
                LIMIT 10
            `).all();

            if (topGlobal.length === 0) {
                return interaction.editReply("⚠️ Nenhum registro global encontrado.");
            }

            const medalhas = { 0: "💎", 1: "🌟", 2: "✨" }; // Medalhas diferentes para o Global
            let description = topGlobal.map((user, index) => {
                const medal = medalhas[index] || `**${index + 1}.**`;
                return `${medal} <@${user.user_id}> — **${user.reputation} Rep**`;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`🌍 Ranking Global de Reputação`)
                .setDescription(description)
                .setColor(0xff2e6c)
                .setFooter({ text: "Os melhores usuários de toda a rede!" })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.editReply("❌ Erro ao processar o ranking global.");
        }
    }
};