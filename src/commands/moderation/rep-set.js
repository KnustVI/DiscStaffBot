// /home/ubuntu/DiscStaffBot/src/commands/moderation/repset.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');
const imageManager = require('../../utils/imageManager');

// ---------------------------------------------------------------------------
// Montagem visual — separada para reaproveitar entre DM e canal de log
// ---------------------------------------------------------------------------

function buildRepSetContainer({ target, staff, reason, diffText, currentRep, newPoints, isGain, emojis }) {
    const titleIcon = isGain ? `${emojis.up || '📈'}` : `${emojis.down || '📉'}`;
    const titleText = isGain ? 'REPUTAÇÃO AUMENTADA' : 'REPUTAÇÃO REDUZIDA';

    const builder = new AdvancedContainerBuilder({ accentColor: isGain ? 0x00FF00 : 0xFF0000 });

    // ── Banner de título — pré-configurado para 'TITLE REPSET.png'.
    // Só adiciona se o arquivo existir de fato em assets/images; até lá,
    // o container funciona normalmente sem banner. ─────────────────────────
    const bannerUrl = imageManager.getUrl('title_repset');
    if (bannerUrl) {
        builder.gallery([bannerUrl]);
        builder.separator();
    }

    // ── Apresentação padrão: Moderador primeiro, logo após o banner ─────────
    const staffAvatar = staff.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
    builder.section(
        `## STAFF RESPONSAVEL\n${staff.toString()}\n${staff.username}\n(\`${staff.id}\`)`,
        AdvancedContainerBuilder.thumbnail(staffAvatar),
    );
    builder.separator();

    // ── Apresentação padrão: Usuário alvo do ajuste ──────────────────────────
    const targetAvatar = target.displayAvatarURL({ size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
    builder.section(
        `## JOGADOR\n${target.toString()}\n${target.username}\n(\`${target.id}\`)`,
        AdvancedContainerBuilder.thumbnail(targetAvatar),
    );
    builder.separator();

    builder.title(`${titleIcon} ${titleText}`, 1);
    builder.separator();
    builder.text(`${emojis.Note || '📝'} **Motivo:**\n\`\`\`text\n${reason}\n\`\`\``);
    builder.separator();
    builder.text(`${titleIcon} **Mudança:** ${diffText} pts (${currentRep} → ${newPoints})`);
    builder.text(`${emojis.star || '⭐'} **Nova Reputação:** ${newPoints}/100`);
    builder.footer(`Server: ${guild.name}`);

    return builder;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('repset')
        .setDescription('Ajusta manualmente os pontos de reputação.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Alvo').setRequired(true))
        .addIntegerOption(opt => opt.setName('pontos').setDescription('Nova pontuação (0-100)').setRequired(true).setMinValue(0).setMaxValue(100))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do ajuste').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, options, user: staff, member: staffMember } = interaction;
        const guildId = guild.id;
        
        const target = options.getUser('usuario');
        const newPoints = options.getInteger('pontos');
        const reason = options.getString('motivo');
        
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {}
        
        try {
            if (!target) {
                return await ResponseManager.error(interaction, 'Usuário não encontrado.');
            }
            
            db.ensureUser(staff.id, staff.username, staff.discriminator, staff.avatar);
            db.ensureUser(target.id, target.username, target.discriminator, target.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            const ConfigSystem = require('../../systems/configSystem');
            
            let targetMember = null;
            try {
                targetMember = await guild.members.fetch(target.id).catch(() => null);
            } catch (err) {}
            
            const isStaffHigher = targetMember && 
                targetMember.roles.highest.position >= staffMember.roles.highest.position && 
                staff.id !== guild.ownerId;
            
            if (isStaffHigher) {
                return await ResponseManager.error(interaction, 'Você não pode ajustar a reputação de um cargo superior.');
            }
            
            const currentRep = ConfigSystem.getSetting(guildId, `rep_${target.id}`) || 
                db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, target.id)?.points || 100;
            
            const diff = newPoints - currentRep;
            const diffText = diff >= 0 ? `+${diff}` : `${diff}`;
            const isGain = diff >= 0;
            
            db.prepare(`INSERT INTO reputation (guild_id, user_id, points, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id) 
                DO UPDATE SET points = ?, updated_at = ?, updated_by = ?`)
                .run(guildId, target.id, newPoints, Date.now(), staff.id, newPoints, Date.now(), staff.id);
            
            ConfigSystem.clearCache(guildId);
            
            db.logActivity(guildId, staff.id, 'rep_set', target.id, {
                oldPoints: currentRep, newPoints, diff, reason
            });
            
            await AnalyticsSystem.updateStaffAnalytics(guildId, staff.id);
            
            const titleIcon = isGain ? `${emojis.up || '📈'}` : `${emojis.down || '📉'}`;
            const titleText = isGain ? 'REPUTAÇÃO AUMENTADA' : 'REPUTAÇÃO REDUZIDA';

            const containerBuilder = buildRepSetContainer({
                target, staff, reason, diffText, currentRep, newPoints, isGain, emojis,
            });
            const { components, flags } = containerBuilder.build();

            // ── Banner de título: attachment buscado uma vez, reenviado em
            // toda mensagem que usa este container (DM e canal de log) ────────
            const bannerAttachment = imageManager.getAttachment('title_repset');
            const filesPayload = bannerAttachment ? [bannerAttachment] : [];

            // ── DM do usuário — captura o resultado REAL do envio (não engole
            // o erro), mesmo padrão aplicado em /strike e /unstrike. ───────────
            let dmDelivered = false;
            if (targetMember) {
                try {
                    await targetMember.send({ components, flags: [flags], files: filesPayload });
                    dmDelivered = true;
                } catch (err) {
                    // Erro 50007 = "Cannot send messages to this user" → DMs bloqueadas/fechadas.
                    dmDelivered = false;
                    console.warn(`⚠️ [REPSET] Não foi possível enviar DM para ${target.tag}: ${err.message}`);
                }
            }
            
            // ── Log no canal configurado (log_punishments) ──────────────────────
            let logSent = false;
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_punishments');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        await logChannel.send({ components, flags: [flags], files: filesPayload });
                        logSent = true;
                    } else {
                        console.warn(`⚠️ [REPSET] Canal de log de punições (${logChannelId}) não encontrado/acessível.`);
                    }
                } catch (err) {
                    console.error('❌ Erro ao enviar log de ajuste de reputação:', err);
                }
            } else {
                console.warn(`⚠️ [REPSET] Canal de log de punições não configurado para a guild ${guildId}.`);
            }

            // ── Monta o aviso para o staff que ajustou a reputação ──────────────
            const dmStatusMsg = dmDelivered
                ? `${emojis.Check || '✅'} O jogador foi notificado em sua DM.`
                : `${emojis.Error || '❌'} O jogador tem as DM bloqueadas e não recebeu a notificação do ajuste.`;

            const summaryLines = [
                `${titleIcon} **Reputação de ${target.username} ${titleText.toLowerCase()}**`,
                `${emojis.status || '📊'} ${currentRep} → ${newPoints} (${diffText})`,
                dmStatusMsg,
            ];
            if (!logSent) summaryLines.push(`${emojis.Warning || '⚠️'} A mensagem de log não foi enviada ao canal (verifique a configuração em /config-logs).`);

            await interaction.editReply({ 
                content: summaryLines.join('\n'),
                components: []
            });
            
            console.log(`📊 [REPSET] ${staff.tag} ajustou ${target.tag} | ${diffText} pts | DM:${dmDelivered} | Log:${logSent} | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            console.error('❌ Erro no repset:', error);
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao ajustar reputação.');
        }
    }
};