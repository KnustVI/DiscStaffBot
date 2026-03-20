const { google } = require('googleapis');
const db = require('../database/database'); // Ajuste o caminho do seu banco
const path = require('path');

async function exportToSheets(guildId) {
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, '../credentials.json'), // O arquivo do Passo 2
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = '1thokm4usZsHWH5P4dmlVFxnoYV5oUIDx3vmLGFocDyc'; // O ID do Passo 3

    // Busca os dados do seu SQLite
    const rows = db.prepare(`SELECT * FROM punishments WHERE guild_id = ?`).all(guildId);

    // Formata os dados para o Google
    const values = [
        ["ID", "Data", "Usuário ID", "Staff ID", "Gravidade", "Motivo"],
        ...rows.map(r => [r.id, new Date(r.created_at).toLocaleString('pt-BR'), r.user_id, r.moderator_id, r.severity, r.reason])
    ];

    // Envia para a planilha
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Página1!A1',
        valueInputOption: 'RAW',
        resource: { values },
    });
}

module.exports = { exportToSheets };