// src/commands/pot/config-potserverlogs.js
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const PoTTokenManager = require('../../integrations/pathoftitans/tokenManager');
const PoTConfigSystem = require('../../systems/potConfigSystem');

const LOG_CHANNELS = [
    { name: '📥 login', event: 'login', endpoint: 'PlayerLogin' },
    { name: '💀 killed', event: 'killed', endpoint: 'PlayerKilled' },
    { name: '💬 chat', event: 'chat', endpoint: 'PlayerChat' },
    { name: '👥 group', event: 'group', endpoint: 'PlayerJoinedGroup' },
    { name: '🪺 nest', event: 'nest', endpoint: 'CreateNest' },
    { name: '📜 quest', event: 'quest', endpoint: 'PlayerQuestComplete' },
    { name: '🔄 respawn', event: 'respawn', endpoint: 'PlayerRespawn' },
    { name: '✨ waystone', event: 'waystone', endpoint: 'PlayerWaystone' },
    { name: '⚡ command', event: 'command', endpoint: 'PlayerCommand' },
    { name: '👑 admin', event: 'admin_command', endpoint: 'AdminCommand' },
    { name: '⚠️ error', event: 'error', endpoint: 'ServerError' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-potserverlogs')
        .setDescription('📋 Cria canais de log do Path of Titans')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt.setName('categoria').setDescription('Nome da categoria (opcional)')),

    async execute(interaction, client) {
        await interaction.deferReply({ flags: 64 });
        
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
        
        const publicUrl = process.env.POT_GATEWAY_URL || `http://${config.server_ip}:${config.webhook_port || 8080}`;

        try {
            // 1. Criar ou obter categoria
            let category = interaction.guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);
            if (!category) {
                category = await interaction.guild.channels.create({ 
                    name: categoryName, 
                    type: ChannelType.GuildCategory 
                });
                await interaction.editReply({ content: `📁 Categoria "${categoryName}" criada.` });
            }
            
            const createdChannels = [];
            const webhookUrls = {};
            
            // 2. Criar canais e webhooks
            for (const log of LOG_CHANNELS) {
                let channel = interaction.guild.channels.cache.find(c => c.name === log.name && c.parentId === category.id);
                
                if (!channel) {
                    channel = await interaction.guild.channels.create({
                        name: log.name,
                        type: ChannelType.GuildText,
                        parent: category.id,
                        topic: `📊 Logs de ${log.event} do Path of Titans`
                    });
                    createdChannels.push(log.name);
                }
                
                // Criar webhook
                const webhook = await channel.createWebhook({
                    name: `PoT ${log.emoji} Logger`,
                    reason: `Webhook para logs de ${log.event}`
                });
                
                webhookUrls[log.endpoint] = `${publicUrl}/${log.event}?token=${token}`;
                PoTConfigSystem.setWebhookForEvent(interaction.guildId, log.event, webhook.url);
            }
            
            // 3. Gerar configuração do Game.ini (em partes para não estourar limite)
            let gameIniLines = ['[ServerWebhooks]', 'bEnabled=true', 'Format="General"', ''];
            for (const log of LOG_CHANNELS) {
                gameIniLines.push(`${log.endpoint}="${publicUrl}/${log.event}?token=${token}"`);
            }
            const gameIniConfig = gameIniLines.join('\n');
            
            // 4. Criar resposta (usando campo separado para não estourar limite)
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('📋 Canais de Log Criados')
                .setDescription(`✅ ${createdChannels.length} canais criados na categoria "${categoryName}"`)
                .addFields(
                    { name: '🔑 Token Atual', value: `\`${token}\``, inline: false },
                    { name: '📝 Próximo passo', value: 'Copie a configuração abaixo para seu `Game.ini`', inline: false }
                )
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed], content: null });
            
            // 5. Enviar a configuração do Game.ini em uma mensagem separada (para não estourar limite do embed)
            await interaction.followUp({
                content: `📄 **Copie para seu Game.ini:**\n\`\`\`ini\n${gameIniConfig}\n\`\`\``,
                flags: 64
            });
            
        } catch (error) {
            console.error('❌ Erro:', error);
            await interaction.editReply({ 
                content: `❌ Erro: ${error.message}\n\nVerifique se o bot tem permissão de "Gerenciar Canais" e "Gerenciar Webhooks".`
            });
        }
    }
};