const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const AnalyticsSystem = require('../../systems/analyticsSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ajuda')
        .setDescription('Guia de introdução e lista de comandos do Assistente Robin.'),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     * @param {import('discord.js').Client} client 
     */
    async execute(interaction, client) {
        const startTime = Date.now();
        const { member, guild, user } = interaction;
        
        // Obter emojis do sistema (se existirem)
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        try {
            // 1. GARANTIR QUE USUÁRIO E GUILD EXISTEM NO BANCO
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            // 2. OBTER CONFIGURAÇÕES DO SERVIDOR
            const ConfigSystem = require('../../systems/configSystem');
            const footerText = ConfigSystem.getSetting(guild.id, 'footer_text') || guild.name;
            
            // 3. OBTER ESTATÍSTICAS DO SERVIDOR
            const stats = {
                totalStrikes: db.prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ?`).get(guild.id).count,
                totalUsers: db.prepare(`SELECT COUNT(DISTINCT user_id) as count FROM reputation WHERE guild_id = ?`).get(guild.id).count,
                activeTickets: db.prepare(`SELECT COUNT(*) as count FROM tickets WHERE guild_id = ? AND status = 'open'`).get(guild.id)?.count || 0,
                avgReputation: db.prepare(`SELECT AVG(points) as avg FROM reputation WHERE guild_id = ?`).get(guild.id)?.avg || 100
            };
            
            // 4. CONSTRUÇÃO DA UI
            const description = [
                `# ${emojis.ROBIN || '🤖'} Assistente Robin`,
                `Olá **${member.displayName}**! Sou o sistema de gestão do **${guild.name}**.`,
                '',
                `### ${emojis.CONFIG || '⚙️'} 1. Configuração`,
                `- \`/config\`: Painel de controle da Staff.`,
                `- \`/botstatus\`: Integridade técnica do sistema.`,
                '',
                `### ${emojis.ACTION || '🛠️'} 2. Moderação`,
                `- \`/strike\`: Aplica punições e reduz reputação.`,
                `- \`/unstrike\`: Remove punições e restaura reputação.`,
                `- \`/historico\`: Consulta a ficha de um usuário.`,
                `- \`/rep-set\`: Ajuste manual de reputação.`,
                '',
                `### ${emojis.REPUTATION || '📊'} 3. Reputação`,
                `- **Máxima:** \`100\` pontos.`,
                `- **Status:** \`> 90\` (Exemplar) | \`< 30\` (Risco).`,
                `- **Recuperação:** +1 ponto/dia sem punições.`,
                '',
                `### 📈 4. Estatísticas do Servidor`,
                `- **Total de Strikes:** ${stats.totalStrikes}`,
                `- **Usuários Penalizados:** ${stats.totalUsers}`,
                `- **Reputação Média:** ${Math.round(stats.avgReputation)}/100`,
                stats.activeTickets > 0 ? `- **Tickets Ativos:** ${stats.activeTickets}` : '',
                '---',
                `> Use os comandos com responsabilidade. | v3.1`
            ].filter(line => line !== '').join('\n');

            const embed = new EmbedBuilder()
                .setColor(0xDCA15E) // Cor padrão Robin
                .setThumbnail(client.user.displayAvatarURL())
                .setDescription(description)
                .addFields({ 
                    name: `📡 Sistema`, 
                    value: `🟢 Operacional | v3.1`, 
                    inline: true 
                })
                .setFooter({ 
                    text: footerText, 
                    iconURL: guild.iconURL() || client.user.displayAvatarURL()
                })
                .setTimestamp();

            // 5. REGISTRAR ATIVIDADE NO LOG
            const activityId = db.logActivity(
                guild.id,
                user.id,
                'help_command',
                null,
                { 
                    command: 'ajuda',
                    responseTime: Date.now() - startTime,
                    stats: {
                        totalStrikes: stats.totalStrikes,
                        totalUsers: stats.totalUsers
                    }
                }
            );
            
            // 6. ATUALIZAR ANALYTICS DO STAFF (se o usuário for staff)
            const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
            if (staffRoleId && member.roles.cache.has(staffRoleId)) {
                await AnalyticsSystem.updateStaffAnalytics(guild.id, user.id);
            }
            
            // 7. RESPOSTA FINAL
            await interaction.editReply({ embeds: [embed] });
            
            // Log silencioso de performance
            console.log(`📊 [AJUDA] Executado por ${user.tag} em ${guild.name} | ${Date.now() - startTime}ms`);

        } catch (error) {
            // 8. TRATAMENTO DE ERRO COM LOG DETALHADO
            console.error('❌ Erro no comando ajuda:', error);
            
            // Registrar erro no sistema de logs
            const ErrorLogger = require('../../systems/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            
            // Registrar no banco
            db.logActivity(
                guild.id,
                user.id,
                'error',
                null,
                { 
                    command: 'ajuda',
                    error: error.message,
                    stack: error.stack
                }
            );
            
            // Resposta de erro amigável
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ Erro ao executar comando')
                .setDescription('Ocorreu um erro interno ao gerar o guia de ajuda. A equipe de staff foi notificada.')
                .setFooter({ text: 'Caso persista, contate um administrador.' })
                .setTimestamp();
            
            await interaction.editReply({ 
                embeds: [errorEmbed],
                content: null
            }).catch(() => null);
        }
    }
};