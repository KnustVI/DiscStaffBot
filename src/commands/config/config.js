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

        try {
            // Sistemas pré-carregados
            const EMOJIS = client.systems.emojis || {};
            const ConfigSystem = client.systems.config;
            const Session = client.systems.sessions;

            // 1. INICIALIZAÇÃO DE SESSÃO (Contextualizada: Guild-User-Action)
            // Guardamos que o usuário está no fluxo de 'config'
            Session.set(guildId, user.id, 'config', {
                step: 'main_panel',
                lastUpdate: Date.now()
            });

            // 2. BUSCA DE DADOS ATUAIS (Puxando do seu ConfigSystem)
            const settings = {
                staff: ConfigSystem.getSetting(guildId, 'staff_role'),
                logs: ConfigSystem.getSetting(guildId, 'logs_channel'),
                strike: ConfigSystem.getSetting(guildId, 'strike_role'),
                exemplar: ConfigSystem.getSetting(guildId, 'exemplar_role'),
                problematico: ConfigSystem.getSetting(guildId, 'problematic_role')
            };

            // 3. CONSTRUÇÃO DO EMBED (Mantendo sua formatação)
            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.CONFIG || '⚙️'} Painel de Configuração`)
                .setDescription('Gerencie os cargos de hierarquia, punição e canais de sistema.')
                .setColor(0xDCA15E)
                .addFields(
                    { 
                        name: `${EMOJIS.STAFF || '👤'} Cargos Administrativos`, 
                        value: `Staff: ${settings.staff ? `<@&${settings.staff}>` : '`❌`'}\nLogs: ${settings.logs ? `<#${settings.logs}>` : '`❌`'}`, 
                        inline: false 
                    },
                    { 
                        name: `${EMOJIS.REPUTATION || '📊'} Cargos de Reputação`, 
                        value: `Exemplar: ${settings.exemplar ? `<@&${settings.exemplar}>` : '`❌`'}\nProblemático: ${settings.problematico ? `<@&${settings.problematico}>` : '`❌`'}\nStrike: ${settings.strike ? `<@&${settings.strike}>` : '`❌`'}`, 
                        inline: false 
                    }
                )
                .setFooter(ConfigSystem.getFooter(guild.name))
                .setTimestamp();

            // 4. COMPONENTES (Organizados por ActionRows)
            
            // Fila 1: Configurações Base (Staff e Logs)
            const rowBase = new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId('config:set:staff_role')
                    .setPlaceholder('Definir Cargo Staff'),
                new ChannelSelectMenuBuilder()
                    .setCustomId('config:set:logs_channel')
                    .addChannelTypes(ChannelType.GuildText)
                    .setPlaceholder('Definir Canal de Logs')
            );

            // Fila 2: Configurações de Reputação (Strike, Exemplar, Problemático)
            // Aqui usamos um Menu de Seleção de Cargos para os 3 tipos
            const rowReputation = new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId('config:set:reputation_roles')
                    .setPlaceholder('Configurar Cargos de Reputação (Exemplar/Prob/Strike)')
                    .setMinValues(1)
                    .setMaxValues(1) // O Handler tratará qual deles está sendo setado via sub-menu ou ordem
            );

            // 5. RESPOSTA (O deferReply já foi dado pelo interactionCreate)
            await interaction.editReply({
                embeds: [embed],
                components: [rowBase, rowReputation]
            });

        } catch (error) {
            console.error('[ERRO] Comando Config:', error);
            if (client.systems.logger) client.systems.logger.log('Command_Config', error);
            
            await interaction.editReply({ 
                content: `❌ Erro ao processar o painel de configuração.` 
            });
        }
    }
};