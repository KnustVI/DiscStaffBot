const ConfigSystem = require('./configSystem'); 
const ErrorLogger = require('./errorLogger');
const os = require('os');

class SystemStatus {
    /**
     * Coleta informações detalhadas sobre a saúde do bot e do ciclo AutoMod.
     */
    static getBotStatus(client, guildId) {
        try {
            // 1. Verificação de Integridade do Client
            if (!client?.isReady()) {
                throw new Error("O Client do Discord não está pronto ou não foi inicializado.");
            }

            // 2. Cálculo de Uptime (Formatado para humanos)
            const uptimeMs = client.uptime || 0;
            const days = Math.floor(uptimeMs / 86400000);
            const hours = Math.floor((uptimeMs % 86400000) / 3600000);
            const minutes = Math.floor((uptimeMs % 3600000) / 60000);

            // 3. Previsão do Próximo Ciclo AutoMod (Lógica baseada em 12h BRT)
            const now = new Date();
            let nextRun = new Date();
            nextRun.setHours(12, 0, 0, 0);

            // Se já passou das 12h hoje, a próxima execução é amanhã
            if (now.getHours() >= 12) {
                nextRun.setDate(nextRun.getDate() + 1);
            }

            // 4. Métricas de Hardware & Network
            const usedMem = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
            const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
            const ping = client.ws?.ping > 0 ? `${client.ws.ping}ms` : "Calculando...";

            // 5. Dados do Servidor Atual (Guild-Specific)
            const guildData = ConfigSystem.getMany(guildId, ['logs_channel', 'last_automod_run']);

            return {
                // Métricas do Bot
                uptime: `${days}d ${hours}h ${minutes}m`,
                ping: ping,
                memory: `${usedMem} MB / ${totalMem} GB`,
                
                // Ciclo AutoMod (Retornando em segundos para Timestamps do Discord)
                nextAutoModTS: Math.floor(nextRun.getTime() / 1000), 
                lastRunTS: guildData.last_automod_run ? Math.floor(Number(guildData.last_automod_run) / 1000) : null,
                
                // Estatísticas Globais
                totalGuilds: client.guilds.cache.size,
                totalUsers: client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0),
                
                // Contexto Local
                logChannel: guildData.logs_channel ? `<#${guildData.logs_channel}>` : "⚠️ Não configurado",
                guildName: client.guilds.cache.get(guildId)?.name || "Este Servidor"
            };

        } catch (err) {
            if (ErrorLogger) ErrorLogger.log('SystemStatus_Logic_Error', err);
            return null; 
        }
    }
}

module.exports = SystemStatus;