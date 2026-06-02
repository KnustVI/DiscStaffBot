// /home/ubuntu/DiscStaffBot/src/commands/developer/automod.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ContainerFormatter = require('../../utils/ContainerFormatter');
const { AutoModerationSystem } = require('../../systems/autoModeration');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('automod')
        .setDescription('🛡️ Executa manutenção e verifica a configuração da Auto Moderação')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        const { guild } = interaction;
        
        const ConfigSystem = require('../../systems/configSystem');
        const guildId = guild.id;
        
        const autoMod = new AutoModerationSystem(client);
        const result = await autoMod.runManualMaintenance();
        
        const isEnabled = ConfigSystem.getSetting(guildId, 'automod_enabled') === 'true';
        const logChannelId = ConfigSystem.getSetting(guildId, 'log_automod');
        const lastRun = ConfigSystem.getSetting(guildId, 'last_automod_run');
        
        let channelStatus = '❌ Não configurado';
        let channelIssues = [];
        
        if (logChannelId) {
            const channel = guild.channels.cache.get(logChannelId);
            if (!channel) {
                channelStatus = '❌ Canal não encontrado';
                channelIssues.push(`Canal com ID \`${logChannelId}\` não existe.`);
            } else {
                const botMember = guild.members.me;
                const perms = channel.permissionsFor(botMember);
                
                if (!perms.has('ViewChannel') || !perms.has('SendMessages')) {
                    channelStatus = `⚠️ Sem permissões em ${channel.name}`;
                    channelIssues.push(`Configure permissões do bot no canal ${channel.name}.`);
                } else {
                    channelStatus = `✅ ${channel.name}`;
                }
            }
        }
        
        const automodStatus = isEnabled ? '✅ Ativada' : '❌ Desativada';
        const workerRunning = autoMod.isRunning;
        const hasIssues = channelIssues.length > 0 || !isEnabled;
        
        const builder = ContainerFormatter.create(guild.name, hasIssues ? 0xFFA500 : 0x00FF00);
        
        builder.addTitle('🛡️ Diagnóstico da Auto Moderação', 1);
        builder.addText(`**Servidor:** ${guild.name}`);
        builder.addSeparator();
        builder.addText(`📋 **Status:** AutoMod: ${automodStatus} | Worker: ${workerRunning ? '🟢 Rodando' : '🔴 Parado'}`);
        builder.addText(`📺 **Canal de Log:** ${channelStatus}`);
        builder.addText(`📊 **Relatório:** 📈 ${result.totalRepRecovered} recuperados | ➕ ${result.totalRolesAdded} adicionados | ➖ ${result.totalRolesRemoved} removidos`);
        
        if (channelIssues.length > 0) {
            builder.addSeparator();
            builder.addTitle('⚠️ Problemas', 2);
            for (const issue of channelIssues) {
                builder.addText(issue);
            }
        }
        
        builder.addFooter();
        
        await interaction.editReply({
            components: [builder.build()],
            flags: ['IsComponentsV2']
        });
    }
};