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
            // 1. Cálculo de Uptime (Tempo que o bot está ligado)
            const uptime = process.uptime();
            const days = Math.floor(uptime / 86400);
            const hours = Math.floor((uptime % 86400) / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);

            // 2. Cálculo do Próximo Ciclo do AutoMod (12:00 BRT)
            const now = new Date();
            let nextRun = new Date();
            nextRun.setHours(12, 0, 0, 0);
            if (now > nextRun) nextRun.setDate(nextRun.getDate() + 1);

            // 3. Métricas GLOBAIS (Alcance do seu Bot em todo o Discord)
            const totalGuilds = client.guilds.cache.size;
            const totalUsers = client.guilds.cache.reduce((acc, guild) => acc + (guild.memberCount || 0), 0);

            // 4. Recuperação de Configurações LOCAIS (Deste servidor específico)
            const logChanId = ConfigSystem.getSetting(guildId, 'logs_channel');
            const lastRunDate = ConfigSystem.getSetting(guildId, 'last_automod_run');

            // 5. Status de Hardware (VPS Oracle Cloud)
            const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
            const ping = client.ws?.ping !== -1 ? client.ws?.ping : "Calculando...";

            return {
                uptime: `${days}d ${hours}h ${minutes}m`,
                ping: ping,
                memory: `${memoryUsage} MB`,
                nextAutoMod: Math.floor(nextRun.getTime() / 1000), // Formato para o Discord <t:TS:R>
                lastRun: lastRunDate ? Math.floor(new Date(lastRunDate).getTime() / 1000) : null,
                logChannel: logChanId || "Não configurado",
                totalGuilds: totalGuilds,
                totalUsers: totalUsers,
                guildName: client.guilds.cache.get(guildId)?.name || "Este Servidor"
            };
        } catch (err) {
            // Se algo falhar, avisamos o ErrorLogger mas não travamos o bot
            ErrorLogger.log('SystemStatus_GetBotStatus', err);
            console.error("❌ Erro no SystemStatus:", err);
            return null; 
        }
    }
}

module.exports = SystemStatus;