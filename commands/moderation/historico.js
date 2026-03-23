const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');
const PunishmentSystem = require('../../systems/punishmentSystem');
const ConfigSystem = require('../../systems/config/configSystem');

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

        // BUSCA NO CACHE
        const staffRole = ConfigSystem.getSetting(guild.id, 'staff_role');
        
        if (!mod.roles.cache.has(staffRole) && !mod.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: `${EMOJIS.AVISO} Acesso restrito à Staff.`, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const history = await PunishmentSystem.getUserHistory(guild.id, targetUser.id, page);

            if (history.total === 0) return interaction.editReply(`${EMOJIS.CHECK} **${targetUser.username}** não possui registros.`);
            if (page > history.totalPages) return interaction.editReply(`${EMOJIS.ERRO} Página inválida.`);

            const embed = this.generateHistoryEmbed(guild.id, targetUser, history, page);
            const buttons = this.generateHistoryButtons(targetUser.id, page, history.totalPages);

            await interaction.editReply({ 
                embeds: [embed], 
                components: history.totalPages > 1 ? [buttons] : [] 
            });
        } catch (error) {
            console.error(error);
            await interaction.editReply(`${EMOJIS.ERRO} Erro ao consultar histórico.`);
        }
    },

    generateHistoryEmbed(guildId, targetUser, history, page) {
        let entries = history.punishments.map(p => {
            const isRevoked = p.severity === 0;
            return `${isRevoked ? EMOJIS.UP : EMOJIS.DOWN} **ID #${p.id}** | ${isRevoked ? '~~ANULADA~~' : `\`Nível ${p.severity}\``}\n` +
                   `└ ${EMOJIS.STAFF} <@${p.moderator_id}> | ${EMOJIS.NOTE} *${p.reason}*`;
        }).join('\n\n');

        return new EmbedBuilder()
            .setAuthor({ name: `Histórico: ${targetUser.tag}`, iconURL: targetUser.displayAvatarURL() })
            .setColor(0xFF3C72)
            .setDescription(`${EMOJIS.REPUTATION} Reputação: **${history.reputation}**/100\n\n${entries}`)
            .setFooter({ text: `Página ${page} de ${history.totalPages}` })
            .setTimestamp();
    },

    generateHistoryButtons(targetUserId, currentPage, totalPages) {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`hist_${targetUserId}_${currentPage - 1}`).setLabel('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(currentPage <= 1),
            new ButtonBuilder().setCustomId(`hist_${targetUserId}_${currentPage + 1}`).setLabel('➡️').setStyle(ButtonStyle.Primary).setDisabled(currentPage >= totalPages)
        );
    }
};