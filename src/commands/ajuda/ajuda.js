const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const EmbedFormatter = require('../../utils/embedFormatter');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ajuda')
        .setDescription('📖 Guia de introdução e lista de comandos do Assistente Titan.'),

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
            
            const isAdmin = member.permissions.has('Administrator');
            
            // Página 1 - Boas-vindas e Configuração
            const page1Embed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setThumbnail(client.user.displayAvatarURL())
                .setDescription(
                    `# ${emojis.user || '🤖'} Assistente Titan\n` +
                    `Olá **${member.displayName}**! Sou o sistema de gestão do seu servidor **${guild.name}**.\n` +
                    `## ${emojis.Config || '⚙️'} Configuração Inicial\n` +
                    `Apenas administradores podem usar estes comandos:\n` +
                    `• **/config-logs** - Configura os canais de log (Geral, Punições, AutoMod, ReportChat)\n` +
                    `• **/config-roles** - Configura cargos (Staff é OBRIGATÓRIO!)\n` +
                    `• **/config-points** - Configura pontos dos strikes e limites de reputação\n` +
                    `## ${emojis.chat || '🎫'} ReportChat\n` +
                    `• **/reportchat** - Cria o painel de reports para os usuários\n` +
                    `Os usuários abrem reports via formulário, staff entra na thread e atende.\n\n` +
                    `> Desenvolvido por **Knust VI** | [Servidor de Suporte](https://discord.gg/8YCEkZQkZP)`
                )
                .setFooter(EmbedFormatter.getFooter(guild.name))
                .setTimestamp();

            // Página 2 - Moderação e Reputação
            const page2Embed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setThumbnail(client.user.displayAvatarURL())
                .setDescription(
                    `# ${emojis.strike || '🛠️'} Moderação e Reputação\n` +
                    `Apenas usuários com cargo STAFF podem usar:\n` +
                    `## ${emojis.strike || '⚠️'} Comandos de Punição\n` +
                    `• **/strike** - Aplica punição e reduz reputação\n` +
                    `• **/unstrike** - Anula punição e restaura pontos\n` +
                    `• **/historico** - Consulta ficha completa do usuário\n` +
                    `• **/repset** - Ajuste manual de reputação\n` +
                    `## ${emojis.star || '⭐'} Sistema de Reputação\n` +
                    `• Máximo: 100 pontos | Mínimo: 0 pontos\n` +
                    `• Recuperação: +1 ponto/dia sem punições\n` +
                    `• Perda: conforme configuração de strikes\n\n` +
                    `> Desenvolvido por **Knust VI** | [Servidor de Suporte](https://discord.gg/8YCEkZQkZP)`
                )
                .setFooter(EmbedFormatter.getFooter(guild.name))
                .setTimestamp();

            // Página 3 - AutoMod e Status
            const page3Embed = new EmbedBuilder()
                .setColor(0xDCA15E)
                .setThumbnail(client.user.displayAvatarURL())
                .setDescription(
                    `# ${emojis.AutoMod || '🛡️'} Auto Moderação\n` +
                    `Sistema automático de gerenciamento de reputação:\n\n` +
                    `## ${emojis.Config || '⚙️'} Comandos\n` +
                    `• **/automod test** - Verifica configurações e canal de log\n` +
                    `## ${emojis.gain || '📈'} Funcionamento\n` +
                    `• Executa diariamente às 12:00\n` +
                    `• +1 ponto para quem não tem punições nas últimas 24h\n` +
                    `• Atribui/remove cargos Exemplar e Problemático automaticamente\n` +
                    `• Envia relatório no canal de log configurado\n` +
                    `## ${emojis.global || '🌐'} Status\n` +
                    `• **/botstatus** - Verifica saúde do bot e sistemas\n` +
                    `• Mostra latência, memória, status do AutoMod e estatísticas\n\n` +
                    `> Desenvolvido por **Knust VI** | [Servidor de Suporte](https://discord.gg/8YCEkZQkZP)`
                )
                .setFooter(EmbedFormatter.getFooter(guild.name))
                .setTimestamp();

            // Se não for admin, mostrar apenas a página 1 (simplificada)
            if (!isAdmin) {
                const simpleEmbed = new EmbedBuilder()
                    .setColor(0xDCA15E)
                    .setThumbnail(client.user.displayAvatarURL())
                    .setDescription(
                        `# ${emojis.user || '🤖'} Assistente Titan\n` +
                        `Olá **${member.displayName}**! Sou o sistema de gestão do servidor **${guild.name}**.\n` +
                        `## ${emojis.chat || '🎫'} ReportChat\n` +
                        `• Use o painel de reports para abrir uma denúncia\n` +
                        `• Staff irá atender e analisar o caso\n` +
                        `• Você pode avaliar o atendimento ao final\n` +
                        `## ${emojis.star || '⭐'} Reputação\n` +
                        `• Sua reputação começa em 100 pontos\n` +
                        `• Infrações reduzem sua pontuação\n` +
                        `• Comportamento exemplar mantém pontos altos\n\n` +
                        `> Desenvolvido por **Knust VI** | [Servidor de Suporte](https://discord.gg/8YCEkZQkZP)`
                    )
                    .setFooter(EmbedFormatter.getFooter(guild.name))
                    .setTimestamp();
                
                await ResponseManager.send(interaction, { embeds: [simpleEmbed] });
                console.log(`📊 [AJUDA] ${user.tag} em ${guild.name} (usuário comum)`);
                return;
            }

            // Para admins, sistema de páginas
            const pages = [page1Embed, page2Embed, page3Embed];
            let currentPage = 0;
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ajuda_prev')
                    .setLabel('◀ Anterior')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('ajuda_next')
                    .setLabel('Próxima ▶')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(pages.length === 1)
            );
            
            await interaction.editReply({
                embeds: [pages[currentPage]],
                components: [row],
                ephemeral: true
            });
            
            const filter = (i) => i.user.id === user.id && (i.customId === 'ajuda_prev' || i.customId === 'ajuda_next');
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 120000 });
            
            collector.on('collect', async (i) => {
                if (i.customId === 'ajuda_prev') {
                    currentPage = Math.max(0, currentPage - 1);
                } else if (i.customId === 'ajuda_next') {
                    currentPage = Math.min(pages.length - 1, currentPage + 1);
                }
                
                const updatedRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('ajuda_prev')
                        .setLabel('◀ Anterior')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(currentPage === 0),
                    new ButtonBuilder()
                        .setCustomId('ajuda_next')
                        .setLabel('Próxima ▶')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(currentPage === pages.length - 1)
                );
                
                await i.update({
                    embeds: [pages[currentPage]],
                    components: [updatedRow]
                });
            });
            
            collector.on('end', async () => {
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ajuda_prev').setLabel('◀ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId('ajuda_next').setLabel('Próxima ▶').setStyle(ButtonStyle.Secondary).setDisabled(true)
                );
                try {
                    await interaction.editReply({ components: [disabledRow] });
                } catch (err) {}
            });
            
            console.log(`📊 [AJUDA] ${user.tag} em ${guild.name} (admin)`);
            
        } catch (error) {
            console.error('❌ Erro no ajuda:', error);
            await ResponseManager.error(interaction, 'Erro ao gerar guia de ajuda.');
        }
    }
};