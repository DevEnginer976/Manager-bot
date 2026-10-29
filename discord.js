import { Client, GatewayIntentBits, Partials } from "discord.js";

export const clients = new Map();

export async function connectBot(id, token) {
  const old = clients.get(id);
  if (old) { try { old.destroy(); } catch {} clients.delete(id); }
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
  });
  await client.login(token);
  clients.set(id, client);
  client.on("error", err => console.error("Discord client error:", err.message));
  return client;
}
export function disconnectBot(id) {
  const client = clients.get(id);
  if (client) { client.destroy(); clients.delete(id); }
}
