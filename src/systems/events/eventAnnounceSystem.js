// src/systems/events/eventAnnounceSystem.js
/**
 * Anúncio automático de criação/início/encerramento de um evento (/evento) —
 * canal Discord exclusivo do plano Caçador (ver ConfigSystem.ROLE_TABS.events,
 * `event_announce_channel`). Publica em 2 lugares ao mesmo tempo: o canal
 * dedicado configurado (marcando o cargo de Notificação de Eventos) e a
 * própria postagem do evento no fórum.
 *
 * Aviso EM JOGO (pedido do dono, 2026-08-19: "Verifique se o comando eventos
 * avisa os jogadores em jogo tambem alem do discord" — resposta: só o
 * lembrete de 30min-antes já avisava em jogo, ver eventScheduler.js
 * _sendIngameEventReminder; criação e início EXATO não avisavam nada em
 * jogo até agora) — `_broadcastInGame` abaixo dispara RCON `announce` só
 * nas fases created/started (ended fica de fora — quem já saiu do jogo não
 * se beneficia de saber que acabou), gate `autoRcon` (Rastreador+, MESMA
 * flag do lembrete de 30min e do botão de TP — "ação automática em jogo
 * disparada pelo bot"), independente do canal de anúncio do Discord
 * (Caçador) — o alvo aqui é o servidor de jogo, não precisa de canal
 * configurado nenhum.
 *
 * `event_posts` mapeia scheduled_event_id -> thread_id — necessário porque
 * início/encerramento chegam bem depois da criação, via evento de gateway
 * `guildScheduledEventUpdate` (ver src/events/guildScheduledEventUpdate.js),
 * sem nenhuma referência direta à thread em mãos nesse momento.
 */
const db = require('../../database/index');
const ConfigSystem = require('../core/configSystem');
const PremiumSystem = require('../premium/premiumSystem');
const PoTConfigSystem = require('../pot/potConfigSystem');
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
    // 'started' fica fixo (SUCCESS, sinal semântico de "começou") —
    // 'created'/'ended' (ambos DEFAULT) usam a cor personalizada do
    // servidor no lugar do DEFAULT fixo, pedido do dono 2026-08-10.
    const personalization = ConfigSystem.getPanelPersonalization(guild.id);
    const accentColor = meta.color === COLORS.DEFAULT ? (personalization.accentColor ?? COLORS.DEFAULT) : meta.color;
    const builder = new AdvancedContainerBuilder({ accentColor });
    builder.text(`# ${EMOJIS[meta.icon] || meta.fallbackIcon} ${meta.title}`);
    builder.text(meta.text(event));
    if (threadUrl) builder.text(`${EMOJIS.wifi || '🔗'} Postagem: ${threadUrl}`);
    if (meta.mentionRole) {
        const mention = ConfigSystem.mentionRoles(guild.id, 'event_notify_role');
        if (mention !== 'nenhum cargo configurado') builder.text(mention);
    }
    builder.footer(guild);
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

// Texto puro (sem markdown/timestamp do Discord — RCON não renderiza nada
// disso) — mesmo teto de tamanho já usado pelo lembrete de 30min
// (eventScheduler.js#INGAME_REMINDER_MAX_LENGTH), evita estourar o RCON
// com um nome de evento gigante.
const INGAME_ANNOUNCE_MAX_LENGTH = 200;
const IN_GAME_MESSAGES = {
    created: (event) => `Novo evento agendado: ${event.name}`,
    started: (event) => `Evento comecou agora: ${event.name} - participe!`,
};

function _formatInGameAnnouncement(event, phase) {
    const raw = IN_GAME_MESSAGES[phase](event).replace(/[\r\n]+/g, ' ').trim();
    return raw.length > INGAME_ANNOUNCE_MAX_LENGTH ? `${raw.slice(0, INGAME_ANNOUNCE_MAX_LENGTH - 3)}...` : raw;
}

async function _broadcastInGame(guild, event, phase) {
    if (!IN_GAME_MESSAGES[phase]) return;
    if (!PremiumSystem.getGuildLimits(guild.id).autoRcon) return;
    try {
        const message = _formatInGameAnnouncement(event, phase);
        const result = await PoTConfigSystem.executeRconCommand(guild.id, `announce ${message}`, {
            source: `Anúncio automático de evento (${phase})`,
        });
        if (!result?.success) {
            console.warn(`⚠️ [EventAnnounce] Não avisou em jogo (${phase}) sobre "${event.name}": ${result?.error || 'erro desconhecido'}`);
        }
    } catch (err) {
        console.error(`❌ [EventAnnounce] Erro ao avisar em jogo (${phase}) sobre "${event.name}":`, err.message);
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
        await _broadcastInGame(guild, scheduledEvent, 'created');
    },

    /** Chamado pelo listener de guildScheduledEventUpdate ao detectar Active. */
    async announceStarted(guild, scheduledEvent) {
        const post = _getPost(scheduledEvent.id);
        const thread = post?.thread_id ? await guild.channels.fetch(post.thread_id).catch(() => null) : null;
        await _sendToChannelAndThread(guild, scheduledEvent, 'started', thread);
        await _broadcastInGame(guild, scheduledEvent, 'started');
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
