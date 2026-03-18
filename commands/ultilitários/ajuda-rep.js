const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reputacao')
        .setDescription('Explica como funciona o sistema de reputação Local e Global.'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('⚖️ Como funciona nossa Reputação?')
            .setColor(0xff2e6c)
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .setDescription(
                `Olá **${interaction.user.username}**! Nosso sistema de monitoramento ajuda a manter a comunidade segura e justa. Entenda a diferença entre os dados:`
            )
            .addFields(
                { 
                    name: '🏠 Reputação Local (Neste Servidor)', 
                    value: 'Sua pontuação começa em **100**. Cada infração cometida aqui reduz essa nota. Ela define seu **Status** (Exemplar, Bom, Crítico) exclusivamente dentro deste servidor.' 
                },
                { 
                    name: '🌍 Histórico Global (Toda a Rede)', 
                    value: 'O BOT registra punições em todos os servidores da nossa rede. A Staff pode consultar seu histórico completo para identificar comportamentos repetitivos em outras comunidades.' 
                },
                { 
                    name: '📈 Como recuperar pontos?', 
                    value: 'A melhor forma de manter uma boa reputação é seguir as regras! Jogadores com comportamento exemplar podem ter seus pontos revistos pela Staff ou recuperados através de sistemas de tempo limpo.' 
                },
                {
                    name: '👮 Para que serve?',
                    value: 'Sistemas de reputação ajudam a identificar jogadores tóxicos ou "raiders" antes que eles causem problemas, protegendo você e seus amigos.'
                }
            )
            .setFooter({ text: 'Dúvidas? Entre em contato com um Administrador.' })
            .setTimestamp();

        // Respondemos de forma pública para que outros também possam ler
        await interaction.reply({ embeds: [embed] });
    }
};