const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, RoleSelectMenuBuilder } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-roles')
        .setDescription('⚙️ Configura os cargos do sistema.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const { guild, user, member } = interaction;
        const guildId = guild.id;
        
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
        
        const embed = new EmbedBuilder()
            .setColor(0xDCA15E)
            .setTitle('👥 Cargos do Sistema')
            .setDescription('Selecione os cargos abaixo:')
            .addFields(
                { name: '🛡️ Staff', value: staffRole ? `<@&${staffRole}>` : '`❌ Não definido`', inline: true },
                { name: '⚠️ Strike (Temporário)', value: strikeRole ? `<@&${strikeRole}>` : '`❌ Não definido`', inline: true },
                { name: '✨ Exemplar', value: exemplarRole ? `<@&${exemplarRole}>` : '`❌ Não definido`', inline: true },
                { name: '⚠️ Problemático', value: problematicoRole ? `<@&${problematicoRole}>` : '`❌ Não definido`', inline: true }
            )
            .setFooter(ConfigSystem.getFooter(guild.name))
            .setTimestamp();
        
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
            embeds: [embed],
            components: [staffRow, strikeRow, exemplarRow, problematicoRow]
        });
    }
};