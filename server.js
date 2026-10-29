import "dotenv/config";
import express from "express";
import session from "express-session";
import SQLiteStoreFactory from "connect-sqlite3";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { PermissionsBitField, ChannelType } from "discord.js";
import { db } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import { clients, connectBot, disconnectBot } from "./discord.js";

const required = ["DISCORD_CLIENT_ID","DISCORD_CLIENT_SECRET","DISCORD_REDIRECT_URI","SESSION_SECRET","MASTER_ENCRYPTION_KEY"];
for (const name of required) if (!process.env[name]) {
  console.error(`Missing ${name}. Copy .env.example to .env and configure it.`);
  process.exit(1);
}
const app = express();
const SQLiteStore = SQLiteStoreFactory(session);
const isProd = process.env.NODE_ENV === "production";
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: "./data" }),
  secret: process.env.SESSION_SECRET,
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: isProd, maxAge: 8 * 60 * 60 * 1000 }
}));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: true, legacyHeaders: false }));
app.use(express.static("public"));

const oauthUrl = () => {
  const u = new URL("https://discord.com/oauth2/authorize");
  u.search = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds"
  });
  return u.toString();
};
app.get("/auth/login", (req,res) => {
  const state = crypto.randomBytes(24).toString("hex");
  req.session.oauthState = state;
  const u = new URL(oauthUrl()); u.searchParams.set("state", state);
  res.redirect(u.toString());
});
app.get("/auth/callback", async (req,res) => {
  try {
    if (!req.query.code || !req.query.state || req.query.state !== req.session.oauthState) return res.status(400).send("OAuth state invalid.");
    delete req.session.oauthState;
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({
        client_id:process.env.DISCORD_CLIENT_ID,
        client_secret:process.env.DISCORD_CLIENT_SECRET,
        grant_type:"authorization_code", code:String(req.query.code),
        redirect_uri:process.env.DISCORD_REDIRECT_URI
      })
    });
    const token = await tokenRes.json();
    if (!token.access_token) return res.status(401).send("Discord OAuth failed.");
    const userRes = await fetch("https://discord.com/api/users/@me", {headers:{Authorization:`Bearer ${token.access_token}`}});
    const user = await userRes.json();
    if (!user.id) return res.status(401).send("Could not identify Discord user.");
    req.session.user = { id:user.id, username:user.username, avatar:user.avatar, accessToken:token.access_token };
    res.redirect("/");
  } catch (e) { console.error(e); res.status(500).send("Login error."); }
});
app.post("/auth/logout", (req,res) => req.session.destroy(() => res.json({ok:true})));

function auth(req,res,next) {
  if (!req.session.user) return res.status(401).json({error:"Sign in with Discord first."});
  next();
}
function ownedBot(req,res,next) {
  const row = db.prepare("SELECT * FROM bots WHERE id=? AND owner_id=?").get(req.params.botId, req.session.user.id);
  if (!row) return res.status(404).json({error:"Bot not found."});
  req.botRow = row;
  req.client = clients.get(row.id);
  if (!req.client?.isReady()) return res.status(503).json({error:"Bot is disconnected. Reconnect it from the dashboard."});
  next();
}
async function guildAccess(req,res,next) {
  try {
    const guild = req.client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({error:"This bot is not in that server."});
    const r = await fetch("https://discord.com/api/users/@me/guilds", {
      headers:{Authorization:`Bearer ${req.session.user.accessToken}`}
    });
    const myGuilds = await r.json();
    const mine = Array.isArray(myGuilds) && myGuilds.find(g => g.id === req.params.guildId);
    if (!mine) return res.status(403).json({error:"Your Discord account is not a member of this server."});
    const p = BigInt(mine.permissions || "0");
    if (!(p & PermissionsBitField.Flags.Administrator) && !(p & PermissionsBitField.Flags.ManageGuild))
      return res.status(403).json({error:"You need Manage Server or Administrator permission."});
    req.guild = guild;
    next();
  } catch (e) { console.error(e); res.status(500).json({error:"Could not verify server permissions."}); }
}
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

app.get("/api/me", (req,res) => res.json({user:req.session.user ? {id:req.session.user.id,username:req.session.user.username,avatar:req.session.user.avatar} : null, loginUrl:"/auth/login"}));
app.get("/api/bots", auth, (req,res) => {
  const rows = db.prepare("SELECT id,label,application_id,created_at FROM bots WHERE owner_id=? ORDER BY created_at DESC").all(req.session.user.id);
  res.json(rows.map(b => ({...b, connected:!!clients.get(b.id)?.isReady(), username:clients.get(b.id)?.user?.tag || null})));
});
app.post("/api/bots", auth, wrap(async (req,res) => {
  const {label, token} = req.body || {};
  if (typeof token !== "string" || token.length < 40 || token.length > 200) return res.status(400).json({error:"Enter a valid bot token."});
  const id = crypto.randomUUID();
  let client;
  try { client = await connectBot(id, token); }
  catch { disconnectBot(id); return res.status(400).json({error:"Discord rejected this token or the bot could not connect. Check the token and bot status."}); }
  const appId = client.application?.id || client.user.id;
  const enc = encrypt(token);
  db.prepare("INSERT INTO bots(id,owner_id,label,application_id,token_enc,token_iv,token_tag,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(id, req.session.user.id, String(label || client.user.username).slice(0,60), appId, enc.data, enc.iv, enc.tag, new Date().toISOString());
  res.json({ok:true,id,username:client.user.tag});
}));
app.delete("/api/bots/:botId", auth, (req,res) => {
  const row = db.prepare("SELECT id FROM bots WHERE id=? AND owner_id=?").get(req.params.botId,req.session.user.id);
  if (!row) return res.status(404).json({error:"Bot not found."});
  disconnectBot(row.id); db.prepare("DELETE FROM bots WHERE id=?").run(row.id); res.json({ok:true});
});
app.post("/api/bots/:botId/reconnect", auth, wrap(async (req,res) => {
  const row = db.prepare("SELECT * FROM bots WHERE id=? AND owner_id=?").get(req.params.botId,req.session.user.id);
  if (!row) return res.status(404).json({error:"Bot not found."});
  const client = await connectBot(row.id,decrypt(row));
  res.json({ok:true,username:client.user.tag});
}));
app.get("/api/bots/:botId/guilds", auth, ownedBot, (req,res) => {
  res.json([...req.client.guilds.cache.values()].map(g=>({id:g.id,name:g.name,icon:g.iconURL({size:64}),memberCount:g.memberCount})));
});
app.get("/api/bots/:botId/guilds/:guildId", auth, ownedBot, guildAccess, (req,res) => {
  const me = req.guild.members.me;
  res.json({
    id:req.guild.id,name:req.guild.name,icon:req.guild.iconURL({size:128}),
    memberCount:req.guild.memberCount,
    botPermissions:me?.permissions.toArray() || [],
    channels:req.guild.channels.cache.filter(c=>[ChannelType.GuildText,ChannelType.GuildAnnouncement,ChannelType.GuildVoice].includes(c.type)).map(c=>({id:c.id,name:c.name,type:c.type})),
    roles:req.guild.roles.cache.filter(r=>r.id!==req.guild.id).map(r=>({id:r.id,name:r.name,color:r.hexColor,position:r.position}))
  });
});
app.get("/api/bots/:botId/guilds/:guildId/members", auth, ownedBot, guildAccess, wrap(async(req,res)=>{
  const members=await req.guild.members.fetch({limit:100});
  res.json([...members.values()].map(m=>({id:m.id,username:m.user.username,tag:m.user.tag,avatar:m.user.displayAvatarURL({size:64}),bot:m.user.bot,nickname:m.nickname})));
}));
app.post("/api/bots/:botId/guilds/:guildId/messages", auth, ownedBot, guildAccess, wrap(async(req,res)=>{
  const {channelId,content}=req.body||{};
  if(typeof content!=="string"||!content.trim()||content.length>2000) return res.status(400).json({error:"Message must contain 1–2000 characters."});
  const channel=await req.guild.channels.fetch(channelId);
  if(!channel?.isTextBased()||!channel.send) return res.status(400).json({error:"Choose a text channel."});
  const me=req.guild.members.me;
  if(!me || !channel.permissionsFor(me).has(PermissionsBitField.Flags.SendMessages)) return res.status(403).json({error:"Bot lacks Send Messages permission in this channel."});
  const msg=await channel.send({content});
  res.json({ok:true,messageId:msg.id});
}));
app.post("/api/bots/:botId/guilds/:guildId/ban", auth, ownedBot, guildAccess, wrap(async(req,res)=>{
  const {userId,reason}=req.body||{};
  if(!/^\d{17,20}$/.test(String(userId||""))) return res.status(400).json({error:"Invalid Discord user ID."});
  const me=req.guild.members.me;
  if(!me?.permissions.has(PermissionsBitField.Flags.BanMembers)) return res.status(403).json({error:"Bot needs Ban Members permission."});
  const target=await req.guild.members.fetch(userId).catch(()=>null);
  if(target && (target.id===req.client.user.id || target.roles.highest.position>=me.roles.highest.position))
    return res.status(400).json({error:"The bot cannot ban itself or a member with an equal/higher role."});
  await req.guild.members.ban(userId,{reason:String(reason||"Action from Bot Manager").slice(0,480)});
  res.json({ok:true});
}));
app.post("/api/bots/:botId/guilds/:guildId/kick", auth, ownedBot, guildAccess, wrap(async(req,res)=>{
  const {userId,reason}=req.body||{};
  if(!/^\d{17,20}$/.test(String(userId||""))) return res.status(400).json({error:"Invalid Discord user ID."});
  const me=req.guild.members.me;
  if(!me?.permissions.has(PermissionsBitField.Flags.KickMembers)) return res.status(403).json({error:"Bot needs Kick Members permission."});
  const target=await req.guild.members.fetch(userId);
  if(target.id===req.client.user.id || target.roles.highest.position>=me.roles.highest.position) return res.status(400).json({error:"Role hierarchy prevents this action."});
  await target.kick(String(reason||"Action from Bot Manager").slice(0,480)); res.json({ok:true});
}));
app.post("/api/bots/:botId/guilds/:guildId/timeout", auth, ownedBot, guildAccess, wrap(async(req,res)=>{
  const {userId,minutes,reason}=req.body||{};
  const n=Number(minutes);
  if(!Number.isInteger(n)||n<1||n>40320) return res.status(400).json({error:"Timeout must be between 1 and 40320 minutes."});
  const me=req.guild.members.me;
  if(!me?.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return res.status(403).json({error:"Bot needs Moderate Members permission."});
  const target=await req.guild.members.fetch(String(userId));
  if(target.id===req.client.user.id || target.roles.highest.position>=me.roles.highest.position) return res.status(400).json({error:"Role hierarchy prevents this action."});
  await target.timeout(n*60*1000,String(reason||"Action from Bot Manager").slice(0,480)); res.json({ok:true});
}));
app.get("/api/bots/:botId/guilds/:guildId/messages/:channelId", auth, ownedBot, guildAccess, wrap(async(req,res)=>{
  const channel=await req.guild.channels.fetch(req.params.channelId);
  if(!channel?.isTextBased()||!channel.messages) return res.status(400).json({error:"Not a text channel."});
  const me=req.guild.members.me;
  if(!channel.permissionsFor(me).has(PermissionsBitField.Flags.ReadMessageHistory)) return res.status(403).json({error:"Bot lacks Read Message History."});
  const msgs=await channel.messages.fetch({limit:50});
  res.json([...msgs.values()].map(m=>({id:m.id,content:m.content,author:m.author.username,createdAt:m.createdAt})));
}));
app.delete("/api/bots/:botId/guilds/:guildId/messages/:channelId/:messageId", auth, ownedBot, guildAccess, wrap(async(req,res)=>{
  const channel=await req.guild.channels.fetch(req.params.channelId);
  if(!channel?.isTextBased()||!channel.messages) return res.status(400).json({error:"Not a text channel."});
  const me=req.guild.members.me;
  if(!channel.permissionsFor(me).has(PermissionsBitField.Flags.ManageMessages)) return res.status(403).json({error:"Bot needs Manage Messages permission."});
  const msg=await channel.messages.fetch(req.params.messageId);
  await msg.delete(); res.json({ok:true});
}));
app.use((err,req,res,next)=>{ console.error(err); if(!res.headersSent) res.status(500).json({error:"Operation failed. Check bot permissions, role hierarchy and Discord availability."}); });

const port=Number(process.env.PORT||3000);
app.listen(port,()=>console.log(`Universal Bot Manager running at ${process.env.BASE_URL||`http://localhost:${port}`}`));
