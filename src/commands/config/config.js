const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    RoleSelectMenuBuilder, 
    ChannelSelectMenuBuilder, 
    ChannelType 
} = require('discord.js');
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');
const ResponseManager = require('../../utils/responseManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Painel de configuração do sistema de integridade.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, user, member } = interaction;
        const guildId = guild.id;
        
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        try {
            // Verificar permissões
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Permissão Negada')
                    .setDescription('Apenas administradores podem configurar o sistema.')
                    .setTimestamp();
                
                return await ResponseManager.send(interaction, { embeds: [errorEmbed] });
            }
            
            // Garantir registros no banco
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            const ConfigSystem = require('../../systems/configSystem');
            
            // Criar sessão com isolamento total (userId_guildId_system_action)
            sessionManager.set(
                user.id,
                guildId,
                'config',
                'panel',
                { 
                    timestamp: Date.now(),
                    userId: user.id,
                    guildId: guildId
                },
                300000
            );
            
            // Coletar configurações atuais
            const staffRole = ConfigSystem.getSetting(guildId, 'staff_role');
            const logChannel = ConfigSystem.getSetting(guildId, 'log_channel');
            const strikeRole = ConfigSystem.getSetting(guildId, 'strike_role');
            const automodEnabled = ConfigSystem.getSetting(guildId, 'automod_enabled') === 'true';
            const exemplarLimit = ConfigSystem.getSetting(guildId, 'limit_exemplar') || '95';
            const problematicLimit = ConfigSystem.getSetting(guildId, 'limit_problematico') || '30';
            
            // Estatísticas
            const totalPunishments = db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ?`).get(guildId)?.count || 0;
            const totalUsers = db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM reputation WHERE guild_id = ?`).get(guildId)?.count || 0;
            
            // Embed principal
            const embed = new EmbedBuilder()
                .setTitle(`${emojis.Config || '⚙️'} Configuração do Servidor`)
                .setColor(0xDCA15E)
                .setDescription('Selecione abaixo os cargos e canais que o bot deve utilizar para o sistema de reputação.')
                .addFields(
                    { name: '🛡️ Cargo Staff', value: staffRole ? `<@&${staffRole}>` : '`❌ Não definido`', inline: true },
                    { name: '📜 Canal de Logs', value: logChannel ? `<#${logChannel}>` : '`❌ Não definido`', inline: true },
                    { name: '⚠️ Cargo de Strike', value: strikeRole ? `<@&${strikeRole}>` : '`❌ Não definido`', inline: true },
                    { name: '🛡️ Auto Moderação', value: automodEnabled ? '✅ Ativada' : '❌ Desativada', inline: true },
                    { name: '🎖️ Limite Exemplar', value: `\`${exemplarLimit} pontos\``, inline: true },
                    { name: '⚠️ Limite Problemático', value: `\`${problematicLimit} pontos\``, inline: true },
                    { name: '📊 Estatísticas', value: `**Punições:** \`${totalPunishments}\` | **Usuários:** \`${totalUsers}\``, inline: false }
                )
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();
            
            // Componentes
            const staffRow = new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId('config:set:staff_role')
                    .setPlaceholder('Selecionar Cargo de Moderadores')
            );
            
            const logRow = new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('config:set:log_channel')
                    .setPlaceholder('Selecionar Canal de Logs')
                    .addChannelTypes(ChannelType.GuildText)
            );
            
            const strikeRow = new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId('config:set:strike_role')
                    .setPlaceholder('Selecionar Cargo de Strike')
            );
            
            // Registrar atividade
            db.logActivity(guildId, user.id, 'config_panel_open', null, {
                command: 'config',
                responseTime: Date.now() - startTime,
                currentConfig: { staffRole, logChannel, strikeRole, automodEnabled, exemplarLimit, problematicLimit }
            });
            
            // Atualizar analytics
            await AnalyticsSystem.updateStaffAnalytics(guildId, user.id);
            
            // Resposta final usando ResponseManager
            await ResponseManager.send(interaction, {
                embeds: [embed],
                components: [staffRow, logRow, strikeRow]
            });
            
            console.log(`📊 [CONFIG] Painel aberto por ${user.tag} em ${guild.name} | ${Date.now() - startTime}ms`);
            
        } catch (error) {
            console.error('❌ Erro no comando config:', error);
            
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            db.logActivity(guildId, user.id, 'error', null, { command: 'config', error: error.message });
            
            // Limpar sessão
            sessionManager.delete(user.id, guildId, 'config', 'panel');
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro ao abrir painel')
                .setDescription('Ocorreu um erro interno. A equipe foi notificada.')
                .addFields({ name: 'Código', value: `\`${error.message?.slice(0, 100) || 'Desconhecido'}\`` })
                .setFooter({ text: 'Caso persista, contate um administrador.' })
                .setTimestamp();
            
            await ResponseManager.send(interaction, { embeds: [errorEmbed] });
        }
    }
};