// /home/ubuntu/DiscStaffBot/src/commands/utility/ajuda.js
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('../../database/index');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');
const { PaginationBuilder } = require('../../utils/paginationBuilder');

// ---------------------------------------------------------------------------
// Fábrica de páginas
// ---------------------------------------------------------------------------

function buildPageWelcome(displayName, guildName, emojis) {
    return new AdvancedContainerBuilder({ accentColor: 0xDCA15E })
        .title(`${emojis.user || '🤖'} Assistente Titan`)
        .text(`Olá **${displayName}**! Sou o sistema de gestão do seu servidor **${guildName}**.`)
        .separator()
        .title(`${emojis.Config || '⚙️'} Configuração Inicial`, 2)
        .text('Apenas administradores podem usar estes comandos:')
        .block([
            '• **/config-logs** — Configura os canais de log (Geral, Punições, AutoMod, ReportChat)',
            '• **/config-roles** — Configura cargos (Staff é OBRIGATÓRIO!)',
            '• **/config-points** — Configura pontos dos strikes e limites de reputação',
        ])
        .separator()
        .title(`${emojis.chat || '🎫'} ReportChat`, 2)
        .block([
            '• **/reportchat** — Cria o painel de reports para os usuários',
            '• Usuários abrem reports via formulário; staff entra na thread e atende.',
        ]);
}

function buildPageModeration(emojis) {
    return new AdvancedContainerBuilder({ accentColor: 0xDCA15E })
        .title(`${emojis.strike || '🛠️'} Moderação e Reputação`)
        .text('Apenas usuários com cargo **STAFF** podem usar:')
        .separator()
        .title(`${emojis.strike || '⚠️'} Comandos de Punição`, 2)
        .block([
            '• **/strike** — Aplica punição e reduz reputação',
            '• **/unstrike** — Anula punição e restaura pontos',
            '• **/historico** — Consulta ficha completa do usuário',
            '• **/repset** — Ajuste manual de reputação',
        ])
        .separator()
        .title(`${emojis.star || '⭐'} Sistema de Reputação`, 2)
        .block([
            '• Máximo: **100 pontos** | Mínimo: **0 pontos**',
            '• Recuperação: +1 ponto/dia sem punições',
            '• Perda: conforme configuração de strikes',
        ]);
}

function buildPageAutomod(emojis) {
    return new AdvancedContainerBuilder({ accentColor: 0xDCA15E })
        .title(`${emojis.AutoMod || '🛡️'} Auto Moderação`)
        .text('Sistema automático de gerenciamento de reputação:')
        .separator()
        .title(`${emojis.Config || '⚙️'} Comandos`, 2)
        .text('• **/automod test** — Verifica configurações e canal de log')
        .separator()
        .title(`${emojis.gain || '📈'} Funcionamento`, 2)
        .block([
            '• Executa diariamente às **12:00**',
            '• +1 ponto para quem não tem punições nas últimas 24h',
            '• Atribui/remove cargos **Exemplar** e **Problemático** automaticamente',
            '• Envia relatório no canal de log configurado',
        ])
        .separator()
        .title(`${emojis.global || '🌐'} Status`, 2)
        .block([
            '• **/botstatus** — Verifica saúde do bot e sistemas',
            '• Mostra latência, memória, status do AutoMod e estatísticas',
        ]);
}

function buildPageUserSimple(displayName, guildName, emojis) {
    return new AdvancedContainerBuilder({ accentColor: 0xDCA15E })
        .title(`${emojis.user || '🤖'} Assistente Titan`)
        .text(`Olá **${displayName}**! Sou o sistema de gestão do servidor **${guildName}**.`)
        .separator()
        .title(`${emojis.chat || '🎫'} ReportChat`, 2)
        .block([
            '• Use o painel de reports para abrir uma denúncia',
            '• Staff irá atender e analisar o caso',
            '• Você pode avaliar o atendimento ao final',
        ])
        .separator()
        .title(`${emojis.star || '⭐'} Reputação`, 2)
        .block([
            '• Sua reputação começa em **100 pontos**',
            '• Infrações reduzem sua pontuação',
            '• Comportamento exemplar mantém pontos altos',
        ]);
}

// ---------------------------------------------------------------------------
// Comando
// ---------------------------------------------------------------------------

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ajuda')
        .setDescription('📖 Guia de introdução e lista de comandos do Assistente Titan.'),

    async execute(interaction, client) {
        const { guild, user, member } = interaction;

        // Carrega emojis customizados
        let emojis = {};
        try {
            emojis = require('../../database/emojis.js').EMOJIS ?? {};
        } catch { /* sem emojis */ }

        try {
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

            const isAdmin = member.permissions.has('Administrator');

            // ----------------------------------------------------------------
            // Usuário comum - Mensagem única
            // ----------------------------------------------------------------
            if (!isAdmin) {
                const page = buildPageUserSimple(member.displayName, guild.name, emojis);
                await interaction.editReply(page.build());
                console.log(`📊 [AJUDA] ${user.tag} em ${guild.name} (usuário comum)`);
                return;
            }

            // ----------------------------------------------------------------
            // Admin - Sistema de Paginação
            // ----------------------------------------------------------------
            const pagination = new PaginationBuilder({
                accentColor: 0xDCA15E,
                timeout: 120000,
                footerText: `${guild.name} • Página {page}`,
            });

            // Adiciona as páginas
            pagination
                .addPage(() => buildPageWelcome(member.displayName, guild.name, emojis))
                .addPage(() => buildPageModeration(emojis))
                .addPage(() => buildPageAutomod(emojis))
                .setButtons({
                    prev: { label: '◀ Anterior', style: ButtonStyle.Secondary },
                    next: { label: 'Próxima ▶', style: ButtonStyle.Primary },
                });

            // Inicia a paginação
            await pagination.start(interaction);

            console.log(`📊 [AJUDA] ${user.tag} em ${guild.name} (admin)`);

        } catch (error) {
            console.error('❌ Erro no ajuda:', error);
            await interaction.editReply({
                content: '❌ Erro ao gerar guia de ajuda. Tente novamente.',
                flags: MessageFlags.Ephemeral
            });
        }
    },
};