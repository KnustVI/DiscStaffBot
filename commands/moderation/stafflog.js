const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis'); // Importe os emojis

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
            
            // Busca ações desse staff específico
            const actions = db.prepare(`
                SELECT * FROM punishments 
                WHERE moderator_id = ? AND guild_id = ? 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `).all(staff.id, guildId, itemsPerPage, offset);

            const countResult = db.prepare('SELECT COUNT(*) as count FROM punishments WHERE moderator_id = ? AND guild_id = ?').get(staff.id, guildId);
            const total = countResult ? countResult.count : 0;
            const maxPages = Math.ceil(total / itemsPerPage);

            const embed = new EmbedBuilder()
                .setThumbnail(staff.displayAvatarURL({ forceStatic: false }))
                .setColor(0xFF3C72)
                .setFooter({ 
                    text: interaction.guild.name, 
                    iconURL: interaction.guild.iconURL({ forceStatic: false }) || null 
                })
                .setTimestamp();
            
            if (actions.length === 0) {
                embed.setDescription(`> ${EMOJIS.DISTINTIVO} **${staff.displayName}** ainda não aplicou nenhuma punição neste servidor.`);
                return { embed, maxPages };
            }

            // Formatação do conteúdo com limite de segurança para não quebrar a Embed
            const content = actions.map(a => {
                const date = new Date(a.created_at).toLocaleDateString('pt-BR');
                // Se for nível 0, indica que foi revogada
                const status = a.severity === 0 ? `${EMOJIS.REFAZER} [REVOGADA]` : `${EMOJIS.STATS} Nível ${a.severity}`;
                
                return `**ID: #${a.id}** | ${EMOJIS.PAINEL} \`${date}\`\n**Status:** ${status}\n**Alvo:** <@${a.user_id}>\n**Motivo:** \`${a.reason.substring(0, 100)}${a.reason.length > 100 ? '...' : ''}\`\n`;
            }).join('\n');

            embed.setDescription(
                `# 👮 Relatório: ${staff.displayName}\n` +
                `${content}\n` +
                `---\n` +
                `*Página ${page + 1} de ${Math.max(1, maxPages)} • Total: ${total} ações*`
            );
            return { embed, maxPages };
        };

        const getButtons = (page, maxPages) => {
            if (maxPages <= 1) return null; // Não retorna botões se houver apenas uma página
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

        const { embed, maxPages } = generateLogEmbed(currentPage);
        const row = getButtons(currentPage, maxPages);

        const response = await interaction.reply({
            embeds: [embed],
            components: row ? [row] : [],
            ephemeral: true 
        });

        // Filtro para garantir que apenas quem usou o comando pode interagir
        const collector = response.createMessageComponentCollector({ 
            filter: i => i.user.id === interaction.user.id,
            time: 300000 
        });

        collector.on('collect', async i => {
            if (i.customId === 'prev_staff') currentPage--;
            if (i.customId === 'next_staff') currentPage++;

            const { embed: newEmbed } = generateLogEmbed(currentPage);
            const newRow = getButtons(currentPage, maxPages);
            
            await i.update({ 
                embeds: [newEmbed], 
                components: newRow ? [newRow] : [] 
            });
        });

        collector.on('end', () => {
            interaction.editReply({ components: [] }).catch(() => null);
        });
    }
};