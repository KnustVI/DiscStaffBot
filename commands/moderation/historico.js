const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis'); // Importe os emojis

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
                content: `${EMOJIS.AVISO} Você não tem permissão para acessar o histórico de punições.`, 
                ephemeral: true 
            });
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            const user = interaction.options.getUser('usuario');
            const page = interaction.options.getInteger('pagina') || 1;
            const limit = 5; 
            const offset = (page - 1) * limit;

            // BUSCA O MEMBER PARA PEGAR O NICKNAME (APELIDO NO SERVIDOR)
            const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
            const displayName = targetMember ? targetMember.displayName : user.username;

            // --- 2. BUSCA O TOTAL DE REGISTROS ---
            const totalData = db.prepare(`SELECT COUNT(*) as total FROM punishments WHERE user_id = ? AND guild_id = ?`).get(user.id, guildId);
            const total = totalData ? totalData.total : 0;

            if (total === 0) {
                return interaction.editReply({ content: `${EMOJIS.CHECK} O usuário **${displayName}** não possui nenhum registro no histórico deste servidor.` });
            }

            const totalPages = Math.ceil(total / limit);
            if (page > totalPages) {
                return interaction.editReply({ content: `${EMOJIS.ERRO} Página inválida. O histórico possui apenas **${totalPages}** página(s).` });
            }

            // --- 3. BUSCA OS DADOS NO BANCO ---
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
                
                const isRevoked = p.severity === 0;
                const statusEmoji = isRevoked ? `${EMOJIS.UP} ` : `${EMOJIS.DOWN} `;
                const severityDisplay = isRevoked 
                    ? `**REVOGADA / ANULADA**` 
                    : `\`Nível ${p.severity}\``;

                description += `${statusEmoji} **ID #${p.id}**\n` +
                               `${EMOJIS.REPUTATION}  **Gravidade:** ${severityDisplay}\n` +
                               `${EMOJIS.STAFF}  **Staff:** <@${p.moderator_id}>\n` +
                               `${EMOJIS.TICKET} **Ticket:** \`#${ticketDisplay}\`\n` +
                               `${EMOJIS.NOTE} **Motivo:** ${p.reason}\n` +
                               `${EMOJIS.HISTORY} **Data:** <t:${unixTimestamp}:f>\n` +
                               `──────────────────\n`;
            }

            // --- 4. CONSTRUÇÃO DO EMBED ---
            const embed = new EmbedBuilder()
                .setThumbnail(user.displayAvatarURL({ forceStatic: false }))
                .setDescription(`# ${EMOJIS.HISTORY} Histórico\n`
                    `## ${EMOJIS.USUARIO} ${displayName} | Reputação: **${reputation}**/100\n` + 
                    `${description}\n` +
                    `## ${EMOJIS.STATS} Resumo da Ficha\n`+
                    `Total de registros: **${total}**\n`
                    `Exibindo página **${page}** de **${totalPages}**`,
                )
                .setColor(0xFF3C72)
                .setFooter({ 
                    text: interaction.guild.name, 
                    iconURL: interaction.guild.iconURL({ forceStatic: false }) || null
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error("Erro crítico no comando histórico:", error);
            await interaction.editReply({ content: `${EMOJIS.ERRO} Ocorreu um erro ao consultar o banco de dados. Verifique os logs do console.` });
        }
    }
};