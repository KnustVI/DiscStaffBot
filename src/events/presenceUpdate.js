// src/events/presenceUpdate.js
// Alimenta staffPresenceSystem.js (ver docblock lá) — usado pelo comando
// /staffonline. Depende da intent GuildPresences (ver index.js); sem ela
// este evento nunca dispara. Dispara MUITO (qualquer troca de status/jogo/
// Spotify de qualquer membro em qualquer guild compartilhada), então toda
// a filtragem pra só staff fica dentro de handlePresenceUpdate — nada
// pesado acontece aqui.
const StaffPresenceSystem = require('../systems/moderation/staffPresenceSystem');

module.exports = {
    name: 'presenceUpdate',
    execute(oldPresence, newPresence) {
        try {
            StaffPresenceSystem.handlePresenceUpdate(oldPresence, newPresence);
        } catch (error) {
            console.error('❌ [presenceUpdate] Erro:', error.message);
        }
    },
};
