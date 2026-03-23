const { SlashCommandBuilder } = require('discord.js');
const ConfigSystem = require('../../systems/configSystem');
const PunishmentSystem = require('../../systems/punishmentSystem');
const { EMOJIS } = require('../../database/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unstrike')
        .setDescription('Remove uma punição específica pelo ID.')
        .addIntegerOption(opt => opt.setName('id').setDescription('O ID que aparece no histórico (Ex: 12)').setRequired(true)),

    async execute(interaction) {
        const authorized = await ConfigSystem.checkAuth(interaction);
        if (!authorized) return;

        const pId = interaction.options.getInteger('id');
        await interaction.deferReply({ ephemeral: true });

        const success = await PunishmentSystem.executeUnstrike({
            guild: interaction.guild,
            punishmentId: pId,
            moderator: interaction.user
        });

        if (!success) {
            return interaction.editReply(`${EMOJIS.ERRO} **Erro:** Punição não encontrada ou ID inválido.`);
        }

        await interaction.editReply(`${EMOJIS.UP} **Sucesso!** A punição foi removida, o log enviado e o usuário notificado.`);
    }
};