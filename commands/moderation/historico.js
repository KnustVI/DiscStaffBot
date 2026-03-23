const { SlashCommandBuilder } = require('discord.js');
const PunishmentSystem = require('../../systems/punishmentSystem');
const ErrorLogger = require('../../systems/errorLogger');
const { EMOJIS } = require('../../database/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('historico')
        .setDescription('Consulta a reputação e punições de um usuário.')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a consultar').setRequired(true)),

    async execute(interaction) {
        const target = interaction.options.getUser('usuario');
        const guildId = interaction.guild.id;

        // 1. Sinaliza ao Discord que estamos processando (Evita o erro de 3s)
        await interaction.deferReply({ ephemeral: true });

        try {
            // 2. Busca os dados usando o Motor do PunishmentSystem (Página 1)
            const history = await PunishmentSystem.getUserHistory(guildId, target.id, 1);
            
            // 3. Gera a Embed e os Botões usando os Helpers
            const embed = PunishmentSystem.generateHistoryEmbed(target, history, 1);
            const buttons = PunishmentSystem.generateHistoryButtons(target.id, 1, history.totalPages);

            // 4. Edita a resposta inicial com os dados carregados
            await interaction.editReply({ 
                embeds: [embed], 
                components: buttons ? [buttons] : [] 
            });

        } catch (err) {
            // Log de Sistema caso o SQLite ou o Motor falhem
            ErrorLogger.log('Command_Historico_Clean', err);
            
            await interaction.editReply({ 
                content: `${EMOJIS.ERRO} Falha ao carregar o histórico. Tente novamente.` 
            });
        }
    }
};