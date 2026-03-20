const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stafflog')
        .setDescription('Consulta o histórico de ações aplicadas por um membro da Staff.')
        .addUserOption(opt => opt.setName('staff').setDescription('Selecione o moderador').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        const staff = interaction.options.getUser('staff');
        const guildId = interaction.guild.id;
        const itemsPerPage = 5;
        let currentPage = 0;

        // 1. BUSCA INICIAL DE DADOS
        const countResult = db.prepare('SELECT COUNT(*) as count FROM punishments WHERE moderator_id = ? AND guild_id = ?').get(staff.id, guildId);
        const total = countResult ? countResult.count : 0;
        const maxPages = Math.ceil(total / itemsPerPage);

        // 2. FUNÇÃO GERADORA DE EMBED
        const generateLogEmbed = (page) => {
            const offset = page * itemsPerPage;
            const actions = db.prepare(`
                SELECT * FROM punishments 
                WHERE moderator_id = ? AND guild_id = ? 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `).all(staff.id, guildId, itemsPerPage, offset);

            const embed = new EmbedBuilder()
                .setThumbnail(staff.displayAvatarURL({ forceStatic: false }))
                .setColor(0xFF3C72)
                .setFooter({ 
                    text: `✧ BOT by: KnustVI`, 
                    iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' 
                })
                .setTimestamp();
            
            if (!actions || actions.length === 0) {
                embed.setDescription(`> ${EMOJIS.STAFF} **${staff.username}** ainda não aplicou nenhuma punição registrada.`);
                return embed;
            }

            const content = actions.map(a => {
                const unixTimestamp = Math.floor(a.created_at / 1000);
                const status = a.severity === 0 ? `${EMOJIS.UP} [REVOGADA]` : `${EMOJIS.STATUS} Nível ${a.severity}`;
                
                return `**ID: #${a.id}** | <t:${unixTimestamp}:d>\n` +
                       `**Status:** ${status} | **Alvo:** <@${a.user_id}>\n` +
                       `**Motivo:** \`${a.reason.substring(0, 80)}${a.reason.length > 80 ? '...' : ''}\`\n` +
                       `──────────────────`;
            }).join('\n');

            embed.setDescription(
                `# ${EMOJIS.STAFF} Relatório: ${staff.username}\n` +
                `${content}\n\n` +
                `*Página ${page + 1} de ${Math.max(1, maxPages)} • Total: ${total} ações*`
            );
            return embed;
        };

        // 3. FUNÇÃO DOS BOTÕES
        const getButtons = (page) => {
            if (maxPages <= 1) return null;
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('prev_staff')
                    .setLabel(`Anterior`)
                    .setEmoji(EMOJIS.LEFT)
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId('next_staff')
                    .setLabel(`Próxima`)
                    .setEmoji(EMOJIS.RIGHT)
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page >= maxPages - 1)
            );
        };

        // 4. RESPOSTA E COLETOR
        try {
            const response = await interaction.reply({
                embeds: [generateLogEmbed(currentPage)],
                components: getButtons(currentPage) ? [getButtons(currentPage)] : [],
                ephemeral: true 
            });

            const collector = response.createMessageComponentCollector({ 
                filter: i => i.user.id === interaction.user.id,
                time: 300000 
            });

            collector.on('collect', async i => {
                if (i.customId === 'prev_staff') currentPage--;
                if (i.customId === 'next_staff') currentPage++;

                await i.update({ 
                    embeds: [generateLogEmbed(currentPage)], 
                    components: [getButtons(currentPage)] 
                }).catch(() => null);
            });

            collector.on('end', () => {
                interaction.editReply({ components: [] }).catch(() => null);
            });

        } catch (error) {
            console.error("Erro ao executar stafflog:", error);
            const errorMsg = { content: `${EMOJIS.ERRO} Erro ao carregar o log.`, ephemeral: true };
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply(errorMsg).catch(() => null);
            } else {
                await interaction.reply(errorMsg).catch(() => null);
            }
        }
    }
};