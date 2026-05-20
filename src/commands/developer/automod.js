// src/commands/developer/automod.js
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
        const lastLog = ConfigSystem.getSetting(guildId, 'last_automod_log');
        
        let channelStatus = '❌ Não configurado';
        let channelIssues = [];
        
        if (logChannelId) {
            const channel = guild.channels.cache.get(logChannelId);
            if (!channel) {
                channelStatus = '❌ Canal não encontrado';
                channelIssues.push(`O canal com ID \`${logChannelId}\` não existe mais no servidor.`);
                channelIssues.push(`**Solução:** Use \`/config-logs\` e configure um canal válido.`);
            } else {
                const botMember = guild.members.me;
                const perms = channel.permissionsFor(botMember);
                
                const missingPerms = [];
                if (!perms.has('ViewChannel')) missingPerms.push('👁️ Ver Canal');
                if (!perms.has('SendMessages')) missingPerms.push('📤 Enviar Mensagens');
                if (!perms.has('EmbedLinks')) missingPerms.push('🔗 Enviar Links/Embeds');
                
                if (missingPerms.length > 0) {
                    channelStatus = `⚠️ Sem permissões em ${channel.name}`;
                    channelIssues.push(`O bot não tem as seguintes permissões no canal ${channel.name}:`);
                    missingPerms.forEach(p => channelIssues.push(`  - ${p}`));
                    channelIssues.push(`**Solução:** Dê as permissões necessárias para o bot no canal.`);
                } else {
                    channelStatus = `✅ ${channel.name}`;
                    try {
                        const testMsg = await channel.send({ content: '🧪 Teste de conexão do AutoMod - esta mensagem será deletada em 5 segundos.' });
                        setTimeout(() => testMsg.delete().catch(() => {}), 5000);
                        channelIssues.push(`✅ Teste de envio realizado com sucesso!`);
                    } catch (err) {
                        channelStatus = `❌ Erro ao enviar`;
                        channelIssues.push(`Erro ao enviar mensagem de teste: ${err.message}`);
                    }
                }
            }
        } else {
            channelIssues.push(`**Solução:** Use \`/config-logs\` e configure o canal "🛡️ AutoMod".`);
        }
        
        let automodStatus = isEnabled ? '✅ Ativada' : '❌ Desativada';
        if (!isEnabled) {
            channelIssues.push(`**Solução:** Use \`/automod toggle\` para ativar a Auto Moderação.`);
        }
        
        let lastRunText = 'Nunca executado';
        if (lastRun) {
            const lastRunDate = new Date(parseInt(lastRun));
            lastRunText = `<t:${Math.floor(lastRunDate.getTime() / 1000)}:R>`;
        }
        
        let lastLogText = lastLog || 'Nunca enviado';
        const workerRunning = autoMod.isRunning;
        const hasIssues = channelIssues.length > 0 || !isEnabled;
        
        const builder = ContainerFormatter.createBuilder(guild.name, hasIssues ? 0xFFA500 : 0x00FF00);
        builder.addTitle('🛡️ Diagnóstico da Auto Moderação', 1);
        builder.addText(`**Servidor:** ${guild.name}`);
        builder.addSeparator();
        
        builder.addSection([`📋 **Status:**`, `AutoMod: ${automodStatus}\nWorker: ${workerRunning ? '🟢 Rodando' : '🔴 Parado'}`]);
        builder.addSection([`📺 **Canal de Log:**`, channelStatus]);
        builder.addSection([`🕐 **Última Execução:**`, lastRunText]);
        builder.addSection([`📝 **Último Log Enviado:**`, lastLogText]);
        builder.addSection([`📊 **Relatório da Execução:**`, `📈 Recuperados: ${result.totalRepRecovered} usuários\n➕ Cargos adicionados: ${result.totalRolesAdded}\n➖ Cargos removidos: ${result.totalRolesRemoved}`]);
        
        if (channelIssues.length > 0) {
            builder.addSeparator();
            builder.addTitle('⚠️ Problemas e Soluções', 2);
            for (const issue of channelIssues) {
                builder.addText(issue);
            }
        }
        
        if (!hasIssues && result.totalRepRecovered === 0 && result.totalRolesAdded === 0 && result.totalRolesRemoved === 0) {
            builder.addSeparator();
            builder.addText('ℹ️ Nenhuma alteração foi necessária durante esta execução. O sistema está funcionando normalmente.');
        } else if (!hasIssues) {
            builder.addSeparator();
            builder.addText('✅ A Auto Moderação está configurada corretamente e executou a manutenção com sucesso.');
        }
        
        builder.addFooter();
        
        await interaction.editReply(builder.build());
    }
};