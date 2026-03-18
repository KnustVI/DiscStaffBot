const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stafflog')
        .setDescription('Consulta o histórico de ações aplicadas por um membro da Staff.')
        .addUserOption(opt => opt.setName('staff').setDescription('Selecione o moderador').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const staff = interaction.options.getUser('staff');
        const guildId = interaction.guild.id;
        const itemsPerPage = 5;
        let currentPage = 0;

        // Função para gerar o Embed e calcular páginas
        const generateLogEmbed = (page) => {
            const offset = page * itemsPerPage;
            
            // Busca ações desse staff
            const actions = db.prepare(`
                SELECT * FROM punishments 
                WHERE moderator_id = ? AND guild_id = ? 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `).all(staff.id, guildId, itemsPerPage, offset);

            const totalData = db.prepare('SELECT COUNT(*) as count FROM punishments WHERE moderator_id = ? AND guild_id = ?').get(staff.id, guildId);
            const total = totalData ? totalData.count : 0;
            const maxPages = Math.ceil(total / itemsPerPage);

            const embed = new EmbedBuilder()
                .setTitle(`👮 Relatório de Auditoria: ${staff.username}`)
                .setThumbnail(staff.displayAvatarURL({ dynamic: true }))
                .setColor(0x5865F2) // Cor Blurple (foco administrativo)
                .setFooter({ text: `Página ${page + 1} de ${Math.max(1, maxPages)} • Total de ações: ${total}` })
                .setTimestamp();

            if (actions.length === 0) {
                embed.setDescription(`> ℹ️ **${staff.username}** ainda não possui ações registradas neste servidor.`);
                return { embed, maxPages };
            }
            
            // Montagem do conteúdo
            const content = actions.map(a => {
                const unixTimestamp = Math.floor(a.created_at / 1000);
                const ticket = a.ticket_id || 'N/A';
                
                // Verifica se a ação foi uma revogação (severity 0)
                const isRevoked = a.severity === 0;
                const statusEmoji = isRevoked ? "🟢" : "⚖️";
                const severityText = isRevoked ? "**ANULADA**" : `Nível ${a.severity}`;

                return `${statusEmoji} **ID: #${a.id}** | <t:${unixTimestamp}:d>\n` +
                       `**Alvo:** <@${a.user_id}>\n` +
                       `**Gravidade:** ${severityText}\n` +
                       `**Ticket:** \`#${ticket}\` | **Motivo:** \`${a.reason}\``;
            }).join('\n\n───────────────────\n\n');

            embed.setDescription(content);
            return { embed, maxPages };
        };

        const { embed, maxPages } = generateLogEmbed(currentPage);

        const getButtons = (page) => {
            const row = new ActionRowBuilder();
            
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('prev_staff')
                    .setLabel('Anterior')
                    .setEmoji('◀️')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId('next_staff')
                    .setLabel('Próxima')
                    .setEmoji('▶️')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page >= maxPages - 1)
            );

            return row;
        };

        const response = await interaction.reply({
            embeds: [embed],
            components: maxPages > 1 ? [getButtons(currentPage)] : [],
            ephemeral: true 
        });

        // Coletor de componentes (botões) - Dura 5 minutos
        const collector = response.createMessageComponentCollector({ time: 300000 });

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return i.reply({ content: "Você não pode controlar este menu.", ephemeral: true });

            if (i.customId === 'prev_staff') currentPage--;
            if (i.customId === 'next_staff') currentPage++;

            const { embed: newEmbed } = generateLogEmbed(currentPage);
            await i.update({ embeds: [newEmbed], components: [getButtons(currentPage)] });
        });

        // Remove os botões quando o coletor expira
        collector.on('end', () => {
            interaction.editReply({ components: [] }).catch(() => null);
        });
    }
};