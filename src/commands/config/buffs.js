// src/commands/config/buffs.js — subcomando /config buffs
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const PunishmentSystem = require('../../systems/moderation/punishmentSystem');
const ConfigSystem = require('../../systems/core/configSystem');

module.exports = {
    async execute(interaction, client) {
        const { guild, user, member } = interaction;

        if (!ConfigSystem.memberIsGuildAdmin(guild.id, member)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
        }

        // Mesma flag do resto do catálogo RCON manual (/ingame-*) — buffs são
        // presets de setattr em lote, então acompanham a mesma exclusividade.
        if (!PremiumSystem.getGuildLimits(guild.id).genericRconEnabled) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guild.id));
        }

        // Pedido do dono: CRIAR/editar buff é restrito ao cargo Supervisor OU
        // ao Cargo Administrativo do Dashboard (memberHasSupervisorRole já
        // aceita os dois, 2026-08-15 — "ele esta acima da supervisão") —
        // diferente de APLICAR um buff (/ingame-buff aplicar), liberado pra
        // qualquer cargo de staff.
        if (!(await PunishmentSystem.memberHasSupervisorRole(guild, member))) {
            return await ResponseManager.error(interaction, 'Este comando é restrito ao cargo Supervisor (ver /config roles).');
        }

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        const BuffPanelSystem = require('../../systems/pot/buffPanelSystem');
        await BuffPanelSystem.refreshBuffPanel(interaction, null, guild.name, { screen: 'list' });
    },
};
