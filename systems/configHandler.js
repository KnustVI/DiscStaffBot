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
                return interaction.reply({
                    content: `${EMOJIS.ERRO || '❌'} Sessão expirada. Use o comando novamente.`,
                    ephemeral: true
                });
            }

            // =========================
            // VALIDAÇÃO DE INPUT
            // =========================
            const selectedValue = interaction.values?.[0];

            if (!selectedValue) {
                return interaction.reply({
                    content: `${EMOJIS.ERRO || '❌'} Valor inválido selecionado.`,
                    ephemeral: true
                });
            }

            // =========================
            // PADRÃO DE KEY (ESCALÁVEL)
            // =========================
            // Ex: config:set:staff_role
            const action = parts[1];
            const key = parts.slice(2).join('_');

            if (action !== 'set' || !key) {
                return interaction.reply({
                    content: `${EMOJIS.ERRO || '❌'} Ação inválida.`,
                    ephemeral: true
                });
            }

            // =========================
            // SALVAR CONFIG
            // =========================
            ConfigSystem.updateSetting(guildId, key, selectedValue);

            // =========================
            // BUSCAR CONFIG (OTIMIZADO)
            // =========================
            const staffRoleId = ConfigSystem.getSetting(guildId, 'staff_role');
            const logsChannelId = ConfigSystem.getSetting(guildId, 'logs_channel');

            const staffDisplay = staffRoleId
                ? `<@&${staffRoleId}>`
                : `${EMOJIS.ERRO || '❌'} \`Não configurado\``;

            const logsDisplay = logsChannelId
                ? `<#${logsChannelId}>`
                : `${EMOJIS.ERRO || '❌'} \`Não configurado\``;

            // =========================
            // EMBED (MANTIDA INTACTA)
            // =========================
            const updatedEmbed = new EmbedBuilder()
                .setDescription(
                    `# ${EMOJIS.CONFIG || '⚙️'} Painel de Configuração \n` +
                    `> **Configuração atualizada com sucesso!**\n\n
                    ${EMOJIS.REPUTATION || '📊'} Verifique os novos valores abaixo:`
                )
                .setColor(0xba0054)
                .addFields(
                    { name: `${EMOJIS.STAFF || '👤'} Cargo Staff`, value: staffDisplay, inline: true },
                    { name: `${EMOJIS.TICKET || '📁'} Canal de Logs`, value: logsDisplay, inline: true }
                )
                .setFooter(ConfigSystem.getFooter(guildName))
                .setTimestamp();

            // =========================
            // UPDATE SEGURO
            // =========================
            await interaction.update({
                embeds: [updatedEmbed],
                components: interaction.message.components
            });

        } catch (err) {

            ErrorLogger.log('ConfigHandler', err);

            const errorMsg = {
                content: `${EMOJIS.ERRO || '❌'} Ocorreu um erro ao salvar a configuração no banco.`,
                ephemeral: true
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMsg);
            } else {
                await interaction.reply(errorMsg);
            }
        }
    }
};

module.exports = ConfigHandler;