const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configura os canais e cargos do sistema de punição.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle(`${EMOJIS.STAFF} Painel de Configuração`)
            .setDescription('Selecione abaixo o que deseja configurar no servidor.')
            .setColor(0x5865F2)
            .addFields(
                { name: '1. Cargo Staff', value: 'Quem poderá usar o comando `/punir`.' },
                { name: '2. Canal de Logs', value: 'Onde as punições serão enviadas.' }
            );

        // Menus de Seleção (Nativo do Discord - Economiza comandos de chat)
        const rowRole = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config_staff_role')
                .setPlaceholder('Selecione o cargo de Staff')
        );

        const rowChannel = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config_logs_channel')
                .addChannelTypes(ChannelType.GuildText)
                .setPlaceholder('Selecione o canal de logs')
        );

        await interaction.reply({ embeds: [embed], components: [rowRole, rowChannel], ephemeral: true });
    }
};