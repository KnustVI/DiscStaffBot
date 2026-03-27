const { EmbedBuilder } = require('discord.js');
const ConfigSystem = require('../systems/configSystem');
const { EMOJIS } = require('../database/emojis');
const ErrorLogger = require('../systems/errorLogger');
const session = require('../utils/sessionManager');

const ConfigHandler = {

    async handle(interaction, parts) {
        const guildId = interaction.guild.id;
        const guildName = interaction.guild.name;

        try {
            // =========================
            // VALIDAÇÃO DE SESSION
            // =========================
            const userSession = session.get(interaction.user.id);

            if (!userSession) {
                // Como houve deferUpdate no interactionCreate, usamos followUp para mensagens novas
                return interaction.followUp({
                    content: `${EMOJIS.ERRO || '❌'} Sessão expirada. Use o comando novamente.`,
                    ephemeral: true
                });
            }

            // =========================
            // VALIDAÇÃO DE INPUT
            // =========================
            const selectedValue = interaction.values?.[0];

            if (!selectedValue) {
                return interaction.followUp({
                    content: `${EMOJIS.ERRO || '❌'} Valor inválido selecionado.`,
                    ephemeral: true
                });
            }

            // =========================
            // PROCESSAMENTO DE KEY
            // =========================
            // parts vem do split(':') -> [config, set, staff_role]
            const action = parts[1]; // set
            const key = parts.slice(2).join('_'); // staff_role ou logs_channel

            if (action !== 'set' || !key) {
                return interaction.followUp({
                    content: `${EMOJIS.ERRO || '❌'} Ação inválida.`,
                    ephemeral: true
                });
            }

            // =========================
            // SALVAR NO BANCO (Sincrono ou Assincrono)
            // =========================
            // Se o seu updateSetting for async, adicione 'await'
            await ConfigSystem.updateSetting(guildId, key, selectedValue);

            // =========================
            // BUSCAR CONFIG ATUALIZADA
            // =========================
            const staffRoleId = await ConfigSystem.getSetting(guildId, 'staff_role');
            const logsChannelId = await ConfigSystem.getSetting(guildId, 'logs_channel');

            const staffDisplay = staffRoleId
                ? `<@&${staffRoleId}>`
                : `${EMOJIS.ERRO || '❌'} \`Não configurado\``;

            const logsDisplay = logsChannelId
                ? `<#${logsChannelId}>`
                : `${EMOJIS.ERRO || '❌'} \`Não configurado\``;

            // =========================
            // EMBED DE ATUALIZAÇÃO
            // =========================
            const updatedEmbed = new EmbedBuilder()
                .setDescription(
                    `# ${EMOJIS.CONFIG || '⚙️'} Painel de Configuração \n` +
                    `> **Configuração atualizada com sucesso!**\n\n` +
                    `${EMOJIS.REPUTATION || '📊'} Verifique os novos valores abaixo:`
                )
                .setColor(0xba0054)
                .addFields(
                    { name: `${EMOJIS.STAFF || '👤'} Cargo Staff`, value: staffDisplay, inline: true },
                    { name: `${EMOJIS.TICKET || '📁'} Canal de Logs`, value: logsDisplay, inline: true }
                )
                .setFooter({ text: `Configuração de ${guildName}` }) // Simplificado se getFooter der erro
                .setTimestamp();

            // =========================
            // RESPOSTA (CRÍTICO: editReply)
            // =========================
            // Como o interactionCreate já deu deferUpdate(), usamos editReply
            await interaction.editReply({
                embeds: [updatedEmbed],
                components: interaction.message.components
            });

        } catch (err) {
            ErrorLogger.log('ConfigHandler', err);
            console.error('[Handler Error]', err);

            const errorMsg = {
                content: `${EMOJIS.ERRO || '❌'} Ocorreu um erro ao salvar no banco. Verifique se a coluna \`${parts.slice(2).join('_')}\` existe na tabela.`,
                ephemeral: true
            };

            // Tratamento seguro de erro para não crashar o bot
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp(errorMsg);
                } else {
                    await interaction.reply(errorMsg);
                }
            } catch (innerErr) {
                console.error('Falha ao enviar mensagem de erro:', innerErr);
            }
        }
    }
};

module.exports = ConfigHandler;