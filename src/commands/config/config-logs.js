// /home/ubuntu/DiscStaffBot/src/commands/config/config-logs.js
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const ContainerFormatter = require('../../utils/containerFormatter');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-logs')
        .setDescription('📝 Configura os canais de log do sistema.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const { guild, user, member } = interaction;
        const guildId = guild.id;
        
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
        
        const logGeral = ConfigSystem.getSetting(guildId, 'log_channel');
        const logPunishments = ConfigSystem.getSetting(guildId, 'log_punishments');
        const logAutomod = ConfigSystem.getSetting(guildId, 'log_automod');
        const logReports = ConfigSystem.getSetting(guildId, 'log_reports');
        
        const builder = ContainerFormatter.create(guild.name, 0xDCA15E);
        
        builder.addTitle(`${emojis.dashboard || '📝'} Canais de Log`, 1);
        builder.addText(`- Geral recebe logs de alterações de configuração, atualizações de sistema e eventos diversos.`);
        builder.addText(`- Punições recebe logs relacionados a strikes, unstrikes, ajustes de reputação e ações disciplinares.`);
        builder.addText(`- AutoMod recebe logs de ações tomadas pela analise diaria de automação do bot, responsavel por dar e remover cargos de bom comportamento e de enviar alertas de players problemáticos.`);
        builder.addText(`- ReportChat recebe logs de reports feitos pelos usuários através do sistema de ReportChat. É onde vai ficar o painel de atendimento dos seus staffs`);
        builder.addSeparator();
        
        builder.addText(`${emojis.global || '📜'} **Geral:** ${logGeral ? `<#${logGeral}>` : `${emojis.Error || '❌'} Não definido`}`);
        builder.addText(`${emojis.strike || '⚖️'} **Punições:** ${logPunishments ? `<#${logPunishments}>` : `${emojis.Error || '❌'} Não definido`}`);
        builder.addText(`${emojis.Config || '🛡️'} **AutoMod:** ${logAutomod ? `<#${logAutomod}>` : `${emojis.Error || '❌'} Não definido`}`);
        builder.addText(`${emojis.chat || '🎫'} **ReportChat:** ${logReports ? `<#${logReports}>` : `${emojis.Error || '❌'} Não definido`}`);
        builder.addFooter();
        
        const geralRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder().setCustomId('config-logs:geral').setPlaceholder('Selecionar canal de logs gerais').addChannelTypes(ChannelType.GuildText)
        );
        const punishmentsRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder().setCustomId('config-logs:punishments').setPlaceholder('Selecionar canal de logs de punições').addChannelTypes(ChannelType.GuildText)
        );
        const automodRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder().setCustomId('config-logs:automod').setPlaceholder('Selecionar canal de logs de automoderação').addChannelTypes(ChannelType.GuildText)
        );
        const reportsRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder().setCustomId('config-logs:reports').setPlaceholder('Selecionar canal de logs de reports').addChannelTypes(ChannelType.GuildText)
        );
        const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('config-logs:criar').setLabel('Criar Canais Automaticamente').setStyle(ButtonStyle.Secondary).setEmoji(emojis.edit || '➕')
        );
        
        await interaction.editReply({
            components: [builder.build(), geralRow, punishmentsRow, automodRow, reportsRow, buttonRow],
            flags: ['IsComponentsV2']
        });
    }
};