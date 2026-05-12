// src/commands/pot/config-potserver.js
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getInstance } = require('../../integrations/pathoftitans');
const PoTConfigSystem = require('../../systems/potConfigSystem');
const PoTTokenManager = require('../../integrations/pathoftitans/tokenManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config-potserver')
        .setDescription('🎮 Configura servidor Path of Titans')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('set')
            .setDescription('Configura IP e senha RCON')
            .addStringOption(opt => opt.setName('ip').setDescription('IP do servidor').setRequired(true))
            .addStringOption(opt => opt.setName('password').setDescription('Senha RCON').setRequired(true))
            .addIntegerOption(opt => opt.setName('port').setDescription('Porta RCON (padrão: 27015)')))
        .addSubcommand(sub => sub
            .setName('token')
            .setDescription('🔑 Mostra o token para colocar no Game.ini'))
        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('Verifica status'))
        .addSubcommand(sub => sub
            .setName('revoke')
            .setDescription('🚫 Revoga o token atual')),

    async execute(interaction, client) {
        const sub = interaction.options.getSubcommand();
        const potIntegration = getInstance(client);

        // SET - Configurar servidor
        if (sub === 'set') {
            const ip = interaction.options.getString('ip');
            const password = interaction.options.getString('password');
            const port = interaction.options.getInteger('port') || 27015;
            
            const config = { enabled: true, server_ip: ip, rcon_password: password, rcon_port: port, configured_at: Date.now(), configured_by: interaction.user.id };
            
            PoTConfigSystem.setServerConfig(interaction.guildId, config, interaction.user.id);
            
            let token = PoTTokenManager.getToken(interaction.guildId);
            if (!token) token = PoTTokenManager.generateToken(interaction.guildId);
            
            const success = await potIntegration.initializeForGuild(interaction.guildId, config);
            
            const embed = new EmbedBuilder()
                .setColor(success ? 0x00FF00 : 0xFFA500)
                .setTitle('🎮 Path of Titans - Configuração')
                .addFields(
                    { name: '📡 IP', value: ip, inline: true },
                    { name: '🔌 Porta RCON', value: port.toString(), inline: true },
                    { name: '🔄 Status', value: success ? '✅ OK' : '⚠️ Offline', inline: true },
                    { name: '🔑 Token', value: `\`${token.substring(0, 20)}...\``, inline: true }
                )
                .setFooter({ text: `Use /config-potserver token para ver o token completo` })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
        }
        
        // TOKEN - Mostrar token
        else if (sub === 'token') {
            let token = PoTTokenManager.getToken(interaction.guildId);
            if (!token) token = PoTTokenManager.generateToken(interaction.guildId);
            
            const publicUrl = process.env.POT_GATEWAY_URL || 'http://localhost:8080';
            
            const embed = new EmbedBuilder()
                .setColor(0x00AAFF)
                .setTitle('🔑 Token do Servidor')
                .setDescription(`\`\`\`\n${token}\n\`\`\``)
                .addFields({
                    name: '📋 URLs para o Game.ini',
                    value: '```ini\n[ServerWebhooks]\nbEnabled=true\nFormat="General"\nPlayerLogin="' + publicUrl + '/login?token=' + token + '"\nPlayerKilled="' + publicUrl + '/killed?token=' + token + '"\nPlayerChat="' + publicUrl + '/chat?token=' + token + '"\n```',
                    inline: false
                })
                .setFooter({ text: '⚠️ Mantenha este token em segredo!' })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
        }
        
        // STATUS - Verificar status
        else if (sub === 'status') {
            const stats = potIntegration.getStats();
            const token = PoTTokenManager.getToken(interaction.guildId);
            const tokenStats = PoTTokenManager.getTokenStats(interaction.guildId);
            
            const embed = new EmbedBuilder()
                .setColor(0x00AAFF)
                .setTitle('🎮 Status da Integração')
                .addFields(
                    { name: '🔒 Gateway', value: stats.gatewayRunning ? '✅ Rodando' : '❌ Parado', inline: true },
                    { name: '🔑 Token', value: token ? '✅ Ativo' : '❌ Não gerado', inline: true },
                    { name: '📊 Usos', value: `${tokenStats.usage_count || 0} requisições`, inline: true }
                )
                .setTimestamp();
            
            if (tokenStats.last_used) {
                embed.addFields({ name: '🕐 Último uso', value: `<t:${Math.floor(tokenStats.last_used / 1000)}:R>`, inline: true });
            }
            
            await interaction.editReply({ embeds: [embed] });
        }
        
        // REVOKE - Revogar token
        else if (sub === 'revoke') {
            const token = PoTTokenManager.getToken(interaction.guildId);
            if (!token) return await interaction.editReply({ content: '❌ Nenhum token ativo para revogar.' });
            
            PoTTokenManager.revokeToken(interaction.guildId);
            const newToken = PoTTokenManager.generateToken(interaction.guildId);
            
            await interaction.editReply({ 
                content: `✅ Token revogado. Novo token: \`${newToken}\`\nAtualize seu Game.ini.`
            });
        }
    }
};