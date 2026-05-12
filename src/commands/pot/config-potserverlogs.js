const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType, PermissionsBitField } = require('discord.js');
const { getInstance } = require('../../integrations/pathoftitans');
const PoTConfigSystem = require('../../systems/potConfigSystem');

// Categorias de logs (organizadas como você pediu)
const LOG_CATEGORIES = [
    { name: '📥 𝑳𝑶𝑮⋅𝙂𝙖𝙢𝙚▸login', emoji: '📥', events: ['login', 'logout', 'leave'], webhookPath: '/pot/login' },
    { name: '💔 𝑳𝑶𝑮⋅𝙂𝙖𝙢𝙚▸damaged', emoji: '💔', events: ['damaged'], webhookPath: '/pot/damaged' },
    { name: '💀 𝑳𝑶𝑮⋅𝙂𝙖𝙢𝙚▸killed', emoji: '💀', events: ['killed'], webhookPath: '/pot/killed' },
    { name: '👥 𝑳𝑶𝑮⋅𝙂𝙖𝙢𝙚▸group', emoji: '👥', events: ['join_group', 'leave_group'], webhookPath: '/pot/group' },
    { name: '🪺 𝑳𝑶𝑮⋅𝙂𝙖𝙢𝙚▸nest', emoji: '🪺', events: ['nest_create', 'nest_destroy', 'nest_invite'], webhookPath: '/pot/nest' },
    { name: '📜 𝑳𝑶𝑮⋅𝙂𝙖𝙢𝙚▸quests', emoji: '📜', events: ['quest_complete', 'quest_failed'], webhookPath: '/pot/quest' },
    { name: '🔄 𝑳𝑶𝑮⋅𝙂𝙖𝙢𝙚▸respawn', emoji: '🔄', events: ['respawn'], webhookPath: '/pot/respawn' },
    { name: '✨ 𝑳𝑶𝑮⋅𝙂𝙖𝙢𝙚▸waystone', emoji: '✨', events: ['waystone'], webhookPath: '/pot/waystone' },
    { name: '💬 𝑳𝑶𝑮⋅𝙂𝙖𝙢𝙚▸chat', emoji: '💬', events: ['chat'], webhookPath: '/pot/chat' },
    { name: '⚡ 𝑳𝑶𝑮⋅𝙂𝙖𝙢𝙚▸command', emoji: '⚡', events: ['player_command'], webhookPath: '/pot/command' },
    { name: '👑 𝑳𝑶𝑮⋅𝙂𝙖𝙢𝙚▸adm-command', emoji: '👑', events: ['admin_command'], webhookPath: '/pot/admin_command' },
    { name: '👁️ 𝑳𝑶𝑮⋅𝙂𝙖𝙢𝙚▸adm-spectate', emoji: '👁️', events: ['admin_spectate'], webhookPath: '/pot/spectate' },
    { name: '🔄 𝑳𝑶𝑮⋅𝙂𝙖𝙢𝙚▸start/restart', emoji: '🔄', events: ['server_start', 'server_restart'], webhookPath: '/pot/server' },
    { name: '⚠️ 𝑳𝑶𝑮⋅𝙂𝙖𝙢𝙚▸error/alert', emoji: '⚠️', events: ['error', 'alert'], webhookPath: '/pot/error' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-potserverlogs')
        .setDescription('📋 Cria automaticamente os canais de log do Path of Titans')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt
            .setName('categoria')
            .setDescription('Categoria onde os canais serão criados (opcional)')
            .setRequired(false)
        ),

    async execute(interaction, client) {
        await interaction.deferReply({ flags: 64 });

        const categoryName = interaction.options.getString('categoria') || '📊 PATH OF TITANS LOGS';
        
        // Verificar se o servidor PoT está configurado
        const config = PoTConfigSystem.getServerConfig(interaction.guildId);
        if (!config || !config.enabled) {
            return await interaction.editReply({
                content: '❌ Primeiro configure o servidor com `/config-potserver set` antes de criar os canais de log.'
            });
        }

        const potIntegration = getInstance(client);
        const token = PoTTokenManager.getToken(interaction.guildId);
        const baseUrl = `http://${config.server_ip}:${config.webhook_port}`;

        try {
            // Criar ou obter categoria
            let category = interaction.guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);
            
            if (!category) {
                category = await interaction.guild.channels.create({
                    name: categoryName,
                    type: ChannelType.GuildCategory,
                    reason: 'Categoria para logs do Path of Titans'
                });
                await interaction.editReply({ content: `📁 Categoria "${categoryName}" criada.` });
            }

            const results = [];
            
            // Criar canais e webhooks para cada categoria
            for (const logCat of LOG_CATEGORIES) {
                try {
                    // Verificar se canal já existe
                    let channel = interaction.guild.channels.cache.find(
                        c => c.name === logCat.name && c.parentId === category.id
                    );
                    
                    if (!channel) {
                        channel = await interaction.guild.channels.create({
                            name: logCat.name,
                            type: ChannelType.GuildText,
                            parent: category.id,
                            topic: `📊 Logs de ${logCat.events.join(', ')} do Path of Titans`,
                            permissionOverwrites: [
                                {
                                    id: interaction.guild.id,
                                    deny: [PermissionsBitField.Flags.SendMessages],
                                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory]
                                }
                            ]
                        });
                    }
                    
                    // Criar webhook no canal
                    const webhook = await channel.createWebhook({
                        name: `PoT ${logCat.emoji} Logger`,
                        avatar: 'https://i.imgur.com/7I0q8qF.png',
                        reason: `Webhook para logs de ${logCat.name}`
                    });
                    
                    // Salvar configuração do webhook
                    PoTConfigSystem.setWebhookForEvent(interaction.guildId, logCat.events[0], webhook.url);
                    
                    results.push({
                        channel: logCat.name,
                        url: webhook.url,
                        status: '✅'
                    });
                    
                } catch (err) {
                    results.push({
                        channel: logCat.name,
                        error: err.message,
                        status: '❌'
                    });
                }
            }
            
            // Atualizar Game.ini com as configurações dos webhooks
            const webhookConfigs = {
                PlayerLogin: `${baseUrl}/pot/login`,
                PlayerLogout: `${baseUrl}/pot/login`,
                PlayerLeave: `${baseUrl}/pot/login`,
                PlayerDamagedPlayer: `${baseUrl}/pot/damaged`,
                PlayerKilled: `${baseUrl}/pot/killed`,
                PlayerJoinedGroup: `${baseUrl}/pot/group`,
                PlayerLeftGroup: `${baseUrl}/pot/group`,
                CreateNest: `${baseUrl}/pot/nest`,
                DestroyNest: `${baseUrl}/pot/nest`,
                NestInvite: `${baseUrl}/pot/nest`,
                PlayerQuestComplete: `${baseUrl}/pot/quest`,
                PlayerQuestFailed: `${baseUrl}/pot/quest`,
                PlayerRespawn: `${baseUrl}/pot/respawn`,
                PlayerWaystone: `${baseUrl}/pot/waystone`,
                PlayerChat: `${baseUrl}/pot/chat`,
                PlayerCommand: `${baseUrl}/pot/command`,
                AdminCommand: `${baseUrl}/pot/admin_command`,
                AdminSpectate: `${baseUrl}/pot/spectate`,
                ServerStart: `${baseUrl}/pot/server`,
                ServerRestart: `${baseUrl}/pot/server`,
                ServerError: `${baseUrl}/pot/error`,
                SecurityAlert: `${baseUrl}/pot/error`
            };
            
            PoTConfigSystem.setWebhookConfigs(interaction.guildId, webhookConfigs);
            
            // Enviar resumo
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('📋 Canais de Log Criados')
                .setDescription(`✅ ${LOG_CATEGORIES.length} canais criados/configurados na categoria "${categoryName}"`)
                .addFields(
                    { name: '📡 Base URL', value: baseUrl, inline: true },
                    { name: '🎮 Servidor', value: config.server_ip, inline: true },
                    { name: '📝 Próximo passo', value: 'Adicione as URLS abaixo no arquivo `Game.ini` do seu servidor.', inline: false }
                )
                .setTimestamp();
            
            // Listar canais criados
            const successList = results.filter(r => r.status === '✅').map(r => `✅ ${r.channel}`).join('\n');
            const errorList = results.filter(r => r.status === '❌').map(r => `❌ ${r.channel}: ${r.error}`).join('\n');
            
            if (successList) {
                embed.addFields({ name: '📋 Canais Criados', value: successList, inline: false });
            }
            if (errorList) {
                embed.addFields({ name: '⚠️ Falhas', value: errorList, inline: false });
            }
            
            // Gerar configuração para Game.ini
            let gameIniConfig = `[ServerWebhooks]\nbEnabled=true\nFormat="General"\n`;
            for (const [event, url] of Object.entries(webhookConfigs)) {
                gameIniConfig += `${event}="${url}"\n`;
            }
            
            embed.addFields({
                name: '📄 Copie para seu Game.ini',
                value: `\`\`\`ini\n${gameIniConfig}\n\`\`\``,
                inline: false
            });
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('❌ Erro ao criar canais:', error);
            await interaction.editReply({
                content: `❌ Erro ao criar canais: ${error.message}\n\nVerifique se o bot tem permissão de "Gerenciar Canais" e "Gerenciar Webhooks".`
            });
        }
    }
};