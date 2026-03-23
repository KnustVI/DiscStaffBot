const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
const db = require('../database/database'); // Um ponto a menos (correto)
const emojis = require('../database/emojis'); // Um ponto a menos (correto)

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configura os canais e cargos do sistema de punição.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        // Busca as configurações atuais
        const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
        const logsChannelId = ConfigSystem.getSetting(guildId, 'logs_channel');

        // Formata a visualização (Menção ou Aviso)
        const staffDisplay = staffRoleId ? `<@&${staffRoleId}>` : '❌ `Não configurado`';
        const logsDisplay = logsChannelId ? `<#${logsChannelId}>` : '❌ `Não configurado`';

        const embed = new EmbedBuilder()
            .setTitle(`${EMOJIS.STAFF} Painel de Configuração`)
            .setDescription('Gerencie as definições do bot para este servidor.')
            .setColor(staffRoleId && logsChannelId ? 0x00FF00 : 0x5865F2) // Fica verde se tudo estiver OK
            .addFields(
                { name: '🛡️ Cargo Staff', value: staffDisplay, inline: true },
                { name: '📜 Canal de Logs', value: logsDisplay, inline: true }
            )
            .setFooter({ text: 'Selecione nos menus abaixo para alterar.' });

        const rowRole = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config_staff_role')
                .setPlaceholder('Alterar Cargo de Staff')
        );

        const rowChannel = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config_logs_channel')
                .addChannelTypes(ChannelType.GuildText)
                .setPlaceholder('Alterar Canal de Logs')
        );

        await interaction.reply({ embeds: [embed], components: [rowRole, rowChannel], ephemeral: true });
    }
};