// src/commands/utility/perfil.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/index');
const PlayerRegistrationSystem = require('../../systems/pot/playerRegistrationSystem');
const PlayerRegistry = require('../../systems/pot/potPlayerRegistry');
const ResponseManager = require('../../utils/responseManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('perfil')
        .setDescription('👤 Mostra o perfil de um usuário: Discord + vínculo com Path of Titans.')
        .addUserOption(opt => opt.setName('usuario')
            .setDescription('Usuário a consultar (padrão: você mesmo)')
            .setRequired(false))
        .addStringOption(opt => opt.setName('alderon_id')
            .setDescription('Buscar pelo Alderon ID em vez do usuário do Discord')
            .setRequired(false)),

    async execute(interaction, client) {
        const { guild, user } = interaction;
        const usuarioOpt = interaction.options.getUser('usuario');
        const alderonIdOpt = interaction.options.getString('alderon_id');

        db.ensureUser(user.id, user.username, user.discriminator, user.avatar);
        db.ensureGuild(guild.id, guild.name, guild.icon, guild.ownerId);

        if (usuarioOpt && alderonIdOpt) {
            return await ResponseManager.error(interaction, 'Use apenas uma opção por vez: `usuario` OU `alderon_id`.');
        }

        let targetUser = usuarioOpt || user;

        if (alderonIdOpt) {
            const linked = PlayerRegistry.getPlayerByAlderonId(alderonIdOpt.trim());
            if (!linked) {
                return await ResponseManager.error(interaction, `Nenhum jogador registrado com o Alderon ID \`${alderonIdOpt}\`.`);
            }
            const resolvedUser = await client.users.fetch(linked.user_id).catch(() => null);
            if (!resolvedUser) {
                return await ResponseManager.error(interaction, 'Esse Alderon ID está vinculado a uma conta do Discord que não foi encontrada.');
            }
            targetUser = resolvedUser;
        }

        const system = new PlayerRegistrationSystem(client);
        await system.sendProfile(interaction, targetUser);
    },
};
