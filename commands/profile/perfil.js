const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const db = require('../../database/database');
const { createCanvas } = require('canvas');

// --- Funções Utilitárias ---
function createProgressBarImage(value, max) {
    const width = 400;
    const height = 40;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const progress = Math.min(value, max) / max;
    const progressWidth = Math.max(10, width * progress);

    const cornerRadius = height / 2;
    ctx.beginPath();
    ctx.moveTo(cornerRadius, 0);
    ctx.lineTo(width - cornerRadius, 0);
    ctx.quadraticCurveTo(width, 0, width, cornerRadius);
    ctx.quadraticCurveTo(width, height, width - cornerRadius, height);
    ctx.lineTo(cornerRadius, height);
    ctx.quadraticCurveTo(0, height, 0, cornerRadius);
    ctx.quadraticCurveTo(0, 0, cornerRadius, 0);
    ctx.closePath();
    ctx.fillStyle = '#f3f4f6';
    ctx.fill();

    if (progressWidth > 0) {
        ctx.beginPath();
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#10b981');
        gradient.addColorStop(1, '#34d399');
        ctx.fillStyle = gradient;

        const endRadius = progressWidth < height / 2 ? progressWidth : height / 2;
        ctx.moveTo(cornerRadius, 0);
        ctx.lineTo(progressWidth - endRadius, 0);
        ctx.quadraticCurveTo(progressWidth, 0, progressWidth, endRadius);
        ctx.quadraticCurveTo(progressWidth, height, progressWidth - endRadius, height);
        ctx.lineTo(cornerRadius, height);
        ctx.quadraticCurveTo(0, height, 0, cornerRadius);
        ctx.quadraticCurveTo(0, 0, cornerRadius, 0);
        ctx.closePath();
        ctx.fill();
    }
    return canvas.toBuffer();
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
                .setDescription('Selecione o usuário para ver o perfil')
                .setRequired(false)
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            // --- CORREÇÃO AQUI: Captura a opção do usuário ou usa quem chamou o comando ---
            const targetUser = interaction.options.getUser('usuario') || interaction.user;
            const guildId = interaction.guild.id;
            
            const userData = db.prepare('SELECT * FROM users WHERE user_id = ? AND guild_id = ?').get(targetUser.id, guildId);

            if (!userData) {
                const visitorEmbed = new EmbedBuilder()
                    .setTitle(`👤 Perfil: ${targetUser.username}`)
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                    .setColor(0x2b2d31) 
                    .setDescription(`\n> ✨ **Este usuário ainda não passou pelo nosso BOT.**\n\nA reputação inicial é **100**. Registros aparecerão aqui em breve.`)
                    .addFields(
                        { name: "🏅 Reputação Base", value: `**100**/100`, inline: true },
                        { name: "🛡️ Status", value: "👍 Bom", inline: true }
                    )
                    .setFooter({ text: `Consultado em: ${interaction.guild.name}` })
                    .setTimestamp();

                return interaction.editReply({ embeds: [visitorEmbed] });
            }

            const reputation = userData.reputation ?? 100;
            const penalties = userData.penalties ?? 0;
            const lastPenalty = userData.last_penalty;

            const daysWithoutPenalty = lastPenalty
                ? Math.floor((Date.now() - lastPenalty) / (1000 * 60 * 60 * 24))
                : "∞";

            const localRanking = db.prepare('SELECT user_id FROM users WHERE guild_id = ? ORDER BY reputation DESC').all(guildId);
            const localPos = localRanking.findIndex(u => u.user_id === targetUser.id) + 1;

            const globalRanking = db.prepare('SELECT user_id FROM users ORDER BY reputation DESC').all();
            const globalPos = globalRanking.findIndex(u => u.user_id === targetUser.id && u.guild_id === guildId) + 1;

            const progressBarBuffer = createProgressBarImage(reputation, 100);
            const attachment = new AttachmentBuilder(progressBarBuffer, { name: 'progress.png' });

            const embed = new EmbedBuilder()
                .setTitle(`👤 Perfil: ${targetUser.username}`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .setColor(reputation >= 90 ? 0xf2b705 : (reputation >= 50 ? 0x10b981 : 0xff0000))
                .addFields(
                    { name: "🏅 Reputação", value: `**${reputation}**/100`, inline: true },
                    { name: "⚖️ Punições", value: `\`${penalties}\``, inline: true },
                    { name: "⏳ Limpo há", value: `\`${daysWithoutPenalty === "∞" ? "Sempre" : daysWithoutPenalty + " dias"}\``, inline: true },
                    { name: "🏠 Rank Local", value: `**#${localPos}** / ${localRanking.length}`, inline: true },
                    { name: "🌍 Rank Global", value: `**#${globalPos}** / ${globalRanking.length}`, inline: true },
                    { name: "🛡️ Status", value: getStatus(reputation), inline: true },
                    { 
                        name: "📈 Barra de Reputação", 
                        value: '\u200B', 
                        inline: false 
                    }
                )
                .setImage('attachment://progress.png')
                .setFooter({ text: `Consultado em: ${interaction.guild.name}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed], files: [attachment] });

        } catch (error) {
            console.error(`Erro no comando perfil:`, error);
            await interaction.editReply("❌ Erro interno ao processar o perfil.");
        }
    }
};