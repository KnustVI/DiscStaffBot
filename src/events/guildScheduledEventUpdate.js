// src/events/guildScheduledEventUpdate.js
/**
 * Detecta transições de status de um Evento Agendado do Discord (criado
 * por /evento) pra disparar o anúncio automático de início/encerramento —
 * ver eventAnnounceSystem.js. Cobre tanto o auto-início do eventScheduler.js
 * quanto alguém da staff clicando "Iniciar"/"Encerrar" manualmente no
 * Discord: qualquer mudança de status do evento passa por aqui, não importa
 * quem/o que causou.
 */
const { GuildScheduledEventStatus } = require('discord.js');
const EventAnnounceSystem = require('../systems/events/eventAnnounceSystem');

module.exports = {
    name: 'guildScheduledEventUpdate',
    async execute(oldScheduledEvent, newScheduledEvent) {
        try {
            const guild = newScheduledEvent.guild;
            if (!guild) return;

            const becameActive = oldScheduledEvent?.status !== GuildScheduledEventStatus.Active
                && newScheduledEvent.status === GuildScheduledEventStatus.Active;
            const becameCompleted = oldScheduledEvent?.status !== GuildScheduledEventStatus.Completed
                && newScheduledEvent.status === GuildScheduledEventStatus.Completed;

            if (becameActive) {
                await EventAnnounceSystem.announceStarted(guild, newScheduledEvent);
            } else if (becameCompleted) {
                await EventAnnounceSystem.announceEnded(guild, newScheduledEvent);
            }
        } catch (err) {
            console.error('❌ [guildScheduledEventUpdate] Erro ao processar mudança de status:', err.message);
        }
    },
};
