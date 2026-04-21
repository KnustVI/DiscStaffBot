const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const ResponseManager = require('../../utils/responseManager');
const EmbedFormatter = require('../../utils/embedFormatter');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('automod')
        .setDescription('🛡️ Gerencia o sistema de Auto Moderação')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('toggle')
            .setDescription('🔄 Liga/Desliga o sistema de auto moderação')
        )
        .addSubcommand(sub => sub
            .setName('config')
            .setDescription('⚙️ Configura limites da auto moderação')
        )
        .addSubcommand(sub => sub
            .setName('report')
            .setDescription('📊 Gera relatório da auto moderação')
        )
        .addSubcommand(sub => sub
            .setName('test')
            .setDescription('🧪 Testa a configuração da auto moderação')
        ),

    async execute(interaction, client) {
        const { guild, user, member } = interaction;
        const subcommand = interaction.options.getSubcommand();
        
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        const ConfigSystem = require('../../systems/configSystem');
        const AutoModSystem = require('../../systems/autoModeration');
        
        // ==================== TEST ====================
        if (subcommand === 'test') {
            await interaction.deferReply({ flags: 64 });
            
            const guildId = guild.id;
            
            // Verificações
            const checks = {
                automod_enabled: ConfigSystem.getSetting(guildId, 'automod_enabled') === 'true',
                limit_exemplar: ConfigSystem.getSetting(guildId, 'limit_exemplar'),
                limit_problematico: ConfigSystem.getSetting(guildId, 'limit_problematico'),
                role_exemplar: ConfigSystem.getSetting(guildId, 'role_exemplar'),
                role_problematico: ConfigSystem.getSetting(guildId, 'role_problematico'),
                log_automod: ConfigSystem.getSetting(guildId, 'log_automod'),
                last_run: ConfigSystem.getSetting(guildId, 'last_automod_run'),
                last_log: ConfigSystem.getSetting(guildId, 'last_automod_log')
            };
            
            // Validar cada configuração
            const issues = [];
            const warnings = [];
            
            // Verificar se está ativado
            if (!checks.automod_enabled) {
                issues.push('❌ Auto Moderação está **DESATIVADA**. Use `/automod toggle` para ativar.');
            } else {
                warnings.push('✅ Auto Moderação está **ATIVADA**');
            }
            
            // Verificar limites
            if (!checks.limit_exemplar) {
                issues.push('❌ Limite Exemplar não configurado. Use `/automod config limits` para configurar.');
            } else {
                const limitEx = parseInt(checks.limit_exemplar);
                if (limitEx < 50 || limitEx > 100) {
                    issues.push(`⚠️ Limite Exemplar (${limitEx}) está fora do recomendado (50-100).`);
                } else {
                    warnings.push(`✅ Limite Exemplar: ${limitEx} pontos`);
                }
            }
            
            if (!checks.limit_problematico) {
                issues.push('❌ Limite Problemático não configurado. Use `/automod config limits` para configurar.');
            } else {
                const limitProb = parseInt(checks.limit_problematico);
                if (limitProb < 0 || limitProb > 50) {
                    issues.push(`⚠️ Limite Problemático (${limitProb}) está fora do recomendado (0-50).`);
                } else {
                    warnings.push(`✅ Limite Problemático: ${limitProb} pontos`);
                }
            }
            
            // Verificar cargos
            if (!checks.role_exemplar) {
                issues.push('❌ Cargo Exemplar não configurado. Use `/config-roles` para configurar.');
            } else {
                const role = guild.roles.cache.get(checks.role_exemplar);
                if (role) {
                    warnings.push(`✅ Cargo Exemplar: ${role.name}`);
                } else {
                    issues.push(`❌ Cargo Exemplar (ID: ${checks.role_exemplar}) não encontrado no servidor.`);
                }
            }
            
            if (!checks.role_problematico) {
                issues.push('❌ Cargo Problemático não configurado. Use `/config-roles` para configurar.');
            } else {
                const role = guild.roles.cache.get(checks.role_problematico);
                if (role) {
                    warnings.push(`✅ Cargo Problemático: ${role.name}`);
                } else {
                    issues.push(`❌ Cargo Problemático (ID: ${checks.role_problematico}) não encontrado no servidor.`);
                }
            }
            
            // Verificar canal de log
            if (!checks.log_automod) {
                issues.push('❌ Canal de log da Auto Moderação não configurado. Use `/config-logs` para configurar.');
            } else {
                const channel = guild.channels.cache.get(checks.log_automod);
                if (channel) {
                    warnings.push(`✅ Canal de log: ${channel.name}`);
                    
                    // Verificar permissões do bot
                    const botMember = guild.members.me;
                    const permissions = channel.permissionsFor(botMember);
                    
                    if (!permissions.has('ViewChannel')) {
                        issues.push(`❌ Bot não tem permissão para **ver** o canal ${channel.name}.`);
                    }
                    if (!permissions.has('SendMessages')) {
                        issues.push(`❌ Bot não tem permissão para **enviar mensagens** no canal ${channel.name}.`);
                    }
                    if (!permissions.has('EmbedLinks')) {
                        issues.push(`❌ Bot não tem permissão para **enviar embeds** no canal ${channel.name}.`);
                    }
                } else {
                    issues.push(`❌ Canal de log (ID: ${checks.log_automod}) não encontrado no servidor.`);
                }
            }
            
            // Verificar última execução
            let lastRunText = 'Nunca executado';
            if (checks.last_run) {
                const lastRunDate = new Date(parseInt(checks.last_run));
                lastRunText = `<t:${Math.floor(lastRunDate.getTime() / 1000)}:R>`;
            }
            
            let lastLogText = 'Nunca enviado';
            if (checks.last_log) {
                lastLogText = checks.last_log;
            }
            
            // Verificar estatísticas básicas
            const db = require('../../database/index');
            const totalUsers = db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM reputation WHERE guild_id = ?`).get(guildId)?.count || 0;
            const avgRep = db.prepare(`SELECT AVG(points) as avg FROM reputation WHERE guild_id = ?`).get(guildId)?.avg || 0;
            
            // Montar embed
            const statusColor = issues.length === 0 ? 0x00FF00 : (issues.length > 2 ? 0xFF0000 : 0xFFA500);
            const statusIcon = issues.length === 0 ? '✅' : (issues.length > 2 ? '🔴' : '⚠️');
            
            const embed = new EmbedBuilder()
                .setColor(statusColor)
                .setThumbnail(guild.iconURL())
                .setDescription(`# ${statusIcon} Diagnóstico da Auto Moderação\n**Servidor:** ${guild.name}`)
                .addFields(
                    { name: '📋 Status Geral', value: issues.length === 0 ? '✅ Tudo configurado corretamente!' : `⚠️ ${issues.length} problema(s) encontrado(s)`, inline: false },
                    { name: '⚙️ Configurações', value: warnings.join('\n') || 'Nenhuma configuração válida', inline: false }
                );
            
            if (issues.length > 0) {
                embed.addFields({ name: '❌ Problemas Encontrados', value: issues.join('\n'), inline: false });
            }
            
            embed.addFields(
                { name: '📊 Estatísticas', value: `👥 Usuários no sistema: ${totalUsers}\n⭐ Reputação média: ${Math.round(avgRep)}/100`, inline: true },
                { name: '🕐 Última Execução', value: lastRunText, inline: true },
                { name: '📝 Último Log', value: lastLogText, inline: true }
            );
            
            embed.setFooter(EmbedFormatter.getFooter(guild.name))
                .setTimestamp();
            
            // Tentar executar teste rápido
            const autoMod = new AutoModSystem(client);
            
            // Testar se consegue buscar o canal de log
            let channelTest = '❌ Não testado';
            if (checks.log_automod) {
                try {
                    const testChannel = await guild.channels.fetch(checks.log_automod);
                    if (testChannel) {
                        channelTest = `✅ Canal ${testChannel.name} acessível`;
                    }
                } catch (err) {
                    channelTest = `❌ Erro ao acessar canal: ${err.message}`;
                }
            }
            
            embed.addFields({ name: '🔍 Teste de Conexão', value: channelTest, inline: false });
            
            await interaction.editReply({ embeds: [embed] });
            return;
        }
        
        // ==================== TOGGLE ====================
        if (subcommand === 'toggle') {
            const AutoMod = require('../../systems/autoModeration');
            const autoMod = new AutoMod(client);
            await autoMod.handleToggleAutoMod(interaction);
            return;
        }
        
        // ==================== CONFIG ====================
        if (subcommand === 'config') {
            const AutoMod = require('../../systems/autoModeration');
            const autoMod = new AutoMod(client);
            await autoMod.handleAutoModConfig(interaction, 'limits', guild.name);
            return;
        }
        
        // ==================== REPORT ====================
        if (subcommand === 'report') {
            const AutoMod = require('../../systems/autoModeration');
            const autoMod = new AutoMod(client);
            await autoMod.handleAutoModReport(interaction, guild.name);
            return;
        }
    }
};