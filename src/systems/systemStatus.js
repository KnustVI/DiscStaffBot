const ConfigSystem = require('./configSystem'); 
const ErrorLogger = require('./errorLogger');
const os = require('os');

class SystemStatus {
    /**
     * Coleta informações detalhadas sobre a saúde do bot e do ciclo AutoMod
     */
    static getBotStatus(client, guildId) {
        try {
            // 1. Cálculo de Uptime do Bot (Desde o Login)
            const uptimeMs = client.uptime || 0;
            const days = Math.floor(uptimeMs / 86400000);
            const hours = Math.floor((uptimeMs % 86400000) / 3600000);
            const minutes = Math.floor((uptimeMs % 3600000) / 60000);

            // 2. Cálculo do Próximo Ciclo do AutoMod (12:00 BRT)
            // Forçamos o cálculo para o fuso de Brasília (UTC-3)
            const now = new Date();
            const brtOffset = -3; 
            let nextRun = new Date(now.getTime() + (brtOffset * 3600000));
            nextRun.setUTCHours(12, 0, 0, 0);
            
            // Se já passou das 12h hoje, o próximo é amanhã
            if (now.getUTCHours() >= (12 - brtOffset)) {
                nextRun.setUTCDate(nextRun.getUTCDate() + 1);
            }

            // 3. Métricas GLOBAIS (Performance de Cache)
            const totalGuilds = client.guilds.cache.size;
            const totalUsers = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0);

            // 4. Configurações Locais via ConfigSystem
            const logChanId = ConfigSystem.getSetting(guildId, 'logs_channel');
            const lastRunDate = ConfigSystem.getSetting(guildId, 'last_automod_run');

            // 5. Hardware (VPS Oracle Cloud) - Ponto 4 (Otimização)
            const usedMem = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
            const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1); // GB
            const ping = client.ws?.ping > 0 ? `${client.ws.ping}ms` : "Calculando...";

            return {
                uptime: `${days}d ${hours}h ${minutes}m`,
                ping: ping,
                memory: `${usedMem}MB / ${totalMem}GB`,
                nextAutoMod: Math.floor(nextRun.getTime() / 1000), 
                lastRun: lastRunDate ? Math.floor(new Date(lastRunDate).getTime() / 1000) : null,
                logChannel: logChanId || "Não configurado",
                totalGuilds: totalGuilds,
                totalUsers: totalUsers,
                guildName: client.guilds.cache.get(guildId)?.name || "Este Servidor"
            };
        } catch (err) {
            ErrorLogger.log('SystemStatus_Error', err);
            return null; 
        }
    }
}

module.exports = SystemStatus;