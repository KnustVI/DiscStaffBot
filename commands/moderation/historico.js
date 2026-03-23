const { SlashCommandBuilder } = require('discord.js');
const PunishmentSystem = require('../../systems/punishmentSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Consulta a reputação e punições de um usuário.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a consultar').setRequired(true)),

    async execute(interaction) {
        const target = interaction.options.getUser('usuario');
        const guildId = interaction.guild.id;

        // Busca página 1 (O motor no PunishmentSystem já limita a 5 itens)
        const history = await PunishmentSystem.getUserHistory(guildId, target.id, 1);
        
        const embed = PunishmentSystem.generateHistoryEmbed(target, history, 1);
        const buttons = PunishmentSystem.generateHistoryButtons(target.id, 1, history.totalPages);

        await interaction.reply({ 
            embeds: [embed], 
            components: buttons ? [buttons] : [], 
            ephemeral: true 
        });
    }
};