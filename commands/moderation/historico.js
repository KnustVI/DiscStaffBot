const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Ver histórico detalhado de punições de um usuário neste servidor.')
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

        // --- 1. VERIFICAÇÃO DE PERMISSÃO ---
        const staffRoleSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guildId);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasStaffRole = staffRoleSetting ? interaction.member.roles.cache.has(staffRoleSetting.value) : false;

        if (!isAdmin && !hasStaffRole) {
            return interaction.reply({ 
                content: "❌ Você não tem permissão para acessar o histórico de punições.", 
                ephemeral: true 
            });
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            const user = interaction.options.getUser('usuario');
            const page = interaction.options.getInteger('pagina') || 1;
            const limit = 5; // Quantidade de punições por página
            const offset = (page - 1) * limit;

            // --- 2. BUSCA O TOTAL DE REGISTROS ---
            const totalData = db.prepare(`SELECT COUNT(*) as total FROM punishments WHERE user_id = ? AND guild_id = ?`).get(user.id, guildId);
            const total = totalData ? totalData.total : 0;

            if (total === 0) {
                return interaction.editReply({ content: `✅ O usuário **${user.displayName}** não possui nenhum registro no histórico deste servidor.` });
            }

            const totalPages = Math.ceil(total / limit);
            if (page > totalPages) {
                return interaction.editReply({ content: `❌ Página inválida. O histórico possui apenas **${totalPages}** página(s).` });
            }

            // --- 3. BUSCA OS DADOS (ORDEM DO MAIS RECENTE PARA O MAIS ANTIGO) ---
            const punishments = db.prepare(`
                SELECT * FROM punishments 
                WHERE user_id = ? AND guild_id = ?
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `).all(user.id, guildId, limit, offset);

            let description = "";

            for (const p of punishments) {
                const unixTimestamp = Math.floor(p.created_at / 1000);
                const ticketDisplay = p.ticket_id || 'N/A';
                
                // Identificação visual de Punição Revogada (Severity 0)
                const isRevoked = p.severity === 0;
                const statusEmoji = isRevoked ? "🟢" : "🔴";
                const severityDisplay = isRevoked 
                    ? `**REVOGADA / ANULADA**` 
                    : `\`Nível ${p.severity}\``;

                description += `${statusEmoji} **ID #${p.id}**\n` +
                               `⚖️ **Gravidade:** ${severityDisplay}\n` +
                               `👮 **Moderador:** <@${p.moderator_id}>\n` +
                               `🎫 **Ticket:** \`#${ticketDisplay}\`\n` +
                               `📝 **Motivo:** ${p.reason}\n` +
                               `📅 **Data:** <t:${unixTimestamp}:f>\n` +
                               `──────────────────\n`;
            }

            // --- 4. CONSTRUÇÃO DO EMBED ---
            const embed = new EmbedBuilder()
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .setDescription(`# 📜 Histórico de Punições | ${member.displayName}`
                    `${description}\n` +
                    `📍 Dados restritos ao servidor: ${interaction.guild.name}`,
                )
                .addFields({
                    name: "📊 Resumo da Ficha",
                    value: `Total de registros: **${total}**\nExibindo página **${page}** de **${totalPages}**`,
                    inline: true
                })
                .setColor(0xff2e6c) // Cor padrão do sistema
                .setFooter({ 
                    text: interaction.guild.name, 
                    iconURL: interaction.guild.iconURL({ dynamic: true }) 
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error("Erro crítico no comando histórico:", error);
            await interaction.editReply({ content: "❌ Ocorreu um erro ao consultar o banco de dados. Verifique os logs do console." });
        }
    }
};