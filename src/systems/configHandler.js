const { EmbedBuilder } = require('discord.js');

const ConfigHandler = {
    async handle(interaction, parts) {
        const { guild, client, guildId } = interaction;

        try {
            // Problema 2: Usando sistemas pré-carregados no client
            const EMOJIS = client.systems.emojis || {};
            const ConfigSystem = client.systems.config;
            const ErrorLogger = client.systems.logger;

            // ==========================================
            // 1. CAPTURA DINÂMICA DE VALORES
            // ==========================================
            // Resolve para qualquer tipo de Select Menu (Role, Channel, String)
            let selectedValue = interaction.values?.[0] || 
                                interaction.roles?.first()?.id || 
                                interaction.channels?.first()?.id;

            if (!selectedValue) {
                throw new Error("Nenhum valor válido foi detectado na seleção.");
            }

            // parts: [config, set, logs_channel] -> key: logs_channel
            const action = parts[1]; 
            const key = parts.slice(2).join('_'); 

            if (action !== 'set' || !key) {
                throw new Error(`Ação inválida: ${action}:${key}`);
            }

            // ==========================================
            // 2. PERSISTÊNCIA (BANCO DE DADOS)
            // ==========================================
            // Problema 6: Só usar await se a função for realmente Async (I/O de Banco)
            await ConfigSystem.updateSetting(guildId, key, selectedValue);

            // ==========================================
            // 3. COLETA DE ESTADOS PARA O EMBED
            // ==========================================
            // Buscamos todos os valores (os antigos e os novos que você quer implementar)
            const settings = {
                staff: ConfigSystem.getSetting(guildId, 'staff_role'),
                logs: ConfigSystem.getSetting(guildId, 'logs_channel'),
                strike: ConfigSystem.getSetting(guildId, 'strike_role'),
                exemplar: ConfigSystem.getSetting(guildId, 'exemplar_role'),
                problem: ConfigSystem.getSetting(guildId, 'problematic_role')
            };

            // Função interna para formatar menções ou erro
            const format = (id, type) => {
                if (!id) return `${EMOJIS.ERRO || '❌'} \`Não configurado\``;
                return type === 'channel' ? `<#${id}>` : `<@&${id}>`;
            };

            // ==========================================
            // 4. ATUALIZAÇÃO DA INTERFACE (MANTENDO SEU EMBED)
            // ==========================================
            const updatedEmbed = new EmbedBuilder()
                .setTitle(`${EMOJIS.CONFIG || '⚙️'} Painel de Configuração`)
                .setDescription(
                    `### ${EMOJIS.CHECK || '✅'} Atualizado com Sucesso!\n` +
                    `O parâmetro **${key.replace(/_/g, ' ')}** foi salvo.`
                )
                .setColor(0xDCA15E)
                .addFields(
                    { 
                        name: `${EMOJIS.STAFF || '👤'} Administração`, 
                        value: `Staff: ${format(settings.staff, 'role')}\nLogs: ${format(settings.logs, 'channel')}`, 
                        inline: false 
                    },
                    { 
                        name: `${EMOJIS.REPUTATION || '📊'} Reputação & Punição`, 
                        value: `Strike: ${format(settings.strike, 'role')}\nExemplar: ${format(settings.exemplar, 'role')}\nProblemático: ${format(settings.problem, 'role')}`, 
                        inline: false 
                    }
                )
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();

            // Editamos a mensagem original mantendo os componentes
            await interaction.editReply({
                embeds: [updatedEmbed],
                components: interaction.message.components 
            });

        } catch (err) {
            if (interaction.client.systems.logger) {
                interaction.client.systems.logger.log('ConfigHandler_Error', err);
            }
            throw err; 
        }
    }
};

module.exports = ConfigHandler;