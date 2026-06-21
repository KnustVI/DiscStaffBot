// /home/ubuntu/DiscStaffBot/src/commands/config/config-logs.js
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');

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
        
        const fmt = (channelId) => channelId
            ? `<#${channelId}>`
            : `${emojis.Error || '❌'} Não definido`;

        // ✅ Container único com todas as informações
        const path = require('path');
        const { AttachmentBuilder } = require('discord.js');
        // CARREGAR IMAGENS DA PASTA ASSETS
        const imagesPath = path.join(__dirname, '..', '..', 'assets', 'images');

        // Criar attachments para cada imagem que você vai usar
        const bannerAttachment = new AttachmentBuilder(
            path.join(imagesPath, 'TITLE CONGIF LOGS DC.png'),
            { name: 'TITLE CONGIF LOGS DC.png' }
        );

        const iconURL = guild.iconURL({ size: 64}) || 'https://via.placeholder.com/128x128/7289DA/FFFFFF?text=Servidor';
        const { components, flags } = new AdvancedContainerBuilder({ accentColor: 0xDCA15E })
        
        .gallery([
        'attachment://TITLE CONGIF LOGS DC.png',
        ])
        .separator()
        .section(
            `Aqui serão configuradas todas as logs relacionadas ao sistema do ***Titan's Pass***. 
            \n Recomendamos criar canais separados para cada categoria de log para melhor organização e controle de permissões, caso prefira clique no botão abaixo para que ele crie automaticamente para você!
            \n Os canais criados podem ter o nome alterado a sua maneira ou deletados, isso não afetará o funcionamento do sistema, desde que o canal correto seja selecionado no menu abaixo, para receber as logs.`,
            AdvancedContainerBuilder.thumbnail(guild.iconURL({ size: 128 }))
        )
            .text('**Geral** — recebe logs de alterações de configuração, atualizações de sistema e eventos diversos.')
            .text(`${emojis.global || '📜'} **Geral:** ${fmt(logGeral)}`)
            .separator()
            // Seção 2: Punições
            .text('**Punições** — recebe logs relacionados a strikes, unstrikes, ajustes de reputação e ações disciplinares.')
            .text(`${emojis.strike || '⚖️'} **Punições:** ${fmt(logPunishments)}`)
            .separator()
            // Seção 3: AutoMod
            .text('**AutoMod** — recebe logs de ações tomadas pela análise diária de automação do bot, responsável por dar e remover cargos e enviar alertas de players problemáticos.')
            .text(`${emojis.AutoMod || '🛡️'} **AutoMod:** ${fmt(logAutomod)}`)
            .separator()
            // Seção 4: ReportChat
            .text('**ReportChat** — recebe logs de reports feitos pelos usuários. É onde fica o painel de atendimento dos staffs.')
            .text(`${emojis.chat || '🎫'} **ReportChat:** ${fmt(logReports)}`)
            .footer(guild.name)
            .build();

        // ✅ ActionRows com os Select Menus (cada um abaixo do bloco correspondente)
        const geralRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:geral')
                .setPlaceholder('Selecionar canal de logs gerais')
                .addChannelTypes(ChannelType.GuildText)
        );

        const punishmentsRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:punishments')
                .setPlaceholder('Selecionar canal de logs de punições')
                .addChannelTypes(ChannelType.GuildText)
        );

        const automodRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:automod')
                .setPlaceholder('Selecionar canal de logs de automoderação')
                .addChannelTypes(ChannelType.GuildText)
        );

        const reportsRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:reports')
                .setPlaceholder('Selecionar canal de logs de reports')
                .addChannelTypes(ChannelType.GuildText)
        );

        const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('config-logs:criar')
                .setLabel('Criar Canais Automaticamente')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(emojis.plusone || '➕')
        );

        // ✅ Todos os componentes juntos na ordem correta
        await interaction.editReply({
            components: [
                ...components,      // Container com todas as informações
                geralRow,           // Select Menu 1
                punishmentsRow,     // Select Menu 2
                automodRow,         // Select Menu 3
                reportsRow,         // Select Menu 4
                buttonRow           // Botão
            ],
            flags: [flags]
        });
    }
};