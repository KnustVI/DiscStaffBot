// /home/ubuntu/DiscStaffBot/src/commands/developer/automod.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { AdvancedContainerBuilder } = require('../../utils/containerBuilder');
// REMOVER esta importação:
// const { AutoModerationSystem } = require('../../systems/autoModeration');

let emojis = {};
try {
    emojis = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    emojis = {};
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('automod')
        .setDescription('🛡️ Executa manutenção e verifica a configuração da Auto Moderação')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const { guild } = interaction;
        
        const ConfigSystem = require('../../systems/configSystem');
        const guildId = guild.id;
        
        const autoMod = global.autoModInstance;
        
        if (!autoMod) {
            // Se não existir, tenta inicializar (fallback)
            try {
                const autoModeration = require('../../systems/autoModeration');
                const newInstance = autoModeration(client);
                if (newInstance) {
                    await interaction.deferReply({ flags: 64 });
                    return await interaction.editReply({
                        content: `${emojis.trianglealert || '⚠️'} Sistema de Auto Moderação foi inicializado agora. Execute o comando novamente para ver o diagnóstico.`,
                        flags: 64
                    });
                }
            } catch (error) {
                await interaction.deferReply({ flags: 64 });
                return await interaction.editReply({
                    content: `${emojis.circlealert || '❌'} Erro ao inicializar o sistema de Auto Moderação. Verifique os logs.`,
                    flags: 64
                });
            }
        }

        // Executar manutenção manual usando a instância global
        const result = await autoMod.runManualMaintenance();

        const isEnabled = ConfigSystem.getSetting(guildId, 'automod_enabled') === 'true';
        const logChannelId = ConfigSystem.getSetting(guildId, 'log_automod');
        const lastRun = ConfigSystem.getSetting(guildId, 'last_automod_run');

        let channelStatus = `${emojis.circlealert || '❌'} Não configurado`;
        let channelIssues = [];

        if (logChannelId) {
            const channel = guild.channels.cache.get(logChannelId);
            if (!channel) {
                channelStatus = `${emojis.circlealert || '❌'} Canal não encontrado`;
                channelIssues.push(`Canal com ID \`${logChannelId}\` não existe.`);
            } else {
                const botMember = guild.members.me;
                const perms = channel.permissionsFor(botMember);

                if (!perms.has('ViewChannel') || !perms.has('SendMessages')) {
                    channelStatus = `${emojis.trianglealert || '⚠️'} Sem permissões em ${channel.name}`;
                    channelIssues.push(`Configure permissões do bot no canal ${channel.name}.`);
                } else {
                    channelStatus = `${emojis.circlecheck || '✅'} ${channel.name}`;
                }
            }
        }

        const automodStatus = isEnabled ? `${emojis.toggleon || '✅'} Ativada` : `${emojis.toggleoff || '❌'} Desativada`;
        const workerRunning = autoMod.isRunning;
        const hasIssues = channelIssues.length > 0 || !isEnabled;

        const builder = new AdvancedContainerBuilder({ accentColor: hasIssues ? 0xFFA500 : 0x00FF00 });

        builder.title(`${emojis.shieldcheck || '🛡️'} Diagnóstico da Auto Moderação`, 1);
        builder.text(`**Servidor:** ${guild.name}`);
        builder.separator();
        builder.text(`${emojis.clipboardlist || '📋'} **Status:** AutoMod: ${automodStatus} | Worker: ${workerRunning ? '🟢 Rodando' : '🔴 Parado'}`);
        builder.text(`📺 **Canal de Log:** ${channelStatus}`);
        builder.text(`${emojis.gauge || '📊'} **Relatório:** ${emojis.trendingup || '📈'} ${result.totalRepRecovered} recuperados | ${emojis.plus || '➕'} ${result.totalRolesAdded} adicionados | ${emojis.minus || '➖'} ${result.totalRolesRemoved} removidos`);

        if (channelIssues.length > 0) {
            builder.separator();
            builder.title(`${emojis.trianglealert || '⚠️'} Problemas`, 2);
            for (const issue of channelIssues) {
                builder.text(issue);
            }
        }
        
        builder.footer(`Server: ${guild.name}`);
        
        const { components, flags } = builder.build();
        
        await interaction.editReply({
            components,
            flags: [flags]
        });
    }
};