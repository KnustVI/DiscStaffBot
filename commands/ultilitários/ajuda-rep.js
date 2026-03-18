const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reputacao')
        .setDescription('Explica como funciona o sistema de reputação Local e Global.'),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        // --- BUSCA AS MÉTRICAS CONFIGURADAS NO BANCO ---
        const getMetric = (level, type, fallback) => {
            const res = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`)
                          .get(guildId, `punish_${level}_${type}`);
            return res ? res.value : fallback;
        };

        // Fallbacks caso o ADM ainda não tenha configurado nada
        const defaultMetrics = {
            1: { action: "Aviso", time: 0, rep: 2 },
            2: { action: "Advertência", time: 5, rep: 5 },
            3: { action: "Castigo leve", time: 30, rep: 10 },
            4: { action: "Castigo médio", time: 120, rep: 20 },
            5: { action: "Castigo severo", time: 1440, rep: 35 }
        };

        // Montando a lista de punições dinamicamente
        let punicoesTexto = "";
        for (let i = 1; i <= 5; i++) {
            const action = getMetric(i, 'action', defaultMetrics[i].action);
            const rep = getMetric(i, 'rep', defaultMetrics[i].rep);
            const time = getMetric(i, 'time', defaultMetrics[i].time);
            
            const timeDesc = time > 0 ? `${time} min` : "Aviso";
            punicoesTexto += `**${i}** - ${action} (\`-${rep} Rep\`) — *${timeDesc}*\n`;
        }

        const embed = new EmbedBuilder()
            .setTitle('⚖️ Como funciona nossa Reputação?')
            .setColor(0xff2e6c)
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .setDescription(
                `# Olá **${interaction.user.username}**!\n` +
                `Nosso sistema de monitoramento ajuda a manter a comunidade segura e justa. Entenda como funcionam as punições e o status:\n\n` +
                `## 📊 A Escala de Status\n` +
                `✨ **90 - 100 (Exemplar):** Jogador padrão ou exemplar.\n` +
                `✅ **70 - 89 (Bom):** Cometeu erros leves, mas é confiável.\n` +
                `⚠️ **50 - 69 (Atenção):** Jogador problemático. Requer atenção da Staff.\n` +
                `🚨 **Abaixo de 50 (Crítico):** Jogador reincidente ou tóxico.\n\n` +
                `## 🛠️ Tabela de Punições Atualizada\n` +
                punicoesTexto
            )
            .addFields(
                { 
                    name: '🏠 Reputação Local (Neste Servidor)', 
                    value: 'Sua pontuação começa em **100**. Cada infração reduz essa nota. Ela define seu **Status** exclusivamente aqui.' 
                },
                { 
                    name: '📈 Recuperação Diária', 
                    value: 'A cada **24 horas** sem cometer infrações, você recupera automaticamente **1 ponto** de reputação, até atingir o limite de 100.' 
                },
                { 
                    name: '🌍 Histórico de Rede', 
                    value: 'O BOT registra punições em toda a nossa rede. A Staff pode consultar seu histórico para identificar comportamentos repetitivos.' 
                }
            )
            .setFooter({ text: '📍 Os valores acima são definidos pela Administração deste servidor.' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};