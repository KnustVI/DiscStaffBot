// src/commands/pot/config-potserverlogs.js
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const PoTTokenManager = require('../../integrations/pathoftitans/tokenManager');
const PoTConfigSystem = require('../../systems/potConfigSystem');

// Categorias de logs (versão simplificada)
const LOG_CHANNELS = [
    { name: '📥 login', event: 'login', emoji: '📥' },
    { name: '💀 killed', event: 'killed', emoji: '💀' },
    { name: '💬 chat', event: 'chat', emoji: '💬' },
    { name: '👥 group', event: 'group', emoji: '👥' },
    { name: '🪺 nest', event: 'nest', emoji: '🪺' },
    { name: '📜 quest', event: 'quest', emoji: '📜' },
    { name: '🔄 respawn', event: 'respawn', emoji: '🔄' },
    { name: '✨ waystone', event: 'waystone', emoji: '✨' },
    { name: '⚡ command', event: 'command', emoji: '⚡' },
    { name: '👑 admin', event: 'admin_command', emoji: '👑' },
    { name: '⚠️ error', event: 'error', emoji: '⚠️' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-potserverlogs')
        .setDescription('📋 Cria canais de log do Path of Titans')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('categoria').setDescription('Nome da categoria (opcional)')),

    async execute(interaction, client) {
        const categoryName = interaction.options.getString('categoria') || '📊 PATH OF TITANS LOGS';
        
        // Verificar se servidor está configurado
        const config = PoTConfigSystem.getServerConfig(interaction.guildId);
        if (!config) {
            return await interaction.editReply({
                content: '❌ Configure o servidor primeiro com `/config-potserver set`'
            });
        }
        
        // Verificar token
        let token = PoTTokenManager.getToken(interaction.guildId);
        if (!token) token = PoTTokenManager.generateToken(interaction.guildId);
        
        await interaction.editReply({ content: '📁 Criando canais...' });

        try {
            // Criar ou obter categoria
            let category = interaction.guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);
            if (!category) {
                category = await interaction.guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory });
            }
            
            const results = [];
            const publicUrl = process.env.POT_GATEWAY_URL || 'http://localhost:8080';
            
            // Criar canais
            for (const log of LOG_CHANNELS) {
                let channel = interaction.guild.channels.cache.find(c => c.name === log.name && c.parentId === category.id);
                
                if (!channel) {
                    channel = await interaction.guild.channels.create({
                        name: log.name,
                        type: ChannelType.GuildText,
                        parent: category.id,
                        topic: `📊 Logs de ${log.event} do Path of Titans`
                    });
                }
                
                // Criar webhook
                const webhook = await channel.createWebhook({
                    name: `PoT ${log.emoji} Logger`,
                    reason: `Webhook para logs de ${log.event}`
                });
                
                // Salvar webhook
                PoTConfigSystem.setWebhookForEvent(interaction.guildId, log.event, webhook.url);
                results.push(`✅ ${log.name}`);
            }
            
            // Gerar URLs para o Game.ini
            let gameIniConfig = `[ServerWebhooks]\nbEnabled=true\nFormat="General"\n`;
            for (const log of LOG_CHANNELS) {
                gameIniConfig += `${log.event === 'login' ? 'PlayerLogin' : 
                                   log.event === 'killed' ? 'PlayerKilled' :
                                   log.event === 'chat' ? 'PlayerChat' :
                                   log.event === 'group' ? 'PlayerJoinedGroup' :
                                   log.event === 'nest' ? 'CreateNest' :
                                   log.event === 'quest' ? 'PlayerQuestComplete' :
                                   log.event === 'respawn' ? 'PlayerRespawn' :
                                   log.event === 'waystone' ? 'PlayerWaystone' :
                                   log.event === 'command' ? 'PlayerCommand' :
                                   log.event === 'admin_command' ? 'AdminCommand' :
                                   'ServerError'}="${publicUrl}/${log.event}?token=${token}"\n`;
            }
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('📋 Canais de Log Criados')
                .setDescription(`✅ ${results.length} canais criados na categoria "${categoryName}"`)
                .addFields(
                    { name: '📝 Próximo passo', value: 'Copie a configuração abaixo para seu `Game.ini`', inline: false },
                    { name: '📄 Configuração', value: `\`\`\`ini\n${gameIniConfig}\n\`\`\``, inline: false }
                )
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed], content: null });
            
        } catch (error) {
            console.error('❌ Erro:', error);
            await interaction.editReply({ 
                content: `❌ Erro: ${error.message}\n\nVerifique se o bot tem permissão de "Gerenciar Canais" e "Gerenciar Webhooks".`
            });
        }
    }
};