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
            .setImage('https://i.ibb.co/wFj3SL9v/Chat-GPT-Image-18-de-mar-de-2026-23-24-35.png')
            .setAuthor({ 
                name: 'Central de Ajuda DiscStaff', 
                iconURL: interaction.client.user.displayAvatarURL() 
            })
            .setDescription(
                `# ${EMOJIS.ROBIN} Assistente Robin\n` +
                `Olá **${interaction.member.displayName}**! Sou o braço direito da sua Staff. Abaixo estão as instruções para gerenciar este servidor.\n\n` +
                
                `### ${EMOJIS.CONFIG} 1. Configuração Inicial\n` +
                `*Estes comandos preparam o terreno para o bot funcionar:* \n` +
                `- \`/config canais-e-cargos\`: Define onde os logs vão e quem é Staff.\n` +
                `- \`/config metricas\`: Ajusta o rigor da reputação.\n` +
                `- \`/config show\`: Revisa o que foi configurado.\n\n` +
                
                `### ${EMOJIS.ACTION} 2. Moderação & Gestão\n` +
                `*Para manter a ordem e gerenciar comportamentos:* \n` +
                `- \`/punir\`: Aplica sanções (perda de rep/timeout).\n` +
                `- \`/revogar\`: Cancela uma punição indevida.\n` +
                `- \`/resetrep\`: Limpa a ficha de um usuário.\n` +
                `- \`/historico\`: Histórico completo de um membro.\n` +
                `- \`/stafflog\`: Audita as ações feitas por um Staff.\n\n` +
                
                `### ${EMOJIS.CONSULT} 3. Consultas & Status\n` +
                `*Disponível para usuários e administradores:* \n` +
                `- \`/conferir\`: Explica como a reputação funciona.\n` +
                `- \`/reputacao\`: Mostra o perfil e a barra de integridade.\n\n` +
                `---`
            )
            .addFields({ 
                name: `📡 Status do Sistema`, 
                value: `🟢 Online e Monitorando \`${interaction.guild.name}\``, 
                inline: false 
            })
            .setFooter({ 
                text: `✧ BOT by: KnustVI | v2.0`, 
                iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' 
            })
            .setTimestamp();

        try {
            await interaction.reply({ 
                embeds: [embed], 
                ephemeral: true 
            });
        } catch (error) {
            console.error("Erro ao enviar comando de ajuda:", error);
        }
    }
};