const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

let emojis = {};
try {
    emojis = require('../../database/emojis.js').EMOJIS || {};
} catch (err) {
    emojis = {};
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('potserver')
        .setDescription('🎮 Gerenciamento do servidor Path of Titans')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('⚙️ Configura o servidor Path of Titans')
            .addStringOption(opt => opt
                .setName('ip')
                .setDescription('IP do servidor (ex: 192.168.1.100)')
                .setRequired(true)
            )
            .addStringOption(opt => opt
                .setName('rcon_password')
                .setDescription('Senha RCON do servidor')
                .setRequired(true)
            )
            .addIntegerOption(opt => opt
                .setName('rcon_port')
                .setDescription('Porta RCON do servidor')
                .setRequired(true)
            )
            .addStringOption(opt => opt
                .setName('nome')
                .setDescription('Nome do servidor de jogo (ex: Atlas Brasil)')
                .setRequired(false)
            )
        )
        .addSubcommand(sub => sub
            .setName('logs')
            .setDescription('📋 Gerencia os webhooks/logs do servidor')
        )
        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('📊 Status da integração com o servidor')
        )
        .addSubcommand(sub => sub
            .setName('reset')
            .setDescription('🔄 Reseta configurações do servidor')
            .addStringOption(opt => opt
                .setName('scope')
                .setDescription('O que resetar')
                .setRequired(true)
                .addChoices(
                    { name: '🖥️ Configuração do Servidor', value: 'server' },
                    { name: '📨 Webhooks/Logs', value: 'logs' },
                    { name: '🗑️ Tudo (Configuração + Webhooks)', value: 'all' }
                )
            )
        ),
    
    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();
        
        // Importar os handlers de cada subcomando
        const setupHandler = require('./setup');
        const logsHandler = require('./logs');
        const statusHandler = require('./status');
        const resetHandler = require('./reset');
        
        switch(subcommand) {
            case 'setup':
                await setupHandler.execute(interaction, client);
                break;
            case 'logs':
                await logsHandler.execute(interaction, client);
                break;
            case 'status':
                await statusHandler.execute(interaction, client);
                break;
            case 'reset':
                await resetHandler.execute(interaction, client);
                break;
            default:
                await interaction.editReply({
                    content: `${emojis.circlealert || '❌'} Subcomando inválido.`,
                    flags: 64
                });
        }
    }
};