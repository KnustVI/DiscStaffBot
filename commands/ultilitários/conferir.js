const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/database');
const { EMOJIS } = require('../../database/emojis'); // Importe os emojis

module.exports = {
    data: new SlashCommandBuilder()
        .setName('conferir')
        .setDescription('Explica como funciona o sistema de reputação Local e Global.'),

    async execute(interaction) {
        const guildId = interaction.guild.id;

        // --- FUNÇÃO DE FORMATAÇÃO DE TEMPO ---
        const formatTime = (minutes) => {
            const m = parseInt(minutes);
            if (!m || m <= 0) return "Aviso";
            if (m >= 1440) return `${Math.floor(m / 1440)} dia(s)`;
            if (m >= 60) return `${Math.floor(m / 60)} hora(s)`;
            return `${m} min`;
        };

        // --- BUSCA AS MÉTRICAS ---
        const getMetric = (level, type, fallback) => {
            const res = db.prepare(`SELECT value FROM settings WHERE guild_id = ? AND key = ?`)
                          .get(guildId, `punish_${level}_${type}`);
            return res ? res.value : fallback;
        };

        const defaultMetrics = {
            1: { action: "aviso", time: 0, rep: 2 },
            2: { action: "timeout", time: 5, rep: 5 },
            3: { action: "timeout", time: 30, rep: 10 },
            4: { action: "timeout", time: 120, rep: 20 },
            5: { action: "ban", time: 0, rep: 35 }
        };

        let punicoesTexto = "";
        for (let i = 1; i <= 5; i++) {
            let actionRaw = getMetric(i, 'action', defaultMetrics[i].action);
            let action = actionRaw.charAt(0).toUpperCase() + actionRaw.slice(1);
            
            const rep = getMetric(i, 'rep', defaultMetrics[i].rep);
            const time = getMetric(i, 'time', defaultMetrics[i].time);
            
            const timeDesc = actionRaw === 'ban' ? "Permanente" : formatTime(time);
            
            punicoesTexto += `**Nível ${i}** - ${action} (\`-${rep} Rep\`) — *${timeDesc}*\n`;
        }

        const embed = new EmbedBuilder()
            .setColor(0xFF3C72)
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .setDescription(
                `# Olá **${interaction.member.displayName}**!\n` +
                `Nosso sistema consiste em ajudar a staff com atividades diárias de monitoramento de usuários. Abaixo segue como funciona o sistema.:\n` +
                `## ${EMOJIS.STATUS} A Escala de Status\n` +
                `${EMOJIS.EXCELLENT} **90 - 100 (Exemplar):** Jogador padrão ou exemplar.\n` +
                `${EMOJIS.GOOD} **70 - 89 (Bom):** Cometeu erros leves, mas é confiável.\n` +
                `${EMOJIS.OBSERVATION} **50 - 69 (Atenção):** Jogador problemático.\n` +
                `${EMOJIS.CRITIC} **Abaixo de 50 (Crítico):** Jogador reincidente ou tóxico.\n` + 
                `## ${EMOJIS.CONFIG} Niveis de Punições\n` + 
                punicoesTexto +
                `\n${EMOJIS.SERVER } Os valores acima são definidos pela Administração deste servidor.\n`+
                `## ${EMOJIS.REPUTATION} Reputação \n` +
                '- Sua pontuação começa em **100**. Cada infração reduz essa nota. Ela define seu **Status** exclusivamente aqui.\n'+
                '- A cada **24 horas** sem cometer infrações, você recupera automaticamente ${EMOJIS.UP} **1 ponto** de reputação, até atingir o limite de 100.\n' +
                '- Sempre que receber uma punição, perderá pontos de acordo com a gravidade e não poderá recuperar **1 ponto** até que se passe 24 horas sem novas infrações.'
            )
            .setFooter({ 
                        text: `✧ BOT by: KnustVI | ${interaction.guild.name}`, 
                        iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' 
                    })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};