require('dotenv').config()
const { REST, Routes } = require('discord.js')

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN)

async function clearGlobal() {
  try {

    console.log("🧹 Limpando comandos globais...")

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: [] }
    )

    console.log("✅ Comandos globais removidos.")

  } catch (error) {
    console.error(error)
  }
}

clearGlobal()
