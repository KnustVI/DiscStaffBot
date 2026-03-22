const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');
const PunishmentSystem = require('../../systems/punishmentSystem');

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

        // Validações rápidas de Config (Pode mover para um 'ConfigSystem' depois)
        const staffRole = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guild.id);
        const logChanId = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guild.id);

        if (!staffRole || !logChanId) return interaction.reply({ content: `${EMOJIS.ERRO} Sistema não configurado.`, ephemeral: true });
        if (!mod.roles.cache.has(staffRole.value) && !mod.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: `${EMOJIS.ERRO} Sem permissão.`, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) return interaction.editReply(`${EMOJIS.ERRO} Usuário não encontrado.`);

        try {
            const result = await PunishmentSystem.executePunishment(guild, targetMember, interaction.user.id, severity, reason, ticketId);

            // Montagem do Embed (Reaproveitando sua lógica visual)
            const logEmbed = new EmbedBuilder()
                .setTitle(`${EMOJIS.ACTION} Nova Punição | ID #${result.punishmentId}`)
                .setColor(0xFF0000)
                .addFields(
                    { name: `${EMOJIS.USUARIO} Usuário`, value: `${targetUser}`, inline: true },
                    { name: `${EMOJIS.ACTION} Ação`, value: `\`${result.detail}\``, inline: true },
                    { name: `${EMOJIS.DOWN} Reputação`, value: `\`${result.currentRep} pts (-${result.repLoss})\``, inline: true },
                    { name: `${EMOJIS.TICKET} Ticket`, value: `\`#${ticketId}\``, inline: true },
                    { name: `${EMOJIS.NOTE} Motivo`, value: `\`\`\`${reason}\`\`\`` }
                )
                .setTimestamp();

            const logChannel = guild.channels.cache.get(logChanId.value);
            if (logChannel) logChannel.send({ embeds: [logEmbed] });
            
            await targetUser.send({ content: `Você foi punido em **${guild.name}**`, embeds: [logEmbed] }).catch(() => null);

            await interaction.editReply(`${EMOJIS.CHECK} Punição **#${result.punishmentId}** aplicada.`);
        } catch (err) {
            console.error(err);
            interaction.editReply(`${EMOJIS.ERRO} Erro ao aplicar punição. Verifique a hierarquia de cargos.`);
        }
    }
};