// /home/ubuntu/DiscStaffBot/src/commands/config/config-logs.js
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');
const imageManager = require('../../utils/imageManager');

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
        
        // ✅ UNIFICADO: Geral e AutoMod compartilham o mesmo canal agora.
        // getUnifiedGeneralLogChannel() lê 'log_channel' e cai para o antigo
        // 'log_automod' apenas como fallback legado (servidores já configurados).
        const logGeral = ConfigSystem.getUnifiedGeneralLogChannel(guildId);
        const logPunishments = ConfigSystem.getSetting(guildId, 'log_punishments');
        const logReports = ConfigSystem.getSetting(guildId, 'log_reports');
        
        const fmt = (channelId) => channelId
            ? `<#${channelId}>`
            : `${emojis.Error || '❌'} Não definido`;

        const bannerUrl = imageManager.getUrl('title_config_logs_dc');
        const bannerAttachment = imageManager.getAttachment('title_config_logs_dc');
        const { components, flags } = new AdvancedContainerBuilder({ accentColor: 0xDCA15E })
        
        .gallery([bannerUrl])
        .separator()
        .section(
            `Aqui serão configuradas todas as logs relacionadas ao sistema do ***Titan's Pass***. 
            \n Recomendamos criar canais separados para cada categoria de log para melhor organização e controle de permissões, caso prefira clique no botão abaixo para que ele crie automaticamente para você!
            \n Os canais criados podem ter o nome alterado a sua maneira ou deletados, isso não afetará o funcionamento do sistema, desde que o canal correto seja selecionado no menu abaixo, para receber as logs.`,
            AdvancedContainerBuilder.thumbnail(guild.iconURL({ size: 128 }))
        )
            .text('**Geral / AutoMod** — recebe logs de alterações de configuração, atualizações de sistema, eventos diversos e o relatório diário de AutoModeração (recuperação de pontos, cargos, ranking de staff).')
            .text(`${emojis.global || '📜'} **Geral / AutoMod:** ${fmt(logGeral)}`)
            .separator()
            // Seção 2: Punições
            .text('**Punições** — recebe logs relacionados a strikes, unstrikes, ajustes de reputação e ações disciplinares.')
            .text(`${emojis.strike || '⚖️'} **Punições:** ${fmt(logPunishments)}`)
            .separator()
            // Seção 3: ReportChat
            .text('**ReportChat** — recebe logs de reports feitos pelos usuários. É onde fica o painel de atendimento dos staffs.')
            .text(`${emojis.chat || '🎫'} **ReportChat:** ${fmt(logReports)}`)
            .footer(`Server: ${guild.name}`)
            .build();

        // ── Select menu único pra Geral/AutoMod (sem mais o de automod separado) ──
        const geralRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:geral')
                .setPlaceholder('Selecionar canal de logs gerais / automod')
                .addChannelTypes(ChannelType.GuildText)
        );

        const punishmentsRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config-logs:punishments')
                .setPlaceholder('Selecionar canal de logs de punições')
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

        const replyPayload = {
            components: [
                ...components,
                geralRow,
                punishmentsRow,
                reportsRow,
                buttonRow
            ],
            flags: [flags],
        };
        if (bannerAttachment) replyPayload.files = [bannerAttachment];

        await interaction.editReply(replyPayload);
    }
};