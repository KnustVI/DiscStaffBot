const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Ver histórico detalhado de punições de um usuário')
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Usuário que deseja verificar')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('pagina')
                .setDescription('Página do histórico')
                .setRequired(false)
                .setMinValue(1)
        ),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        // 1. Verificação de Permissão
        const staffRoleSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guildId);
        const isOwner = interaction.user.id === interaction.guild.ownerId;
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasStaffRole = staffRoleSetting ? interaction.member.roles.cache.has(staffRoleSetting.value) : false;

        if (!isOwner && !isAdmin && !hasStaffRole) {
            return interaction.reply({ 
                content: "❌ Você não tem permissão para acessar o histórico.", 
                ephemeral: true 
            });
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            const user = interaction.options.getUser('usuario');
            const page = interaction.options.getInteger('pagina') || 1;
            const limit = 5;
            const offset = (page - 1) * limit;

            // 2. Busca o total de punições NESTE servidor
            const totalData = db.prepare(`SELECT COUNT(*) as total FROM punishments WHERE user_id = ? AND guild_id = ?`).get(user.id, guildId);
            const total = totalData ? totalData.total : 0;

            if (total === 0) {
                return interaction.editReply({ content: `✅ O usuário **${user.username}** não possui punições registradas neste servidor.` });
            }

            const totalPages = Math.ceil(total / limit);
            if (page > totalPages) {
                return interaction.editReply({ content: `❌ Página inválida. Existem apenas ${totalPages} página(s).` });
            }

            // 3. Busca punições (incluindo a nova coluna ticket_id)
            const punishments = db.prepare(`
                SELECT * FROM punishments 
                WHERE user_id = ? AND guild_id = ?
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `).all(user.id, guildId, limit, offset);

            let description = "";

            for (const p of punishments) {
                const unixTimestamp = Math.floor(p.created_at / 1000);
                const ticketDisplay = p.ticket_id || 'Não informado';

                description += `🆔 **ID #${p.id}**\n` +
                               `📌 **Gravidade:** \`Nível ${p.severity}\`\n` +
                               `👮 **Moderador:** <@${p.moderator_id}>\n` +
                               `🎫 **Ticket:** \`#${ticketDisplay}\`\n` + // <-- Ticket adicionado aqui
                               `📝 **Motivo:** ${p.reason}\n` +
                               `📅 **Data:** <t:${unixTimestamp}:f>\n` +
                               `──────────────────\n`;
            }

            const embed = new EmbedBuilder()
                .setTitle(`📜 Histórico — ${user.username}`)
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .setDescription(description)
                .addFields({
                    name: "📊 Estatísticas",
                    value: `Total: **${total}** | Página: **${page}/${totalPages}**`,
                    inline: true
                })
                .setColor(0xff2e6c)
                .setFooter({ text: `Requisitado por ${interaction.user.username}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error("Erro no comando historico:", error);
            await interaction.editReply({ content: "❌ Erro ao consultar o banco de dados." });
        }
    }
};