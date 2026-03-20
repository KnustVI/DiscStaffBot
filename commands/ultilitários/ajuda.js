const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { EMOJIS } = require('../../database/emojis'); 
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { EMOJIS } = require('../../database/emojis'); 

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ajuda')
        .setDescription('Guia de introdução e lista de comandos do DiscStaffBot.'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setColor(0xFF3C72)
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .setImage('https://i.ibb.co/wFj3SL9v/Chat-GPT-Image-18-de-mar-de-2026-23-24-35.png') // Imagem de introdução
            .setDescription(
                `# ${EMOJIS.ROBIN} Assistente Robin\n` +
                `Olá **${interaction.member.displayName}**! Sou o sistema de Gestão de Staff.\n` +
                `### ${EMOJIS.CONFIG} 1. Configuração Inicial\n` +
                `- \`/config canais-e-cargos\`: Define cargos e canais.\n` +
                `- \`/config metricas\`: Ajusta valores de reputação.\n` +
                `- \`/config show\`: Mostra as configurações atuais.\n` +
                `### ${EMOJIS.ACTION} 2. Moderação\n` +
                `- \`/punir\`: Aplica sanções.\n` +
                `- \`/revogar\`: Anula punições.\n` +
                `- \`/resetrep\`: Limpa a ficha de punições de um usuário.\n` +
                `- \`/historico\`: Ver histórico detalhado de punições de um usuário.\n` +
                `- \`/stafflog\`: Consulta o histórico de ações aplicadas por um membro da Staff.\n` +
                `### ${EMOJIS.CONSULT} 3. Consultas\n` +
                `- \`/conferir\`: Explica o sistema para qualquer usuário do servidor.\n` +
                `- \`/reputacao\`: Status de um usuário.`
            )
            .setFooter({ 
                        text: `✧ BOT by: KnustVI | ${interaction.guild.name}`, 
                        iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' 
                    })
            .setTimestamp();

        try {
            // Removido o campo 'components', agora apenas a Embed será enviada
            await interaction.reply({ 
                embeds: [embed], 
                ephemeral: true 
            });
        } catch (error) {
            console.error("Erro ao enviar comando de ajuda:", error);
        }
        try {
            // Removido o campo 'components', agora apenas a Embed será enviada
            await interaction.reply({ 
                embeds: [embed], 
                ephemeral: true 
            });
        } catch (error) {
            console.error("Erro ao enviar comando de ajuda:", error);
        }
    }
};