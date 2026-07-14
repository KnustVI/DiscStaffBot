// src/commands/config/buffs.js — subcomando /config buffs
const { PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const PremiumSystem = require('../../systems/premium/premiumSystem');

module.exports = {
    async execute(interaction, client) {
        const { guild, user, member } = interaction;

        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
        }

        // Mesma flag do resto do catálogo RCON manual (/ingame-*) — buffs são
        // presets de setattr em lote, então acompanham a mesma exclusividade.
        if (!PremiumSystem.getGuildLimits(guild.id).genericRconEnabled) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guild.id));
        }

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        const BuffPanelSystem = require('../../systems/pot/buffPanelSystem');
        await BuffPanelSystem.refreshBuffPanel(interaction, null, guild.name, { screen: 'list' });
    },
};
