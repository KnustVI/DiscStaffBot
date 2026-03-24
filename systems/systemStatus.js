const db = require('../database/database');
const ConfigSystem = require('./configSystem'); // Usamos para pegar as configurações salvas
const ErrorLogger = require('./errorLogger');

class SystemStatus {
    /**
     * Coleta informações detalhadas sobre a saúde do bot e do ciclo AutoMod
     * @param {Client} client - O cliente do Discord
     * @param {string} guildId - ID da guilda para buscar configurações locais
     */
        static getBotStatus(client, guildId) {
        try {
            const uptime = process.uptime();
            const days = Math.floor(uptime / 86400);
            const hours = Math.floor((uptime % 86400) / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);

            const now = new Date();
            let nextRun = new Date();
            nextRun.setHours(12, 0, 0, 0);
            if (now > nextRun) nextRun.setDate(nextRun.getDate() + 1);

            // --- AQUI ESTÁ A LÓGICA DE CORREÇÃO ---
            // 1. Tenta pegar o canal da última vez que o automod rodou
            const lastAutoModChan = ConfigSystem.getSetting(guildId, 'last_automod_run_channel');
            
            // 2. Pega o canal que você configurou no /config
            const configLogChan = ConfigSystem.getSetting(guildId, 'logs_channel');

            return {
                uptime: `${days}d ${hours}h ${minutes}m`,
                ping: client.ws.ping,
                memory: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
                nextAutoMod: Math.floor(nextRun.getTime() / 1000),
                lastRun: ConfigSystem.getSetting(guildId, 'last_automod_run'),
                // PRIORIDADE: Mostra o canal que rodou por último. Se nunca rodou, mostra o do /config.
                lastChannel: lastAutoModChan || configLogChan 
            };
        } catch (err) {
            ErrorLogger.log('SystemStatus_GetBotStatus', err);
            return null;
        }
    }
}

module.exports = SystemStatus;