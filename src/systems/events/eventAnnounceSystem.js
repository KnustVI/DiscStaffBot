// src/systems/events/eventAnnounceSystem.js
/**
 * Anúncio automático de criação/início/encerramento de um evento (/evento) —
 * exclusivo do plano Caçador (ver ConfigSystem.ROLE_TABS.events,
 * `event_announce_channel`). Publica em 2 lugares ao mesmo tempo: o canal
 * dedicado configurado (marcando o cargo de Notificação de Eventos) e a
 * própria postagem do evento no fórum.
 *
 * `event_posts` mapeia scheduled_event_id -> thread_id — necessário porque
 * início/encerramento chegam bem depois da criação, via evento de gateway
 * `guildScheduledEventUpdate` (ver src/events/guildScheduledEventUpdate.js),
 * sem nenhuma referência direta à thread em mãos nesse momento.
 */
const db = require('../../database/index');
const ConfigSystem = require('../core/configSystem');
const PremiumSystem = require('../premium/premiumSystem');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

const PHASES = {
    created: {
        title: 'NOVO EVENTO CRIADO', icon: 'partypopper', fallbackIcon: '🎉', color: COLORS.DEFAULT, mentionRole: true,
        text: (event) => `O evento **${event.name}** foi criado! Início previsto: <t:${Math.floor(event.scheduledStartTimestamp / 1000)}:F> (<t:${Math.floor(event.scheduledStartTimestamp / 1000)}:R>).`,
    },
    started: {
        title: 'EVENTO COMEÇOU', icon: 'rocket', fallbackIcon: '🚀', color: COLORS.SUCCESS, mentionRole: true,
        text: (event) => `O evento **${event.name}** começou agora! Participe.`,
    },
    ended: {
        title: 'EVENTO ENCERRADO', icon: 'checkcheck', fallbackIcon: '✅', color: COLORS.DEFAULT, mentionRole: false,
        text: (event) => `O evento **${event.name}** foi encerrado. Obrigado a quem participou!`,
    },
};

function _registerPost(scheduledEventId, guildId, threadId) {
    db.prepare(`
        INSERT INTO event_posts (scheduled_event_id, guild_id, thread_id, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(scheduled_event_id) DO UPDATE SET thread_id = excluded.thread_id
    `).run(scheduledEventId, guildId, threadId, Date.now());
}

function _getPost(scheduledEventId) {
    return db.prepare(`SELECT * FROM event_posts WHERE scheduled_event_id = ?`).get(scheduledEventId) || null;
}

function _removePost(scheduledEventId) {
    db.prepare(`DELETE FROM event_posts WHERE scheduled_event_id = ?`).run(scheduledEventId);
}

function _buildAnnouncement(guild, event, phase, threadUrl) {
    const meta = PHASES[phase];
    const builder = new AdvancedContainerBuilder({ accentColor: meta.color });
    builder.text(`# ${EMOJIS[meta.icon] || meta.fallbackIcon} ${meta.title}`);
    builder.text(meta.text(event));
    if (threadUrl) builder.text(`${EMOJIS.wifi || '🔗'} Postagem: ${threadUrl}`);
    if (meta.mentionRole) {
        const mention = ConfigSystem.mentionRoles(guild.id, 'event_notify_role');
        if (mention !== 'nenhum cargo configurado') builder.text(mention);
    }
    builder.footer(guild.name);
    return builder.build();
}

async function _sendToChannelAndThread(guild, event, phase, thread) {
    if (!PremiumSystem.isGuildAtLeast(guild.id, 'cacador')) return;

    const announceChannelId = ConfigSystem.getSetting(guild.id, 'event_announce_channel');
    if (!announceChannelId) return;

    const payload = _buildAnnouncement(guild, event, phase, thread?.url || null);

    const announceChannel = await guild.channels.fetch(announceChannelId).catch(() => null);
    if (announceChannel?.isTextBased?.()) {
        await announceChannel.send(payload).catch((err) => console.error('❌ [EventAnnounce] Erro ao anunciar no canal:', err.message));
    }
    if (thread) {
        await thread.send(payload).catch((err) => console.error('❌ [EventAnnounce] Erro ao anunciar na postagem:', err.message));
    }
}

module.exports = {
    /**
     * Chamado por evento.js logo após criar o Evento Agendado + a postagem
     * no fórum. Registra o mapeamento em `event_posts` INDEPENDENTE de tier
     * (Rastreador+ sempre tem Evento Agendado) — barato, e permite que o
     * anúncio funcione retroativamente se o servidor virar Caçador durante
     * o próprio evento, sem precisar recriar nada.
     */
    async announceCreated(guild, scheduledEvent, thread) {
        _registerPost(scheduledEvent.id, guild.id, thread.id);
        await _sendToChannelAndThread(guild, scheduledEvent, 'created', thread);
    },

    /** Chamado pelo listener de guildScheduledEventUpdate ao detectar Active. */
    async announceStarted(guild, scheduledEvent) {
        const post = _getPost(scheduledEvent.id);
        const thread = post?.thread_id ? await guild.channels.fetch(post.thread_id).catch(() => null) : null;
        await _sendToChannelAndThread(guild, scheduledEvent, 'started', thread);
    },

    /**
     * Chamado pelo listener de guildScheduledEventUpdate ao detectar
     * Completed. Remove o mapeamento depois — nada mais precisa dele.
     */
    async announceEnded(guild, scheduledEvent) {
        const post = _getPost(scheduledEvent.id);
        const thread = post?.thread_id ? await guild.channels.fetch(post.thread_id).catch(() => null) : null;
        await _sendToChannelAndThread(guild, scheduledEvent, 'ended', thread);
        _removePost(scheduledEvent.id);
    },

    _getPost,
};
