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
            // 1. Cálculo de Uptime (Tempo Online)
            const uptime = process.uptime();
            const days = Math.floor(uptime / 86400);
            const hours = Math.floor((uptime % 86400) / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);

            // 2. Cálculo do próximo ciclo do AutoMod (Fixado para Meio-dia)
            const now = new Date();
            let nextRun = new Date();
            nextRun.setHours(12, 0, 0, 0);
            
            // Se já passou das 12h hoje, o próximo é amanhã
            if (now > nextRun) {
                nextRun.setDate(nextRun.getDate() + 1);
            }

            // 3. Retorno dos dados processados
            return {
                uptime: `${days}d ${hours}h ${minutes}m`,
                ping: client.ws.ping,
                memory: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
                nextAutoMod: Math.floor(nextRun.getTime() / 1000), // Timestamp para o Discord
                // Buscamos as configurações que salvamos no AutoMod
                lastRun: ConfigSystem.getSetting(guildId, 'last_automod_run'),
                lastChannel: ConfigSystem.getSetting(guildId, 'last_automod_channel')
            };
        } catch (err) {
            ErrorLogger.log('SystemStatus_GetBotStatus', err);
            return null;
        }
    }
}

module.exports = SystemStatus;