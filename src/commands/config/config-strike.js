const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');
const ResponseManager = require('../../utils/responseManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-strike')
        .setDescription('⚙️ Configura os níveis de pontos do sistema de Strike.')
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
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
                return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
            }
            
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            const ConfigSystem = require('../../systems/configSystem');
            
            // Criar sessão para o painel
            sessionManager.set(user.id, guildId, 'config-strike', 'panel', {
                timestamp: Date.now(),
                userId: user.id,
                guildId: guildId
            }, 300000);
            
            // Buscar valores atuais
            const DEFAULT_POINTS = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 100 };
            const points = {
                1: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_1')) || DEFAULT_POINTS[1],
                2: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_2')) || DEFAULT_POINTS[2],
                3: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_3')) || DEFAULT_POINTS[3],
                4: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_4')) || DEFAULT_POINTS[4],
                5: parseInt(ConfigSystem.getSetting(guildId, 'strike_points_5')) || DEFAULT_POINTS[5]
            };
            
            const severityIcons = ['', '🟢', '🟡', '🟠', '🔴', '💀'];
            const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
            
            // Embed principal
            const description = [
                `# ${emojis.Config || '⚙️'} Configuração dos Níveis de Strike`,
                `Gerencie quantos pontos cada nível remove.`,
                ``,
                `## ${emojis.strike || '⚠️'} Valores Atuais`,
                `${severityIcons[1]} **Nível 1 (${severityNames[1]}):** \`${points[1]} pontos\``,
                `${severityIcons[2]} **Nível 2 (${severityNames[2]}):** \`${points[2]} pontos\``,
                `${severityIcons[3]} **Nível 3 (${severityNames[3]}):** \`${points[3]} pontos\``,
                `${severityIcons[4]} **Nível 4 (${severityNames[4]}):** \`${points[4]} pontos\``,
                `${severityIcons[5]} **Nível 5 (${severityNames[5]}):** \`${points[5]} pontos\``,
                ``,
                `## ${emojis.Note || '📝'} Valores Padrão`,
                `Nível 1: 10 pts | Nível 2: 25 pts | Nível 3: 40 pts | Nível 4: 60 pts | Nível 5: 100 pts`,
                ``,
                `## ${emojis.How || '💡'} Como usar`,
                `Clique no botão **✏️ Editar Todos os Níveis** para alterar os valores em um único modal.`
            ].join('\n');
            
            const embed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setDescription(description)
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();
            
            // Botões
            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('config-strike:edit:modal')
                    .setLabel('Editar Todos os Níveis')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('✏️')
            );
            
            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('config-strike:reset')
                    .setLabel('Resetar Padrão')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⚠️')
            );
            
            await ResponseManager.send(interaction, {
                embeds: [embed],
                components: [row1, row2]
            });
            
            console.log(`📊 [CONFIG-STRIKE] Painel aberto por ${user.tag}`);
            
        } catch (error) {
            console.error('❌ Erro no config-strike:', error);
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao abrir painel de configuração.');
        }
    }
};