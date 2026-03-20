const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { EMOJIS } = require('../../database/emojis'); // Importe os emojis

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ajuda')
        .setDescription('Guia de introdução e lista de comandos do DiscStaffBot.'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setColor(0xFF3C72)
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .setDescription(
                `# ${EMOJIS.ROBIN} Introdução ao Assistente Robin\n` +
                `Olá **${interaction.member.displayName}**! Eu sou o assistente de moderação focado em **Reputação e Gestão de Staff**.\n\n` +
                `Para começar a me usar corretamente, siga o guia abaixo:\n` +
                `# ${EMOJIS.CONFIG} 1. Configuração Inicial (Adm)\n` +
                `Você deve configurar o bot primeiro para usar os outros comandos.\n` +
                `- \`/config canais-e-cargos\`: Define cargos e canais.\n` +
                `- \`/config metricas\`: Ajusta os valores de perda de reputação.\n` +
                `- \`/config show\`: Mostra as configurações atuais.\n` +
                `- \`/config configreset\`: Reseta as definições do bot.\n` +
                `# ${EMOJIS.HOW} 2. Como Punir?\n` +
                `- \`/punir\`: Aplica sanções e desconta reputação.\n` +
                `- \`/revogar\`: Anula uma punição e devolve os pontos.\n` +
                `# ${EMOJIS.CONSULT} 3. Consultas\n` +
                `- \`/conferir\`: Explica o sistema aos jogadores.\n` +
                `- \`/reputacao\`: Mostra o status de um usuário.`
            )
            .setFooter({ 
                text: interaction.guild.name, 
                iconURL: interaction.guild.iconURL({ dynamic: true }) 
            })
            .setTimestamp();

        const response = await interaction.reply({ 
            embeds: [embed], 
            components: [row],
            ephemeral: true 
        });

        const collector = response.createMessageComponentCollector({ time: 60000 });

    }
};