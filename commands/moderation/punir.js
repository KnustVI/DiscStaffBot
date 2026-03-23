const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');
const PunishmentSystem = require('../../systems/punishment/punishmentSystem');
const ConfigSystem = require('../../systems/configSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('punir')
        .setDescription('Aplica uma punição e desconta pontos de reputação.')
        .addUserOption(opt => opt.setName('usuario').setDescription('O usuário que será punido').setRequired(true))
        .addIntegerOption(opt => opt.setName('gravidade').setDescription('Nível da infração (1 a 5)').setRequired(true).addChoices(
            { name: 'Nível 1 (Leve)', value: 1 },
            { name: 'Nível 2 (Média)', value: 2 },
            { name: 'Nível 3 (Grave)', value: 3 },
            { name: 'Nível 4 (Gravíssima)', value: 4 },
            { name: 'Nível 5 (Banimento)', value: 5 }
        ))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da punição').setRequired(true))
        .addStringOption(opt => opt.setName('ticket').setDescription('Número do ticket (Opcional)')),

    async execute(interaction) {
        const { guild, options, member: mod } = interaction;
        const targetUser = options.getUser('usuario');
        const severity = options.getInteger('gravidade');
        const reason = options.getString('motivo');
        const ticketId = options.getString('ticket') || 'N/A';

        // 1. Busca Configurações via System (Com Cache)
        const staffRoleId = ConfigSystem.getSetting(guild.id, 'staff_role');
        const logChanId = ConfigSystem.getSetting(guild.id, 'logs_channel');

        if (!staffRoleId || !logChanId) {
            return interaction.reply({ content: `${EMOJIS.ERRO} Sistema não configurado. Use \`/config\`.`, ephemeral: true });
        }

        // 2. Permissão
        if (!mod.roles.cache.has(staffRoleId) && !mod.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: `${EMOJIS.ERRO} Sem permissão.`, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (targetMember) {
            if (targetMember.id === interaction.user.id) return interaction.editReply(`${EMOJIS.ERRO} Você não pode se punir.`);
            if (!targetMember.manageable && severity > 1) return interaction.editReply(`${EMOJIS.ERRO} Não posso punir este usuário.`);
        }

        try {
            const result = await PunishmentSystem.executePunishment(guild, targetMember, interaction.user.id, severity, reason, ticketId);

            const logEmbed = new EmbedBuilder()
                .setAuthor({ name: `Punição | ID #${result.punishmentId}`, iconURL: targetUser.displayAvatarURL() })
                .setColor(0xFF3C72)
                .addFields(
                    { name: `${EMOJIS.USUARIO} Infrator`, value: `${targetUser}`, inline: true },
                    { name: `${EMOJIS.ACTION} Ação`, value: `\`${result.detail}\``, inline: true },
                    { name: `${EMOJIS.DOWN} Reputação`, value: `\`${result.currentRep} pts\``, inline: true },
                    { name: `${EMOJIS.TICKET} Ticket`, value: `\`#${ticketId}\``, inline: true },
                    { name: `${EMOJIS.NOTE} Motivo`, value: `\`\`\`${reason}\`\`\`` }
                )
                .setTimestamp();

            const logChannel = await guild.channels.fetch(logChanId).catch(() => null);
            if (logChannel) await logChannel.send({ embeds: [logEmbed] });

            await interaction.editReply(`${EMOJIS.CHECK} Punição **#${result.punishmentId}** aplicada.`);
        } catch (err) {
            console.error(err);
            return interaction.editReply(`${EMOJIS.ERRO} Erro no banco de dados.`);
        }
    }
};