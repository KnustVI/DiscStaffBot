// /home/ubuntu/DiscStaffBot/src/commands/utility/botstatus.js
const { SlashCommandBuilder, PermissionFlagsBits, version } = require('discord.js');
const db = require('../../database/index');
const SystemStatus = require('../../systems/monitoring/systemStatus');
const ResponseManager = require('../../utils/responseManager');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

const DEVELOPER_ID = '203676076189286412';

// ---------------------------------------------------------------------------
// Coleta de dados — separado da montagem visual
// ---------------------------------------------------------------------------

function collectGuildStats(guildId) {
    const totalPunishments = db
        .prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ?`)
        .get(guildId)?.count ?? 0;

    const totalUsers = db
        .prepare(`SELECT COUNT(DISTINCT user_id) as count FROM reputation WHERE guild_id = ?`)
        .get(guildId)?.count ?? 0;

    const avgReputation = db
        .prepare(`SELECT AVG(points) as avg FROM reputation WHERE guild_id = ?`)
        .get(guildId)?.avg ?? 100;

    const since30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentStrikes = db
        .prepare(`SELECT COUNT(*) as count FROM punishments WHERE guild_id = ? AND created_at > ?`)
        .get(guildId, since30d)?.count ?? 0;

    return { totalPunishments, totalUsers, avgReputation, recentStrikes };
}

async function resolveLastLogLink(guild, logChannelId, emojis) {
    if (!logChannelId) {
        return `${emojis.circlealert || '❌'} Não definido`;
    }

    try {
        const channel = await guild.channels.fetch(logChannelId).catch(() => null);
        if (!channel) return `${emojis.circlealert || '❌'} Canal não encontrado`;

        const messages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
        if (messages?.first()) return `[Última mensagem](${messages.first().url})`;

        return `<#${logChannelId}> (sem mensagens)`;
    } catch {
        return `${emojis.circlealert || '❌'} Erro ao buscar`;
    }
}

// ---------------------------------------------------------------------------
// Montagem visual
// ---------------------------------------------------------------------------

function buildStatusPage({ guild, emojis, status, dbStats, guildStats, lastLogLink, isHealthy, isDeveloper }) {
    const healthEmoji  = isHealthy ? '🟢' : '🔴';
    const healthStatus = isHealthy ? 'Saudável' : 'Crítico — Verifique os logs';

    const builder = new AdvancedContainerBuilder({ accentColor: isHealthy ? COLORS.SUCCESS : COLORS.ERROR });

    builder
        .section(
            [
                '# PAINEL DE CONTROLE DO BOT',
                'Status geral, uptime e métricas do bot.',
            ].join('\n'),
            builder.assetThumbnail('icone_info') || AdvancedContainerBuilder.thumbnail('https://cdn.discordapp.com/embed/avatars/0.png')
        )
        .separator()
        .title(`${emojis.megaphone || '🌐'} Status Global`, 2)
        .block([
            `**Servidores:** ${status.totalGuilds}`,
            `**Usuários:** ${status.totalUsers.toLocaleString('pt-BR')}`,
            `**Uptime:** ${status.uptime}`,
            `**Latência:** ${status.ping}`,
        ])
        .separator();

    if (isDeveloper) {
        builder
            .title(`${emojis.terminal || '📦'} Hardware & Sistema`, 2)
            .block([
                `**RAM:** ${status.memory}`,
                `**Node:** ${process.version}`,
                `**DJS:** v${version}`,
                `**CPU Load:** ${status.cpuLoad?.toFixed(2) ?? 'N/A'}`,
            ])
            .separator();
    }

    builder
        .title(`${emojis.storage || '🗄️'} Banco de Dados`, 2)
        .block([
            `**Tamanho:** ${dbStats?.fileSize ?? 'N/A'}`,
            `**Tabelas:** ${Object.keys(dbStats?.tables ?? {}).length}`,
            `**Punições:** ${guildStats.totalPunishments}`,
            `${emojis.user || '👥'} **Penalizados:** ${guildStats.totalUsers}`,
            `${emojis.star || '⭐'} **Média:** ${Math.round(guildStats.avgReputation)}/100`,
            `${emojis.gavel || '⚠️'} **Últimos 30d:** ${guildStats.recentStrikes}`,
        ])
        .separator()
        .title(`${emojis.shieldcheck || '🛡️'} Sistema AutoMod`, 2)
        .block([
            `**Próximo Ciclo:** <t:${status.nextAutoModTS}:R>`,
            `**Última Execução:** ${status.lastRunTS ? `<t:${status.lastRunTS}:f>` : 'Nenhum registro'}`,
            `**Logs:** ${lastLogLink}`,
            `**Health:** ${healthEmoji} ${healthStatus}`,
        ])
        .footer(guild.name);

    return builder;
}

// ---------------------------------------------------------------------------
// Comando
// ---------------------------------------------------------------------------

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botstatus')
        .setDescription('Verifica o estado de saúde do bot e do AutoMod.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const startTime = Date.now();
        const { guild, user } = interaction;
        const guildId = guild.id;
        const isDeveloper = user.id === DEVELOPER_ID;

        let emojis = {};
        try {
            emojis = require('../../database/emojis.js').EMOJIS ?? {};
        } catch { /* usa fallbacks nos builders */ }

        try {
            db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
            db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

            const ConfigSystem = require('../../systems/core/configSystem');
            const status = SystemStatus.getBotStatus(client, guildId);

            if (!status) {
                return await ResponseManager.error(interaction, 'Erro ao coletar dados do sistema.');
            }

            const dbStats      = db.getStats();
            const guildStats   = collectGuildStats(guildId);
            const isHealthy    = SystemStatus.isSystemHealthy(client, guildId);
            const logChannelId = ConfigSystem.getSetting(guildId, 'log_automod');
            const lastLogLink  = await resolveLastLogLink(guild, logChannelId, emojis);

            const builder = buildStatusPage({
                guild,
                emojis,
                status,
                dbStats,
                guildStats,
                lastLogLink,
                isHealthy,
                isDeveloper,
            });

            const payload = builder.build();
            await interaction.editReply(payload);

            db.logActivity(guildId, user.id, 'status_command', null, {
                command: 'botstatus',
                responseTime: Date.now() - startTime,
                systemHealth: isHealthy,
                totalPunishments: guildStats.totalPunishments,
            });

            console.log(`📊 [BOTSTATUS] ${user.tag} em ${guild.name} | ${Date.now() - startTime}ms`);

        } catch (error) {
            console.error('❌ Erro no botstatus:', error);
            const ErrorLogger = require('../../systems/core/errorLogger');
            await ErrorLogger.logInteractionError(interaction, error, 'command');
            await ResponseManager.error(interaction, 'Erro ao gerar relatório de status.');
        }
    },
};