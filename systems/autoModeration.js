const cron = require('node-cron')
const db = require('../database/database')

module.exports = (client) => {

cron.schedule('0 3 * * *', async () => {

console.log("Verificação diária iniciada")

const now = Date.now()
const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30
const FIFTEEN_DAYS = 1000 * 60 * 60 * 24 * 15

const users = db.prepare(`SELECT * FROM users`).all()

for (const user of users) {

const member = await client.guilds.cache.first().members.fetch(user.user_id).catch(() => null)

if (!member) continue

const daysWithoutPenalty = now - user.last_penalty

// Jogador exemplar
if (daysWithoutPenalty >= THIRTY_DAYS) {

console.log(`${member.user.tag} elegível para exemplar`)

// Aqui futuramente adicionaremos o cargo

}

// verificar penalidades recentes

const penalties = db.prepare(`
SELECT COUNT(*) as total FROM penalties
WHERE user_id = ?
AND date > ?
`).get(user.user_id, now - FIFTEEN_DAYS)

if (penalties.total >= 5) {

console.log(`${member.user.tag} atingiu limite de penalidades`)

// Aqui futuramente adicionaremos cargo problemático

}

}

console.log("Verificação concluída")

})

}