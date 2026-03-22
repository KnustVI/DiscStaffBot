const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');
const PunishmentSystem = require('../../systems/punishmentSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Ver histórico detalhado de punições de um usuário.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a verificar').setRequired(true))
        .addIntegerOption(opt => opt.setName('pagina').setDescription('Página do histórico').setMinValue(1)),

    async execute(interaction) {
        const { guild, options, member: mod } = interaction;
        const targetUser = options.getUser('usuario');
        const page = options.getInteger('pagina') || 1;

        // Validação de Permissão
        const staffRole = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guild.id);
        if (!mod.roles.cache.has(staffRole?.value) && !mod.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: `${EMOJIS.AVISO} Acesso restrito à Staff.`, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const history = await PunishmentSystem.getUserHistory(guild.id, targetUser.id, page);

            if (history.total === 0) {
                return interaction.editReply(`${EMOJIS.CHECK} **${targetUser.username}** não possui registros.`);
            }

            if (page > history.totalPages) {
                return interaction.editReply(`${EMOJIS.ERRO} Página inválida. O histórico tem apenas **${history.totalPages}** página(s).`);
            }

            let entries = "";
            for (const p of history.punishments) {
                const isRevoked = p.severity === 0;
                const time = `<t:${Math.floor(p.created_at / 1000)}:f>`;
                
                // Futura integração: Se ticketId for um ID de canal/thread, podemos linkar
                const ticketLink = p.ticket_id && p.ticket_id !== 'N/A' ? `[#${p.ticket_id}](https://discord.com/channels/${guild.id}/${p.ticket_id})` : `\`#${p.ticket_id || 'N/A'}\``;

                entries += `${isRevoked ? EMOJIS.UP : EMOJIS.DOWN} **ID #${p.id}** | ${isRevoked ? '~~ANULADA~~' : `\`Nível ${p.severity}\``}\n` +
                           `└ ${EMOJIS.STAFF} <@${p.moderator_id}> | ${EMOJIS.TICKET} ${ticketLink}\n` +
                           `└ ${EMOJIS.NOTE} *${p.reason}*\n` +
                           `└ ${EMOJIS.HISTORY} ${time}\n` +
                           `──────────────────\n`;
            }

            const embed = new EmbedBuilder()
                .setAuthor({ name: `Histórico de ${targetUser.tag}`, iconURL: targetUser.displayAvatarURL() })
                .setColor(0xFF3C72)
                .setDescription(
                    `${EMOJIS.REPUTATION} Reputação Atual: **${history.reputation}**/100\n\n` + 
                    entries +
                    `\nTotal: **${history.total}** registros | Página **${page}** de **${history.totalPages}**`
                )
                .setFooter({ text: `✧ BOT by: KnustVI`, iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await interaction.editReply(`${EMOJIS.ERRO} Erro ao consultar banco de dados.`);
        }
    }
};