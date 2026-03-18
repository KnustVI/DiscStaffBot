const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ajuda')
        .setDescription('Guia de introdução e lista de comandos do DiscStaffBot.'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setColor(0xff2e6c) // Verde primavera para dar as boas-vindas
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .setDescription(
                `# 🚀 Introdução ao DiscStaffBot`
                `Olá **${interaction.user.username}**! Eu sou o assistente de moderação focado em **Reputação e Gestão de Staff**.\n`+
                `Para começar a me usar corretamente, siga o guia abaixo:`+
                '# 🛠️ 1. Configuração Inicial (Adm)'+
                'Você deve configuar o bot primeiro para usar os outros comandos e sistemas.\n'+
                '- Use `/config canais-e-cargos` para definir ou alterar os cargos e canais de logs\n'+
                '- Use `/config metricas` para definir ou alterar quanto de reputação cada infração (Nível 1 a 5) deve retirar.\n' +
                '- Use `/config show` para mostrar suas configurações feitas.\n' +
                '- Use `/config reset` para resetar todas as configurações (Não apaga punições já aplicadas)' +
                '# ⚖️ 3. Como Punir?'+
                '- Moderadores usam `/punir`. O bot aplica a punição no Discord, desconta os pontos e avisa o usuário no PV automaticamente, com todas as informações incluidas.\n' +
                '- Moderadores usam `/revogar`. O bot revoga a punição no Discord, readiciona os pontos e avisa o usuário no PV automaticamente, com todas as informações incluidas.\n' +
                '# 🔍 4. Consultas'+
                '- Use `/histórico @usuario` para ver o histórico completo e a reputação atual de alguém.'+
                '- Use `/perfil @usuario` para ver o status completo e a reputação atual de alguém.',
            )
            .setFooter({ 
                text: interaction.guild.name, 
                iconURL: interaction.guild
                .iconURL({ dynamic: true }) 
                .setTimestamp()
            })

        // Adicionando um botão para o comando de reputação para facilitar a vida do usuário
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

        // Coletor simples para o botão de atalho
        const collector = response.createMessageComponentCollector({ time: 60000 });

        collector.on('collect', async i => {
            if (i.customId === 'ver_reputacao_btn') {
                // Aqui o bot tenta executar a lógica do comando /reputação ou apenas avisa
                await i.reply({ 
                    content: '📌 Use o comando `/reputacao` para ver a tabela detalhada de punições deste servidor!', 
                    ephemeral: true 
                });
            }
        });
    }
};