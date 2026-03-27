const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    RoleSelectMenuBuilder, 
    ChannelSelectMenuBuilder, 
    ChannelType 
} = require('discord.js');

const { EMOJIS } = require('../../database/emojis');
const session = require('../../ultilitários/sessionManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configura os canais e cargos do sistema de punição.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {

        // =========================
        // SESSION START (OBRIGATÓRIO AGORA)
        // =========================
        session.create(interaction.user.id, {
            type: 'config',
            createdAt: Date.now()
        });

        // =========================
        // EMBED (INALTERADA)
        // =========================
        const embed = new EmbedBuilder()
            .setTitle(`${EMOJIS.CONFIG || '⚙️'} Painel de Configuração`)
            .setDescription('Selecione abaixo o que deseja configurar no servidor.')
            .setColor(0xba0054)
            .addFields(
                { name: '1. Cargo Staff', value: 'Quem poderá usar os comandos de moderação.' },
                { name: '2. Canal de Logs', value: 'Onde as punições serão enviadas.' }
            );

        // =========================
        // SELECT MENUS (PADRÃO NOVO)
        // =========================
        const rowRole = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config:set:staff_role') // 🔥 novo padrão
                .setPlaceholder('Selecione o cargo de Staff')
        );

        const rowChannel = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config:set:logs_channel') // 🔥 novo padrão
                .addChannelTypes(ChannelType.GuildText)
                .setPlaceholder('Selecione o canal de logs')
        );

        await interaction.reply({
            embeds: [embed],
            components: [rowRole, rowChannel],
            ephemeral: true
        });
    }
};