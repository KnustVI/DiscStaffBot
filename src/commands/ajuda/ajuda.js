// /home/ubuntu/DiscStaffBot/src/commands/utility/ajuda.js
const { SlashCommandBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('../../database/index');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');
const { PaginationBuilder } = require('../../utils/paginationBuilder');

// ---------------------------------------------------------------------------
// Fábrica de páginas
// ---------------------------------------------------------------------------

const FALLBACK_ICON = 'https://cdn.discordapp.com/embed/avatars/0.png';

function buildPageWelcome(displayName, guildName, emojis) {
    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });

    return builder
        .section(
            [
                '# ASSISTENTE TITAN',
                `Olá **${displayName}**! Sou o sistema de gestão do seu servidor **${guildName}**.`,
            ].join('\n'),
            builder.assetThumbnail('icone_help') || AdvancedContainerBuilder.thumbnail(FALLBACK_ICON)
        )
        .separator()
        .title(`${emojis.settings || '⚙️'} Configuração Inicial`, 2)
        .text('Apenas administradores podem usar estes comandos:')
        .block([
            '• **/config-logs** — Configura os canais de log (Geral, Punições, AutoMod, ReportChat)',
            '• **/config-roles** — Configura cargos (Staff é OBRIGATÓRIO!)',
            '• **/config-punishments** — Configura pontos dos strikes e limites de reputação',
        ])
        .separator()
        .title(`${emojis.ticket || '🎫'} ReportChat`, 2)
        .block([
            '• **/reportchat** — Cria o painel de reports para os usuários',
            '• Usuários abrem reports via formulário; staff entra na thread e atende.',
        ])
        .footer(guildName);
}

function buildPageModeration(guildName, emojis) {
    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });

    return builder
        .section(
            [
                '# MODERAÇÃO E REPUTAÇÃO',
                'Apenas usuários com cargo **STAFF** podem usar:',
            ].join('\n'),
            builder.assetThumbnail('icone_help') || AdvancedContainerBuilder.thumbnail(FALLBACK_ICON)
        )
        .separator()
        .title(`${emojis.gavel || '⚠️'} Comandos de Punição`, 2)
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
        ])
        .footer(guildName);
}

function buildPageAutomod(guildName, emojis) {
    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });

    return builder
        .section(
            [
                '# AUTO MODERAÇÃO',
                'Sistema automático de gerenciamento de reputação:',
            ].join('\n'),
            builder.assetThumbnail('icone_help') || AdvancedContainerBuilder.thumbnail(FALLBACK_ICON)
        )
        .separator()
        .title(`${emojis.settings || '⚙️'} Comandos`, 2)
        .text('• **/automod test** — Verifica configurações e canal de log')
        .separator()
        .title(`${emojis.trendingup || '📈'} Funcionamento`, 2)
        .block([
            '• Executa diariamente às **12:00**',
            '• +1 ponto para quem não tem punições nas últimas 24h',
            '• Atribui/remove cargos **Exemplar** e **Problemático** automaticamente',
            '• Envia relatório no canal de log configurado',
        ])
        .separator()
        .title(`${emojis.megaphone || '🌐'} Status`, 2)
        .block([
            '• **/botstatus** — Verifica saúde do bot e sistemas',
            '• Mostra latência, memória, status do AutoMod e estatísticas',
        ])
        .footer(guildName);
}

function buildPageUserSimple(displayName, guildName, emojis) {
    const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });

    return builder
        .section(
            [
                '# ASSISTENTE TITAN',
                `Olá **${displayName}**! Sou o sistema de gestão do servidor **${guildName}**.`,
            ].join('\n'),
            builder.assetThumbnail('icone_help') || AdvancedContainerBuilder.thumbnail(FALLBACK_ICON)
        )
        .separator()
        .title(`${emojis.ticket || '🎫'} ReportChat`, 2)
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
        ])
        .footer(guildName);
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

        // Nota: handlers.js → handleCommand() já chama interaction.deferReply()
        // antes de invocar execute(), então a interação já está deferida aqui.

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
                const payload = page.build();
                await interaction.editReply(payload);
                console.log(`📊 [AJUDA] ${user.tag} em ${guild.name} (usuário comum)`);
                return;
            }

            // ----------------------------------------------------------------
            // Admin - Sistema de Paginação
            // ----------------------------------------------------------------
            const pagination = new PaginationBuilder({
                accentColor: COLORS.DEFAULT,
                timeout: 120000,
            });

            pagination
                .addPage(() => buildPageWelcome(member.displayName, guild.name, emojis))
                .addPage(() => buildPageModeration(guild.name, emojis))
                .addPage(() => buildPageAutomod(guild.name, emojis))
                .setButtons({
                    prev: { label: 'Anterior', style: ButtonStyle.Secondary },
                    next: { label: 'Próxima', style: ButtonStyle.Primary },
                });

            await pagination.start(interaction);

            console.log(`📊 [AJUDA] ${user.tag} em ${guild.name} (admin)`);

        } catch (error) {
            console.error('❌ Erro no ajuda:', error);

            try {
                const errorPayload = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                    .text(`${emojis.circlealert || '❌'} Erro ao gerar guia de ajuda. Tente novamente.`)
                    .footer(guild?.name)
                    .build();

                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply(errorPayload);
                } else {
                    await interaction.reply({ ...errorPayload, flags: errorPayload.flags | MessageFlags.Ephemeral });
                }
            } catch (err) {
                console.error('❌ Erro ao responder fallback de erro:', err);
            }
        }
    },
};