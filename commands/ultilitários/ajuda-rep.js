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
                `# Olá **${interaction.user.username}**! 
                Nosso sistema de monitoramento ajuda a manter a comunidade segura e justa. Entenda a diferença entre os dados:
                ## 📊 A Escala de Status
                - O valor numérico define em qual "faixa" de comportamento o jogador se encontra:
                ✨ 90 - 100 (Exemplar): Jogador padrão ou que nunca causou problemas.
                ✅ 70 - 89 (Bom): Cometeu erros leves, mas ainda é considerado confiável.
                ⚠️ 50 - 69 (Atenção): Jogador problemático. A Staff deve ficar de olho em reincidências.
                🚨 Abaixo de 50 (Crítico): Jogador altamente tóxico ou reincidente grave. Geralmente, nesta fase, qualquer erro novo resulta em Banimento Permanente.
                ## Nível,Gravidade, Pontos Retirados, Tipo de Punição Comum.
                1 - Aviso (-2 Rep) Aviso verbal.
                2 - Advertência (-5 Rep) 5 minutos de castigo.
                3 - Castigo leve (-10 Rep) 30 minutos de castigo.
                4 - Castigo médio (-20 Rep) 2 horas de castigo.
                5 - Castigo severo (-35 Rep) 24 horas de castigo.
                `
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