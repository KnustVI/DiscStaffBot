const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unstrike')
        .setDescription('Remove uma punição específica e devolve os pontos.')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID da punição no histórico').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da anulação').setRequired(true)),

    async execute(interaction) {
        const { client, guild, options, user } = interaction;
        const EMOJIS = client.systems.emojis || {};
        const Config = client.systems.config;
        const Punishment = client.systems.punishment;

        const auth = Config.checkAuth(interaction);
        if (!auth.authorized) return interaction.editReply({ content: auth.message });

        try {
            const success = await Punishment.executeUnstrike({
                guild,
                punishmentId: options.getInteger('id'),
                moderator: user,
                reason: options.getString('motivo') 
            });

            if (!success) {
                return interaction.editReply({
                    content: `${EMOJIS.ERRO || '❌'} Punição não encontrada ou ID inválido.`
                });
            }

            await interaction.editReply({
                content: `${EMOJIS.CHECK || '✅'} **Anulado!** Os pontos foram devolvidos e o histórico atualizado.`
            });

        } catch (err) {
            await interaction.editReply({
                content: `${EMOJIS.ERRO || '❌'} **Falha ao anular:** \`${err.message}\``
            });
        }
    }
};