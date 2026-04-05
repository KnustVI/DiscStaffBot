const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
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
        
        // Buscar configurações atuais
        const logGeral = ConfigSystem.getSetting(guildId, 'log_channel');
        const logPunishments = ConfigSystem.getSetting(guildId, 'log_punishments');
        const logAutomod = ConfigSystem.getSetting(guildId, 'log_automod');
        const logTickets = ConfigSystem.getSetting(guildId, 'log_tickets');
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setTitle('📝 Canais de Log')
            .setDescription('Selecione os canais abaixo:')
            .addFields(
                { name: '📜 Geral', value: logGeral ? `<#${logGeral}>` : '`❌ Não definido`', inline: true },
                { name: '⚖️ Punições', value: logPunishments ? `<#${logPunishments}>` : '`❌ Não definido`', inline: true },
                { name: '🛡️ AutoMod', value: logAutomod ? `<#${logAutomod}>` : '`❌ Não definido`', inline: true },
                { name: '🎫 Tickets', value: logTickets ? `<#${logTickets}>` : '`❌ Não definido`', inline: true }
            )
            .setFooter(ConfigSystem.getFooter(guild.name))
            .setTimestamp();
        
        const { ActionRowBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
        
        const geralRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:geral')
                .setPlaceholder('📜 Selecionar canal de logs gerais')
                .addChannelTypes(ChannelType.GuildText)
        );
        
        const punishmentsRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:punishments')
                .setPlaceholder('⚖️ Selecionar canal de logs de punições')
                .addChannelTypes(ChannelType.GuildText)
        );
        
        const automodRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:automod')
                .setPlaceholder('🛡️ Selecionar canal de logs de automoderação')
                .addChannelTypes(ChannelType.GuildText)
        );
        
        const ticketsRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:tickets')
                .setPlaceholder('🎫 Selecionar canal de logs de tickets')
                .addChannelTypes(ChannelType.GuildText)
        );
        
        const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config-logs:criar')
                .setLabel('Criar Canais Automaticamente')
                .setStyle(ButtonStyle.Success)
                .setEmoji('➕')
        );
        
        await ResponseManager.send(interaction, {
            embeds: [embed],
            components: [geralRow, punishmentsRow, automodRow, ticketsRow, buttonRow]
        });
    }
};