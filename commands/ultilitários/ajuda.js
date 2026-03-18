const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ajuda')
        .setDescription('Guia de introdução e lista de comandos do DiscStaffBot.'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setColor(0xff2e6c)
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .setDescription(
                `# 🚀 Introdução ao DiscStaffBot\n` + // Adicionado o + que faltava
                `Olá **${interaction.user.username}**! Eu sou o assistente de moderação focado em **Reputação e Gestão de Staff**.\n\n` +
                `Para começar a me usar corretamente, siga o guia abaixo:\n\n` +
                `# 🛠️ 1. Configuração Inicial (Adm)\n` +
                `Você deve configurar o bot primeiro para usar os outros comandos.\n` +
                `- \`/config canais-e-cargos\`: Define cargos e canais.\n` +
                `- \`/config metricas\`: Ajusta os valores de perda de reputação.\n` +
                `- \`/config show\`: Mostra as configurações atuais.\n` +
                `- \`/config configreset\`: Reseta as definições do bot.\n\n` +
                `# ⚖️ 2. Como Punir?\n` +
                `- \`/punir\`: Aplica sanções e desconta reputação.\n` +
                `- \`/revogar\`: Anula uma punição e devolve os pontos.\n\n` +
                `# 🔍 3. Consultas\n` +
                `- \`/reputacao\`: Explica o sistema aos jogadores.\n` +
                `- \`/perfil\`: Mostra o status de um usuário.`
            )
            .setFooter({ 
                text: interaction.guild.name, 
                iconURL: interaction.guild.iconURL({ dynamic: true }) 
            })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ver_reputacao_btn')
                .setLabel('Ver Regras de Reputação')
                .setEmoji('⚖️')
                .setStyle(ButtonStyle.Primary)
        );

        const response = await interaction.reply({ 
            embeds: [embed], 
            components: [row],
            ephemeral: true 
        });

        const collector = response.createMessageComponentCollector({ time: 60000 });

        collector.on('collect', async i => {
            if (i.customId === 'ver_reputacao_btn') {
                await i.reply({ 
                    content: '📌 Use o comando `/reputacao` para ver a tabela detalhada de punições deste servidor!', 
                    ephemeral: true 
                });
            }
        });
    }
};