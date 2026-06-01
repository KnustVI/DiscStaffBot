// /home/ubuntu/DiscStaffBot/src/commands/utility/ajuda.js
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
            
            // Página 1 - Boas-vindas e Configuração
            const page1Builder = ContainerFormatter.create(guild.name, 0xDCA15E);
            page1Builder.title(`${emojis.user || '🤖'} Assistente Titan`, 1);
            page1Builder.text(`Olá **${member.displayName}**! Sou o sistema de gestão do seu servidor **${guild.name}**.`);
            page1Builder.line();
            page1Builder.title(`${emojis.Config || '⚙️'} Configuração Inicial`, 2);
            page1Builder.text(`Apenas administradores podem usar estes comandos:`);
            page1Builder.text(`• **/config-logs** - Configura os canais de log (Geral, Punições, AutoMod, ReportChat)`);
            page1Builder.text(`• **/config-roles** - Configura cargos (Staff é OBRIGATÓRIO!)`);
            page1Builder.text(`• **/config-points** - Configura pontos dos strikes e limites de reputação`);
            page1Builder.line();
            page1Builder.title(`${emojis.chat || '🎫'} ReportChat`, 2);
            page1Builder.text(`• **/reportchat** - Cria o painel de reports para os usuários`);
            page1Builder.text(`Os usuários abrem reports via formulário, staff entra na thread e atende.`);
            page1Builder.footer();
            
            // Página 2 - Moderação e Reputação
            const page2Builder = ContainerFormatter.create(guild.name, 0xDCA15E);
            page2Builder.title(`${emojis.strike || '🛠️'} Moderação e Reputação`, 1);
            page2Builder.text(`Apenas usuários com cargo STAFF podem usar:`);
            page2Builder.line();
            page2Builder.title(`${emojis.strike || '⚠️'} Comandos de Punição`, 2);
            page2Builder.text(`• **/strike** - Aplica punição e reduz reputação`);
            page2Builder.text(`• **/unstrike** - Anula punição e restaura pontos`);
            page2Builder.text(`• **/historico** - Consulta ficha completa do usuário`);
            page2Builder.text(`• **/repset** - Ajuste manual de reputação`);
            page2Builder.line();
            page2Builder.title(`${emojis.star || '⭐'} Sistema de Reputação`, 2);
            page2Builder.text(`• Máximo: 100 pontos | Mínimo: 0 pontos`);
            page2Builder.text(`• Recuperação: +1 ponto/dia sem punições`);
            page2Builder.text(`• Perda: conforme configuração de strikes`);
            page2Builder.footer();

            // Página 3 - AutoMod e Status
            const page3Builder = ContainerFormatter.create(guild.name, 0xDCA15E);
            page3Builder.title(`${emojis.AutoMod || '🛡️'} Auto Moderação`, 1);
            page3Builder.text(`Sistema automático de gerenciamento de reputação:`);
            page3Builder.line();
            page3Builder.title(`${emojis.Config || '⚙️'} Comandos`, 2);
            page3Builder.text(`• **/automod test** - Verifica configurações e canal de log`);
            page3Builder.line();
            page3Builder.title(`${emojis.gain || '📈'} Funcionamento`, 2);
            page3Builder.text(`• Executa diariamente às 12:00`);
            page3Builder.text(`• +1 ponto para quem não tem punições nas últimas 24h`);
            page3Builder.text(`• Atribui/remove cargos Exemplar e Problemático automaticamente`);
            page3Builder.text(`• Envia relatório no canal de log configurado`);
            page3Builder.line();
            page3Builder.title(`${emojis.global || '🌐'} Status`, 2);
            page3Builder.text(`• **/botstatus** - Verifica saúde do bot e sistemas`);
            page3Builder.text(`• Mostra latência, memória, status do AutoMod e estatísticas`);
            page3Builder.footer();
            
            // Se não for admin, mostrar apenas a página 1 (simplificada)
            if (!isAdmin) {
                const simpleBuilder = ContainerFormatter.create(guild.name, 0xDCA15E);
                simpleBuilder.title(`${emojis.user || '🤖'} Assistente Titan`, 1);
                simpleBuilder.text(`Olá **${member.displayName}**! Sou o sistema de gestão do servidor **${guild.name}**.`);
                simpleBuilder.line();
                simpleBuilder.title(`${emojis.chat || '🎫'} ReportChat`, 2);
                simpleBuilder.text(`• Use o painel de reports para abrir uma denúncia`);
                simpleBuilder.text(`• Staff irá atender e analisar o caso`);
                simpleBuilder.text(`• Você pode avaliar o atendimento ao final`);
                simpleBuilder.line();
                simpleBuilder.title(`${emojis.star || '⭐'} Reputação`, 2);
                simpleBuilder.text(`• Sua reputação começa em 100 pontos`);
                simpleBuilder.text(`• Infrações reduzem sua pontuação`);
                simpleBuilder.text(`• Comportamento exemplar mantém pontos altos`);
                simpleBuilder.footer();
                
                await interaction.editReply({
                    components: [simpleBuilder.build()],
                    flags: ['IsComponentsV2']
                });
                console.log(`📊 [AJUDA] ${user.tag} em ${guild.name} (usuário comum)`);
                return;
            }
            
            // Para admins, sistema de páginas
            const pages = [page1Builder, page2Builder, page3Builder];
            let currentPage = 0;
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('ajuda_prev').setLabel('◀ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('ajuda_next').setLabel('Próxima ▶').setStyle(ButtonStyle.Secondary).setDisabled(pages.length === 1)
            );
            
            await interaction.editReply({
                components: [pages[currentPage].build(), row],
                flags: ['IsComponentsV2']
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
                    new ButtonBuilder().setCustomId('ajuda_prev').setLabel('◀ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
                    new ButtonBuilder().setCustomId('ajuda_next').setLabel('Próxima ▶').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === pages.length - 1)
                );
                
                await i.update({
                    components: [pages[currentPage].build(), updatedRow],
                    flags: ['IsComponentsV2']
                });
            });
            
            collector.on('end', async () => {
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ajuda_prev').setLabel('◀ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId('ajuda_next').setLabel('Próxima ▶').setStyle(ButtonStyle.Secondary).setDisabled(true)
                );
                try {
                    await interaction.editReply({
                        components: [pages[currentPage]?.build(), disabledRow],
                        flags: ['IsComponentsV2']
                    });
                } catch (err) {}
            });
            
            console.log(`📊 [AJUDA] ${user.tag} em ${guild.name} (admin)`);
            
        } catch (error) {
            console.error('❌ Erro no ajuda:', error);
            await ResponseManager.error(interaction, 'Erro ao gerar guia de ajuda.');
        }
    }
};