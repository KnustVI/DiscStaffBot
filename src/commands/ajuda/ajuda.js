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
            
            const ConfigSystem = require('../../systems/configSystem');
            
            // Verificar se o usuário é administrador
            const isAdmin = member.permissions.has('Administrator');
            
            // ==================== PÁGINAS DO LIVRO ====================
            
            const pages = [
                {
                    title: '📖 Bem-vindo ao Assistente Titan',
                    description: `Olá **${member.displayName}**! Sou o sistema de gestão do servidor **${guild.name}**.\n\n` +
                        `Este guia vai te ajudar a entender todas as funcionalidades do bot.\n\n` +
                        `**📌 Navegação:** Use os botões abaixo para navegar pelas páginas.\n` +
                        `**🔒 Permissões:** Comandos administrativos só aparecem para quem tem permissão.`,
                    icon: '🤖'
                },
                {
                    title: '⚙️ Configuração Inicial',
                    description: `**Para começar, configure o sistema:**\n\n` +
                        `🔹 **\`/config-logs\`** - Configura os canais de log\n` +
                        `   • Geral - logs gerais do sistema\n` +
                        `   • Punições - logs de strikes\n` +
                        `   • AutoMod - logs da auto moderação\n` +
                        `   • ReportChat - logs de reports\n\n` +
                        `🔹 **\`/config-roles\`** - Configura cargos\n` +
                        `   • **Staff** (OBRIGATÓRIO) - sem ele, staff não usa comandos\n` +
                        `   • Strike - cargo temporário (opcional)\n` +
                        `   • Exemplar/Problemático - para AutoMod (opcional)\n\n` +
                        `🔹 **\`/config-points\`** - Configura pontos dos strikes\n` +
                        `   • Personalize quantos pontos cada nível perde\n` +
                        `   • Configure limites de reputação`,
                    icon: '⚙️'
                },
                {
                    title: '📊 Status e Monitoramento',
                    description: `**Acompanhe o funcionamento do bot:**\n\n` +
                        `🔹 **\`/botstatus\`** - Status do bot e sistemas\n` +
                        `   • Uptime, latência, memória\n` +
                        `   • Estatísticas de punições\n` +
                        `   • Status do AutoMod\n\n` +
                        `🔹 **\`/automod test\`** - Diagnóstico do AutoMod\n` +
                        `   • Verifica configurações\n` +
                        `   • Testa canal de log\n` +
                        `   • Mostra problemas e soluções`,
                    icon: '📊'
                },
                {
                    title: '🎫 Sistema de ReportChat',
                    description: `**Como os usuários reportam problemas:**\n\n` +
                        `1️⃣ **\`/reportchat\`** - Cria o painel de reports\n` +
                        `2️⃣ Usuários clicam em "Reportar Jogador"\n` +
                        `3️⃣ Preenchem o formulário\n` +
                        `4️⃣ Thread privada é criada\n\n` +
                        `**Staff pode:**\n` +
                        `• Entrar na thread (botão "Entrar")\n` +
                        `• Fechar reports (com/sem motivo)\n` +
                        `• Usuários avaliam o atendimento\n\n` +
                        `📌 **Canal de log** deve ser configurado em \`/config-logs\``,
                    icon: '🎫'
                },
                {
                    title: '🛠️ Comandos de Moderação (Staff)',
                    description: `**Apenas usuários com cargo STAFF:**\n\n` +
                        `🔹 **\`/strike\`** - Aplica punição\n` +
                        `   • Reduz reputação\n` +
                        `   • Pode aplicar timeout/kick/ban\n` +
                        `   • Registra no histórico\n\n` +
                        `🔹 **\`/unstrike\`** - Remove punição\n` +
                        `   • Restaura reputação\n` +
                        `   • Remove cargo temporário\n\n` +
                        `🔹 **\`/historico\`** - Consulta ficha do usuário\n` +
                        `   • Reputação atual\n` +
                        `   • Lista de strikes\n` +
                        `   • Paginação para muitos registros\n\n` +
                        `🔹 **\`/repset\`** - Ajuste manual de reputação\n` +
                        `   • Soma ou subtrai pontos`,
                    icon: '🛠️'
                },
                {
                    title: '🛡️ Auto Moderação',
                    description: `**Gerenciamento automático de reputação:**\n\n` +
                        `🔹 **\`/automod toggle\`** - Liga/desliga o sistema\n\n` +
                        `🔹 **\`/automod config limits\`** - Configura limites\n` +
                        `   • Limite Exemplar (ex: 95+ pontos)\n` +
                        `   • Limite Problemático (ex: 30- pontos)\n\n` +
                        `**Funcionamento automático:**\n` +
                        `• Diariamente às 12:00\n` +
                        `• +1 ponto para quem não tem punições\n` +
                        `• Atribui/remove cargos automaticamente\n` +
                        `• Envia relatório no canal de log\n\n` +
                        `📌 **Canal de log** necessário para relatórios`,
                    icon: '🛡️'
                },
                {
                    title: '⭐ Sistema de Reputação',
                    description: `**Como funciona a reputação:**\n\n` +
                        `• **Máximo:** 100 pontos\n` +
                        `• **Mínimo:** 0 pontos\n` +
                        `• **Recuperação:** +1 ponto/dia sem punições\n` +
                        `• **Perda:** conforme configuração de strikes\n\n` +
                        `**Cargos automáticos (se configurados):**\n` +
                        `• Exemplar: pontos ≥ limite configurado\n` +
                        `• Problemático: pontos ≤ limite configurado\n\n` +
                        `📌 **Comando \`/historico\`** mostra reputação atual`,
                    icon: '⭐'
                },
                {
                    title: '❓ Dicas e Suporte',
                    description: `**Dicas importantes:**\n\n` +
                        `✅ **Configure tudo antes de liberar para staff**\n` +
                        `✅ **Cargo STAFF é obrigatório** para comandos de moderação\n` +
                        `✅ **Logs são importantes** para auditoria\n` +
                        `✅ **Teste o AutoMod** com \`/automod test\`\n\n` +
                        `**Comandos de desenvolvimento (restritos):**\n` +
                        `• \`/reset-reports\` - Limpa todos os reports\n` +
                        `• \`/reset-db\` - Limpeza total (apenas desenvolvedor)\n\n` +
                        `📌 **Em caso de dúvidas, contate o desenvolvedor do bot.**`,
                    icon: '❓'
                }
            ];
            
            // Filtrar páginas com base na permissão do usuário
            const visiblePages = isAdmin ? pages : pages.filter(page => {
                // Usuários não-admin não veem páginas de configuração
                const adminPages = ['⚙️ Configuração Inicial', '📊 Status e Monitoramento', '🛠️ Comandos de Moderação (Staff)', '🛡️ Auto Moderação'];
                return !adminPages.includes(page.title);
            });
            
            let currentPage = 0;
            const totalPages = visiblePages.length;
            
            // Função para criar o embed da página atual
            function getPageEmbed(pageIndex) {
                const page = visiblePages[pageIndex];
                const embed = new EmbedBuilder()
                    .setColor(0xDCA15E)
                    .setThumbnail(client.user.displayAvatarURL())
                    .setAuthor({ 
                        name: `${page.icon} ${page.title}`,
                        iconURL: client.user.displayAvatarURL()
                    })
                    .setDescription(page.description)
                    .setFooter({ text: `Página ${pageIndex + 1} de ${totalPages} • ${EmbedFormatter.getFooter(guild.name).text}` })
                    .setTimestamp();
                
                return embed;
            }
            
            // Criar botões de navegação
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ajuda_prev')
                    .setLabel('◀ Anterior')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(currentPage === 0),
                new ButtonBuilder()
                    .setCustomId('ajuda_next')
                    .setLabel('Próxima ▶')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(currentPage === totalPages - 1)
            );
            
            // Enviar a primeira página
            await interaction.reply({
                embeds: [getPageEmbed(currentPage)],
                components: [row],
                ephemeral: true
            });
            
            // Criar um collector para os botões
            const filter = (i) => i.user.id === user.id && (i.customId === 'ajuda_prev' || i.customId === 'ajuda_next');
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 120000 }); // 2 minutos
            
            collector.on('collect', async (i) => {
                if (i.customId === 'ajuda_prev') {
                    currentPage = Math.max(0, currentPage - 1);
                } else if (i.customId === 'ajuda_next') {
                    currentPage = Math.min(totalPages - 1, currentPage + 1);
                }
                
                // Atualizar os botões
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
                        .setDisabled(currentPage === totalPages - 1)
                );
                
                await i.update({
                    embeds: [getPageEmbed(currentPage)],
                    components: [updatedRow]
                });
            });
            
            collector.on('end', async () => {
                // Desabilitar botões após expirar
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('ajuda_prev')
                        .setLabel('◀ Anterior')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('ajuda_next')
                        .setLabel('Próxima ▶')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                );
                
                try {
                    await interaction.editReply({ components: [disabledRow] });
                } catch (err) {}
            });
            
            console.log(`📊 [AJUDA] ${user.tag} em ${guild.name} - ${totalPages} páginas`);
            
        } catch (error) {
            console.error('❌ Erro no ajuda:', error);
            await ResponseManager.error(interaction, 'Erro ao gerar guia de ajuda.');
        }
    }
};