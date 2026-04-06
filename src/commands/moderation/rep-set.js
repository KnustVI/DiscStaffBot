const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');
const EmbedFormatter = require('../../utils/embedFormatter');

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
            
            // Validar hierarquia
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
            
            // Gerar embed
            const color = isGain ? 0x00FF00 : 0xFF0000;
            const titleIcon = isGain ? `${emojis.up || '📈'}` : `${emojis.down || '📉'}`;
            const titleText = isGain ? 'REPUTAÇÃO AUMENTADA' : 'REPUTAÇÃO REDUZIDA';
            
            const description = [
                `# ${titleIcon} ${titleText}`,
                `## ${emojis.Note || '📝'} Motivo`,
                `\`\`\`text\n${reason}\n\`\`\``
            ].join('\n');
            
            const embed = new EmbedBuilder()
                .setColor(color)
                .setDescription(description)
                .setTimestamp();

                // Fields com formatação padronizada
            embed.addFields(
                { 
                    name: `${emojis.user || '👤'} Usuário:`, 
                    value: EmbedFormatter.formatUser(target, targetMember),
                    inline: true 
                },
                { 
                    name: `${emojis.staff || '👮'} Responsável:`, 
                    value: EmbedFormatter.formatUser(staff, staffMember),
                    inline: true 
                },
                { 
                    name: `${isGain ? '📈' : '📉'} Mudança:`, 
                    value: `${diffText} pts (${currentRep} → ${newPoints})`,
                    inline: true 
                },
                { 
                    name: `${emojis.star || '⭐'} Nova Reputação:`, 
                    value: `${newPoints}/100`,
                    inline: true 
                }
            );

            embed.setFooter(EmbedFormatter.getFooter(guild.name));
            
            // Enviar DM
            if (targetMember) {
                try {
                    await targetMember.send({ embeds: [embed] }).catch(() => null);
                } catch (err) {}
            }
            
            // Enviar log
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_punishments');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder(embed.toJSON());
                        logEmbed.setDescription(description + `\n\n## 👮 Responsável\n<@${staff.id}>`);
                        await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                    }
                } catch (err) {}
            }
            
            await ResponseManager.success(interaction, 
                `${titleIcon} **Reputação de ${target.username} ${titleText.toLowerCase()}**\n ${emojis.status} ${currentRep} → ${newPoints} (${diffText})`
            );
            
            console.log(`📊 [REPSET] ${staff.tag} ajustou ${target.tag} | ${diffText} pts | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            console.error('❌ Erro no repset:', error);
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao ajustar reputação.');
        }
    }
};