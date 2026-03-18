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

        // Função para gerar o Embed de Auditoria
        const generateLogEmbed = (page) => {
            const offset = page * itemsPerPage;
            
            // Busca ações desse staff específico (Inclui ticket_id que adicionamos no DB)
            const actions = db.prepare(`
                SELECT * FROM punishments 
                WHERE moderator_id = ? AND guild_id = ? 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `).all(staff.id, guildId, itemsPerPage, offset);

            const totalCount = db.prepare('SELECT COUNT(*) as count FROM punishments WHERE moderator_id = ? AND guild_id = ?').get(staff.id, guildId);
            const total = totalCount ? totalCount.count : 0;
            const maxPages = Math.ceil(total / itemsPerPage);

            const embed = new EmbedBuilder()
                .setTitle(`👮 Relatório de Staff: ${staff.username}`)
                .setThumbnail(staff.displayAvatarURL({ dynamic: true }))
                .setColor(0xff2e6c)
                .setFooter({ text: `Página ${page + 1} de ${Math.max(1, maxPages)} • Total de ações: ${total}` });

            if (actions.length === 0) {
                embed.setDescription(`> ℹ️ **${staff.username}** ainda não aplicou nenhuma punição neste servidor.`);
                return { embed, maxPages };
            }
            
            // Montagem do conteúdo com o Ticket incluso
            const content = actions.map(a => {
                const date = new Date(a.created_at).toLocaleDateString('pt-BR');
                const ticket = a.ticket_id || 'N/A'; // Fallback caso o registro seja antigo
                
                return `**ID: #${a.id}** | 🗓️ \`${date}\`\n**Alvo:** <@${a.user_id}>\n**Gravidade:** Nível ${a.severity}\n**Motivo:** \`${a.reason}\`\n**Ticket:** \`#${ticket}\`\n`;
            }).join('\n───────────────────\n'); // Linha separadora para facilitar a leitura

            embed.setDescription(content);
            return { embed, maxPages };
        };

        const { embed, maxPages } = generateLogEmbed(currentPage);

        const getButtons = (page) => {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('prev_staff')
                    .setLabel('◀️ Anterior')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId('next_staff')
                    .setLabel('Próxima ▶️')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page >= maxPages - 1)
            );
        };

        const response = await interaction.reply({
            embeds: [embed],
            components: maxPages > 1 ? [getButtons(currentPage)] : [],
            ephemeral: true 
        });

        const collector = response.createMessageComponentCollector({ time: 300000 });

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return i.reply({ content: "Apenas quem usou o comando pode navegar.", ephemeral: true });

            if (i.customId === 'prev_staff') currentPage--;
            if (i.customId === 'next_staff') currentPage++;

            const { embed: newEmbed } = generateLogEmbed(currentPage);
            await i.update({ embeds: [newEmbed], components: [getButtons(currentPage)] });
        });

        collector.on('end', () => {
            interaction.editReply({ components: [] }).catch(() => null);
        });
    }
};