// src/commands/config/index.js
/**
 * /config — comando único pras 3 configurações do servidor (cargos, canais
 * de log, punições/reputação), antes 3 comandos separados
 * (config-roles/config-logs/config-punishments). Mesmo padrão de
 * src/commands/pot/index.js (/potserver): este arquivo só registra o
 * comando e despacha pro handler do subcomando; a lógica de verdade
 * continua em src/systems/core/configSystem.js, sem nenhuma mudança.
 */
const { SlashCommandBuilder } = require('discord.js');

let emojis = {};
try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('⚙️ Configurações do servidor (cargos, canais de log, punições).')
        // null, não Administrator — mesmo raciocínio do /strike (ver
        // comentário completo em strike/index.js): default nativo bloqueava
        // quem tem só o cargo Administrativo do Dashboard (ver /config
        // geral do servidor, "Game Server") sem Administrator de verdade,
        // ANTES da interação sequer chegar no bot. Cada subcomando já checa
        // ConfigSystem.memberIsGuildAdmin no próprio execute() (roles.js/
        // logs.js/punishments.js/personalizar.js/buffs.js/filtro.js).
        .setDefaultMemberPermissions(null)
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
            .setDescription('🖼️ Personaliza banners de /strike, /unstrike e do report-chat (Caçador).')
            .addAttachmentOption(opt => opt.setName('banner_strike')
                .setDescription('[Caçador] Envie sua própria imagem pro banner do /strike (em vez de escolher do menu).')
                .setRequired(false))
            .addAttachmentOption(opt => opt.setName('banner_unstrike')
                .setDescription('[Caçador] Envie sua própria imagem pro banner do /unstrike (em vez de escolher do menu).')
                .setRequired(false))
            .addAttachmentOption(opt => opt.setName('banner_reportchat')
                .setDescription('[Caçador] Envie sua própria imagem pro banner do report-chat (em vez de escolher do menu).')
                .setRequired(false)))
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
