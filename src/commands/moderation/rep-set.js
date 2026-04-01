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
        
        // Obter emojis do sistema
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
                    content: `${emojis.Error || '❌'} Usuário não encontrado.`
                });
            }
            
            // 2. GARANTIR QUE USUÁRIOS E GUILD EXISTEM NO BANCO
            db.ensureUser(staff.id, staff.username, staff.discriminator, staff.avatar);
            db.ensureUser(target.id, target.username, target.discriminator, target.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            // 3. OBTER SISTEMAS
            const ConfigSystem = require('../../systems/configSystem');
            
            // 4. VERIFICAR HIERARQUIA
            let targetMember = null;
            try {
                targetMember = await guild.members.fetch(target.id).catch(() => null);
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
                    content: `${emojis.Error || '❌'} Você não tem autoridade para ajustar a reputação de um cargo superior ou igual ao seu.` 
                });
            }
            
            // 5. OBTER REPUTAÇÃO ATUAL
            const currentRep = ConfigSystem.getSetting(guildId, `rep_${target.id}`) || 
                db.prepare(`SELECT points FROM reputation WHERE guild_id = ? AND user_id = ?`).get(guildId, target.id)?.points || 100;
            
            const oldPoints = currentRep;
            const diff = newPoints - oldPoints;
            const diffText = diff >= 0 ? `+${diff}` : `${diff}`;
            const isGain = diff >= 0;
            
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
            
            // 7. REGISTRAR ATIVIDADE NO LOG
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
            
            // 9. GERAR EMBED UNIFICADO
            const unifiedEmbed = generateRepSetUnifiedEmbed(
                target,
                staff,
                oldPoints,
                newPoints,
                diff,
                reason,
                emojis
            );
            
            // 10. ENVIAR DM PARA O USUÁRIO (se possível)
            if (targetMember) {
                try {
                    await targetMember.send({ embeds: [unifiedEmbed] }).catch(() => null);
                } catch (err) {
                    console.error('❌ Erro ao enviar DM:', err);
                }
            }
            
            // 11. ENVIAR LOG PARA CANAL
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_channel');
            if (logChannelId) {
                try {
                    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder(unifiedEmbed.toJSON());
                        logEmbed.setDescription(
                            unifiedEmbed.description + 
                            `\n\n## ${emojis.staff || '👮'} Responsável\n<@${staff.id}>`
                        );
                        await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
                    }
                } catch (err) {
                    console.error('❌ Erro ao enviar log:', err);
                }
            }
            
            // 12. RESPOSTA NO CANAL
            const gainIcon = isGain ? '📈' : '📉';
            const gainText = isGain ? 'Aumentada' : 'Reduzida';
            
            await interaction.editReply({ 
                content: `${gainIcon} **Reputação de ${target.username} ${gainText}**\n📊 \`${oldPoints}\` → \`${newPoints}\` (\`${diffText}\`)\n📝 Motivo: ${reason.slice(0, 100)}`,
                embeds: [],
                components: []
            });
            
            // Log silencioso
            console.log(`📊 [REPSET] ${staff.tag} ajustou ${target.tag} em ${guild.name} | ${diffText} pts | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            // 13. TRATAMENTO DE ERRO
            console.error('❌ Erro no comando repset:', error);
            
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
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
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro ao Ajustar Reputação')
                .setDescription('Ocorreu um erro interno ao processar o ajuste de reputação.')
                .addFields(
                    { name: 'Alvo', value: target?.tag || 'Desconhecido', inline: true },
                    { name: 'Valor Solicitado', value: `\`${newPoints}\``, inline: true },
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

/**
 * Gera embed unificado para ajuste de reputação
 */
function generateRepSetUnifiedEmbed(target, moderator, oldPoints, newPoints, diff, reason, emojis) {
    const isGain = diff >= 0;
    const diffText = diff >= 0 ? `+${diff}` : `${diff}`;
    const color = isGain ? 0x00FF00 : 0xFF0000;
    const titleIcon = isGain ? '📈' : '📉';
    const titleText = isGain ? 'REPUTAÇÃO AUMENTADA' : 'REPUTAÇÃO REDUZIDA';
    
    const description = [
        `# ${titleIcon} ${titleText}`,
        `Uma alteração manual foi registrada no sistema.`,
        ``,
        `## ${emojis.user || '👤'} Usuário Alvo: ${target.username}`,
        `\`${target.id}\``,
        ``,
        `## ${emojis.staff || '👮'} Responsável: ${moderator.username}`,
        `\`${moderator.id}\``,
        ``,
        `**Mudança:** \`${diffText} pts\``,
        `**Saldo Final:** \`${newPoints}/100 pts\``,
        ``,
        `## ${emojis.Note || '📝'} Motivo`,
        `\`\`\`text\n${reason}\n\`\`\``
    ].join('\n');
    
    return new EmbedBuilder()
        .setColor(color)
        .setDescription(description)
        .setFooter({ text: `ID: ${Date.now()} • ${new Date().toLocaleString('pt-BR')}` })
        .setTimestamp();
}