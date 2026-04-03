const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');
const ResponseManager = require('../../utils/responseManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-strike')
        .setDescription('⚙️ Configura os níveis de pontos do sistema de Strike.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('ver')
            .setDescription('Ver as configurações atuais dos níveis de strike'))
        .addSubcommand(sub => sub.setName('set')
            .setDescription('Define os pontos para um nível específico')
            .addIntegerOption(opt => opt.setName('nivel')
                .setDescription('Nível do strike (1 a 5)')
                .setRequired(true)
                .addChoices(
                    { name: 'Nível 1', value: 1 },
                    { name: 'Nível 2', value: 2 },
                    { name: 'Nível 3', value: 3 },
                    { name: 'Nível 4', value: 4 },
                    { name: 'Nível 5', value: 5 }
                ))
            .addIntegerOption(opt => opt.setName('pontos')
                .setDescription('Pontos a remover (0-100)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100)))
        .addSubcommand(sub => sub.setName('reset')
            .setDescription('Reseta todos os níveis para os valores padrão')),

    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, user, member, options } = interaction;
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
                return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
            }
            
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            const ConfigSystem = require('../../systems/configSystem');
            const sub = options.getSubcommand();
            
            // Valores padrão
            const DEFAULT_POINTS = {
                1: 10,
                2: 25,
                3: 40,
                4: 60,
                5: 100
            };
            
            // ==================== VER CONFIGURAÇÕES ====================
            if (sub === 'ver') {
                const points = {
                    1: ConfigSystem.getSetting(guildId, 'strike_points_1') || DEFAULT_POINTS[1],
                    2: ConfigSystem.getSetting(guildId, 'strike_points_2') || DEFAULT_POINTS[2],
                    3: ConfigSystem.getSetting(guildId, 'strike_points_3') || DEFAULT_POINTS[3],
                    4: ConfigSystem.getSetting(guildId, 'strike_points_4') || DEFAULT_POINTS[4],
                    5: ConfigSystem.getSetting(guildId, 'strike_points_5') || DEFAULT_POINTS[5]
                };
                
                const severityIcons = ['', '🟢', '🟡', '🟠', '🔴', '💀'];
                
                const description = [
                    `# ${emojis.Config || '⚙️'} Configuração dos Níveis de Strike`,
                    `Gerencie quantos pontos cada nível remove.`,
                    ``,
                    `## Valores Atuais`,
                    `${severityIcons[1]} **Nível 1 (Leve):** \`${points[1]} pontos\``,
                    `${severityIcons[2]} **Nível 2 (Moderada):** \`${points[2]} pontos\``,
                    `${severityIcons[3]} **Nível 3 (Grave):** \`${points[3]} pontos\``,
                    `${severityIcons[4]} **Nível 4 (Severa):** \`${points[4]} pontos\``,
                    `${severityIcons[5]} **Nível 5 (Permanente):** \`${points[5]} pontos\``,
                    ``,
                    `## ${emojis.Note || '📝'} Como usar`,
                    `- Use \`/config-strike set nível:<1-5> pontos:<valor>\` para alterar`,
                    `- Use \`/config-strike reset\` para restaurar valores padrão`,
                    ``,
                    `## Valores Padrão`,
                    `Nível 1: 10 pts | Nível 2: 25 pts | Nível 3: 40 pts | Nível 4: 60 pts | Nível 5: 100 pts`
                ].join('\n');
                
                const embed = new EmbedBuilder()
                    .setColor(0xDCA15E)
                    .setDescription(description)
                    .setFooter(ConfigSystem.getFooter(guild.name))
                    .setTimestamp();
                
                // Botões para ações rápidas
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('config-strike:reset')
                        .setLabel('Resetar Padrão')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('⚠️'),
                    new ButtonBuilder()
                        .setCustomId('config-strike:edit')
                        .setLabel('Editar Níveis')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('✏️')
                );
                
                await ResponseManager.send(interaction, { embeds: [embed], components: [row] });
                
                console.log(`📊 [CONFIG-STRIKE] Visualizado por ${user.tag}`);
                return;
            }
            
            // ==================== DEFINIR NÍVEL ====================
            if (sub === 'set') {
                const nivel = options.getInteger('nivel');
                const pontos = options.getInteger('pontos');
                
                // Validar pontos
                if (pontos < 0 || pontos > 100) {
                    return await ResponseManager.error(interaction, 'Os pontos devem estar entre 0 e 100.');
                }
                
                // Salvar configuração
                ConfigSystem.setSetting(guildId, `strike_points_${nivel}`, pontos.toString());
                
                // Limpar cache
                ConfigSystem.clearCache(guildId);
                
                const severityNames = ['', 'Leve', 'Moderada', 'Grave', 'Severa', 'Permanente'];
                const severityIcons = ['', '🟢', '🟡', '🟠', '🔴', '💀'];
                
                // Registrar atividade
                db.logActivity(guildId, user.id, 'config_strike_set', null, {
                    nivel, pontos, oldValue: null
                });
                
                await AnalyticsSystem.updateStaffAnalytics(guildId, user.id);
                
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle(`${emojis.Check || '✅'} Nível de Strike Atualizado`)
                    .setDescription(`${severityIcons[nivel]} **Nível ${nivel} (${severityNames[nivel]})** agora remove \`${pontos} pontos\`.`)
                    .setFooter(ConfigSystem.getFooter(guild.name))
                    .setTimestamp();
                
                await ResponseManager.send(interaction, { embeds: [embed] });
                
                console.log(`📊 [CONFIG-STRIKE] ${user.tag} definiu Nível ${nivel} = ${pontos} pts`);
                return;
            }
            
            // ==================== RESETAR ====================
            if (sub === 'reset') {
                // Resetar todos os níveis
                for (let i = 1; i <= 5; i++) {
                    ConfigSystem.setSetting(guildId, `strike_points_${i}`, DEFAULT_POINTS[i].toString());
                }
                
                ConfigSystem.clearCache(guildId);
                
                db.logActivity(guildId, user.id, 'config_strike_reset', null, { resetToDefault: true });
                await AnalyticsSystem.updateStaffAnalytics(guildId, user.id);
                
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle(`${emojis.Check || '✅'} Configurações Resetadas`)
                    .setDescription('Todos os níveis de strike foram resetados para os valores padrão:\n\n' +
                        '🟢 Nível 1: `10 pontos`\n' +
                        '🟡 Nível 2: `25 pontos`\n' +
                        '🟠 Nível 3: `40 pontos`\n' +
                        '🔴 Nível 4: `60 pontos`\n' +
                        '💀 Nível 5: `100 pontos`')
                    .setFooter(ConfigSystem.getFooter(guild.name))
                    .setTimestamp();
                
                await ResponseManager.send(interaction, { embeds: [embed] });
                
                console.log(`📊 [CONFIG-STRIKE] ${user.tag} resetou todos os níveis`);
                return;
            }
            
        } catch (error) {
            console.error('❌ Erro no config-strike:', error);
            
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            await ResponseManager.error(interaction, 'Erro ao configurar níveis de strike. A equipe foi notificada.');
        }
    }
};