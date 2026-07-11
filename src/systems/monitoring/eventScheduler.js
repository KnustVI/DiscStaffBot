// src/systems/monitoring/eventScheduler.js

/**
 * eventScheduler.js
 *
 * Eventos agendados do Discord (Guild Scheduled Events) NUNCA iniciam
 * sozinhos — mesmo passando da hora marcada, ficam parados em "Agendado"
 * até alguém da staff clicar em "Iniciar Evento" manualmente. Se ninguém
 * lembrar, o evento fica acumulado na aba de Eventos pra sempre.
 *
 * Este worker roda a cada minuto, olha os eventos agendados de cada
 * servidor e:
 *  - ~30 minutos antes do início: avisa o cargo Equipe de Eventos
 *    (/config roles) no canal de logs gerais (/config logs), uma vez por
 *    evento.
 *  - Se já passou da hora de início e o evento ainda está "Agendado":
 *    tenta iniciar automaticamente (status -> Ativo).
 *  - Se já passou tempo demais (ABANDON_GRACE_MS além do fim previsto, ou do
 *    início se não houver fim definido) e o evento continua "Agendado" —
 *    ou seja, nem o auto-início conseguiu tirá-lo do lugar — remove o
 *    evento, para não ficar um evento fantasma parado na aba.
 */

const cron = require('node-cron');
const { GuildScheduledEventStatus } = require('discord.js');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

let EMOJIS = {};
try {
    EMOJIS = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    EMOJIS = {};
}

// Tempo de tolerância após o fim (ou início, se não houver fim) previsto do
// evento antes de considerá-lo abandonado e removê-lo.
const ABANDON_GRACE_MS = 2 * 60 * 60 * 1000; // 2h

// Quanto antes do início avisar o cargo de eventos no canal de logs gerais.
const REMINDER_LEAD_MS = 30 * 60 * 1000; // 30min

// IDs de evento já avisados nesta execução do bot — evita reenviar o aviso
// a cada minuto enquanto o evento continua dentro da janela de 30min. É só
// em memória de propósito: se o bot reiniciar bem nesse intervalo, o pior
// caso é um aviso repetido, não um dado perdido.
const remindedEvents = new Set();

async function maybeSendStartReminder(guild, event, startAt, now) {
    if (remindedEvents.has(event.id)) return;

    const msUntilStart = startAt - now;
    if (msUntilStart > REMINDER_LEAD_MS || msUntilStart <= 0) return;

    remindedEvents.add(event.id);

    try {
        const ConfigSystem = require('../core/configSystem');
        const eventRoleIds = ConfigSystem.getRoleIds(guild.id, 'event_role');
        const logChannelId = ConfigSystem.getUnifiedGeneralLogChannel(guild.id);
        if (eventRoleIds.length === 0 || !logChannelId) return; // não configurado — sem aviso

        const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (!logChannel) return;

        const startTs = Math.floor(startAt / 1000);
        const builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT });
        builder.text(`# ${EMOJIS.clockalert || '⏰'} EVENTO COMEÇANDO EM BREVE`);
        builder.text(`${ConfigSystem.mentionRoles(guild.id, 'event_role')} o evento **${event.name}** começa em cerca de 30 minutos!`);
        builder.separator();
        builder.text(`${EMOJIS.calendardays || '📅'} **Início:** <t:${startTs}:F> (<t:${startTs}:R>)`);
        builder.text(`${EMOJIS.wifi || '🔗'} **Evento:** ${event.url}`);
        builder.footer(guild.name);

        await logChannel.send(builder.build());
        console.log(`⏰ [EventScheduler] Lembrete de 30min enviado: "${event.name}" (${guild.name})`);
    } catch (err) {
        console.error(`❌ [EventScheduler] Erro ao enviar lembrete de "${event.name}":`, err.message);
    }
}

async function checkGuildEvents(guild) {
    let events;
    try {
        events = await guild.scheduledEvents.fetch();
    } catch (err) {
        // Sem permissão no servidor, ou erro transitório da API — tenta de
        // novo no próximo ciclo, não vale a pena logar toda hora.
        return;
    }

    const now = Date.now();

    for (const event of events.values()) {
        if (event.status !== GuildScheduledEventStatus.Scheduled) continue;

        const startAt = event.scheduledStartTimestamp;
        if (!startAt) continue;

        if (startAt > now) {
            await maybeSendStartReminder(guild, event, startAt, now);
            continue; // ainda não chegou a hora de iniciar
        }

        const referenceEnd = event.scheduledEndTimestamp || startAt;
        const abandonDeadline = referenceEnd + ABANDON_GRACE_MS;

        if (now > abandonDeadline) {
            try {
                await event.delete();
                console.log(`🗑️ [EventScheduler] Evento agendado nunca iniciado, removido: "${event.name}" (${guild.name})`);
            } catch (err) {
                console.error(`❌ [EventScheduler] Erro ao remover evento expirado "${event.name}":`, err.message);
            }
            continue;
        }

        try {
            await event.setStatus(GuildScheduledEventStatus.Active);
            console.log(`▶️ [EventScheduler] Evento iniciado automaticamente: "${event.name}" (${guild.name})`);
        } catch (err) {
            // Não conseguiu iniciar agora — tenta de novo no próximo ciclo,
            // até estourar o prazo de abandono acima.
            console.warn(`⚠️ [EventScheduler] Não foi possível iniciar "${event.name}" ainda: ${err.message}`);
        }
    }
}

function startEventSchedulerWorker(client) {
    console.log('📅 [EventScheduler] Worker de eventos agendados iniciado (checa a cada minuto)');

    cron.schedule('* * * * *', async () => {
        for (const guild of client.guilds.cache.values()) {
            try {
                await checkGuildEvents(guild);
            } catch (err) {
                console.error(`❌ [EventScheduler] Erro ao checar eventos de ${guild.name}:`, err.message);
            }
        }
    }, { timezone: 'America/Sao_Paulo' });
}

module.exports = { startEventSchedulerWorker, checkGuildEvents, ABANDON_GRACE_MS, REMINDER_LEAD_MS, remindedEvents };
