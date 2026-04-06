const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-logs')
        .setDescription('${Eemoji.Config || "📝"} Configura os canais de log do sistema.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const { guild, user, member } = interaction;
        const guildId = guild.id;
        
        // Carregar emojis do servidor
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
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
            .setTitle(`${emojis.dashboard || '📝'} Canais de Log`)
            .setDescription('Selecione os canais abaixo:')
            .addFields(
                { name: `${emojis.global || '📜'} Geral`, value: logGeral ? `<#${logGeral}>` : `${emojis.Error || '❌'} Não definido`, inline: true },
                { name: `${emojis.strike || '⚖️'} Punições`, value: logPunishments ? `<#${logPunishments}>` : `${emojis.Error || '❌'} Não definido`, inline: true },
                { name: `${emojis.AutoMod || '🛡️'} AutoMod`, value: logAutomod ? `<#${logAutomod}>` : `${emojis.Error || '❌'} Não definido`, inline: true },
                { name: `${emojis.Ticket || '🎫'} Tickets`, value: logTickets ? `<#${logTickets}>` : `${emojis.Error || '❌'} Não definido`, inline: true }
            )
            .setFooter(ConfigSystem.getFooter(guild.name))
            .setTimestamp();
        
        const { ActionRowBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
        
        const geralRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:geral')
                .setPlaceholder(`${emojis.global || '📜'} Selecionar canal de logs gerais`)
                .addChannelTypes(ChannelType.GuildText)
        );
        
        const punishmentsRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:punishments')
                .setPlaceholder(`${emojis.strike || '⚖️'} Selecionar canal de logs de punições`)
                .addChannelTypes(ChannelType.GuildText)
        );
        
        const automodRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:automod')
                .setPlaceholder(`${emojis.AutoMod || '🛡️'} Selecionar canal de logs de automoderação`)
                .addChannelTypes(ChannelType.GuildText)
        );
        
        const ticketsRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:tickets')
                .setPlaceholder(`${emojis.Ticket || '🎫'} Selecionar canal de logs de tickets`)
                .addChannelTypes(ChannelType.GuildText)
        );
        
        const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config-logs:criar')
                .setLabel('Criar Canais Automaticamente')
                .setStyle(ButtonStyle.Success)
                .setEmoji(emojis.plusone || '➕')
        );
        
        await ResponseManager.send(interaction, {
            embeds: [embed],
            components: [geralRow, punishmentsRow, automodRow, ticketsRow, buttonRow]
        });
    }
};