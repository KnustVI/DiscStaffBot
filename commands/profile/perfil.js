const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

// --- Funções Utilitárias ---
function progressBar(value, max = 100) {
    const size = 10;
    const filledCount = Math.min(size, Math.max(0, Math.round((value / max) * size)));
    const emptyCount = size - filledCount;
    const bar = "█".repeat(filledCount) + "░".repeat(emptyCount);
    return `\`${bar}\` **${value}/${max}**`;
}

function getStatus(rep) {
    if (rep >= 90) return "🏆 Exemplar";
    if (rep >= 70) return "👍 Bom";
    if (rep >= 50) return "⚠️ Observação";
    if (rep >= 30) return "❗ Problemático";
    return "🚨 Crítico";
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('perfil')
        .setDescription('Exibe o perfil de reputação e estatísticas de um usuário.')
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Selecione o usuário (opcional)')
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            const targetUser = interaction.options.getUser('usuario') || interaction.user;
            
            // CORREÇÃO: Removido guild_id pois a tabela 'users' não possui essa coluna
            const userData = db.prepare('SELECT * FROM users WHERE user_id = ?').get(targetUser.id);

            if (!userData) {
                return interaction.editReply({
                    content: `❌ **${targetUser.username}** ainda não possui registros no sistema.`
                });
            }

            const reputation = userData.reputation ?? 100;
            const penalties = userData.penalties ?? 0;
            const lastPenalty = userData.last_penalty;

            // CÁLCULO DE DIAS
            const daysWithoutPenalty = lastPenalty
                ? Math.floor((Date.now() - lastPenalty) / (1000 * 60 * 60 * 24))
                : "∞";

            // RANKING: Global do bot (já que reputação é por usuário)
            const ranking = db.prepare('SELECT user_id FROM users ORDER BY reputation DESC').all();
            const position = ranking.findIndex(u => u.user_id === targetUser.id) + 1;

            const targetGoal = 90;
            const currentProgress = Math.min(reputation, targetGoal);

            const embed = new EmbedBuilder()
                .setTitle(`🏆 Perfil de Reputação: ${targetUser.username}`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .setColor(reputation > 50 ? 0xf2b705 : 0xff0000)
                .addFields(
                    { name: "🏅 Reputação", value: `**${reputation}**/100`, inline: true },
                    { name: "⚖️ Punições", value: `\`${penalties}\``, inline: true },
                    { name: "⏳ Limpo há", value: `\`${daysWithoutPenalty === "∞" ? "Sempre limpo" : daysWithoutPenalty + " dias"}\``, inline: true },
                    { name: "📊 Ranking Global", value: `**#${position}** de ${ranking.length}`, inline: true },
                    { name: "🛡️ Status", value: getStatus(reputation), inline: true },
                    { name: '\u200B', value: '\u200B', inline: true },
                    { 
                        name: "📈 Barra de Reputação", 
                        value: progressBar(reputation, 100), 
                        inline: false 
                    },
                    { 
                        name: `🎯 Próximo Objetivo: ${getStatus(targetGoal)}`, 
                        value: progressBar(currentProgress, targetGoal), 
                        inline: false 
                    }
                )
                .setFooter({ text: `ID: ${targetUser.id}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(`Erro no comando perfil:`, error);
            await interaction.editReply("❌ Ocorreu um erro interno ao processar o perfil.");
        }
    }
};