// src/systems/monitoring/dailyAnalyticsJob.js
/**
 * Envia diariamente a análise resumida de staff (punições, reports,
 * eventos, modo espectador — ver analyticsSystem.js) pro canal de logs
 * gerais (config-log → log_channel) de cada guild. Restrito a servidores
 * tier Caçador (pedido do dono — ver premiumSystem.js analyticsEnabled).
 */
const cron = require('node-cron');
const ConfigSystem = require('../core/configSystem');
const PremiumSystem = require('../premium/premiumSystem');
const AnalyticsSystem = require('../moderation/analyticsSystem');

function startDailyAnalyticsJob(client) {
    console.log('📊 Job de análise diária de staff iniciado');

    // Roda pouco depois da meia-noite (horário de SP) pra fechar o dia
    // anterior, que é o que getLocalDate() já teria virado nesse ponto.
    cron.schedule('5 0 * * *', async () => {
        console.log('📊 Gerando análise diária de staff...');

        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const date = AnalyticsSystem.getLocalDate(yesterday);

        for (const guild of client.guilds.cache.values()) {
            try {
                if (!PremiumSystem.getGuildLimits(guild.id).analyticsEnabled) continue;

                const logChannelId = ConfigSystem.getSetting(guild.id, 'log_channel');
                if (!logChannelId) continue;

                const rows = AnalyticsSystem.getGuildDailySummary(guild.id, date);
                if (rows.length === 0) continue; // sem atividade de staff nesse dia, não manda mensagem vazia

                const channel = await guild.channels.fetch(logChannelId).catch(() => null);
                if (!channel) continue;

                const builder = AnalyticsSystem.generateDailySummaryContainer(guild, date);
                await channel.send(builder.build());
            } catch (error) {
                console.error(`❌ [DailyAnalytics] Erro ao gerar análise diária da guild ${guild.id}:`, error);
            }
        }
    }, {
        timezone: 'America/Sao_Paulo'
    });
}

module.exports = { startDailyAnalyticsJob };
