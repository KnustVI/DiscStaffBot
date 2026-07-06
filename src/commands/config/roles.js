// src/commands/config/roles.js — subcomando /config roles
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

        // Painel dividido em 3 abas (Cargos Automáticos, Moderação, Eventos)
        // — ver ROLE_TABS em configSystem.js. Começa na aba de Cargos
        // Automáticos (reputação).
        await ConfigSystem.refreshRolesPanel(interaction, null, 'automod');
    },
};
