// src/commands/pot/config-potserver.js (versão simplificada)
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getInstance } = require('../../integrations/pathoftitans');
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
            .addIntegerOption(opt => opt.setName('port').setDescription('Porta RCON (padrão: 27015)'))
        )
        .addSubcommand(sub => sub
            .setName('token')
            .setDescription('🔑 Mostra o token para colocar no Game.ini')
        )
        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('Verifica status')
        )
        .addSubcommand(sub => sub
            .setName('revoke')
            .setDescription('🚫 Revoga o token atual')
        ),

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();
        const potIntegration = getInstance(client);

        if (subcommand === 'set') {
            await interaction.deferReply({ flags: 64 });
            
            const ip = interaction.options.getString('ip');
            const password = interaction.options.getString('password');
            const port = interaction.options.getInteger('port') || 27015;
            
            const config = {
                enabled: true,
                server_ip: ip,
                rcon_password: password,
                rcon_port: port
            };
            
            // Salvar config
            const db = require('../../database/index');
            const stmt = db.prepare(`
                INSERT INTO settings (guild_id, key, value, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            `);
            stmt.run(interaction.guildId, 'pot_server_config', JSON.stringify(config), Date.now());
            
            // Gerar token se não existir
            let token = PoTTokenManager.getToken(interaction.guildId);
            if (!token) {
                token = PoTTokenManager.generateToken(interaction.guildId);
            }
            
            const success = await potIntegration.initializeForGuild(interaction.guildId, config);
            
            const embed = new EmbedBuilder()
                .setColor(success ? 0x00FF00 : 0xFFA500)
                .setTitle('🎮 Path of Titans - Configuração')
                .addFields(
                    { name: '📡 IP', value: ip, inline: true },
                    { name: '🔌 Porta RCON', value: port.toString(), inline: true },
                    { name: '🔄 Status', value: success ? '✅ OK' : '⚠️ Offline', inline: true }
                )
                .setFooter({ text: 'Use /config-potserver token para ver o token' })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            
        } else if (subcommand === 'token') {
            await interaction.deferReply({ flags: 64 });
            
            let token = PoTTokenManager.getToken(interaction.guildId);
            if (!token) {
                token = PoTTokenManager.generateToken(interaction.guildId);
            }
            
            const publicUrl = process.env.POT_GATEWAY_URL || 'https://SEU_DOMINIO_AQUI:8080';
            
            const embed = new EmbedBuilder()
                .setColor(0x00AAFF)
                .setTitle('🔑 Token do Servidor')
                .setDescription(`\`\`\`\n${token}\n\`\`\``)
                .addFields(
                    { name: '📋 URLs para o Game.ini', value: 'Copie as linhas abaixo para seu `Game.ini`:' },
                    { name: 'Exemplo', value: '```ini\n[ServerWebhooks]\nbEnabled=true\nFormat="General"\nPlayerLogin="' + publicUrl + '/login?token=' + token + '"\nPlayerKilled="' + publicUrl + '/killed?token=' + token + '"\nPlayerChat="' + publicUrl + '/chat?token=' + token + '"\n```', inline: false }
                )
                .setFooter({ text: '⚠️ Mantenha este token em segredo!' })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            
        } else if (subcommand === 'status') {
            await interaction.deferReply();
            
            const stats = potIntegration.getStats();
            const token = PoTTokenManager.getToken(interaction.guildId);
            const tokenStats = PoTTokenManager.getTokenStats(interaction.guildId);
            
            const embed = new EmbedBuilder()
                .setColor(0x00AAFF)
                .setTitle('🎮 Status da Integração')
                .addFields(
                    { name: '🔒 Gateway', value: stats.gatewayRunning ? '✅ Rodando' : '❌ Parado', inline: true },
                    { name: '🔑 Token', value: token ? '✅ Ativo' : '❌ Não gerado', inline: true },
                    { name: '📊 Usos do Token', value: `${tokenStats.usage_count || 0} requisições`, inline: true }
                )
                .setTimestamp();
            
            if (tokenStats.last_used) {
                embed.addFields({ name: '🕐 Último uso', value: `<t:${Math.floor(tokenStats.last_used / 1000)}:R>`, inline: true });
            }
            
            await interaction.editReply({ embeds: [embed] });
            
        } else if (subcommand === 'revoke') {
            await interaction.deferReply({ flags: 64 });
            
            PoTTokenManager.revokeToken(interaction.guildId);
            const newToken = PoTTokenManager.generateToken(interaction.guildId);
            
            await interaction.editReply({ 
                content: `✅ Token revogado. Novo token gerado: \`${newToken}\`\nAtualize seu Game.ini com o novo token.`
            });
        }
    }
};