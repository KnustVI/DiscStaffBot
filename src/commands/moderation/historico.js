const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const ResponseManager = require('../../utils/responseManager');
const PunishmentSystem = require('../../systems/punishmentSystem');
const AnalyticsSystem = require('../../systems/analyticsSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Consulta a reputação e punições de um usuário.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a consultar').setRequired(true)),

    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, user, options } = interaction;
        const guildId = guild.id;
        const target = options.getUser('usuario');
        
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {}
        
        try {
            if (!target) {
                return await ResponseManager.error(interaction, 'Usuário não encontrado.');
            }
            
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            db.ensureUser(target.id, target.username, target.discriminator, target.avatar);
            
            const ConfigSystem = require('../../systems/configSystem');
            const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
            
            const history = await PunishmentSystem.getUserHistory(guildId, target.id, 1);
            const userData = await PunishmentSystem.getUserData(guildId, target.id);
            
            if (!history || history.totalRecords === 0) {
                db.logActivity(guildId, user.id, 'history_view', target.id, { hasRecords: false });
                
                const repEmoji = (history?.reputation || 100) >= 90 ? '✨' : 
                                (history?.reputation || 100) >= 70 ? '⭐' : 
                                (history?.reputation || 100) >= 50 ? '🌟' : '⚠️';
                
                const description = [
                    `# ${emojis.History || '📋'} HISTÓRICO DE ${target.username.toUpperCase()}`,
                    `## ${repEmoji} Reputação Atual: **${history?.reputation || 100}/100** pontos`,
                    `## ${emojis.strike || '⚠️'} Punições: **0**`,
                    `\`\`\`\nNenhuma punição registrada.\n\`\`\``
                ].join('\n');
                
                const embed = new EmbedBuilder()
                    .setColor(0xDCA15E)
                    .setDescription(description)
                    .setThumbnail(target.displayAvatarURL())
                    .setFooter({ text: `Consultado por ${user.tag}` })
                    .setTimestamp();
                
                return await ResponseManager.send(interaction, { embeds: [embed] });
            }
            
            // Criar sessão com isolamento total
            sessionManager.set(user.id, guildId, 'history', 'view', {
                targetId: target.id,
                currentPage: 1,
                totalPages: history.totalPages
            }, 600000);
            
            const embed = PunishmentSystem.generateHistoryEmbed(target, history, 1);
            const components = PunishmentSystem.generateHistoryButtons(target.id, 1, history.totalPages);
            
            db.logActivity(guildId, user.id, 'history_view', target.id, {
                totalRecords: history.totalRecords, reputation: history.reputation
            });
            
            if (staffRoleId && interaction.member.roles.cache.has(staffRoleId)) {
                await AnalyticsSystem.updateStaffAnalytics(guildId, user.id);
            }
            
            embed.setFooter({ text: `Página 1 de ${history.totalPages} • Total: ${history.totalRecords} registros` });
            
            await ResponseManager.send(interaction, {
                embeds: [embed],
                components: components ? [components] : []
            });
            
            console.log(`📊 [HISTORICO] ${user.tag} consultou ${target.tag} | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            console.error('❌ Erro no historico:', error);
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao carregar histórico.');
        }
    }
};