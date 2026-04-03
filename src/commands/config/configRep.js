const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const sessionManager = require('../../utils/sessionManager');
const AnalyticsSystem = require('../../systems/analyticsSystem');
const ResponseManager = require('../../utils/responseManager');

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
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Permissão Negada')
                    .setDescription('Apenas administradores podem configurar o sistema de reputação.')
                    .setTimestamp();
                
                return await ResponseManager.send(interaction, { embeds: [errorEmbed] });
            }
            
            // Garantir registros no banco
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            const ConfigSystem = require('../../systems/configSystem');
            const sub = options.getSubcommand();
            
            let changes = [];
            let configSnapshot = {};
            
            // Criar sessão com isolamento total
            sessionManager.set(
                user.id,
                guildId,
                'config-rep',
                sub,
                { 
                    timestamp: Date.now(),
                    subcommand: sub,
                    userId: user.id,
                    guildId: guildId
                },
                300000
            );
            
            // ==================== SUBCOMANDO: CARGOS ====================
            if (sub === 'cargos') {
                const rolesToSet = [
                    { key: 'role_exemplar', role: options.getRole('exemplar'), label: 'Exemplar' },
                    { key: 'role_problematico', role: options.getRole('problematico'), label: 'Problemático' },
                    { key: 'strike_role', role: options.getRole('strike'), label: 'Strike' }
                ];
                
                const oldValues = {};
                for (const item of rolesToSet) {
                    if (item.role) {
                        oldValues[item.key] = ConfigSystem.getSetting(guildId, item.key);
                    }
                }
                
                for (const item of rolesToSet) {
                    if (item.role) {
                        ConfigSystem.setSetting(guildId, item.key, item.role.id);
                        changes.push(`${emojis.Check || '✅'} **${item.label}:** ${item.role}`);
                        configSnapshot[item.key] = item.role.id;
                    }
                }
                
                if (Object.keys(oldValues).length > 0) {
                    configSnapshot.oldValues = oldValues;
                }
            }
            
            // ==================== SUBCOMANDO: LIMITES ====================
            if (sub === 'limites') {
                const limitsToSet = [
                    { key: 'limit_exemplar', val: options.getInteger('meta_exemplar'), label: 'Meta Exemplar', default: 95 },
                    { key: 'limit_problematico', val: options.getInteger('alerta_ruim'), label: 'Alerta Problemático', default: 30 }
                ];
                
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
                            
                            await ResponseManager.warning(interaction, null, { embeds: [warningEmbed] });
                        }
                        
                        ConfigSystem.setSetting(guildId, item.key, item.val.toString());
                        changes.push(`${emojis.Check || '✅'} **${item.label}:** \`${item.val} pontos\``);
                        configSnapshot[item.key] = item.val;
                    }
                }
                
                if (Object.keys(oldValues).length > 0) {
                    configSnapshot.oldValues = oldValues;
                }
            }
            
            // Validar se houve alterações
            if (changes.length === 0) {
                sessionManager.delete(user.id, guildId, 'config-rep', sub);
                
                const noChangesEmbed = new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle(`${emojis.Warning || '⚠️'} Nenhuma Alteração`)
                    .setDescription('Nenhuma alteração foi especificada. Selecione pelo menos uma opção para configurar.')
                    .setFooter(ConfigSystem.getFooter(guild.name))
                    .setTimestamp();
                
                return await ResponseManager.send(interaction, { embeds: [noChangesEmbed] });
            }
            
            // Registrar atividade
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
            
            // Atualizar analytics
            await AnalyticsSystem.updateStaffAnalytics(guildId, user.id);
            
            // Resposta visual
            const embed = new EmbedBuilder()
                .setTitle(`${emojis.Config || '⚙️'} Reputação: Regras Atualizadas`)
                .setColor(0xDCA15E)
                .setDescription(`As novas diretrizes foram aplicadas.\n\n${changes.join('\n')}`)
                .addFields(
                    { name: '🕒 Data', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                )
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();
            
            await ResponseManager.send(interaction, { embeds: [embed] });
            
            console.log(`📊 [CONFIG-REP] ${sub.toUpperCase()} por ${user.tag} | ${Date.now() - startTime}ms`);
            
            // Limpar sessão
            sessionManager.delete(user.id, guildId, 'config-rep', sub);
            
        } catch (error) {
            console.error('❌ Erro no config-rep:', error);
            
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            db.logActivity(guildId, user.id, 'error', null, { 
                command: 'config-rep',
                subcommand: options?.getSubcommand() || 'unknown',
                error: error.message
            });
            
            sessionManager.delete(user.id, guildId, 'config-rep', options?.getSubcommand() || 'unknown');
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro ao Salvar Configurações')
                .setDescription('Ocorreu um erro crítico. A equipe foi notificada.')
                .addFields(
                    { name: 'Código do Erro', value: `\`${error.message?.slice(0, 100) || 'Desconhecido'}\`` },
                    { name: 'Subcomando', value: `\`${options?.getSubcommand() || 'unknown'}\``, inline: true }
                )
                .setFooter({ text: 'Caso persista, contate um administrador.' })
                .setTimestamp();
            
            await ResponseManager.send(interaction, { embeds: [errorEmbed] });
        }
    }
};