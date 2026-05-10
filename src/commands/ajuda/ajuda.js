const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const EmbedFormatter = require('../../utils/embedFormatter');

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
                `# ${emojis.user || '🤖'} Assistente TITAN`,
                `Olá **${member.displayName}**! Sou o sistema de gestão agora no seu servidor **${guild.name}**.`,
                `Para começar a usar, aqui estão algumas informações e comandos úteis, começe por fazer a configuração inicial.`,
                `### ${emojis.Config || '⚙️'} Configuração.`,
                `Apenas administradores podem usar estes comandos para configurar o sistema e personalizar a experiência da equipe.`,
                `- \`/config-logs\`: Configura os canais de log para diferentes sistemas.`,
                `***IMPORTANTE:*** Configure os canais de log para garantir que todas as ações e eventos sejam registrados corretamente. O canal de AutoMod é especialmente importante para monitorar as ações automáticas do bot.`,
                `- \`/config-points\`: Configura os pontos dos níveis de Strike e limites de reputação.`,
                `- \`/config-roles\`: Configura os cargos e permissões para Staff. É obrigatório que selecione um cargo para sua staff, sem o cargo configurado eles não conseguem usar os comandos de moderação. Os outos cargos são opcionais.`,
                `### ${emojis.History || '⚙️'} Status do Bot`,
                `- \`/botstatus\`: Informa o status atual do bot e seus sistemas.`,
                `### ${emojis.chat || '💬'} Painel de Report`,
                `- \`/reportchat\`: Manda seu panel de report para que os players usem.`,
                `### ${emojis.strike || '🛠️'} Moderação`,
                `Apenas aqueles com o cargo staff a configuração podem usar estes comandos.`,
                `- \`/strike\`: Aplica punições e reduz reputação.`,
                `- \`/unstrike\`: Remove punições e restaura reputação.`,
                `- \`/historico\`: Consulta a ficha de um usuário.`,
                `- \`/repset\`: Ajuste manual de reputação.`,
                `### ${emojis.star || '📊'} Reputação.`,
                `- **Máxima:** 100 pontos.`,
                `- **Recuperação:** +1 ponto/dia sem punições.`
                `- Automod aplica cargos configurados de acordo com a configuração de points.`,
                ``,
                `> Comandos não listados acima são de uso do desenvolvedor e não são para uso geral. `
            ].join('\n');
            
            const embed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setThumbnail(client.user.displayAvatarURL())
                .setDescription(description)
                .setTimestamp();

                embed.setFooter(EmbedFormatter.getFooter(guild.name));
            
            await ResponseManager.send(interaction, { embeds: [embed] });
            
            console.log(`📊 [AJUDA] ${user.tag} em ${guild.name}`);
            
        } catch (error) {
            console.error('❌ Erro no ajuda:', error);
            await ResponseManager.error(interaction, 'Erro ao gerar guia de ajuda.');
        }
    }
};