// src/commands/config/buffs.js — subcomando /config buffs
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const PremiumSystem = require('../../systems/premium/premiumSystem');
const ConfigSystem = require('../../systems/core/configSystem');

module.exports = {
    async execute(interaction, client) {
        const { guild, user, member } = interaction;

        // Mesma flag do resto do catálogo RCON manual (/ingame-*) — buffs são
        // presets de setattr em lote, então acompanham a mesma exclusividade.
        if (!PremiumSystem.getGuildLimits(guild.id).genericRconEnabled) {
            return await ResponseManager.error(interaction, PremiumSystem.getGuildDenialMessage(guild.id));
        }

        // BUG REAL corrigido (pedido do dono, 2026-08-17): esta rota rodava
        // memberIsGuildAdmin (só Administrator nativo ou Cargo Admin do
        // Dashboard) ANTES de checar o cargo Supervisor — como a 1ª
        // checagem já era mais estrita, a 2ª nunca sobrava chance de barrar
        // ninguém diferente (quem só tinha o cargo Supervisor, sem admin,
        // já tinha sido rejeitado ali). Na prática só Administrador
        // conseguia criar/editar buff, mesmo o comentário antigo dizendo
        // que Supervisor deveria bastar. Pedido do dono vai além do bug
        // original: "qualquer cargo configurado no bot como staff,
        // independente da equipe" — mesma checagem já usada por APLICAR um
        // buff (/ingame-buff aplicar, ver ingame-buff.js), agora idêntica
        // pros dois: CRIAR/editar e APLICAR aceitam qualquer cargo de staff
        // configurado (Moderador/Supervisor/Equipe de Eventos) ou admin.
        if (!ConfigSystem.memberHasAnyStaffRole(guild.id, member) && !ConfigSystem.memberIsGuildAdmin(guild.id, member)) {
            return await ResponseManager.error(interaction, 'Este comando é restrito à equipe do servidor (cargo Staff, ver /config roles).');
        }

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        const BuffPanelSystem = require('../../systems/pot/buffPanelSystem');
        await BuffPanelSystem.refreshBuffPanel(interaction, null, guild.name, { screen: 'list' });
    },
};
