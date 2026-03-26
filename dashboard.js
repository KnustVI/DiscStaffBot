const express = require('express');
const app = express();
const path = require('path');

function loadDashboard(client) {
    // Configura o motor de visualização (HTML dinâmico)
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    // Rota Principal: O que aparece quando você entra no site
    app.get('/', (req, res) => {
        res.render('index', { 
            botName: client.user.username,
            serverCount: client.guilds.cache.size,
            userCount: client.users.cache.size
        });
    });

    // Porta onde o site vai rodar (3000 é o padrão)
    app.listen(3000, () => {
        console.log("✅ Dashboard online em: http://localhost:3000");
    });
}

module.exports = loadDashboard;