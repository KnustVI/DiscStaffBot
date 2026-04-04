const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType, Perms } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-logs')
        .setDescription('📝 Configura os canais de log do sistema.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const { guild, user, member } = interaction;
        const guildId = guild.id;
        
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
        }
        
        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
        
        const ConfigSystem = require('../../systems/configSystem');
        
        const logGeral = ConfigSystem.getSetting(guildId, 'log_channel');
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setTitle('📝 Canais de Log')
            .setDescription('Configure os canais para cada sistema:')
            .addFields(
                { name: '📜 Geral', value: logGeral ? `<#${logGeral}>` : '`❌ Não definido`', inline: false },
                { name: '🛡️ AutoModeração', value: '`⏳ Aguardando configuração`', inline: true },
                { name: '⚖️ Punições', value: '`⏳ Aguardando configuração`', inline: true },
                { name: '🎫 Tickets', value: '`⏳ Aguardando configuração`', inline: true }
            )
            .setFooter(ConfigSystem.getFooter(guild.name))
            .setTimestamp();
        
        const row1 = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:geral')
                .setPlaceholder('Selecionar canal de logs gerais')
                .addChannelTypes(ChannelType.GuildText)
        );
        
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config-logs:criar')
                .setLabel('➕ Criar Canais Automaticamente')
                .setStyle(ButtonStyle.Success)
                .setEmoji('➕')
        );
        
        await ResponseManager.send(interaction, { embeds: [embed], components: [row1, row2] });
    },
    
    // Método para criar canais automaticamente (chamado via handler)
    async createLogChannels(interaction) {
        const guild = interaction.guild;
        const ConfigSystem = require('../../systems/configSystem');
        
        // Criar categoria
        const category = await guild.channels.create({
            name: '📊 LOGS DO SISTEMA',
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [Perms.ViewChannel]
                },
                {
                    id: interaction.client.user.id,
                    allow: [Perms.ViewChannel, Perms.SendMessages, Perms.EmbedLinks]
                }
            ]
        });
        
        // Criar canais
        const channels = {
            geral: await guild.channels.create({
                name: '📜 logs-gerais',
                type: ChannelType.GuildText,
                parent: category.id
            }),
            automod: await guild.channels.create({
                name: '🛡️ logs-automod',
                type: ChannelType.GuildText,
                parent: category.id
            }),
            punishments: await guild.channels.create({
                name: '⚖️ logs-punicoes',
                type: ChannelType.GuildText,
                parent: category.id
            }),
            tickets: await guild.channels.create({
                name: '🎫 logs-tickets',
                type: ChannelType.GuildText,
                parent: category.id
            })
        };
        
        // Salvar no banco
        ConfigSystem.setSetting(guild.id, 'log_channel', channels.geral.id);
        ConfigSystem.setSetting(guild.id, 'log_automod', channels.automod.id);
        ConfigSystem.setSetting(guild.id, 'log_punishments', channels.punishments.id);
        ConfigSystem.setSetting(guild.id, 'log_tickets', channels.tickets.id);
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Canais de Log Criados')
            .setDescription('Os seguintes canais foram criados:')
            .addFields(
                { name: '📜 Geral', value: `<#${channels.geral.id}>`, inline: true },
                { name: '🛡️ AutoMod', value: `<#${channels.automod.id}>`, inline: true },
                { name: '⚖️ Punições', value: `<#${channels.punishments.id}>`, inline: true },
                { name: '🎫 Tickets', value: `<#${channels.tickets.id}>`, inline: true }
            )
            .setFooter(ConfigSystem.getFooter(guild.name))
            .setTimestamp();
        
        await interaction.update({ embeds: [embed], components: [] });
    }
};