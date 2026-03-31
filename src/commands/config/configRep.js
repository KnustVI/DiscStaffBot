const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const SessionManager = require('../../utils/sessionManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-rep')
        .setDescription('⚙️ Configura o sistema de Reputação e Punições.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('cargos')
            .setDescription('Define os cargos vinculados aos níveis de reputação.')
            .addRoleOption(opt => opt.setName('exemplar').setDescription('Cargo para bons jogadores (Reputação Alta)'))
            .addRoleOption(opt => opt.setName('problematico').setDescription('Cargo para infratores (Reputação Baixa)'))
            .addRoleOption(opt => opt.setName('strike').setDescription('Cargo temporário aplicado durante punições')))
        .addSubcommand(sub => sub.setName('limites')
            .setDescription('Define os gatilhos de pontos para a troca automática de cargos.')
            .addIntegerOption(opt => opt.setName('meta_exemplar').setDescription('Mínimo para ser Exemplar (Sugerido: 95)').setMinValue(50).setMaxValue(100))
            .addIntegerOption(opt => opt.setName('alerta_ruim').setDescription('Máximo para ser Problemático (Sugerido: 30)').setMinValue(0).setMaxValue(50))),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     * @param {import('discord.js').Client} client 
     */
    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, user, member, options } = interaction;
        const guildId = guild.id;
        
        // Obter emojis do sistema (se existirem)
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        try {
            // 1. VERIFICAR PERMISSÕES (segurança extra)
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Permissão Negada')
                    .setDescription('Apenas administradores podem configurar o sistema de reputação.')
                    .setTimestamp();
                
                return await interaction.editReply({ embeds: [errorEmbed] });
            }
            
            // 2. GARANTIR QUE USUÁRIO E GUILD EXISTEM NO BANCO
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            // 3. OBTER SISTEMAS
            const ConfigSystem = require('../../systems/configSystem');
            const sub = options.getSubcommand();
            
            let changes = [];
            let configSnapshot = {};
            
            // 4. REGISTRAR SESSÃO DE CONFIGURAÇÃO
            SessionManager.set(
                user.id,
                guildId,
                'config_rep',
                { 
                    timestamp: Date.now(),
                    subcommand: sub,
                    userId: user.id,
                    guildId: guildId
                },
                300000 // 5 minutos
            );
            
            // --- SUBCOMANDO: CARGOS ---
            if (sub === 'cargos') {
                const rolesToSet = [
                    { key: 'role_exemplar', role: options.getRole('exemplar'), label: 'Exemplar' },
                    { key: 'role_problematico', role: options.getRole('problematico'), label: 'Problemático' },
                    { key: 'strike_role', role: options.getRole('strike'), label: 'Strike' }
                ];
                
                // Capturar valores anteriores para log
                const oldValues = {};
                for (const item of rolesToSet) {
                    if (item.role) {
                        oldValues[item.key] = ConfigSystem.getSetting(guildId, item.key);
                    }
                }
                
                for (const item of rolesToSet) {
                    if (item.role) {
                        // Persistência no Cache + SQLite
                        ConfigSystem.setSetting(guildId, item.key, item.role.id);
                        changes.push(`${emojis.CHECK || '✅'} **${item.label}:** ${item.role}`);
                        configSnapshot[item.key] = item.role.id;
                    }
                }
                
                // Log das alterações
                if (Object.keys(oldValues).length > 0) {
                    configSnapshot.oldValues = oldValues;
                }
            }
            
            // --- SUBCOMANDO: LIMITES ---
            if (sub === 'limites') {
                const limitsToSet = [
                    { key: 'limit_exemplar', val: options.getInteger('meta_exemplar'), label: 'Meta Exemplar', default: 95 },
                    { key: 'limit_problematico', val: options.getInteger('alerta_ruim'), label: 'Alerta Problemático', default: 30 }
                ];
                
                // Capturar valores anteriores para log
                const oldValues = {};
                for (const item of limitsToSet) {
                    if (item.val !== null) {
                        oldValues[item.key] = ConfigSystem.getSetting(guildId, item.key);
                    }
                }
                
                for (const item of limitsToSet) {
                    if (item.val !== null) {
                        // Validar valores lógicos
                        if (item.key === 'limit_exemplar' && item.val <= (limitsToSet.find(l => l.key === 'limit_problematico')?.val || 30)) {
                            const warningEmbed = new EmbedBuilder()
                                .setColor(0xFFA500)
                                .setTitle('⚠️ Aviso de Configuração')
                                .setDescription(`O limite para **${item.label}** (${item.val}) está menor ou igual ao limite para **Problemático**. Isso pode causar sobreposição de cargos.`)
                                .setFooter({ text: 'Revise os limites para garantir separação adequada.' })
                                .setTimestamp();
                            
                            await interaction.editReply({ embeds: [warningEmbed] }).catch(() => null);
                        }
                        
                        // Salvar como string no banco
                        ConfigSystem.setSetting(guildId, item.key, item.val.toString());
                        changes.push(`${emojis.CHECK || '✅'} **${item.label}:** \`${item.val} pontos\``);
                        configSnapshot[item.key] = item.val;
                    }
                }
                
                if (Object.keys(oldValues).length > 0) {
                    configSnapshot.oldValues = oldValues;
                }
            }
            
            // --- VALIDAR SE HOUVE ALTERAÇÕES ---
            if (changes.length === 0) {
                // Limpar sessão
                SessionManager.delete(user.id, guildId, 'config_rep');
                
                const noChangesEmbed = new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle(`${emojis.WARNING || '⚠️'} Nenhuma Alteração`)
                    .setDescription('Nenhuma alteração foi especificada. Selecione pelo menos uma opção para configurar.')
                    .setFooter(ConfigSystem.getFooter(guild.name))
                    .setTimestamp();
                
                return await interaction.editReply({ embeds: [noChangesEmbed] });
            }
            
            // --- REGISTRAR ATIVIDADE NO LOG ---
            const activityId = db.logActivity(
                guildId,
                user.id,
                'config_rep_update',
                null,
                { 
                    command: 'config-rep',
                    subcommand: sub,
                    responseTime: Date.now() - startTime,
                    changes: configSnapshot,
                    changesList: changes
                }
            );
            
            // --- ATUALIZAR ANALYTICS DO STAFF ---
            await AnalyticsSystem.updateStaffAnalytics(guildId, user.id);
            
            // --- RESPOSTA VISUAL ---
            const embed = new EmbedBuilder()
                .setTitle(`${emojis.SETTINGS || '⚙️'} Reputação: Regras Atualizadas`)
                .setColor(0xDCA15E) // Cor padrão do sistema
                .setDescription(`As novas diretrizes foram aplicadas e o **AutoMod** passará a utilizá-las no próximo ciclo.\n\n${changes.join('\n')}`)
                .addFields(
                    { 
                        name: '📊 ID da Transação', 
                        value: `\`${activityId || 'N/A'}\``, 
                        inline: true 
                    },
                    { 
                        name: '🕒 Data', 
                        value: `<t:${Math.floor(Date.now() / 1000)}:F>`, 
                        inline: true 
                    }
                )
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            
            // Log silencioso de performance
            console.log(`📊 [CONFIG-REP] ${sub.toUpperCase()} por ${user.tag} em ${guild.name} | ${Date.now() - startTime}ms`);
            
            // Limpar sessão após sucesso
            SessionManager.delete(user.id, guildId, 'config_rep');
            
        } catch (error) {
            // 5. TRATAMENTO DE ERRO COM LOG DETALHADO
            console.error('❌ Erro no comando config-rep:', error);
            
            // Registrar erro no sistema de logs
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            // Registrar no banco
            db.logActivity(
                guildId,
                user.id,
                'error',
                null,
                { 
                    command: 'config-rep',
                    subcommand: options?.getSubcommand() || 'unknown',
                    error: error.message,
                    stack: error.stack
                }
            );
            
            // Limpar sessão em caso de erro
            SessionManager.delete(user.id, guildId, 'config_rep');
            
            // Resposta de erro amigável
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro ao Salvar Configurações')
                .setDescription('Ocorreu um erro crítico ao salvar as diretrizes de reputação. A equipe de staff foi notificada.')
                .addFields(
                    { name: 'Código do Erro', value: `\`${error.message?.slice(0, 100) || 'Desconhecido'}\``, inline: false },
                    { name: 'Subcomando', value: `\`${options?.getSubcommand() || 'unknown'}\``, inline: true },
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