const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/database');
const { createCanvas } = require('canvas');
const { EMOJIS } = require('../../database/emojis');

// --- Funções Utilitárias de Design (Mantidas) ---
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
    if (rep >= 90) return `${EMOJIS.EXCELLENT} Exemplar`;
    if (rep >= 70) return `${EMOJIS.GOOD} Bom`;
    if (rep >= 50) return `${EMOJIS.OBSERVATION} Observação`;
    if (rep >= 30) return `${EMOJIS.PROBLEMATIC} Problemático`;
    return `${EMOJIS.CRITIC} Crítico`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reputação')
        .setDescription('Exibe a reputação e estatísticas detalhadas.')
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Selecione o usuário para ver o perfil (Restrito à Staff)')
        ),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('usuario') || interaction.user;
        const guildId = interaction.guild.id;

        // --- 1. VERIFICAÇÃO DE PRIVACIDADE ---
        if (targetUser.id !== interaction.user.id) {
            const staffRoleSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guildId);
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
            const hasStaffRole = staffRoleSetting ? interaction.member.roles.cache.has(staffRoleSetting.value) : false;

            if (!isAdmin && !hasStaffRole) {
                return interaction.reply({ 
                    content: `${EMOJIS.AVISO} Você só pode ver a sua própria reputação. A consulta de terceiros é restrita à Staff.`, 
                    ephemeral: true 
                });
            }
        }

        try {
            await interaction.deferReply();

            const userData = db.prepare('SELECT * FROM users WHERE user_id = ? AND guild_id = ?').get(targetUser.id, guildId);

            // --- CÁLCULOS DE REPUTAÇÃO ---
            const reputation = userData?.reputation ?? 100;
            const penalties = userData?.penalties ?? 0;
            const lastPenalty = userData?.last_penalty;

            const diffMs = lastPenalty ? Date.now() - lastPenalty : null;
            const daysWithoutPenalty = diffMs ? Math.floor(diffMs / (1000 * 60 * 60 * 24)) : "∞";

            // Lógica de Recuperação alinhada ao Automod (03:00h)
            let recoveryStatus = `${EMOJIS.EXCELLENT} Máxima`;
            if (reputation < 100) {
                const now = new Date();
                const nextRun = new Date();
                nextRun.setHours(3, 0, 0, 0);
                if (now.getHours() >= 3) nextRun.setDate(now.getDate() + 1);
                
                const timeLeft = nextRun - now;
                const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
                
                recoveryStatus = `${EMOJIS.UP} +1 pt em ~${hoursLeft}h`;
                
                // Se foi punido há menos de 24h, a recuperação fica pausada
                if (diffMs && diffMs < (24 * 60 * 60 * 1000)) {
                    recoveryStatus = `${EMOJIS.PAUSE} Pausada`;
                }
            }

            // --- RANKING E CANVAS ---
            const localRanking = db.prepare('SELECT user_id FROM users WHERE guild_id = ? ORDER BY reputation DESC').all(guildId);
            const localPos = localRanking.findIndex(u => u.user_id === targetUser.id) + 1 || localRanking.length + 1;

            const progressBarBuffer = createProgressBarImage(reputation, 100);
            const attachment = new AttachmentBuilder(progressBarBuffer, { name: 'progress.png' });

            const embed = new EmbedBuilder()
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .setColor(reputation >= 90 ? 0x10b981 : (reputation >= 50 ? 0xf59e0b : 0xef4444))
                .setDescription(
                    `# ${EMOJIS.USUARIO} ${targetUser.displayName}\n` +
                    `Estatísticas de comportamento em **${interaction.guild.name}**.\n` +
                    `${EMOJIS.SERVER} Registros locais protegidos.` 
                )
                .addFields(
                    { name: `${EMOJIS.REPUTATION} Reputação`, value: `**${reputation}**/100`, inline: true },
                    { name: `${EMOJIS.DOWN} Punições`, value: `**${penalties}**`, inline: true },
                    { name: `${EMOJIS.DATE} Limpo há`, value: `**${daysWithoutPenalty === "∞" ? "Sempre" : daysWithoutPenalty + " dias"}**`, inline: true },
                    { name: `${EMOJIS.RANK} Rank Local`, value: `**#${localPos}** de ${localRanking.length || 1}`, inline: true },
                    { name: `${EMOJIS.STATUS} Status`, value: getStatus(reputation), inline: true },
                    { name: `${EMOJIS.UP} Recuperação`, value: recoveryStatus, inline: true },
                    { name: `${EMOJIS.REPUTATION} Barra de Integridade`, value: '\u200B', inline: false }
                )
                .setImage('attachment://progress.png')
                .setFooter({ 
                    text: `✧ BOT by: KnustVI`, 
                    iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' 
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed], files: [attachment] });

        } catch (error) {
            console.error("Erro no comando perfil:", error);
            if (interaction.deferred) await interaction.editReply(`${EMOJIS.ERRO} Erro ao carregar perfil.`);
        }
    }
};