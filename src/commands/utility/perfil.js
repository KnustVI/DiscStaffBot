// src/commands/utility/perfil.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/index');
const PlayerRegistrationSystem = require('../../systems/pot/playerRegistrationSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('perfil')
        .setDescription('👤 Mostra o perfil de um usuário: Discord + vínculo com Path of Titans.')
        .addUserOption(opt => opt.setName('usuario')
            .setDescription('Usuário a consultar (padrão: você mesmo)')
            .setRequired(false)),

    async execute(interaction, client) {
        const { guild, user } = interaction;
        const targetUser = interaction.options.getUser('usuario') || user;

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        const system = new PlayerRegistrationSystem(client);
        await system.sendProfile(interaction, targetUser);
    },
};
