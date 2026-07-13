// src/commands/strike/index.js
/**
 * /strike — comando único com 3 subcomandos, cada um com um propósito
 * diferente (ver PunishmentSystem em src/systems/moderation/):
 *   - registro:      registro simples de punição (sem nível, sem ação em
 *                     jogo/Discord) — disponível em QUALQUER tier, incluindo Free.
 *   - ingame:        pune só pelo Alderon ID, usando um nível (ação em jogo via RCON).
 *   - personalizado: modo manual completo, restrito ao cargo Supervisor.
 * Só ingame/personalizado aplicam ações automáticas (RCON/Discord) — ambos
 * dependem de níveis (Rastreador+). Um /strike "bare" (sem nenhum
 * subcomando) não é possível — a API do Discord não permite misturar
 * opções de topo com subcomandos no mesmo comando, e como ingame/
 * personalizado já são subcomandos, "registro" também precisa ser (daí o
 * nome "registro", não "strike" — evita a redundância de "/strike strike").
 * Mesmo padrão de src/commands/config/index.js (/config): este arquivo só
 * registra o comando e despacha pro subcomando; a lógica de verdade vive em
 * cada arquivo irmão e em src/systems/moderation/punishmentSystem.js.
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

let emojis = {};
try { emojis = require('../../database/emojis.js').EMOJIS || {}; } catch (err) {}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('strike')
        .setDescription('⚖️ Aplica uma punição a um jogador.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommand(sub => sub
            .setName('registro')
            .setDescription('Apenas registro de punição, não aplica ação em jogo ou discord.')
            .addUserOption(opt => opt.setName('usuario').setDescription('Membro infrator').setRequired(true))
            .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da punição').setRequired(true))
            .addStringOption(opt => opt.setName('duracao').setDescription('Tempo (Ex: 10m, 1h, 3d — vazio/0 = permanente)').setRequired(false))
            .addStringOption(opt => opt.setName('report').setDescription('ID do Report (Opcional)').setRequired(false)))
        .addSubcommand(sub => sub
            .setName('ingame')
            .setDescription('Pune um jogador pelo Alderon ID (ação em jogo via RCON).')
            .addStringOption(opt => opt.setName('alderon_id').setDescription('Alderon ID do jogador').setRequired(true))
            .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da punição (mostrado ao jogador banido/mutado no jogo)').setRequired(true))
            .addStringOption(opt => opt.setName('report').setDescription('ID do Report (Opcional)').setRequired(false)))
        .addSubcommand(sub => sub
            .setName('personalizado')
            .setDescription('[Supervisor] Punição manual completa, com controle total sobre ações.')
            .addUserOption(opt => opt.setName('usuario').setDescription('Membro infrator').setRequired(true))
            .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da punição').setRequired(true))
            .addStringOption(opt => opt.setName('agid').setDescription('Alderon ID do jogador, se ele não estiver vinculado (/registrar) — necessário pra ação em jogo').setRequired(false))
            .addStringOption(opt => opt.setName('duracao').setDescription('Tempo (sobrescreve a duração do nível)').setRequired(false))
            .addStringOption(opt => opt.setName('discord_act').setDescription('Ação imediata no Discord')
                .addChoices(
                    { name: 'Nenhuma', value: 'none' },
                    { name: 'Mute (Timeout)', value: 'timeout' },
                    { name: 'Expulsar (Kick)', value: 'kick' },
                    { name: 'Banir (Ban)', value: 'ban' },
                ))
            .addStringOption(opt => opt.setName('jogo_act').setDescription('Ação imediata In-Game (sobrescreve a ação do nível)')
                .addChoices(
                    { name: 'Nenhuma', value: 'none' },
                    { name: 'Mensagem no Sistema', value: 'SystemMessage' },
                    { name: 'Kick do Jogo', value: 'Kick' },
                    { name: 'Ban do Jogo', value: 'Ban' },
                    { name: 'Mute do Jogo (ServerMute)', value: 'ServerMute' },
                ))
            .addStringOption(opt => opt.setName('report').setDescription('ID do Report (Opcional)').setRequired(false))),

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();

        const registroHandler = require('./registro');
        const ingameHandler = require('./ingame');
        const personalizadoHandler = require('./personalizado');

        switch (subcommand) {
            case 'registro':
                await registroHandler.execute(interaction, client);
                break;
            case 'ingame':
                await ingameHandler.execute(interaction, client);
                break;
            case 'personalizado':
                await personalizadoHandler.execute(interaction, client);
                break;
            default:
                await interaction.editReply({
                    content: `${emojis.circlealert || '❌'} Subcomando inválido.`,
                    flags: 64,
                });
        }
    },
};
