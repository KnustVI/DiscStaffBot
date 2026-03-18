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
            const guildId = interaction.guild.id;
            
            // 1. Busca os dados específicos
            const userData = db.prepare('SELECT * FROM users WHERE user_id = ? AND guild_id = ?').get(targetUser.id, guildId);

            // --- CASO O USUÁRIO NÃO TENHA REGISTRO ---
            if (!userData) {
                const visitorEmbed = new EmbedBuilder()
                    .setTitle(`👤 Perfil: ${targetUser.username}`)
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                    .setColor(0x2b2d31) // Cor neutra
                    .setDescription(`\n> ✨ **Este usuário ainda não passou pelo nosso BOT.**\n\nA reputação inicial de todo jogador é **100**. Registros de punições e estatísticas aparecerão aqui assim que a primeira ação for registrada.`)
                    .addFields(
                        { name: "🏅 Reputação Base", value: `**100**/100`, inline: true },
                        { name: "🛡️ Status Inicial", value: "👍 Bom", inline: true }
                    )
                    .setFooter({ text: `Consultado em: ${interaction.guild.name}` })
                    .setTimestamp();

                return interaction.editReply({ embeds: [visitorEmbed] });
            }

            // --- CASO O USUÁRIO TENHA REGISTRO (Lógica normal) ---
            const reputation = userData.reputation ?? 100;
            const penalties = userData.penalties ?? 0;
            const lastPenalty = userData.last_penalty;

            const daysWithoutPenalty = lastPenalty
                ? Math.floor((Date.now() - lastPenalty) / (1000 * 60 * 60 * 24))
                : "∞";

            // Rankings
            const localRanking = db.prepare('SELECT user_id FROM users WHERE guild_id = ? ORDER BY reputation DESC').all(guildId);
            const localPos = localRanking.findIndex(u => u.user_id === targetUser.id) + 1;

            const globalRanking = db.prepare('SELECT user_id, guild_id FROM users ORDER BY reputation DESC').all();
            const globalPos = globalRanking.findIndex(u => u.user_id === targetUser.id && u.guild_id === guildId) + 1;

            const targetGoal = 90;
            const currentProgress = Math.min(reputation, targetGoal);

            const embed = new EmbedBuilder()
                .setTitle(`👤 Perfil: ${targetUser.username}`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .setColor(reputation > 50 ? 0xf2b705 : 0xff0000)
                .addFields(
                    { name: "🏅 Reputação", value: `**${reputation}**/100`, inline: true },
                    { name: "⚖️ Punições", value: `\`${penalties}\``, inline: true },
                    { name: "⏳ Limpo há", value: `\`${daysWithoutPenalty === "∞" ? "Sempre" : daysWithoutPenalty + " dias"}\``, inline: true },
                    { name: "🏠 Rank Local", value: `**#${localPos}** / ${localRanking.length}`, inline: true },
                    { name: "🌍 Rank Global", value: `**#${globalPos}** / ${globalRanking.length}`, inline: true },
                    { name: "🛡️ Status", value: getStatus(reputation), inline: true },
                    { 
                        name: "📈 Barra de Reputação", 
                        value: progressBar(reputation, 100), 
                        inline: false 
                    },
                    { 
                        name: `🎯 Próximo Nível: ${getStatus(targetGoal)}`, 
                        value: progressBar(currentProgress, targetGoal), 
                        inline: false 
                    }
                )
                .setFooter({ text: `Consultado em: ${interaction.guild.name}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(`Erro no comando perfil:`, error);
            await interaction.editReply("❌ Erro interno ao processar o perfil.");
        }
    }
};