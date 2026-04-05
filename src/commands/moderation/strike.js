const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('strike')
        .setDescription('Aplica uma punição rápida e remove pontos de reputação.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(opt => opt.setName('usuario').setDescription('Membro infrator').setRequired(true))
        .addIntegerOption(opt => opt.setName('gravidade').setDescription('Nível da infração').setRequired(true)
            .addChoices(
                { name: 'Nível 1 (-10 pts)', value: 1 },
                { name: 'Nível 2 (-25 pts)', value: 2 },
                { name: 'Nível 3 (-40 pts)', value: 3 },
                { name: 'Nível 4 (-60 pts)', value: 4 },
                { name: 'Nível 5 (-100 pts)', value: 5 }
            ))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da punição').setRequired(true))
        .addStringOption(opt => opt.setName('duracao').setDescription('Tempo (Ex: 10m, 1h, 3d, 0 para Perm)').setRequired(true))
        .addStringOption(opt => opt.setName('ticket').setDescription('ID do Ticket (Opcional)').setRequired(false))
        .addStringOption(opt => opt.setName('discord_act').setDescription('Ação imediata no Discord')
            .addChoices(
                { name: 'Nenhuma', value: 'none' },
                { name: 'Mute (Timeout)', value: 'timeout' },
                { name: 'Expulsar (Kick)', value: 'kick' },
                { name: 'Banir (Ban)', value: 'ban' }
            ))
        .addStringOption(opt => opt.setName('jogo_act').setDescription('Ação imediata In-Game')
            .addChoices(
                { name: 'Nenhuma', value: 'none' },
                { name: 'Aviso na Tela', value: 'rcon_warn' },
                { name: 'Kick do Jogo', value: 'rcon_kick' },
                { name: 'Slay (Matar)', value: 'rcon_slay' },
                { name: 'Ban do Jogo', value: 'rcon_ban' }
            )),

    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, options, channel, user: staff, member: staffMember } = interaction;
        const guildId = guild.id;
        
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        const targetUser = options.getUser('usuario');
        const severity = options.getInteger('gravidade');
        const reason = options.getString('motivo');
        const durationStr = options.getString('duracao');
        const discordAct = options.getString('discord_act') || 'none';
        const jogoAct = options.getString('jogo_act') || 'none';
        const ticketId = options.getString('ticket') || 
            (channel.name.includes('ticket') ? channel.name.split('-')[1] || channel.name : null);
        
        try {
            if (!targetUser) {
                return await ResponseManager.error(interaction, 'Usuário não encontrado.');
            }
            
            // Garantir registros no banco
            db.ensureUser(staff.id, staff.username, staff.discriminator, staff.avatar);
            db.ensureUser(targetUser.id, targetUser.username, targetUser.discriminator, targetUser.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            const ConfigSystem = require('../../systems/configSystem');
            const PunishmentSystem = require('../../systems/punishmentSystem');
            
            // Buscar pontos configurados para o nível (customizável via /config-strike)
            const pointsMap = {
                1: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_1')) || 10,
                2: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_2')) || 25,
                3: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_3')) || 40,
                4: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_4')) || 60,
                5: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_5')) || 100
            };
            const pointsToLose = pointsMap[severity] || 10;
            
            // Validar hierarquia
            let targetMember = null;
            try {
                targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
            } catch (err) {
                targetMember = null;
            }
            
            const isStaffHigher = targetMember && 
                targetMember.roles.highest.position >= staffMember.roles.highest.position && 
                staff.id !== guild.ownerId;
            
            if (isStaffHigher) {
                db.logActivity(guildId, staff.id, 'strike_denied', targetUser.id, {
                    command: 'strike', reason: 'Hierarquia insuficiente', severity, pointsToLose
                });
                return await ResponseManager.error(interaction, 'Você não pode punir este membro.');
            }
            
            // Obter reputação atual
            const currentRep = ConfigSystem.getSetting(guildId, `rep_${targetUser.id}`) || 
                db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, targetUser.id)?.points || 100;
            
            const newPoints = Math.max(0, currentRep - pointsToLose);
            
            // Calcular expiração
            let expiresAt = null;
            let durationMs = 0;
            if (durationStr !== '0' && durationStr.toLowerCase() !== 'perm') {
                durationMs = PunishmentSystem.parseDuration(durationStr);
                if (durationMs > 0) expiresAt = Date.now() + durationMs;
            }
            
            // Aplicar punição
            const punishmentUuid = db.generateUUID();
            const strikeId = db.prepare(`
                INSERT INTO punishments (uuid, guild_id, user_id, moderator_id, reason, severity, 
                    points_deducted, ticket_id, created_at, expires_at, status, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(punishmentUuid, guildId, targetUser.id, staff.id, reason, severity,
                pointsToLose, ticketId || null, Date.now(), expiresAt, 'active',
                JSON.stringify({ discordAct, jogoAct, duration: durationStr })
            ).lastInsertRowid;
            
            // Atualizar reputação
            db.prepare(`UPDATE reputation SET points = ?, updated_at = ?, updated_by = ?
                WHERE guild_id = ? AND user_id = ?`).run(newPoints, Date.now(), staff.id, guildId, targetUser.id);
            
            // Aplicar ações do Discord
            let discordActionResult = null;
            if (discordAct !== 'none' && targetMember) {
                try {
                    switch (discordAct) {
                        case 'timeout':
                            await targetMember.timeout(durationMs > 0 ? durationMs : 60000, reason);
                            discordActionResult = `Timeout de ${durationStr || '1 minuto'} aplicado`;
                            break;
                        case 'kick':
                            await targetMember.kick(reason);
                            discordActionResult = 'Expulsão aplicada';
                            break;
                        case 'ban':
                            await targetMember.ban({ reason });
                            discordActionResult = 'Banimento aplicado';
                            break;
                    }
                } catch (err) {
                    discordActionResult = `❌ Erro: ${err.message}`;
                }
            }
            
            // Registrar atividade
            db.logActivity(guildId, staff.id, 'strike', targetUser.id, {
                command: 'strike', punishmentId: strikeId, severity, pointsLost: pointsToLose,
                oldPoints: currentRep, newPoints, reason, duration: durationStr, discordAct, jogoAct
            });
            
            await AnalyticsSystem.updateStaffAnalytics(guildId, staff.id);
            
            // Gerar embed unificado
            const unifiedEmbed = PunishmentSystem.generateStrikeUnifiedEmbed(
                targetUser, staff, strikeId, severity, reason, ticketId || null,
                pointsToLose, newPoints, discordAct, discordActionResult
            );
            
            // Enviar DM
            if (targetMember) {
                try {
                    await targetMember.send({ embeds: [unifiedEmbed] }).catch(() => null);
                } catch (err) {}
            }
            
            // Enviar log
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_punishments');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder(unifiedEmbed.toJSON());
                        logEmbed.setDescription(unifiedEmbed.description + `\n\n## ${emojis.staff || '👮'} Moderador\n<@${staff.id}>`);
                        await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                    }
                } catch (err) {}
            }
            
            // Resposta no canal
            const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
            const severityIcon = ['', '🟢', '🟡', '🟠', '🔴', '💀'][severity] || '❓';
            
            await ResponseManager.success(interaction, 
                `${severityIcon} **Strike #${strikeId} aplicado em ${targetUser.username}**\n📉 ${pointsToLose} pts perdidos | ⭐ Reputação: ${newPoints}/100`
            );
            
            console.log(`📊 [STRIKE] ${staff.tag} puniu ${targetUser.tag} | #${strikeId} | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            console.error('❌ Erro no strike:', error);
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao aplicar strike. A equipe foi notificada.');
        }
    }
};