const { EmbedBuilder } = require('discord.js');
const ConfigSystem = require('../systems/configSystem');
const { EMOJIS } = require('../database/emojis');
const ErrorLogger = require('../systems/errorLogger');

const ConfigHandler = {

    async handle(interaction, parts) {
        const guildId = interaction.guild.id;
        const guildName = interaction.guild.name;

        try {
            // =========================
            // 1. CAPTURA DE VALOR (MULTIMODAL)
            // =========================
            // Pega o ID independente se for String, Role ou Channel Select Menu
            let selectedValue = interaction.values?.[0] || 
                                interaction.roles?.first()?.id || 
                                interaction.channels?.first()?.id;

            // Se for um componente de seleção e não temos valor, algo deu errado
            if ((interaction.isAnySelectMenu()) && !selectedValue) {
                throw new Error("Nenhum valor válido foi detectado na seleção.");
            }

            // parts: [config, set, staff, role] -> key: staff_role
            const action = parts[1]; 
            const key = parts.slice(2).join('_'); 

            if (action !== 'set' || !key) {
                throw new Error(`Ação ou chave de configuração inválida: ${action}:${key}`);
            }

            // =========================
            // 2. PERSISTÊNCIA NO BANCO
            // =========================
            // Atualizamos o banco de dados e limpamos o cache interno
            await ConfigSystem.updateSetting(guildId, key, selectedValue);

            // =========================
            // 3. BUSCA DE ESTADO ATUALIZADO
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
            // 4. ATUALIZAÇÃO DA INTERFACE
            // =========================
            const updatedEmbed = new EmbedBuilder()
                .setTitle(`${EMOJIS.CONFIG || '⚙️'} Painel de Configuração`)
                .setDescription(
                    `### ${EMOJIS.CHECK || '✅'} Configuração Atualizada\n` +
                    `O parâmetro **${key.replace(/_/g, ' ')}** foi definido com sucesso.`
                )
                .setColor(0xba0054)
                .addFields(
                    { name: `${EMOJIS.STAFF || '👤'} Cargo Staff`, value: staffDisplay, inline: true },
                    { name: `${EMOJIS.TICKET || '📁'} Canal de Logs`, value: logsDisplay, inline: true }
                )
                .setFooter({ text: `ID do Servidor: ${guildId}` })
                .setTimestamp();

            // Usamos editReply pois o interactionCreate já deu deferUpdate/Reply
            await interaction.editReply({
                embeds: [updatedEmbed],
                components: interaction.message.components 
            });

        } catch (err) {
            ErrorLogger.log('ConfigHandler', err);
            
            // Repassamos o erro para o interactionCreate lidar com a mensagem de erro ao user
            throw err; 
        }
    }
};

module.exports = ConfigHandler;