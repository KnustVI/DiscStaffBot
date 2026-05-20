// src/commands/config/config-roles.js
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, RoleSelectMenuBuilder } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const ContainerFormatter = require('../../utils/ContainerFormatter.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-roles')
        .setDescription('⚙️ Configura os cargos do sistema.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const { guild, user, member } = interaction;
        const guildId = guild.id;
        
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {
            emojis = {};
        }
        
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await ResponseManager.error(interaction, 'Apenas administradores podem configurar o sistema.');
        }
        
        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
        
        const ConfigSystem = require('../../systems/configSystem');
        
        const staffRole = ConfigSystem.getSetting(guildId, 'staff_role');
        const strikeRole = ConfigSystem.getSetting(guildId, 'strike_role');
        const exemplarRole = ConfigSystem.getSetting(guildId, 'role_exemplar');
        const problematicoRole = ConfigSystem.getSetting(guildId, 'role_problematico');
        
        const builder = ContainerFormatter.createBuilder(guild.name, 0xDCA15E);
        builder.addTitle(`${emojis.staff || '👥'} Cargos do Sistema`, 1);
        builder.addText(`É obrigatório que selecione um cargo para sua staff, sem o cargo configurado eles não conseguem usar os comandos de moderação. Os outros cargos são opcionais.`);
        builder.addSeparator();
        builder.addText(`Selecione os cargos abaixo:`);
        builder.addSeparator();
        
        builder.addSection([`${emojis.staff || '🛡️'} **Staff:**`, staffRole ? `<@&${staffRole}>` : `${emojis.Error || '❌'} Não definido`]);
        builder.addSection([`${emojis.strike || '⚠️'} **Strike (Temporário):**`, strikeRole ? `<@&${strikeRole}>` : `${emojis.Error || '❌'} Não definido`]);
        builder.addSection([`${emojis.shinystar || '✨'} **Exemplar:**`, exemplarRole ? `<@&${exemplarRole}>` : `${emojis.Error || '❌'} Não definido`]);
        builder.addSection([`${emojis.Warning || '⚠️'} **Problemático:**`, problematicoRole ? `<@&${problematicoRole}>` : `${emojis.Error || '❌'} Não definido`]);
        
        builder.addFooter();
        
        const staffRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config-roles:staff')
                .setPlaceholder('Selecionar cargo de Staff')
        );
        
        const strikeRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config-roles:strike')
                .setPlaceholder('Selecionar cargo de Strike')
        );
        
        const exemplarRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config-roles:exemplar')
                .setPlaceholder('Selecionar cargo Exemplar')
        );
        
        const problematicoRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config-roles:problematico')
                .setPlaceholder('Selecionar cargo Problemático')
        );
        
        await ResponseManager.send(interaction, {
            components: [builder.container, staffRow, strikeRow, exemplarRow, problematicoRow]
        });
    }
};