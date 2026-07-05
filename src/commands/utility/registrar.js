// src/commands/utility/registrar.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/index');
const PlayerRegistrationSystem = require('../../systems/pot/playerRegistrationSystem');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('registrar')
        .setDescription('🆔 Vincula seu Discord ao seu Alderon ID (Path of Titans) — vale em qualquer servidor com o bot.'),

    async execute(interaction, client) {
        const { guild, user } = interaction;

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        const system = new PlayerRegistrationSystem(client);
        await system.sendPanel(interaction);
    },
};
