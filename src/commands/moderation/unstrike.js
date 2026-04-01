const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const SessionManager = require('../../utils/sessionManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unstrike')
        .setDescription('Anula uma punição e devolve os pontos ao usuário.')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID único da punição no banco').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da anulação').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     * @param {import('discord.js').Client} client 
     */
    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, options, user: staff, member: staffMember } = interaction;
        const guildId = guild.id;
        
        const punishmentId = options.getInteger('id');
        const reason = options.getString('motivo');
        
        // Obter emojis do sistema
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        try {
            // 1. GARANTIR QUE USUÁRIO E GUILD EXISTEM NO BANCO
            db.ensureUser(staff.id, staff.username, staff.discriminator, staff.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            // 2. OBTER SISTEMAS
            const ConfigSystem = require('../../systems/configSystem');
            const PunishmentSystem = require('../../systems/punishmentSystem');
            
            // 3. BUSCAR PUNIÇÃO NO BANCO
            const punishment = db.prepare(`
                SELECT * FROM punishments 
                WHERE id = ? AND guild_id = ? AND status = 'active'
            `).get(punishmentId, guildId);
            
            if (!punishment) {
                db.logActivity(
                    guildId,
                    staff.id,
                    'unstrike_not_found',
                    null,
                    { 
                        command: 'unstrike',
                        punishmentId,
                        reason,
                        error: 'Punição não encontrada ou já anulada'
                    }
                );
                
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle(`${emojis.Warning || '⚠️'} Punição Não Encontrada`)
                    .setDescription(`Não foi encontrada uma punição ativa com o ID \`${punishmentId}\` neste servidor.`)
                    .addFields(
                        { name: '💡 Dica', value: 'Verifique o ID correto usando `/historico`' }
                    )
                    .setTimestamp();
                
                return await interaction.editReply({ embeds: [errorEmbed] });
            }
            
            // 4. VALIDAÇÃO DE HIERARQUIA
            let targetMember = null;
            try {
                targetMember = await guild.members.fetch(punishment.user_id).catch(() => null);
            } catch (err) {
                targetMember = null;
            }
            
            const isStaffHigher = targetMember && 
                targetMember.roles.highest.position >= staffMember.roles.highest.position && 
                staff.id !== guild.ownerId;
            
            if (isStaffHigher) {
                db.logActivity(
                    guildId,
                    staff.id,
                    'unstrike_denied',
                    punishment.user_id,
                    { 
                        command: 'unstrike',
                        punishmentId,
                        reason: 'Hierarquia insuficiente',
                        targetRolePosition: targetMember.roles.highest.position,
                        staffRolePosition: staffMember.roles.highest.position
                    }
                );
                
                return await interaction.editReply({ 
                    content: `${emojis.Error || '❌'} **Erro de Hierarquia:** Você não pode anular punições de um cargo superior ou igual ao seu.` 
                });
            }
            
            // 5. OBTER PONTOS A RESTAURAR
            const pointsMap = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 100 };
            const pointsToRestore = pointsMap[punishment.severity] || 10;
            
            // 6. OBTER REPUTAÇÃO ATUAL
            const currentRep = db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, punishment.user_id)?.points || 100;
            const newPoints = Math.min(100, currentRep + pointsToRestore);
            
            // 7. GERAR UUID PARA ANULAÇÃO
            const reversalUuid = db.generateUUID();
            
            // 8. ATUALIZAR PUNIÇÃO
            db.prepare(`
                UPDATE punishments SET 
                    status = 'revoked',
                    revoked_by = ?,
                    revoked_reason = ?,
                    revoked_at = ?
                WHERE id = ? AND guild_id = ?
            `).run(staff.id, reason, Date.now(), punishmentId, guildId);
            
            // 9. RESTAURAR REPUTAÇÃO
            db.prepare(`
                UPDATE reputation SET points = ?, updated_at = ?, updated_by = ?
                WHERE guild_id = ? AND user_id = ?
            `).run(newPoints, Date.now(), staff.id, guildId, punishment.user_id);
            
            // 10. REMOVER CARGO TEMPORÁRIO (strike role)
            const strikeRoleId = ConfigSystem.getSetting(guildId, 'strike_role');
            if (strikeRoleId && targetMember && targetMember.roles.cache.has(strikeRoleId)) {
                try {
                    await targetMember.roles.remove(strikeRoleId, `Punição #${punishmentId} anulada`);
                } catch (err) {
                    console.error('❌ Erro ao remover cargo de strike:', err);
                }
            }
            
            // 11. REMOVER TIMEOUT
            if (targetMember && targetMember.communicationDisabledUntilTimestamp) {
                try {
                    await targetMember.timeout(null, `Punição #${punishmentId} anulada`);
                } catch (err) {
                    console.error('❌ Erro ao remover timeout:', err);
                }
            }
            
            // 12. REGISTRAR ATIVIDADE NO LOG
            const activityId = db.logActivity(
                guildId,
                staff.id,
                'unstrike',
                punishment.user_id,
                { 
                    command: 'unstrike',
                    punishmentId,
                    punishmentUuid: punishment.uuid,
                    reversalUuid,
                    severity: punishment.severity,
                    pointsRestored: pointsToRestore,
                    oldPoints: currentRep,
                    newPoints,
                    originalReason: punishment.reason,
                    originalModerator: punishment.moderator_id,
                    reversalReason: reason,
                    originalCreatedAt: punishment.created_at,
                    responseTime: Date.now() - startTime
                }
            );
            
            // 13. ATUALIZAR ANALYTICS DO STAFF
            await AnalyticsSystem.updateStaffAnalytics(guildId, staff.id);
            
            // 14. BUSCAR INFORMAÇÕES DO ALVO
            const targetUser = await client.users.fetch(punishment.user_id).catch(() => null);
            
            // 15. GERAR EMBED UNIFICADO
            const unifiedEmbed = PunishmentSystem.generateUnstrikeUnifiedEmbed(
                targetUser,
                staff,
                punishmentId,
                reason,
                pointsToRestore,
                newPoints,
                punishment.reason
            );
            
            // 16. ENVIAR DM PARA O USUÁRIO
            if (targetUser) {
                try {
                    await targetUser.send({ embeds: [unifiedEmbed] }).catch(() => null);
                } catch (err) {
                    console.error('❌ Erro ao enviar DM:', err);
                }
            }
            
            // 17. ENVIAR LOG PARA CANAL
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_channel');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder(unifiedEmbed.toJSON());
                        logEmbed.setDescription(
                            unifiedEmbed.description + 
                            `\n\n## ${emojis.staff || '👮'} Anulado por\n<@${staff.id}>`
                        );
                        await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                    }
                } catch (err) {
                    console.error('❌ Erro ao enviar log:', err);
                }
            }
            
            // 18. RESPOSTA NO CANAL
            const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
            
            await interaction.editReply({ 
                content: `${emojis.Check || '✅'} **Strike #${punishmentId} anulado!**\n📈 +${pointsToRestore} pts restaurados | ⭐ Reputação: ${newPoints}/100\n📝 Motivo: ${reason.slice(0, 100)}`,
                embeds: [],
                components: []
            });
            
            // Log silencioso
            console.log(`📊 [UNSTRIKE] ${staff.tag} anulou punição #${punishmentId} de ${targetUser?.tag || punishment.user_id} em ${guild.name} | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            // 19. TRATAMENTO DE ERRO
            console.error('❌ Erro no comando unstrike:', error);
            
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            db.logActivity(
                guildId,
                staff.id,
                'error',
                null,
                { 
                    command: 'unstrike',
                    punishmentId,
                    reason,
                    error: error.message,
                    stack: error.stack
                }
            );
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro ao Anular Punição')
                .setDescription('Ocorreu um erro interno ao processar a anulação. A equipe de staff foi notificada.')
                .addFields(
                    { name: 'ID da Punição', value: `\`${punishmentId}\``, inline: true },
                    { name: 'Código do Erro', value: `\`${error.message?.slice(0, 50) || 'Desconhecido'}\``, inline: false }
                )
                .setFooter({ text: 'Caso persista, contate um administrador.' })
                .setTimestamp();
            
            await interaction.editReply({ 
                embeds: [errorEmbed],
                content: null
            }).catch(() => null);
        }
    }
};