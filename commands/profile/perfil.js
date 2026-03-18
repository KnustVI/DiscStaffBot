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
        const colorMain = value >= 70 ? '#10b981' : (value >= 40 ? '#f59e0b' : '#ef4444');
        const colorSub = value >= 70 ? '#34d399' : (value >= 40 ? '#fbbf24' : '#f87171');
        
        gradient.addColorStop(0, colorMain);
        gradient.addColorStop(1, colorSub);
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
        .setDescription('Exibe sua reputação e estatísticas neste servidor.')
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Selecione o usuário para ver o perfil')
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            const targetUser = interaction.options.getUser('usuario') || interaction.user;
            const guildId = interaction.guild.id;
            
            const userData = db.prepare('SELECT * FROM users WHERE user_id = ? AND guild_id = ?').get(targetUser.id, guildId);

            if (!userData) {
                const visitorEmbed = new EmbedBuilder()
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                    .setColor(0x2b2d31) 
                    .setDescription(`# 👤 Perfil: ${targetUser.username}\n`+
                        `✨ **Este usuário ainda não possui registros.**\n`
                        `- A reputação neste servidor começa em **100**.`)
                    .addFields(
                        { name: "🏅 Reputação", value: `**100**/100`, inline: true },
                        { name: "🛡️ Status", value: "👍 Bom", inline: true }
                    )
                    .setFooter({ 
                    text: interaction.guild.name, 
                    iconURL: interaction.guild
                    .iconURL({ dynamic: true }) })
                    .setTimestamp();

                return interaction.editReply({ embeds: [visitorEmbed] });
            }

            const reputation = userData.reputation ?? 100;
            const penalties = userData.penalties ?? 0;
            const lastPenalty = userData.last_penalty;

            // Cálculo de tempo sem punição
            const diffMs = lastPenalty ? Date.now() - lastPenalty : null;
            const daysWithoutPenalty = diffMs ? Math.floor(diffMs / (1000 * 60 * 60 * 24)) : "∞";

            // Lógica de Recuperação Diária
            let recoveryStatus = "✅ Reputação Máxima";
            if (reputation < 100) {
                // Se o bot roda todo dia às 00:00, mostramos quanto falta para o próximo dia
                const now = new Date();
                const tomorrow = new Date(now);
                tomorrow.setDate(now.getDate() + 1);
                tomorrow.setHours(0, 0, 0, 0);
                const hoursLeft = Math.floor((tomorrow - now) / (1000 * 60 * 60));
                
                recoveryStatus = `📈 +1 pt em ~${hoursLeft}h`;
                
                // Se foi punido nas últimas 24h, ele não recupera hoje
                if (diffMs && diffMs < (24 * 60 * 60 * 1000)) {
                    recoveryStatus = "⏳ Pausada (Punido recentemente)";
                }
            }

            const localRanking = db.prepare('SELECT user_id FROM users WHERE guild_id = ? ORDER BY reputation DESC').all(guildId);
            const localPos = localRanking.findIndex(u => u.user_id === targetUser.id) + 1;

            const progressBarBuffer = createProgressBarImage(reputation, 100);
            const attachment = new AttachmentBuilder(progressBarBuffer, { name: 'progress.png' });

            const embed = new EmbedBuilder()
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .setColor(reputation >= 90 ? 0xf2b705 : (reputation >= 50 ? 0x10b981 : 0xff0000))
                .setDescription(
                    `# 👤 Perfil: ${targetUser.username}`+
                    `Estatísticas de comportamento em **${interaction.guild.name}**.\n`+
                    `📍 Estes dados são restritos a este servidor.` ,
                )
                .addFields(
                    { name: "🏅 Reputação", value: `**${reputation}**/100`, inline: true },
                    { name: "⚖️ Punições", value: `\`${penalties}\``, inline: true },
                    { name: "⏳ Limpo há", value: `\`${daysWithoutPenalty === "∞" ? "Sempre" : daysWithoutPenalty + " dias"}\``, inline: true },
                    { name: "🏠 Rank Local", value: `**#${localPos}** de ${localRanking.length}`, inline: true },
                    { name: "🛡️ Status", value: getStatus(reputation), inline: true },
                    { name: "🔄 Recuperação", value: `\`${recoveryStatus}\``, inline: true },
                    { 
                        name: "📈 Barra de Integridade", 
                        value: '\u200B', 
                        inline: false 
                    }
                )
                .setImage('attachment://progress.png')
                .setFooter({ 
                text: interaction.guild.name, 
                iconURL: interaction.guild
                .iconURL({ dynamic: true })})
                .setTimestamp();
                

            await interaction.editReply({ embeds: [embed], files: [attachment] });

        } catch (error) {
            console.error(error);
            await interaction.editReply("❌ Erro ao carregar perfil.");
        }
    }
};