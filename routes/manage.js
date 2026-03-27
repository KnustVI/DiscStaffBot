const express = require('express');
const router = express.Router();
const db = require('../database'); // Puxa o seu arquivo de banco

// Página de Configurações
router.get('/:guildID', (req, res) => {
    const { guildID } = req.params;
    
    // Busca as chaves no SQLite
    const rows = db.prepare("SELECT key, value FROM settings WHERE guild_id = ?").all(guildID);
    const config = {};
    rows.forEach(row => { config[row.key] = row.value; });

    res.render('manage', {
        guildID,
        config,
        user: req.user // Assume que você terá um sistema de login
    });
});

// Ação de Salvar
router.post('/:guildID', (req, res) => {
    const { guildID } = req.params;
    const data = req.body;

    const saveSetting = db.prepare(`
        INSERT INTO settings (guild_id, key, value) 
        VALUES (?, ?, ?) 
        ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value
    `);

    // Salva tudo de uma vez
    const transaction = db.transaction((settings) => {
        for (const [key, value] of Object.entries(settings)) {
            saveSetting.run(guildID, key, value);
        }
    });

    transaction(data);
    res.redirect(`/manage/${guildID}?success=true`);
});

module.exports = router;