const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ajuda')
        .setDescription('Guia de introdução e lista de comandos do Assistente Robin.'),

    async execute(interaction, client) {
        const { guild, user, member } = interaction;
        
        let emojis = {};
        try {
            const emojisFile = require('../../database/emojis.js');
            emojis = emojisFile.EMOJIS || {};
        } catch (err) {}
        
        try {
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);
            
            const ConfigSystem = require('../../systems/configSystem');
            const footerText = ConfigSystem.getSetting(guild.id, 'footer_text') || guild.name;
            
            const description = [
                `# ${emojis.user || '🤖'} Assistente Robin`,
                `Olá **${member.displayName}**! Sou o sistema de gestão do **${guild.name}**.`,
                ``,
                `## ${emojis.Config || '⚙️'} Configuração`,
                `- \`/config\`: Painel de controle da Staff`,
                `- \`/botstatus\`: Integridade técnica do sistema`,
                ``,
                `## ${emojis.strike || '🛠️'} Moderação`,
                `- \`/strike\`: Aplica punições e reduz reputação`,
                `- \`/unstrike\`: Remove punições e restaura reputação`,
                `- \`/historico\`: Consulta a ficha de um usuário`,
                `- \`/repset\`: Ajuste manual de reputação`,
                ``,
                `## ${emojis.star || '📊'} Reputação`,
                `- **Máxima:** \`100\` pontos`,
                `- **Exemplar:** \`> 90\` pontos`,
                `- **Risco:** \`< 30\` pontos`,
                `- **Recuperação:** +1 ponto/dia sem punições`,
                ``,
                `> Use os comandos com responsabilidade.`
            ].join('\n');
            
            const embed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setThumbnail(client.user.displayAvatarURL())
                .setDescription(description)
                .setFooter({ text: footerText, iconURL: guild.iconURL() || client.user.displayAvatarURL() })
                .setTimestamp();
            
            await ResponseManager.send(interaction, { embeds: [embed] });
            
            console.log(`📊 [AJUDA] ${user.tag} em ${guild.name}`);
            
        } catch (error) {
            console.error('❌ Erro no ajuda:', error);
            await ResponseManager.error(interaction, 'Erro ao gerar guia de ajuda.');
        }
    }
};