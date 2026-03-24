const db = require('../database/database');
const ConfigSystem = require('./configSystem'); 
const ErrorLogger = require('./errorLogger');

class SystemStatus {
    /**
     * Coleta informações detalhadas sobre a saúde do bot e do ciclo AutoMod
     * @param {Client} client - O cliente do Discord
     * @param {string} guildId - ID da guilda para buscar configurações locais
     */
    static getBotStatus(client, guildId) {
        try {
            // 1. Cálculo de Uptime
            const uptime = process.uptime();
            const days = Math.floor(uptime / 86400);
            const hours = Math.floor((uptime % 86400) / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);

            // 2. Cálculo do Próximo Ciclo (12:00 BRT)
            const now = new Date();
            let nextRun = new Date();
            nextRun.setHours(12, 0, 0, 0);
            if (now > nextRun) nextRun.setDate(nextRun.getDate() + 1);

            // 3. Recuperação de Configurações com Fallback (Segurança)
            // Buscamos as chaves exatas que definimos no autoModeration.js
            const lastAutoModChan = ConfigSystem.getSetting(guildId, 'last_automod_run_channel');
            const configLogChan = ConfigSystem.getSetting(guildId, 'logs_channel');
            const lastRunDate = ConfigSystem.getSetting(guildId, 'last_automod_run');

            return {
                uptime: `${days}d ${hours}h ${minutes}m`,
                ping: client.ws?.ping || 0, // Evita erro se o websocket estiver instável
                memory: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
                nextAutoMod: Math.floor(nextRun.getTime() / 1000),
                lastRun: lastRunDate || null,
                // Prioridade: Canal real da última execução > Canal configurado no /config
                lastChannel: lastAutoModChan || configLogChan || null 
            };
        } catch (err) {
            // Se algo der errado, logamos no console da Oracle Cloud para você ver o erro real
            console.error("❌ Erro Crítico no SystemStatus:", err);
            ErrorLogger.log('SystemStatus_GetBotStatus', err);
            return null; 
        }
    }
}

module.exports = SystemStatus;