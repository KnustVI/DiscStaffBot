const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis'); // Importe os emojis

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Exibe o Top 10 de reputação DESTE servidor'),

    async execute(interaction) {
        try {
            await interaction.deferReply();
            const guildId = interaction.guild.id;

            // Busca os 10 melhores apenas DESTE servidor
            const topRanking = db.prepare(`
                SELECT user_id, reputation 
                FROM users 
                WHERE guild_id = ?
                ORDER BY reputation DESC 
                LIMIT 10
            `).all(guildId);

            if (topRanking.length === 0) {
                return interaction.editReply("⚠️ Nenhum registro de reputação encontrado neste servidor.");
            }

            const medalhas = { 0: `${EMOJIS.FIRST}`, 1: `${EMOJIS.SECOND}`, 2: `${EMOJIS.THIRD}` };
            
            const list = topRanking.map((user, index) => {
                const position = medalhas[index] || `**${index + 1}º**`;
                // Menção simples para evitar carregar membros desnecessários, 
                // o Discord resolve o nome automaticamente no client.
                return `${position} <@${user.user_id}> — \`${user.reputation} pts\``;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setColor(0xFF3C72) // Cor dourada para o ranking
                .setDescription(
                    `# ${EMOJIS.RANK} Melhores usuários | ${interaction.guild.name}\n`+
                    `Confira os jogadores que mais melhoraram seu comportamento após uma punição:\n\n${list}\n---\n` +
                    `${EMOJIS.SERVER} O ranking é atualizado em tempo real.`,
                )
                .setFooter({ 
                text: interaction.guild.name, 
                iconURL: interaction.guild
                .iconURL({ dynamic: true })})
                .setTimestamp();
                
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error("Erro no comando rank:", error);
            await interaction.editReply(`${EMOJIS.ERRO} Erro ao processar o ranking local.`);
        }
    }
};