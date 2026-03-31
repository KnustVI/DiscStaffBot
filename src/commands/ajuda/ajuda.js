const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ajuda')
        .setDescription('Guia de introdução e lista de comandos do Assistente Robin.'),

    async execute(interaction) {
        // Destruturação rápida para performance
        const { client, member, guild } = interaction;

        // Ponto 2: Lookup direto na memória (Client.systems já carregado no index)
        const EMOJIS = client.systems.emojis || {}; 
        const ConfigSystem = client.systems.config; 
        const ErrorLogger = client.systems.logger;

        // Ponto 6: Remoção de await em funções síncronas. 
        // Se getFooter apenas formata texto, o await causa um micro-atraso desnecessário.
        const footerData = ConfigSystem.getFooter 
            ? ConfigSystem.getFooter(guild.name) 
            : { text: guild.name, iconURL: guild.iconURL() };

        // Construção da descrição usando Template Strings de forma limpa
        const description = [
            `# ${EMOJIS.ROBIN || '🤖'} Assistente Robin`,
            `Olá **${member.displayName}**! Sou o braço direito da sua Staff no **${guild.name}**.`,
            `### ${EMOJIS.CONFIG || '⚙️'} 1. Configuração Inicial`,
            `- \`/config\`: Painel interativo para Staff e Logs.`,
            `- \`/botstatus\`: Saúde do sistema e ciclos.`,
            `### ${EMOJIS.ACTION || '🛠️'} 2. Moderação & Gestão`,
            `- \`/strike\`: Aplica sanções e remove reputação.`,
            `- \`/rep-set\`: Ajuste manual de pontos.`,
            `- \`/historico\`: Consulta a ficha completa.`,
            `### ${EMOJIS.REPUTATION || '📊'} 3. Sistema de Reputação`,
            `- **Base:** Todos iniciam com \`100\` pontos.`,
            `- **Cargos:** \`95+\` **Exemplares** | \`< 30\` **Problemáticos**.`,
            `---`,
            `> Utilize os comandos acima para manter a ordem.`
        ].join('\n');

        const embed = new EmbedBuilder()
            .setColor(0xDCA15E) 
            .setThumbnail(client.user.displayAvatarURL())
            .setDescription(description)
            .addFields({ 
                name: `📡 Integridade`, 
                value: `🟢 Online | SQLite (WAL)`, 
                inline: true 
            })
            .setFooter({ 
                text: footerData.text, 
                iconURL: footerData.iconURL 
            })
            .setTimestamp();

        try {
            // Ponto 1: Usando editReply porque o roteador já deu deferReply
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            // Ponto 5: Log centralizado sem duplicar lógica no console se houver logger
            if (ErrorLogger && typeof ErrorLogger.log === 'function') {
                ErrorLogger.log('Command_Ajuda', error);
            } else {
                console.error("❌ Erro no comando ajuda:", error);
            }
        }
    }
};