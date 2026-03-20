const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Ver histórico detalhado de punições de um usuário neste servidor.')
        // Removida a trava rígida de permissão do Discord para controle interno por cargo
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

        // 1. VERIFICAÇÃO DE PERMISSÃO (STAFF OU ADMIN)
        const staffRoleSetting = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = 'staff_role'`).get(guildId);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        const hasStaffRole = staffRoleSetting ? interaction.member.roles.cache.has(staffRoleSetting.value) : false;

        if (!isAdmin && !hasStaffRole) {
            return interaction.reply({ 
                content: `${EMOJIS.AVISO} Você não tem permissão de **Staff** para acessar o histórico de outros membros.`, 
                ephemeral: true 
            });
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            const user = interaction.options.getUser('usuario');
            const page = interaction.options.getInteger('pagina') || 1;
            const limit = 5; 
            const offset = (page - 1) * limit;

            // BUSCA DADOS DO USUÁRIO
            const userData = db.prepare(`SELECT reputation FROM users WHERE user_id = ? AND guild_id = ?`).get(user.id, guildId);
            const userRep = userData ? userData.reputation : 100;

            const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
            const displayName = targetMember ? targetMember.displayName : user.username;

            // 2. BUSCA O TOTAL DE REGISTROS
            const totalData = db.prepare(`SELECT COUNT(*) as total FROM punishments WHERE user_id = ? AND guild_id = ?`).get(user.id, guildId);
            const total = totalData ? totalData.total : 0;

            if (total === 0) {
                return interaction.editReply({ content: `${EMOJIS.CHECK} O usuário **${displayName}** não possui registros de punição neste servidor.` });
            }

            const totalPages = Math.ceil(total / limit);
            if (page > totalPages) {
                return interaction.editReply({ content: `${EMOJIS.ERRO} Página inválida. O histórico possui apenas **${totalPages}** página(s).` });
            }

            // 3. BUSCA OS DADOS PAGINADOS
            const punishments = db.prepare(`
                SELECT * FROM punishments 
                WHERE user_id = ? AND guild_id = ?
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `).all(user.id, guildId, limit, offset);

            let historyEntries = ""; 

            for (const p of punishments) {
                const unixTimestamp = Math.floor(p.created_at / 1000);
                const ticketDisplay = p.ticket_id || 'N/A';
                
                const isRevoked = p.severity === 0;
                const statusEmoji = isRevoked ? `${EMOJIS.UP}` : `${EMOJIS.DOWN}`;
                const severityDisplay = isRevoked 
                    ? `**ANULADA**` 
                    : `\`Nível ${p.severity}\``;

                historyEntries += `${statusEmoji} **ID #${p.id}** | ${severityDisplay}\n` +
                                  `${EMOJIS.STAFF} **Staff:** <@${p.moderator_id}>\n` +
                                  `${EMOJIS.TICKET} **Ticket:** \`#${ticketDisplay}\` | ${EMOJIS.NOTE} **Motivo:** ${p.reason}\n` +
                                  `${EMOJIS.HISTORY} **Data:** <t:${unixTimestamp}:f>\n` +
                                  `──────────────────\n`;
            }

            // 4. CONSTRUÇÃO DO EMBED
            const embed = new EmbedBuilder()
                .setThumbnail(user.displayAvatarURL({ forceStatic: false }))
                .setColor(0xFF3C72)
                .setDescription(
                    `# ${EMOJIS.HISTORY} Histórico de Punições\n` +
                    `## ${EMOJIS.USUARIO} ${displayName}\n` +
                    `${EMOJIS.REPUTATION} Reputação Atual: **${userRep}**/100\n\n` + 
                    `${historyEntries}\n` +
                    `### ${EMOJIS.STATS} Resumo da Ficha\n` +
                    `Total de registros: **${total}**\n` +
                    `Página **${page}** de **${totalPages}**`
                )
                .setFooter({ 
                    text: `✧ BOT by: KnustVI`, 
                    iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' 
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error("Erro no comando historico:", error);
            await interaction.editReply({ content: `${EMOJIS.ERRO} Ocorreu um erro técnico ao consultar o histórico.` });
        }
    }
};