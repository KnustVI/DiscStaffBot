// src/commands/developer/automod.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const EmbedFormatter = require('../../utils/embedFormatter');
const { AutoModerationSystem } = require('../../systems/autoModeration');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('automod')
        .setDescription('🛡️ Testa a configuração da Auto Moderação')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('test')
            .setDescription('🧪 Verifica a configuração e o canal de log')
        ),

    async execute(interaction, client) {
        const { guild } = interaction;
        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand !== 'test') return;
        
        await interaction.deferReply({ flags: 64 });
        
        const ConfigSystem = require('../../systems/configSystem');
        const guildId = guild.id;
        
        // Buscar configurações
        const isEnabled = ConfigSystem.getSetting(guildId, 'automod_enabled') === 'true';
        const logChannelId = ConfigSystem.getSetting(guildId, 'log_automod');
        const lastRun = ConfigSystem.getSetting(guildId, 'last_automod_run');
        const lastLog = ConfigSystem.getSetting(guildId, 'last_automod_log');
        
        // Verificar canal de log
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
                    
                    // Testar envio de mensagem
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
        
        // Verificar se a AutoMod está ativa
        let automodStatus = isEnabled ? '✅ Ativada' : '❌ Desativada';
        if (!isEnabled) {
            channelIssues.push(`**Solução:** Use \`/automod toggle\` para ativar a Auto Moderação.`);
        }
        
        // Verificar última execução
        let lastRunText = 'Nunca executado';
        if (lastRun) {
            const lastRunDate = new Date(parseInt(lastRun));
            lastRunText = `<t:${Math.floor(lastRunDate.getTime() / 1000)}:R>`;
        }
        
        // Verificar último log enviado
        let lastLogText = lastLog || 'Nunca enviado';
        
        // Verificar se o worker está rodando
        const autoMod = new AutoModerationSystem(client);
        const workerRunning = autoMod.isRunning;
        
        // Montar embed
        const hasIssues = channelIssues.length > 0 || !isEnabled;
        const embed = new EmbedBuilder()
            .setColor(hasIssues ? 0xFFA500 : 0x00FF00)
            .setThumbnail(guild.iconURL())
            .setDescription(`# 🛡️ Diagnóstico da Auto Moderação\n**Servidor:** ${guild.name}`)
            .addFields(
                { name: '📋 Status', value: `**AutoMod:** ${automodStatus}\n**Worker:** ${workerRunning ? '🟢 Rodando' : '🔴 Parado'}`, inline: true },
                { name: '📺 Canal de Log', value: channelStatus, inline: true },
                { name: '🕐 Última Execução', value: lastRunText, inline: true },
                { name: '📝 Último Log Enviado', value: lastLogText, inline: false }
            );
        
        if (channelIssues.length > 0) {
            embed.addFields({ name: '⚠️ Problemas e Soluções', value: channelIssues.join('\n'), inline: false });
        }
        
        if (!hasIssues) {
            embed.addFields({ name: '✅ Tudo Certo!', value: 'A Auto Moderação está configurada corretamente e deve enviar logs normalmente.', inline: false });
        }
        
        embed.setFooter(EmbedFormatter.getFooter(guild.name)).setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
    }
};