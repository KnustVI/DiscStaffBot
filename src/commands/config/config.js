const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Painel de configuração do sistema de integridade.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     */
    async execute(interaction) {
        const { client, guild, guildId } = interaction;
        const { config, sessions, emojis } = client.systems;
        const EMOJIS = emojis || {};

        // 1. Criar uma sessão para evitar que outros usem os botões deste usuário
        if (sessions) {
            sessions.set(guildId, interaction.user.id, 'config_panel', { timestamp: Date.now() });
        }

        // 2. Coletar configurações atuais (Cache-first via seu ConfigSystem)
        const staffRole = config.getSetting(guildId, 'staff_role');
        const logChannel = config.getSetting(guildId, 'logs_channel');
        const strikeRole = config.getSetting(guildId, 'strike_role');

        const embed = new EmbedBuilder()
            .setTitle(`${EMOJIS.SETTINGS || '⚙️'} Configuração do Servidor`)
            .setColor(0x5865F2)
            .setDescription('Selecione abaixo os cargos e canais que o bot deve utilizar para o sistema de reputação.')
            .addFields(
                { name: '🛡️ Cargo Staff', value: staffRole ? `<@&${staffRole}>` : '`Não definido`', inline: true },
                { name: '📜 Canal de Logs', value: logChannel ? `<#${logChannel}>` : '`Não definido`', inline: true },
                { name: '⚠️ Cargo de Strike', value: strikeRole ? `<@&${strikeRole}>` : '`Não definido`', inline: true }
            )
            .setFooter(config.getFooter(guild.name));

        // 3. Componentes de Seleção Nativos do Discord
        // Menu para selecionar Cargo Staff
        const staffRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config:set_staff')
                .setPlaceholder('Selecionar Cargo de Moderadores')
        );

        // Menu para selecionar Canal de Logs
        const logRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config:set_logs')
                .setPlaceholder('Selecionar Canal de Logs')
                .addChannelTypes(ChannelType.GuildText)
        );

        // Menu para selecionar Cargo de Punidos (Strike)
        const strikeRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config:set_rep_roles')
                .setPlaceholder('Selecionar Cargo de Strike')
        );

        await interaction.editReply({
            embeds: [embed],
            components: [staffRow, logRow, strikeRow]
        });
    }
};