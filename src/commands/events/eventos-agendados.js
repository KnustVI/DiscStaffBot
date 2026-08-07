// src/commands/events/eventos-agendados.js
const { SlashCommandBuilder, GuildScheduledEventStatus } = require('discord.js');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// "#canal" (voz/palco) ou o texto livre de local externo (ver /evento
// local_canal/local_descricao) — mesmos dois formatos que um evento
// agendado do Discord pode ter, sem exigir que o evento tenha sido criado
// pelo bot (também pega evento agendado manualmente pela própria interface
// do Discord).
function formatLocation(event) {
    if (event.channelId) return `<#${event.channelId}>`;
    return event.entityMetadata?.location || 'Não informado';
}

function formatEventBlock(event) {
    const startTs = Math.floor(event.scheduledStartTimestamp / 1000);
    const isActive = event.status === GuildScheduledEventStatus.Active;
    const whenLine = isActive
        ? `${EMOJIS.clockalert || '🔴'} **Desde:** <t:${startTs}:F>`
        : `${EMOJIS.calendardays || '📅'} **Início:** <t:${startTs}:F> (<t:${startTs}:R>)`;
    const interested = Number.isFinite(event.userCount) ? event.userCount : null;

    return [
        `### ${event.name}`,
        whenLine,
        `${EMOJIS.mappin || '📍'} **Local:** ${formatLocation(event)}`,
        interested !== null ? `${EMOJIS.users || '👥'} **Interessados:** \`${interested}\`` : null,
        `${EMOJIS.wifi || '🔗'} ${event.url}`,
    ].filter(Boolean).join('\n');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('eventos-agendados')
        .setDescription('📅 Mostra os eventos agendados do Discord para os próximos 7 dias.'),

    async execute(interaction, client) {
        const { guild } = interaction;

        // Busca com withUserCount pra trazer "interessados" (event.userCount)
        // — mesmo padrão já usado em dashboard.js GET /events/:guildID. Pega
        // QUALQUER evento agendado do Discord, criado pelo /evento do bot ou
        // manualmente pela própria interface do Discord — não é uma tabela
        // própria, é sempre a fonte de verdade nativa (guild.scheduledEvents).
        let eventList;
        try {
            eventList = await guild.scheduledEvents.fetch();
        } catch (err) {
            console.error('❌ [Eventos] Erro ao buscar eventos agendados:', err.message);
            return await interaction.editReply(
                new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                    .text(`${EMOJIS.circlealert || '❌'} Não foi possível buscar os eventos agendados agora. Tente novamente em instantes.`)
                    .footer(guild.name)
                    .build()
            );
        }

        const eventsWithCounts = await Promise.all(
            [...eventList.values()].map(ev =>
                guild.scheduledEvents.fetch({ guildScheduledEvent: ev.id, withUserCount: true }).catch(() => ev)
            )
        );

        const now = Date.now();
        const happeningNow = eventsWithCounts
            .filter(ev => ev.status === GuildScheduledEventStatus.Active)
            .sort((a, b) => (a.scheduledStartTimestamp || 0) - (b.scheduledStartTimestamp || 0));
        const upcoming = eventsWithCounts
            .filter(ev => ev.status === GuildScheduledEventStatus.Scheduled && ev.scheduledStartTimestamp && ev.scheduledStartTimestamp <= now + WINDOW_MS)
            .sort((a, b) => a.scheduledStartTimestamp - b.scheduledStartTimestamp);

        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        builder.title(`${EMOJIS.calendardays || '📅'} EVENTOS DOS PRÓXIMOS 7 DIAS`, 1);

        if (happeningNow.length === 0 && upcoming.length === 0) {
            builder.separator();
            builder.text(`${EMOJIS.messagesquare || 'ℹ️'} Nenhum evento acontecendo agora nem agendado para os próximos 7 dias.`);
            builder.footer(guild.name);
            return await interaction.editReply(builder.build());
        }

        if (happeningNow.length > 0) {
            builder.separator();
            builder.title('Acontecendo agora', 2);
            happeningNow.forEach((event, index) => {
                if (index > 0) builder.separator();
                builder.text(formatEventBlock(event));
            });
        }

        if (upcoming.length > 0) {
            builder.separator();
            builder.title('Agendados', 2);
            upcoming.forEach((event, index) => {
                if (index > 0) builder.separator();
                builder.text(formatEventBlock(event));
            });
        }

        builder.footer(guild.name);
        await interaction.editReply(builder.build());
    },
};
