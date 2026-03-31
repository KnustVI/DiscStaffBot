const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    RoleSelectMenuBuilder, 
    ChannelSelectMenuBuilder, 
    ChannelType 
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Painel Central de Configurações do Assistente Robin.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const { client, guild, user, guildId } = interaction;

        // Ponto 2: Acesso rápido aos sistemas pré-carregados
        const EMOJIS = client.systems.emojis || {};
        const ConfigSystem = client.systems.config;
        const Session = client.systems.sessions;

        try {
            // Ponto 3: Inicialização de Sessão com Contexto (Guild-User-Action)
            // Isso evita que o bot confunda ações se o usuário abrir o config em dois servers.
            if (Session) {
                Session.set(guildId, user.id, 'config_panel', {
                    currentStep: 'main',
                    timestamp: Date.now()
                });
            }

            // Ponto 6: Busca de dados síncrona (ConfigSystem deve ler do Map/Cache)
            const settings = {
                staff: ConfigSystem.getSetting(guildId, 'staff_role'),
                logs: ConfigSystem.getSetting(guildId, 'logs_channel'),
                strike: ConfigSystem.getSetting(guildId, 'strike_role'),
                exemplar: ConfigSystem.getSetting(guildId, 'exemplar_role'),
                problematic: ConfigSystem.getSetting(guildId, 'problematic_role')
            };

            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.CONFIG || '⚙️'} Painel de Configuração`)
                .setDescription('Gerencie os cargos de hierarquia e canais de logs do sistema Robin.')
                .setColor(0xDCA15E)
                .addFields(
                    { 
                        name: `${EMOJIS.STAFF || '👤'} Administração`, 
                        value: `> **Staff:** ${settings.staff ? `<@&${settings.staff}>` : '`Não definido`'}\n> **Logs:** ${settings.logs ? `<#${settings.logs}>` : '`Não definido`'}`, 
                        inline: false 
                    },
                    { 
                        name: `${EMOJIS.REPUTATION || '📊'} Reputação & Punição`, 
                        value: `> **Exemplar:** ${settings.exemplar ? `<@&${settings.exemplar}>` : '`❌`'}\n> **Problemático:** ${settings.problematic ? `<@&${settings.problematic}>` : '`❌`'}\n> **Cargo Strike:** ${settings.strike ? `<@&${settings.strike}>` : '`❌`'}`, 
                        inline: false 
                    }
                )
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();

            // Ponto 2 & 5: Componentes com IDs padronizados para o Roteador
            const rowBase = new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId('config:set_staff')
                    .setPlaceholder('Selecionar Cargo Staff'),
                new ChannelSelectMenuBuilder()
                    .setCustomId('config:set_logs')
                    .addChannelTypes(ChannelType.GuildText)
                    .setPlaceholder('Selecionar Canal de Logs')
            );

            const rowRep = new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId('config:set_rep_roles')
                    .setPlaceholder('Configurar Cargos de Reputação/Strike')
                    .setMinValues(1)
                    .setMaxValues(1)
            );

            // Resposta única via editReply (O deferReply já foi dado pelo interactionCreate)
            await interaction.editReply({
                embeds: [embed],
                components: [rowBase, rowRep]
            });

        } catch (error) {
            if (client.systems.logger) client.systems.logger.log('Command_Config', error);
            console.error('❌ Erro no Painel Config:', error);

            await interaction.editReply({ 
                content: '❌ Ocorreu um erro ao carregar o painel de configurações.',
                components: [] // Limpa botões em caso de erro crítico
            });
        }
    }
};