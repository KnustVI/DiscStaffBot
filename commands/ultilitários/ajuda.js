const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { EMOJIS } = require('../../database/emojis'); 
const ErrorLogger = require('../../systems/errorLogger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ajuda')
        .setDescription('Guia de introdução e lista de comandos do DiscStaffBot.'),

    async execute(interaction) {
        const { client, member, guild } = interaction;

        const description = [
            `# ${EMOJIS.ROBIN || '🤖'} Assistente Robin`,
            `Olá **${member.displayName}**! Sou o braço direito da sua Staff. Fui projetado para gerenciar a ordem e a integridade do **${guild.name}** através de um sistema inteligente de reputação e mais.`,
            '',
            `### ${EMOJIS.CONFIG} 1. Configuração Inicial`,
            `- \`/config\`: Abre o painel interativo para definir cargos de Staff e canais de Log/Alertas.`,
            `### ${EMOJIS.ACTION} 2. Moderação & Gestão`,
            `- \`/punir\`: Aplica sanções que removem reputação e aplicam timeout automático.`,
            `- \`/rep-set\`: Ajuste manual de pontos (exclusivo para cargos de confiança).`,
            `- \`/historico\`: Consulta a ficha completa de um membro de forma paginada e leve.`,
            `- \`/info\`: Consulta o status de um usuário e sua reputação atual.`,
            `### ${EMOJIS.REPUTATION} 3. Como funciona a Reputação?`,
            `- **Base:** Todos iniciam com \`100\` pontos.`,
            `- **Manutenção Diária:** Às 03:00 AM, usuários ativos recuperam \`+1\` ponto.`,
            `- **Cargos Automáticos:** Membros com \`95+\` pontos ganham o cargo **Exemplar**, enquanto membros abaixo de \`30\` recebem o cargo **Problemático**.`,
            `---`,
            `> Utilize os comandos acima para manter o servidor seguro e organizado.`
        ].join('\n');

        const embed = new EmbedBuilder()
            .setColor(0xba0054)
            .setThumbnail(client.user.displayAvatarURL())
            .setDescription(description)
            .addFields({ 
                name: `📡 Status do Sistema`, 
                value: `🟢 Online e Monitorando via Oracle Cloud`, 
                inline: false 
            })
            .setFooter({ 
                text: `✧ BOT by: KnustVI | Em: ${guild.name}`, 
                iconURL: 'https://i.ibb.co/PvBbXgw7/Asset-9.png' 
            })
            .setTimestamp();

        try {
            await interaction.reply({ 
                embeds: [embed], 
                ephemeral: true 
            });
        } catch (error) {
            ErrorLogger.log('Command_Ajuda', error);
            // Se falhar o ephemeral reply, tentamos avisar no console
            console.error("Erro ao enviar comando de ajuda:", error);
        }
    }
};