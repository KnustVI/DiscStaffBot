// src/commands/developer/combat-config.js
/**
 * Ajusta a janela de inatividade do relatório de combate/dano (PoT) por
 * guild — restrito ao desenvolvedor do bot. Default é 5min (ver
 * DEFAULT_DAMAGE_BATCH_IDLE_MINUTES em gatewayServer.js) quando não houver
 * override configurado aqui.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../database/index');
const ConfigSystem = require('../../systems/core/configSystem');
const { AdvancedContainerBuilder, COLORS } = require('../../utils/containerBuilder');

const DEVELOPER_ID = '203676076189286412';
const SETTING_KEY = 'damage_batch_idle_minutes';
const DEFAULT_MINUTES = 5;

let EMOJIS = {};
try { EMOJIS = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('combat-config')
        .setDescription('🔒 Ajusta a janela de inatividade do relatório de combate/dano (restrito ao desenvolvedor)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('set')
            .setDescription('Define a janela de inatividade (minutos) pra um servidor')
            .addIntegerOption(opt => opt.setName('minutos').setDescription('Minutos sem novo golpe até fechar o relatório').setRequired(true).setMinValue(1).setMaxValue(60))
            .addStringOption(opt => opt.setName('servidor_id').setDescription('ID do servidor Discord').setRequired(true)))
        .addSubcommand(sub => sub
            .setName('check')
            .setDescription('Consulta a janela de inatividade configurada pra um servidor')
            .addStringOption(opt => opt.setName('servidor_id').setDescription('ID do servidor Discord').setRequired(true)))
        .addSubcommand(sub => sub
            .setName('reset')
            .setDescription('Remove o override e volta pro default (5min)')
            .addStringOption(opt => opt.setName('servidor_id').setDescription('ID do servidor Discord').setRequired(true))),

    // client aqui é sempre o bot PRINCIPAL (já em todo servidor de cliente),
    // não o bot developer que recebeu a interação — ver src/systems/core/
    // devBot.js. interaction.guild não existe (o comando roda no servidor
    // privado do dono, não no servidor alvo); servidor_id agora é sempre
    // obrigatório, sem fallback pro servidor onde o comando é rodado.
    async execute(interaction, client) {
        const { user } = interaction;

        if (user.id !== DEVELOPER_ID) {
            db.logActivity(null, user.id, 'combat_config_denied', null, { command: 'combat-config' });
            const denied = new AdvancedContainerBuilder({ accentColor: COLORS.ERROR })
                .text(`${EMOJIS.circlealert || '❌'} Este comando é restrito ao desenvolvedor do bot.`)
                .footer('Bot de Developer');
            const { components, flags } = denied.build();
            await interaction.editReply({ components, flags: [flags] });
            return;
        }

        const sub = interaction.options.getSubcommand();
        const servidorId = interaction.options.getString('servidor_id');
        const footerLabel = client.guilds.cache.get(servidorId)?.name || servidorId;

        let builder;

        if (sub === 'set') {
            const minutos = interaction.options.getInteger('minutos');
            ConfigSystem.setSetting(servidorId, SETTING_KEY, minutos.toString());
            db.logActivity(servidorId, user.id, 'combat_config_set', null, { minutos });
            builder = new AdvancedContainerBuilder({ accentColor: COLORS.SUCCESS })
                .text(`${EMOJIS.circlecheck || '✅'} Janela de inatividade do relatório de combate/dano ajustada.`)
                .text(`**Servidor:** \`${servidorId}\`\n**Nova janela:** ${minutos} minuto${minutos === 1 ? '' : 's'}`);
        } else if (sub === 'reset') {
            ConfigSystem.setSetting(servidorId, SETTING_KEY, null);
            db.logActivity(servidorId, user.id, 'combat_config_reset', null, {});
            builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT })
                .text(`${EMOJIS.refreshccw || '🔄'} Override removido — volta pro default.`)
                .text(`**Servidor:** \`${servidorId}\`\n**Janela atual:** ${DEFAULT_MINUTES} minutos (default)`);
        } else {
            const raw = ConfigSystem.getSetting(servidorId, SETTING_KEY);
            const minutos = parseInt(raw, 10);
            const effective = (Number.isFinite(minutos) && minutos > 0) ? minutos : DEFAULT_MINUTES;
            builder = new AdvancedContainerBuilder({ accentColor: COLORS.DEFAULT })
                .text(`${EMOJIS.clock || '🕐'} Janela de inatividade do relatório de combate/dano.`)
                .text(`**Servidor:** \`${servidorId}\`\n**Janela atual:** ${effective} minutos${raw ? '' : ' (default, sem override configurado)'}`);
        }

        builder.footer(footerLabel);
        const { components, flags } = builder.build();
        await interaction.editReply({ components, flags: [flags] });
    },
};
