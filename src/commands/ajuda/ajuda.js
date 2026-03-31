const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ajuda')
        .setDescription('Guia de introdução e lista de comandos do Assistente Robin.'),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction 
     */
    async execute(interaction) {
        // 1. Extração de dependências do Client (Lookup em memória)
        const { client, member, guild } = interaction;
        const { emojis, config, logger } = client.systems;

        const EMOJIS = emojis || {};
        
        try {
            // 2. Lógica Síncrona (Aproveitando o Cache do ConfigSystem)
            // Não usamos await aqui pois o cache em RAM do seu sistema é instantâneo
            const footerText = config.getSetting(guild.id, 'footer_text') || guild.name;
            
            // 3. Construção da UI (Template Strings otimizadas)
            const description = [
                `# ${EMOJIS.ROBIN || '🤖'} Assistente Robin`,
                `Olá **${member.displayName}**! Sou o sistema de gestão do **${guild.name}**.`,
                '',
                `### ${EMOJIS.CONFIG || '⚙️'} 1. Configuração`,
                `- \`/config\`: Painel de controle da Staff.`,
                `- \`/botstatus\`: Integridade técnica do sistema.`,
                '',
                `### ${EMOJIS.ACTION || '🛠️'} 2. Moderação`,
                `- \`/strike\`: Aplica punições e reduz reputação.`,
                `- \`/historico\`: Consulta a ficha de um usuário.`,
                `- \`/rep-set\`: Ajuste manual de reputação.`,
                '',
                `### ${EMOJIS.REPUTATION || '📊'} 3. Reputação`,
                `- **Máxima:** \`100\` pontos.`,
                `- **Status:** \`> 90\` (Exemplar) | \`< 30\` (Risco).`,
                '---',
                `> Use os comandos com responsabilidade.`
            ].join('\n');

            const embed = new EmbedBuilder()
                .setColor(0xDCA15E) // Cor padrão Robin
                .setThumbnail(client.user.displayAvatarURL())
                .setDescription(description)
                .addFields({ 
                    name: `📡 Sistema`, 
                    value: `🟢 Operacional | v3.0`, 
                    inline: true 
                })
                .setFooter({ 
                    text: footerText, 
                    iconURL: guild.iconURL() 
                })
                .setTimestamp();

            // 4. Resposta Final (Contrato: Slash Command usa editReply)
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            // 5. Proteção contra erro (SafeExecute)
            if (logger) {
                logger.log('Command_Ajuda', error);
            } else {
                console.error("Critical Error in /ajuda:", error);
            }

            // Garante que o usuário saiba que algo deu errado, sem travar a interação
            await interaction.editReply({ 
                content: `${EMOJIS.ERRO || '❌'} Houve um erro interno ao gerar o guia de ajuda.` 
            }).catch(() => null);
        }
    }
};