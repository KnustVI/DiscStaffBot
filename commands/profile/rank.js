const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Exibe o Top 10 de reputação global do bot'),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            // 1. Busca o Top 10 GLOBAL (Removido guild_id pois a tabela users não possui essa coluna)
            const topRanking = db.prepare(`
                SELECT user_id, reputation 
                FROM users 
                ORDER BY reputation DESC 
                LIMIT 10
            `).all();

            if (topRanking.length === 0) {
                return interaction.editReply({
                    content: "⚠️ Nenhum usuário possui registros de reputação no sistema ainda."
                });
            }

            // 2. Mapeamento de medalhas
            const medalhas = { 0: "🥇", 1: "🥈", 2: "🥉" };
            
            let description = topRanking.map((user, index) => {
                const medal = medalhas[index] || `**${index + 1}.**`;
                const isTop3 = index < 3;
                return `${medal} <@${user.user_id}> — ${isTop3 ? "**" : ""}${user.reputation} Rep${isTop3 ? "**" : ""}`;
            }).join('\n');

            // 3. Busca todos os usuários para calcular a posição do autor
            const allUsers = db.prepare('SELECT user_id FROM users ORDER BY reputation DESC').all();
            const myPos = allUsers.findIndex(u => u.user_id === interaction.user.id) + 1;
            
            // Adiciona a posição do autor se ele não estiver no Top 10
            if (myPos > 10) {
                description += `\n\n─── **Sua Posição** ───\n**#${myPos}** <@${interaction.user.id}>`;
            } else if (myPos === 0) {
                 description += `\n\n─── **Sua Posição** ───\n*Você ainda não tem registros.*`;
            }

            // 4. Construção da Embed
            const embed = new EmbedBuilder()
                .setTitle(`🏆 Ranking de Reputação | Global`)
                .setDescription(description)
                .setColor(0xf2b705) 
                .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                .addFields({
                    name: "📊 Estatísticas",
                    value: `Usuários Registrados: \`${allUsers.length}\``
                })
                .setFooter({ 
                    text: `Solicitado por ${interaction.user.tag}`, 
                    iconURL: interaction.user.displayAvatarURL() 
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error("Erro no comando rank:", error);
            await interaction.editReply("❌ Erro ao processar o ranking.");
        }
    }
};