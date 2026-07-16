// src/commands/config/filtro.js — subcomando /config filtro
const { PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const PunishmentSystem = require('../../systems/moderation/punishmentSystem');

module.exports = {
    async execute(interaction, client) {
        const { guild, user, member } = interaction;

        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
        }

        // Exclusivo do Caçador (pedido do dono) — mesma flag já usada pelo
        // catálogo manual/buffs.
        if (!PremiumSystem.getGuildLimits(guild.id).genericRconEnabled) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guild.id));
        }

        // Pedido do dono: CRIAR/editar filtro é restrito ao cargo
        // Supervisor (mesmo critério de /config buffs).
        if (!(await PunishmentSystem.memberHasSupervisorRole(guild, member))) {
            return await ResponseManager.error(interaction, 'Este comando é restrito ao cargo Supervisor (ver /config roles).');
        }

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        const ChatFilterPanelSystem = require('../../systems/pot/chatFilterPanelSystem');
        await ChatFilterPanelSystem.refreshFilterPanel(interaction, null, guild.name, { screen: 'list' });
    },
};
