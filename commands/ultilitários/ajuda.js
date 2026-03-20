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
            .setDescription(
                `# ${EMOJIS.ROBIN} Assistente Robin\n` +
                `Olá **${interaction.member.displayName}**! Sou o sistema de Gestão de Staff.\n\n` +
                `### ${EMOJIS.CONFIG} 1. Configuração Inicial\n` +
                `- \`/config canais-e-cargos\`: Define cargos e canais.\n` +
                `- \`/config metricas\`: Ajusta valores de reputação.\n` +
                `- \`/config show\`: Mostra as configurações atuais.\n\n` +
                `### ${EMOJIS.ACTION} 2. Moderação\n` +
                `- \`/punir\`: Aplica sanções.\n` +
                `- \`/revogar\`: Anula punições.\n\n` +
                `### ${EMOJIS.CONSULT} 3. Consultas\n` +
                `- \`/conferir\`: Explica o sistema.\n` +
                `- \`/reputacao\`: Status de um usuário.`
            )
            .setFooter({ 
                text: interaction.guild.name, 
                iconURL: interaction.guild.iconURL({ dynamic: true }) 
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
    }
};