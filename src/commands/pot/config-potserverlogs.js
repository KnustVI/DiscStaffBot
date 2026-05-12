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
        const categoryName = interaction.options.getString('categoria') || '📊 PATH OF TITANS LOGS';
        
        const config = PoTConfigSystem.getServerConfig(interaction.guildId);
        if (!config) {
            await interaction.editReply({ content: '❌ Configure o servidor primeiro com `/config-potserver set`' });
            return;
        }
        
        let token = PoTTokenManager.getToken(interaction.guildId);
        if (!token) token = PoTTokenManager.generateToken(interaction.guildId);
        
        const publicDomain = process.env.POT_PUBLIC_URL || 'https://api.seubot.com';

        try {
            let category = interaction.guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);
            if (!category) {
                category = await interaction.guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory });
            }
            
            const createdChannels = [];
            
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
                
                const webhook = await channel.createWebhook({
                    name: `PoT ${log.name.split(' ')[0]} Logger`,
                    reason: `Webhook para logs de ${log.event}`
                });
                
                PoTConfigSystem.setWebhookForEvent(interaction.guildId, log.event, webhook.url);
            }
            
            const gameIniLines = ['[ServerWebhooks]', 'bEnabled=true', 'Format="General"', ''];
            for (const log of LOG_CHANNELS) {
                gameIniLines.push(`${log.endpoint}="${publicDomain}/${log.event}?token=${token}"`);
            }
            const gameIniConfig = gameIniLines.join('\n');
            
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('📋 Canais de Log Configurados')
                .setDescription(`✅ ${createdChannels.length} canais criados na categoria "${categoryName}"\n📌 ${LOG_CHANNELS.length - createdChannels.length} canais reutilizados.`)
                .addFields({ name: '🔑 Token Atual', value: `\`${token}\``, inline: false })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            
            await interaction.followUp({
                content: `📄 **Copie para seu Game.ini:**\n\`\`\`ini\n${gameIniConfig}\n\`\`\``,
                flags: 64
            });
            
        } catch (error) {
            console.error('❌ Erro:', error);
            await interaction.editReply({ 
                content: `❌ Erro: ${error.message}\n\nVerifique as permissões do bot.`
            });
        }
    }
};