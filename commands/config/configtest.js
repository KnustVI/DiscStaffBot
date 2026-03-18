const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ChannelSelectMenuBuilder, 
    RoleSelectMenuBuilder, 
    ChannelType, 
    PermissionFlagsBits 
} = require('discord.js');
const db = require('../../database/database'); // Verifique se o caminho do seu DB está correto

module.exports = {
    data: new SlashCommandBuilder()
        .setName('configtest')
        .setDescription('Painel de Configuração com salvamento no Banco de Dados.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        // Função para carregar os dados atuais do banco
        const getConfig = () => {
            const logs = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'logs_channel'`).get(guildId);
            const staff = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guildId);
            return { logs: logs?.value, staff: staff?.value };
        };

        const config = getConfig();

        const embed = new EmbedBuilder()
            .setTitle('⚙️ Configurações do DiscStaffBot')
            .setColor('#ff2e6c')
            .setDescription('Selecione os canais e cargos abaixo. O salvamento é automático no Banco de Dados.')
            .addFields(
                { name: '📁 Canal de Logs', value: config.logs ? `<#${config.logs}>` : '`Não definido`', inline: true },
                { name: '👮 Cargo de Staff', value: config.staff ? `<@&${config.staff}>` : '`Não definido`', inline: true }
            );

        const logRow = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('config_logs')
                .setPlaceholder('Selecionar canal de LOGS')
                .addChannelTypes(ChannelType.GuildText)
        );

        const staffRow = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('config_staff')
                .setPlaceholder('Selecionar cargo de STAFF')
        );

        const response = await interaction.reply({ 
            embeds: [embed], 
            components: [logRow, staffRow], 
            ephemeral: true 
        });

        // --- COLETOR DE TESTE (Isolado do index.js) ---
        const collector = response.createMessageComponentCollector({ time: 60000 }); // Ativo por 1 minuto

        collector.on('collect', async i => {
            if (i.customId === 'config_logs') {
                const channelId = i.values[0];
                // Salva no banco
                db.prepare(`INSERT OR REPLACE INTO settings (guild_id, key, value) VALUES (?, 'logs_channel', ?)`)
                  .run(guildId, channelId);
                
                await i.update({ content: `✅ Canal de logs atualizado para <#${channelId}>!`, components: [logRow, staffRow] });
            }

            if (i.customId === 'config_staff') {
                const roleId = i.values[0];
                // Salva no banco
                db.prepare(`INSERT OR REPLACE INTO settings (guild_id, key, value) VALUES (?, 'staff_role', ?)`)
                  .run(guildId, roleId);
                
                await i.update({ content: `✅ Cargo de Staff atualizado para <@&${roleId}>!`, components: [logRow, staffRow] });
            }
        });
    }
};