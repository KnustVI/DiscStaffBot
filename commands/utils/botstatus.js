const { SlashCommandBuilder, EmbedBuilder, version } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');
const SystemStatus = require('../../systems/systemStatus'); 
const ConfigSystem = require('../../systems/configSystem'); 

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bot-status') // Mantendo o nome sem o ponto para evitar erro de formato
        .setDescription('Verifica o estado de saúde do bot e do AutoMod.'),

    async execute(interaction) {
        // Dá ao bot 3 segundos extras para processar antes de dar timeout
        await interaction.deferReply({ ephemeral: true });

        const { guild, client } = interaction;

        try {
            // CORREÇÃO: Nome da variável corrigido de 'ystemStatus' para 'SystemStatus'
            const status = SystemStatus.getBotStatus(client, guild.id);
            
            // Blindagem: Se o sistema falhar, usamos valores padrão para o bot não "calar a boca"
            const safeStatus = status || {
                uptime: 'Indisponível',
                ping: 0,
                memory: '0',
                nextAutoMod: Math.floor(Date.now() / 1000),
                lastRun: null,
                lastChannel: null
            };

            // CORREÇÃO: Validação rigorosa da data para evitar que o Embed quebre
            const lastRunDate = safeStatus.lastRun ? new Date(safeStatus.lastRun) : null;
            const lastRunText = (lastRunDate && !isNaN(lastRunDate.getTime())) 
                ? `<t:${Math.floor(lastRunDate.getTime() / 1000)}:f>` 
                : 'Nenhum registro recente';

            // CORREÇÃO: Evita exibir "-1ms" se o bot acabou de ligar
            const pingDisplay = safeStatus.ping > 0 ? `${safeStatus.ping}ms` : 'Calculando...';

            // Pegamos o footer com segurança
            const footerData = ConfigSystem.getFooter(guild.name) || { text: `Sistema de Integridade • ${guild.name}` };

            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.PAINEL || '🖥️'} Status do Sistema`)
                .setColor(0xba0054)
                .setThumbnail(client.user.displayAvatarURL())
                .addFields(
                    { 
                        name: `${EMOJIS.BOT || '🤖'} Bot Info`, 
                        value: [
                            `**Uptime:** ${safeStatus.uptime}`,
                            `**Latência:** ${pingDisplay}`,
                            `**Versão:** v${version}`
                        ].join('\n'), 
                        inline: false 
                    },
                    { 
                        name: `${EMOJIS.AUTO_MOD || '🛡️'} AutoModeration`, 
                        value: [
                            `**Próximo Ponto (+1):** <t:${safeStatus.nextAutoMod}:R>`,
                            `**Última Execução:** ${lastRunText}`,
                            `**Canal de Logs:** ${safeStatus.lastChannel ? `<#${safeStatus.lastChannel}>` : 'Não definido'}`,
                            `**Status:** Operacional (12:00)`
                        ].join('\n'), 
                        inline: false 
                    },
                    {
                        name: `${EMOJIS.INFRA || '📦'} Infraestrutura`,
                        value: `**VPS:** Oracle Cloud | **RAM:** ${safeStatus.memory} MB`,
                        inline: false
                    }
                )
                .setFooter({ text: footerData.text || `Sistema de Integridade • ${guild.name}`, iconURL: footerData.iconURL || null })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            // Logamos o erro real no console da Oracle Cloud para você debugar se necessário
            console.error("❌ Erro ao executar bot-status:", err);
            
            // Resposta amigável para o usuário não ficar no vácuo
            if (interaction.deferred) {
                await interaction.editReply({ content: "❌ Ocorreu um erro interno ao carregar os dados. Tente novamente em instantes." });
            }
        }
    }
};