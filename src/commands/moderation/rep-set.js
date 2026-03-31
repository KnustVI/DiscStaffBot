const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const SessionManager = require('../../utils/sessionManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('repset')
        .setDescription('Ajusta manualmente os pontos de reputação.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Alvo').setRequired(true))
        .addIntegerOption(opt => opt.setName('pontos').setDescription('Nova pontuação (0-100)').setRequired(true).setMinValue(0).setMaxValue(100))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do ajuste').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     * @param {import('discord.js').Client} client 
     */
    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, options, user: staff, member: staffMember } = interaction;
        const guildId = guild.id;
        
        const target = options.getUser('usuario');
        const newPoints = options.getInteger('pontos');
        const reason = options.getString('motivo');
        
        // Obter emojis do sistema (se existirem)
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        try {
            // 1. VALIDAR SE O USUÁRIO EXISTE
            if (!target) {
                return await interaction.editReply({ 
                    content: `${emojis.ERRO || '❌'} Usuário não encontrado.`
                });
            }
            
            // 2. GARANTIR QUE USUÁRIOS E GUILD EXISTEM NO BANCO
            db.ensureUser(staff.id, staff.username, staff.discriminator, staff.avatar);
            db.ensureUser(target.id, target.username, target.discriminator, target.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            // 3. OBTER SISTEMAS
            const ConfigSystem = require('../../systems/configSystem');
            const PunishmentSystem = require('../../systems/punishmentSystem');
            
            // 4. VERIFICAR HIERARQUIA (Trava de Segurança)
            let targetMember = null;
            try {
                targetMember = await guild.members.fetch(target.id).catch(() => null);
            } catch (err) {
                // Usuário não está no servidor
                targetMember = null;
            }
            
            const isStaffHigher = targetMember && 
                targetMember.roles.highest.position >= staffMember.roles.highest.position && 
                staff.id !== guild.ownerId;
            
            if (isStaffHigher) {
                // Registrar tentativa negada
                db.logActivity(
                    guildId,
                    staff.id,
                    'rep_set_denied',
                    target.id,
                    { 
                        command: 'repset',
                        reason: 'Hierarquia insuficiente',
                        targetRolePosition: targetMember.roles.highest.position,
                        staffRolePosition: staffMember.roles.highest.position,
                        newPoints,
                        motivo: reason
                    }
                );
                
                return await interaction.editReply({ 
                    content: `${emojis.ERRO || '❌'} Você não tem autoridade para ajustar a reputação de um cargo superior ou igual ao seu.` 
                });
            }
            
            // 5. OBTER REPUTAÇÃO ATUAL
            const currentRep = ConfigSystem.getSetting(guildId, `rep_${target.id}`) || 
                db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, target.id)?.points || 100;
            
            const oldPoints = currentRep;
            const diff = newPoints - oldPoints;
            const diffText = diff >= 0 ? `+${diff}` : `${diff}`;
            
            // 6. ATUALIZAR REPUTAÇÃO NO BANCO
            db.prepare(`
                INSERT INTO reputation (guild_id, user_id, points, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(guild_id, user_id) 
                DO UPDATE SET points = ?, updated_at = ?, updated_by = ?
            `).run(
                guildId, target.id, newPoints, Date.now(), staff.id,
                newPoints, Date.now(), staff.id
            );
            
            // Limpar cache do ConfigSystem
            ConfigSystem.clearCache(guildId);
            
            // 7. REGISTRAR ATIVIDADE NO LOG (com UUID)
            const activityId = db.logActivity(
                guildId,
                staff.id,
                'rep_set',
                target.id,
                { 
                    command: 'repset',
                    oldPoints,
                    newPoints,
                    diff,
                    reason,
                    targetTag: target.tag,
                    responseTime: Date.now() - startTime
                }
            );
            
            // 8. ATUALIZAR ANALYTICS DO STAFF
            await AnalyticsSystem.updateStaffAnalytics(guildId, staff.id);
            
            // 9. RESPOSTA IMEDIATA
            const successColor = diff >= 0 ? 0x00FF00 : 0xFF0000;
            
            const embed = new EmbedBuilder()
                .setColor(successColor)
                .setTitle(`${emojis.CHECK || '✅'} Reputação Ajustada`)
                .setDescription(`**${target.tag}** teve sua reputação ajustada.`)
                .addFields(
                    { 
                        name: '📊 Alteração', 
                        value: `\`${oldPoints}\` → \`${newPoints}\` (\`${diffText}\`)`, 
                        inline: true 
                    },
                    { 
                        name: '👤 Moderador', 
                        value: `${staff.tag}`, 
                        inline: true 
                    },
                    { 
                        name: '📝 Motivo', 
                        value: `\`${reason.slice(0, 100)}\``, 
                        inline: false 
                    },
                    { 
                        name: '🆔 ID da Transação', 
                        value: `\`${activityId?.slice(0, 8) || 'N/A'}...\``, 
                        inline: true 
                    }
                )
                .setFooter({ 
                    text: `ID: ${activityId?.slice(0, 8) || 'N/A'} • ${ConfigSystem.getFooter(guild.name).text}`,
                    iconURL: ConfigSystem.getFooter(guild.name).iconURL
                })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed], content: null });
            
            // 10. FLUXO DE LOG NO CANAL DE LOGS (Async em segundo plano)
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_channel');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setColor(diff >= 0 ? 0x00FF7F : 0xFF4500)
                            .setAuthor({ name: `📝 Ajuste de Reputação`, iconURL: target.displayAvatarURL() })
                            .setDescription([
                                `**Alvo:** ${target} (\`${target.id}\`)`,
                                `**Moderador:** ${staff} (\`${staff.id}\`)`,
                                `**Ajuste:** \`${diffText} pts\` → \`${newPoints}/100\``,
                                `**Motivo:** ${reason}`,
                                `**ID Transação:** \`${activityId}\``
                            ].join('\n'))
                            .setFooter({ text: ConfigSystem.getSetting(guildId, 'footer_text') || guild.name })
                            .setTimestamp();
                        
                        await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                    }
                } catch (err) {
                    console.error('❌ Erro ao enviar log para canal:', err);
                }
            }
            
            // Log silencioso de performance
            console.log(`📊 [REPSET] ${staff.tag} ajustou ${target.tag} em ${guild.name} | ${diffText} pts | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            // 11. TRATAMENTO DE ERRO COM LOG DETALHADO
            console.error('❌ Erro no comando repset:', error);
            
            // Registrar erro no sistema de logs
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            // Registrar no banco
            db.logActivity(
                guildId,
                staff.id,
                'error',
                target?.id || null,
                { 
                    command: 'repset',
                    targetTag: target?.tag || 'unknown',
                    newPoints,
                    reason,
                    error: error.message,
                    stack: error.stack
                }
            );
            
            // Resposta de erro amigável
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro ao Ajustar Reputação')
                .setDescription('Ocorreu um erro interno ao processar o ajuste de reputação. A equipe de staff foi notificada.')
                .addFields(
                    { name: 'Alvo', value: target?.tag || 'Desconhecido', inline: true },
                    { name: 'Valor Solicitado', value: `\`${newPoints}\``, inline: true },
                    { name: 'Código do Erro', value: `\`${error.message?.slice(0, 50) || 'Desconhecido'}\``, inline: false },
                    { name: 'ID da Transação', value: `\`${Date.now()}\``, inline: true }
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