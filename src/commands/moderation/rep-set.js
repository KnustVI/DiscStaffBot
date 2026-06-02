// /home/ubuntu/DiscStaffBot/src/commands/moderation/repset.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');
const ContainerFormatter = require('../../utils/ContainerFormatter');

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
            
            const builder = ContainerFormatter.create(guild.name, isGain ? 0x00FF00 : 0xFF0000);
            builder.addTitle(`${titleIcon} ${titleText}`, 1);
            builder.addSeparator();
            builder.addText(`${emojis.Note || '📝'} **Motivo:**\n\`\`\`text\n${reason}\n\`\`\``);
            builder.addSeparator();
            builder.addText(`${emojis.user || '👤'} **Usuário:** ${target.tag} \`${target.id}\``);
            builder.addText(`${emojis.staff || '👮'} **Responsável:** ${staff.tag} \`${staff.id}\``);
            builder.addText(`${titleIcon} **Mudança:** ${diffText} pts (${currentRep} → ${newPoints})`);
            builder.addText(`${emojis.star || '⭐'} **Nova Reputação:** ${newPoints}/100`);
            builder.addFooter();
            
            if (targetMember) {
                try {
                    await targetMember.send({
                        components: [builder.build()],
                        flags: ['IsComponentsV2']
                    }).catch(() => null);
                } catch (err) {}
            }
            
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_punishments');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const logBuilder = ContainerFormatter.create(guild.name, isGain ? 0x00FF00 : 0xFF0000);
                        logBuilder.addTitle(`${titleIcon} ${titleText}`, 1);
                        logBuilder.addSeparator();
                        logBuilder.addText(`${emojis.Note || '📝'} **Motivo:**\n\`\`\`text\n${reason}\n\`\`\``);
                        logBuilder.addSeparator();
                        logBuilder.addText(`${emojis.user || '👤'} **Usuário:** ${target.tag} \`${target.id}\``);
                        logBuilder.addText(`${emojis.staff || '👮'} **Responsável:** ${staff.tag} \`${staff.id}\``);
                        logBuilder.addText(`${titleIcon} **Mudança:** ${diffText} pts (${currentRep} → ${newPoints})`);
                        logBuilder.addText(`${emojis.star || '⭐'} **Nova Reputação:** ${newPoints}/100`);
                        logBuilder.addFooter();
                        await logChannel.send({
                            components: [logBuilder.build()],
                            flags: ['IsComponentsV2']
                        }).catch(() => null);
                    }
                } catch (err) {}
            }
            
            await interaction.editReply({ 
                content: `${titleIcon} **Reputação de ${target.username} ${titleText.toLowerCase()}**\n${emojis.status} ${currentRep} → ${newPoints} (${diffText})`,
                components: []
            });
            
            console.log(`📊 [REPSET] ${staff.tag} ajustou ${target.tag} | ${diffText} pts | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            console.error('❌ Erro no repset:', error);
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao ajustar reputação.');
        }
    }
};