// src/commands/utility/ajuda.js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const ContainerFormatter = require('../../utils/ContainerFormatter');

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
            
            // Conteúdo das páginas
            const page1Content = [
                `${emojis.user || '🤖'} **Assistente Titan**`,
                `Olá **${member.displayName}**! Sou o sistema de gestão do seu servidor **${guild.name}**.`,
                ``,
                `**${emojis.Config || '⚙️'} Configuração Inicial**`,
                `Apenas administradores podem usar estes comandos:`,
                `• **/config-logs** - Configura os canais de log`,
                `• **/config-roles** - Configura cargos (Staff é OBRIGATÓRIO!)`,
                `• **/config-points** - Configura pontos dos strikes`,
                ``,
                `**${emojis.chat || '🎫'} ReportChat**`,
                `• **/reportchat** - Cria o painel de reports`,
                `Os usuários abrem reports via formulário, staff entra na thread e atende.`
            ];
            
            const page2Content = [
                `${emojis.strike || '🛠️'} **Moderação e Reputação**`,
                `Apenas usuários com cargo STAFF podem usar:`,
                ``,
                `**${emojis.strike || '⚠️'} Comandos de Punição**`,
                `• **/strike** - Aplica punição e reduz reputação`,
                `• **/unstrike** - Anula punição e restaura pontos`,
                `• **/historico** - Consulta ficha completa do usuário`,
                `• **/repset** - Ajuste manual de reputação`,
                ``,
                `**${emojis.star || '⭐'} Sistema de Reputação**`,
                `• Máximo: 100 pontos | Mínimo: 0 pontos`,
                `• Recuperação: +1 ponto/dia sem punições`,
                `• Perda: conforme configuração de strikes`
            ];
            
            const page3Content = [
                `${emojis.AutoMod || '🛡️'} **Auto Moderação**`,
                `Sistema automático de gerenciamento de reputação:`,
                ``,
                `**${emojis.Config || '⚙️'} Comandos**`,
                `• **/automod** - Executa manutenção e verifica configurações`,
                ``,
                `**${emojis.gain || '📈'} Funcionamento**`,
                `• Executa diariamente às 12:00`,
                `• +1 ponto para quem não tem punições nas últimas 24h`,
                `• Atribui/remove cargos Exemplar e Problemático`,
                `• Envia relatório no canal de log configurado`,
                ``,
                `**${emojis.global || '🌐'} Status**`,
                `• **/botstatus** - Verifica saúde do bot e sistemas`,
                `• Mostra latência, memória, status do AutoMod`
            ];
            
            // Função para construir uma página
            function buildPage(content, pageNumber, totalPages) {
                const builder = ContainerFormatter.createBuilder(guild.name, 0xDCA15E);
                
                // Título
                builder.addTitle('📖 Assistente Titan', 1);
                builder.addSeparator();
                
                // Conteúdo
                for (const line of content) {
                    if (line === '') {
                        // Linha vazia não adiciona nada
                        continue;
                    } else if (line.startsWith('**') && line.endsWith('**')) {
                        builder.addTitle(line.replace(/\*\*/g, ''), 2);
                    } else {
                        builder.addText(line);
                    }
                }
                
                builder.addSeparator();
                
                // Informação da página
                builder.addText(`📄 **Página ${pageNumber} de ${totalPages}**`);
                builder.addSeparator();
                
                // Botões de navegação
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('ajuda_prev')
                        .setLabel('◀ Anterior')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(pageNumber === 1),
                    new ButtonBuilder()
                        .setCustomId('ajuda_next')
                        .setLabel('Próxima ▶')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(pageNumber === totalPages)
                );
                
                builder.addButtonRow([row.components[0], row.components[1]]);
                builder.addFooter();
                
                return builder;
            }
            
            // Para usuários não admin - página única
            if (!isAdmin) {
                const simpleContent = [
                    `${emojis.user || '🤖'} **Assistente Titan**`,
                    `Olá **${member.displayName}**! Sou o sistema de gestão do servidor **${guild.name}**.`,
                    ``,
                    `**${emojis.chat || '🎫'} ReportChat**`,
                    `• Use o painel de reports para abrir uma denúncia`,
                    `• Staff irá atender e analisar o caso`,
                    `• Você pode avaliar o atendimento ao final`,
                    ``,
                    `**${emojis.star || '⭐'} Reputação**`,
                    `• Sua reputação começa em 100 pontos`,
                    `• Infrações reduzem sua pontuação`,
                    `• Comportamento exemplar mantém pontos altos`
                ];
                
                const builder = ContainerFormatter.createBuilder(guild.name, 0xDCA15E);
                builder.addTitle('📖 Assistente Titan', 1);
                builder.addSeparator();
                
                for (const line of simpleContent) {
                    if (line === '') continue;
                    if (line.startsWith('**') && line.endsWith('**')) {
                        builder.addTitle(line.replace(/\*\*/g, ''), 2);
                    } else {
                        builder.addText(line);
                    }
                }
                
                builder.addSeparator();
                builder.addFooter();
                
                await ResponseManager.send(interaction, builder.build());
                console.log(`📊 [AJUDA] ${user.tag} em ${guild.name} (usuário comum)`);
                return;
            }
            
            // Para admins - sistema de páginas
            const pagesContent = [page1Content, page2Content, page3Content];
            let currentPage = 0;
            const totalPages = pagesContent.length;
            
            // Função para atualizar a mensagem
            async function updatePage(pageIndex) {
                const builder = buildPage(pagesContent[pageIndex], pageIndex + 1, totalPages);
                const replyData = builder.build();
                return replyData;
            }
            
            // Envia a primeira página
            const initialData = await updatePage(0);
            await interaction.editReply(initialData);
            
            // Coletor de interações
            const filter = (i) => i.user.id === user.id && (i.customId === 'ajuda_prev' || i.customId === 'ajuda_next');
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 120000 });
            
            collector.on('collect', async (i) => {
                if (i.customId === 'ajuda_prev') {
                    currentPage = Math.max(0, currentPage - 1);
                } else if (i.customId === 'ajuda_next') {
                    currentPage = Math.min(totalPages - 1, currentPage + 1);
                }
                
                const newData = await updatePage(currentPage);
                await i.update(newData);
            });
            
            collector.on('end', async () => {
                // Desabilita os botões após expirar
                const disabledBuilder = buildPage(pagesContent[currentPage], currentPage + 1, totalPages);
                const disabledData = disabledBuilder.build();
                // Recria os botões desabilitados
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ajuda_prev').setLabel('◀ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId('ajuda_next').setLabel('Próxima ▶').setStyle(ButtonStyle.Secondary).setDisabled(true)
                );
                disabledData.components = [disabledData.components[0], disabledRow];
                await interaction.editReply(disabledData).catch(() => {});
            });
            
            console.log(`📊 [AJUDA] ${user.tag} em ${guild.name} (admin)`);
            
        } catch (error) {
            console.error('❌ Erro no ajuda:', error);
            await ResponseManager.error(interaction, 'Erro ao gerar guia de ajuda.');
        }
    }
};