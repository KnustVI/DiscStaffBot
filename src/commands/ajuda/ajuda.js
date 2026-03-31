const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ajuda')
        .setDescription('Guia de introdução e lista de comandos do Assistente Robin.'),

    async execute(interaction) {
        const { client, member, guild } = interaction;

        // Problema 2: Acessando sistemas via client.systems (pré-carregados no index)
        const EMOJIS = client.systems.emojis || {}; 
        const ConfigSystem = client.systems.config; 
        const ErrorLogger = client.systems.logger;

        // Conteúdo formatado (Mantendo sua estrutura de Markdown)
        const description = [
            `# ${EMOJIS.ROBIN || '🤖'} Assistente Robin`,
            `Olá **${member.displayName}**! Sou o braço direito da sua Staff. Fui projetado para gerenciar a ordem e a integridade do **${guild.name}** através de um sistema inteligente de reputação.`,
            `### ${EMOJIS.CONFIG || '⚙️'} 1. Configuração Inicial`,
            `- \`/config\`: Painel interativo para definir cargos Staff e canais de Log.`,
            `- \`/botstatus\`: Verifica a saúde do sistema e o próximo ciclo do AutoMod.`,
            `### ${EMOJIS.ACTION || '🛠️'} 2. Moderação & Gestão`,
            `- \`/strike\`: Aplica sanções (Strikes), remove reputação e aplica timeout.`,
            `- \`/rep-set\`: Ajuste manual de pontos (Exclusivo para cargos de confiança).`,
            `- \`/historico\`: Consulta a ficha completa e punições de um membro.`,
            `- \`/info\`: Consulta rápida da reputação atual de um usuário.`,
            `### ${EMOJIS.REPUTATION || '📊'} 3. Sistema de Reputação`,
            `- **Base:** Todos iniciam com \`100\` pontos.`,
            `- **Manutenção:** Diariamente às **12:00 PM (BRT)**, usuários ativos ganham \`+1\` ponto.`,
            `- **Cargos Automáticos:** Membros com \`95+\` pontos tornam-se **Exemplares**, abaixo de \`30\` tornam-se **Problemáticos**.`,
            `---`,
            `> Utilize os comandos acima para manter o servidor seguro. Em caso de erros, contate o desenvolvedor.`
        ].join('\n');

        // Pegamos o footer padronizado (Problema 6: Removido await desnecessário se for síncrono)
        const footerData = ConfigSystem.getFooter ? ConfigSystem.getFooter(guild.name) : { text: guild.name, iconURL: guild.iconURL() };

        const embed = new EmbedBuilder()
            .setColor(0xDCA15E) 
            .setThumbnail(client.user.displayAvatarURL())
            .setDescription(description)
            .addFields({ 
                name: `📡 Integridade do Sistema`, 
                value: `🟢 Online | Database SQLite (WAL)`, 
                inline: false 
            })
            .setFooter({ 
                text: footerData.text, 
                iconURL: footerData.iconURL 
            })
            .setTimestamp();

        try {
            // Importante: Usamos editReply porque o interactionCreate já deu deferReply
            await interaction.editReply({ 
                embeds: [embed]
            });
        } catch (error) {
            if (ErrorLogger) ErrorLogger.log('Command_Ajuda', error);
            console.error("❌ Erro ao enviar comando de ajuda:", error);
        }
    }
};