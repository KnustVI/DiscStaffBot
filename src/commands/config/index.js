// src/commands/config/index.js
/**
 * /config — comando único pras 3 configurações do servidor (cargos, canais
 * de log, punições/reputação), antes 3 comandos separados
 * (config-roles/config-logs/config-punishments). Mesmo padrão de
 * src/commands/pot/index.js (/potserver): este arquivo só registra o
 * comando e despacha pro handler do subcomando; a lógica de verdade
 * continua em src/systems/core/configSystem.js, sem nenhuma mudança.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

let emojis = {};
try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('⚙️ Configurações do servidor (cargos, canais de log, punições).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('roles')
            .setDescription('🎭 Configura os cargos do sistema.'))
        .addSubcommand(sub => sub
            .setName('logs')
            .setDescription('📝 Configura os canais de log do sistema.'))
        .addSubcommand(sub => sub
            .setName('punishments')
            .setDescription('⚖️ Configura os níveis de punição e limites de reputação.'))
        .addSubcommand(sub => sub
            .setName('personalizar')
            .setDescription('🖼️ Personaliza banners de /strike, /unstrike e do report-chat (Caçador).'))
        .addSubcommand(sub => sub
            .setName('buffs')
            .setDescription('💉 Cria e edita buffs (presets de setattr em lote) (Caçador).'))
        .addSubcommand(sub => sub
            .setName('filtro')
            .setDescription('🚫 Filtro de palavras do chat em jogo -> punição automática (Caçador).')),

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();

        const rolesHandler = require('./roles');
        const logsHandler = require('./logs');
        const punishmentsHandler = require('./punishments');
        const personalizarHandler = require('./personalizar');
        const buffsHandler = require('./buffs');
        const filtroHandler = require('./filtro');

        switch (subcommand) {
            case 'roles':
                await rolesHandler.execute(interaction, client);
                break;
            case 'logs':
                await logsHandler.execute(interaction, client);
                break;
            case 'punishments':
                await punishmentsHandler.execute(interaction, client);
                break;
            case 'personalizar':
                await personalizarHandler.execute(interaction, client);
                break;
            case 'buffs':
                await buffsHandler.execute(interaction, client);
                break;
            case 'filtro':
                await filtroHandler.execute(interaction, client);
                break;
            default:
                await interaction.editReply({
                    content: `${emojis.circlealert || '❌'} Subcomando inválido.`,
                    flags: 64,
                });
        }
    },
};
