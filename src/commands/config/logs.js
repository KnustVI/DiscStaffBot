// src/commands/config/logs.js — subcomando /config logs
const { PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');

module.exports = {
    async execute(interaction, client) {
        const { guild, user, member } = interaction;

        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
        }

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        const ConfigSystem = require('../../systems/core/configSystem');

        // Painel único (sem abas) — ver LOG_FIELDS/refreshLogsPanel em
        // configSystem.js.
        await ConfigSystem.refreshLogsPanel(interaction, null, guild.name);
    },
};
