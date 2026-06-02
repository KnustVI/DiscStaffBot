// /home/ubuntu/DiscStaffBot/src/commands/utility/ajuda.js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
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
            page1Builder.addTitle(`${emojis.user || '🤖'} Assistente Titan`, 1);
            page1Builder.addText(`Olá **${member.displayName}**! Sou o sistema de gestão do seu servidor **${guild.name}**.`);
            page1Builder.addSeparator();
            page1Builder.addTitle(`${emojis.Config || '⚙️'} Configuração Inicial`, 2);
            page1Builder.addText(`Apenas administradores podem usar estes comandos:`);
            page1Builder.addText(`• **/config-logs** - Configura os canais de log (Geral, Punições, AutoMod, ReportChat)`);
            page1Builder.addText(`• **/config-roles** - Configura cargos (Staff é OBRIGATÓRIO!)`);
            page1Builder.addText(`• **/config-points** - Configura pontos dos strikes e limites de reputação`);
            page1Builder.addSeparator();
            page1Builder.addTitle(`${emojis.chat || '🎫'} ReportChat`, 2);
            page1Builder.addText(`• **/reportchat** - Cria o painel de reports para os usuários`);
            page1Builder.addText(`Os usuários abrem reports via formulário, staff entra na thread e atende.`);
            page1Builder.addFooter();
            
            // Página 2 - Moderação e Reputação
            const page2Builder = ContainerFormatter.create(guild.name, 0xDCA15E);
            page2Builder.addTitle(`${emojis.strike || '🛠️'} Moderação e Reputação`, 1);
            page2Builder.addText(`Apenas usuários com cargo STAFF podem usar:`);
            page2Builder.addSeparator();
            page2Builder.addTitle(`${emojis.strike || '⚠️'} Comandos de Punição`, 2);
            page2Builder.addText(`• **/strike** - Aplica punição e reduz reputação`);
            page2Builder.addText(`• **/unstrike** - Anula punição e restaura pontos`);
            page2Builder.addText(`• **/historico** - Consulta ficha completa do usuário`);
            page2Builder.addText(`• **/repset** - Ajuste manual de reputação`);
            page2Builder.addSeparator();
            page2Builder.addTitle(`${emojis.star || '⭐'} Sistema de Reputação`, 2);
            page2Builder.addText(`• Máximo: 100 pontos | Mínimo: 0 pontos`);
            page2Builder.addText(`• Recuperação: +1 ponto/dia sem punições`);
            page2Builder.addText(`• Perda: conforme configuração de strikes`);
            page2Builder.addFooter();

            // Página 3 - AutoMod e Status
            const page3Builder = ContainerFormatter.create(guild.name, 0xDCA15E);
            page3Builder.addTitle(`${emojis.AutoMod || '🛡️'} Auto Moderação`, 1);
            page3Builder.addText(`Sistema automático de gerenciamento de reputação:`);
            page3Builder.addSeparator();
            page3Builder.addTitle(`${emojis.Config || '⚙️'} Comandos`, 2);
            page3Builder.addText(`• **/automod test** - Verifica configurações e canal de log`);
            page3Builder.addSeparator();
            page3Builder.addTitle(`${emojis.gain || '📈'} Funcionamento`, 2);
            page3Builder.addText(`• Executa diariamente às 12:00`);
            page3Builder.addText(`• +1 ponto para quem não tem punições nas últimas 24h`);
            page3Builder.addText(`• Atribui/remove cargos Exemplar e Problemático automaticamente`);
            page3Builder.addText(`• Envia relatório no canal de log configurado`);
            page3Builder.addSeparator();
            page3Builder.addTitle(`${emojis.global || '🌐'} Status`, 2);
            page3Builder.addText(`• **/botstatus** - Verifica saúde do bot e sistemas`);
            page3Builder.addText(`• Mostra latência, memória, status do AutoMod e estatísticas`);
            page3Builder.addFooter();
            
            // Se não for admin, mostrar apenas a página 1 (simplificada)
            if (!isAdmin) {
                const simpleBuilder = ContainerFormatter.create(guild.name, 0xDCA15E);
                simpleBuilder.addTitle(`${emojis.user || '🤖'} Assistente Titan`, 1);
                simpleBuilder.addText(`Olá **${member.displayName}**! Sou o sistema de gestão do servidor **${guild.name}**.`);
                simpleBuilder.addSeparator();
                simpleBuilder.addTitle(`${emojis.chat || '🎫'} ReportChat`, 2);
                simpleBuilder.addText(`• Use o painel de reports para abrir uma denúncia`);
                simpleBuilder.addText(`• Staff irá atender e analisar o caso`);
                simpleBuilder.addText(`• Você pode avaliar o atendimento ao final`);
                simpleBuilder.addSeparator();
                simpleBuilder.addTitle(`${emojis.star || '⭐'} Reputação`, 2);
                simpleBuilder.addText(`• Sua reputação começa em 100 pontos`);
                simpleBuilder.addText(`• Infrações reduzem sua pontuação`);
                simpleBuilder.addText(`• Comportamento exemplar mantém pontos altos`);
                simpleBuilder.addFooter();
                
                await interaction.editReply({
                    components: [simpleBuilder.build()],
                    flags: [MessageFlags.IsComponentsV2]
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
                flags: [MessageFlags.IsComponentsV2]
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
                    flags: [MessageFlags.IsComponentsV2]
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
                        flags: [MessageFlags.IsComponentsV2]
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