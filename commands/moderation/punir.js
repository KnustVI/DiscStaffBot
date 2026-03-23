const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { EMOJIS } = require('../../database/emojis');
const PunishmentSystem = require('../../systems/punishmentSystem');
const ConfigSystem = require('../../systems/configSystem');
const ErrorLogger = require('../../systems/errorLogger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('punir')
        .setDescription('Aplica uma punição e desconta pontos de reputação.')
        .addUserOption(opt => opt.setName('usuario').setDescription('O usuário que será punido').setRequired(true))
        .addIntegerOption(opt => opt.setName('gravidade').setDescription('Nível (1 a 5)').setRequired(true).addChoices(
            { name: 'Nível 1 (Leve)', value: 1 },
            { name: 'Nível 5 (Banimento)', value: 5 } // ... outros níveis aqui
        ))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo').setRequired(true))
        .addStringOption(opt => opt.setName('ticket').setDescription('Ticket (Opcional)')),

    async execute(interaction) {
        const { guild, options, member: mod } = interaction;
        
        // 1. Validação de Configuração e Permissão
        const staffRole = ConfigSystem.getSetting(guild.id, 'staff_role');
        const logChanId = ConfigSystem.getSetting(guild.id, 'logs_channel');

        if (!staffRole || !logChanId) return interaction.reply({ content: `${EMOJIS.ERRO} Bot não configurado.`, ephemeral: true });
        if (!mod.roles.cache.has(staffRole) && !mod.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: `${EMOJIS.ERRO} Sem permissão.`, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const targetUser = options.getUser('usuario');
            const severity = options.getInteger('gravidade');
            const reason = options.getString('motivo');
            const ticketId = options.getString('ticket') || 'N/A';

            // 2. Executa a Punição
            await PunishmentSystem.applyPunishment(guild.id, targetUser.id, interaction.user.id, reason, severity);

            // 3. Busca dados finais e gera a Embed Universal
            const history = await PunishmentSystem.getUserHistory(guild.id, targetUser.id);
            const embed = PunishmentSystem.generatePunishmentEmbed({
                id: history.punishments[0]?.id,
                targetUser,
                severity,
                reputation: history.reputation,
                ticketId,
                reason
            });

            // 4. Despacha para Log e DM
            await PunishmentSystem.dispatch(guild, embed, targetUser, logChanId);

            await interaction.editReply(`${EMOJIS.CHECK} Punição aplicada e enviada aos canais responsáveis.`);
                
        } catch (err) {    
        ErrorLogger.log('Command_Punir', err); // <--- Identifica que o erro foi no comando
        return interaction.editReply(`${EMOJIS.ERRO} Erro interno ao processar a punição.`);
        }
    }
};