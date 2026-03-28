const express = require('express');
const router = express.Router();
const db = require('../database/database'); // Certifique-se que o caminho está correto

// Página de Configurações
router.get('/:guildID', async (req, res) => {
    const { guildID } = req.params;
    
    // 1. Verificação de Segurança (Cache do Bot)
    // Usamos o req.client (se você passou o client pelo middleware) ou o client global
    const guild = req.client ? req.client.guilds.cache.get(guildID) : null;
    
    // 2. Busca o Membro (Para pegar Nickname e Cargo para a Sidebar)
    let nickname = req.user.username;
    let role = "Membro";
    
    if (guild) {
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (member) {
            nickname = member.displayName;
            role = member.roles.highest.name;
        }
    }

    // 3. Busca Reputation e Level (Para a Sidebar não quebrar)
    const userData = db.prepare("SELECT reputation, level FROM users WHERE id = ?").get(req.user.id) || { reputation: 100, level: 1 };

    // 4. Busca as configurações do Servidor (Para os Inputs)
    const rows = db.prepare("SELECT key, value FROM settings WHERE guild_id = ?").all(guildID) || [];
    const config = {};
    rows.forEach(row => { config[row.key] = row.value; });

    // RENDERIZAÇÃO COM TODAS AS VARIÁVEIS NECESSÁRIAS
    res.render('manage', {
        guildID, 
        guild: guild, 
        config, 
        user: req.user,
        nickname: nickname,
        role: role,         
        reputation: userData.reputation, 
        level: userData.level,           
        bot: req.client,
        query: req.query
    });
});

// Ação de Salvar (POST)
router.post('/:guildID/save', (req, res) => {
    const { guildID } = req.params;
    const data = req.body;

    try {
        const saveSetting = db.prepare(`
            INSERT INTO settings (guild_id, key, value) 
            VALUES (?, ?, ?) 
            ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
        `);

        const transaction = db.transaction((settings) => {
            for (const [key, value] of Object.entries(settings)) {
                if (value !== undefined) {
                    saveSetting.run(guildID, key, value.toString());
                }
            }
        });

        transaction(data);
        res.redirect(`/manage/${guildID}?success=true`);
    } catch (err) {
        console.error("Erro ao salvar:", err);
        res.redirect(`/manage/${guildID}?error=true`);
    }
});

module.exports = router;