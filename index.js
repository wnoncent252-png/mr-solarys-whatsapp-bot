// MR SOLARYS - Vrai bot WhatsApp (Baileys)
// A HEBERGER SUR RAILWAY / RENDER / UN VPS - PAS SUR VERCEL.
// Vercel ne garde pas de process ni de connexion ouverte en continu,
// hors Baileys a besoin exactement de ca pour fonctionner.
//
// IMPORTANT : le dossier ./session contient les identifiants WhatsApp.
// Il doit etre sur un disque PERSISTANT (volume Railway/Render ou VPS).
// Sans ca, chaque redeploiement efface la session et il faut relier le
// numero a chaque fois.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { Boom } = require('@hapi/boom');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '').replace(/[^0-9]/g, '');
const SESSION_DIR = path.join(__dirname, 'session');
const COMMANDS_PATH = path.join(__dirname, 'custom_commands.json');

if (!API_KEY) {
  console.error('❌ API_KEY manquante dans .env — obligatoire pour protéger /pair, /send, /commands.');
  process.exit(1);
}

let sock = null;
let connectionStatus = 'DISCONNECTED';
let pendingPairNumber = null;
let lastPairingCode = null;
let pairingError = null;
let isManualRestart = false;

function loadCustomCommands() {
  try {
    return JSON.parse(fs.readFileSync(COMMANDS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveCustomCommands(cmds) {
  fs.writeFileSync(COMMANDS_PATH, JSON.stringify(cmds, null, 2));
}

function extractText(msg) {
  const m = msg.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  ).trim();
}

const MENU_TEXT = `╔═══════════════════════╗
   ☠ MR SOLARYS — MENU ☠
╚═══════════════════════╝

⚡ .ping — teste si le bot répond
🆔 .jid — affiche l'identifiant du chat

👑 *Modération de groupe* (admins seulement) :
.add <numero>
.kick (en réponse à un message)
.promote / .demote (en réponse à un message)
.open / .close

Les commandes personnalisées configurées s'ajoutent automatiquement.`;

async function isSenderGroupAdmin(sockInstance, groupId, participant) {
  const meta = await sockInstance.groupMetadata(groupId);
  const p = meta.participants.find((x) => x.id === participant);
  return !!p && (p.admin === 'admin' || p.admin === 'superadmin');
}

async function handleGroupCommand(sockInstance, groupId, cmd, args, msg) {
  const reply = (t) => sockInstance.sendMessage(groupId, { text: t }, { quoted: msg });
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const mentioned = ctx?.mentionedJid || [];
  const quotedParticipant = ctx?.participant;
  const target = mentioned[0] || quotedParticipant;

  switch (cmd) {
    case 'kick': {
      if (!target) return reply('⚠️ Répondez au message du membre à expulser, ou mentionnez-le.');
      await sockInstance.groupParticipantsUpdate(groupId, [target], 'remove');
      return reply('☠️ Membre expulsé.');
    }
    case 'add': {
      const number = (args[0] || '').replace(/[^0-9]/g, '');
      if (!number) return reply('⚠️ Usage : .add 33612345678');
      await sockInstance.groupParticipantsUpdate(groupId, [`${number}@s.whatsapp.net`], 'add');
      return reply('👥 Membre ajouté.');
    }
    case 'promote': {
      if (!target) return reply('⚠️ Répondez au message du membre à promouvoir.');
      await sockInstance.groupParticipantsUpdate(groupId, [target], 'promote');
      return reply('👑 Membre promu administrateur.');
    }
    case 'demote': {
      if (!target) return reply('⚠️ Répondez au message du membre à rétrograder.');
      await sockInstance.groupParticipantsUpdate(groupId, [target], 'demote');
      return reply('⚔️ Statut administrateur retiré.');
    }
    case 'close':
      await sockInstance.groupSettingUpdate(groupId, 'announcement');
      return reply('🔒 Groupe fermé : seuls les admins peuvent écrire.');
    case 'open':
      await sockInstance.groupSettingUpdate(groupId, 'not_announcement');
      return reply('🔓 Groupe réouvert à tous.');
    default:
      return;
  }
}

async function handleMessage(sockInstance, msg) {
  const from = msg.key.remoteJid;
  if (!from) return;
  const isGroup = from.endsWith('@g.us');
  const sender = isGroup ? msg.key.participant : from;
  const text = extractText(msg);
  if (!text || (!text.startsWith('.') && !text.startsWith('/'))) return;

  const [cmdRaw, ...args] = text.slice(1).split(' ');
  const cmd = cmdRaw.toLowerCase();
  const reply = (t) => sockInstance.sendMessage(from, { text: t }, { quoted: msg });

  const GROUP_COMMANDS = ['add', 'kick', 'promote', 'demote', 'open', 'close'];

  if (GROUP_COMMANDS.includes(cmd)) {
    if (!isGroup) return reply('⚠️ Cette commande ne fonctionne que dans un groupe.');
    const senderIsAdmin = await isSenderGroupAdmin(sockInstance, from, sender);
    if (!senderIsAdmin) return reply('⛔ Réservé aux administrateurs du groupe.');
    return handleGroupCommand(sockInstance, from, cmd, args, msg);
  }

  if (cmd === 'ping') {
    return reply('🏓 Pong ! Le bot WhatsApp répond normalement.');
  }

  if (cmd === 'menu' || cmd === 'help') {
    return reply(MENU_TEXT);
  }

  if (cmd === 'jid') {
    return reply(`🆔 JID : ${from}`);
  }

  const customs = loadCustomCommands();
  const match = customs.find((c) => c.trigger.toLowerCase() === cmd && c.type === 'text');
  if (match) return reply(match.code);
}

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['MR SOLARYS', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  if (pendingPairNumber && !sock.authState.creds.registered) {
    const phoneToUse = pendingPairNumber;
    pendingPairNumber = null;
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneToUse);
        lastPairingCode = code;
        pairingError = null;
        connectionStatus = 'PAIRING_CODE_READY';
        console.log('📱 Code de pairing réel généré par WhatsApp :', code);
      } catch (e) {
        pairingError = e.message;
        console.error('Erreur requestPairingCode:', e.message);
      }
    }, 1500);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      connectionStatus = 'QR_READY';
      console.log('📷 Scannez ce QR code réel avec WhatsApp (Appareils connectés) :');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      connectionStatus = 'CONNECTED';
      lastPairingCode = null;
      console.log('✅ WhatsApp connecté avec succès.');
      if (OWNER_NUMBER) {
        sock.sendMessage(`${OWNER_NUMBER}@s.whatsapp.net`, {
          text: '✅ MR SOLARYS est en ligne et connecté à WhatsApp.',
        }).catch(() => {});
      }
    }

    if (connection === 'close') {
      connectionStatus = 'DISCONNECTED';
      if (isManualRestart) {
        isManualRestart = false;
        return;
      }
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('⚠️ Connexion fermée. Code :', statusCode, '— Reconnexion :', shouldReconnect);
      if (shouldReconnect) {
        startSock();
      } else {
        console.log('🚪 Déconnecté (logout). Supprimez le dossier session/ puis relancez pour relier un numéro.');
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;
    try {
      await handleMessage(sock, msg);
    } catch (e) {
      console.error('Erreur traitement message :', e.message);
    }
  });

  return sock;
}

// ---------- API HTTP interne (consommée par le site Vercel) ----------

const app = express();
app.use(express.json());

function auth(req, res, next) {
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.get('/status', auth, (req, res) => {
  res.json({ status: connectionStatus });
});

app.post('/pair', auth, async (req, res) => {
  const { phone } = req.body || {};
  const clean = (phone || '').replace(/[^0-9]/g, '');
  if (!clean) return res.status(400).json({ error: 'Numéro invalide.' });
  if (sock?.authState?.creds?.registered) {
    return res.status(409).json({ error: 'Une session WhatsApp est déjà active. Déconnectez-la avant d\'en relier une nouvelle.' });
  }

  pendingPairNumber = clean;
  lastPairingCode = null;
  pairingError = null;

  if (sock) {
    isManualRestart = true;
    try { sock.end(undefined); } catch { /* déjà fermé, pas grave */ }
  }
  startSock().catch((e) => {
    pairingError = e.message;
  });

  const startTime = Date.now();
  const TIMEOUT_MS = 25000;
  while (Date.now() - startTime < TIMEOUT_MS) {
    if (lastPairingCode) return res.json({ code: lastPairingCode });
    if (pairingError) return res.status(500).json({ error: pairingError });
    await new Promise((r) => setTimeout(r, 500));
  }
  res.status(504).json({ error: 'Délai dépassé en attendant le code WhatsApp. Réessayez dans un instant.' });
});

app.post('/send', auth, async (req, res) => {
  const { to, message } = req.body || {};
  if (!sock || connectionStatus !== 'CONNECTED') {
    return res.status(503).json({ error: 'WhatsApp non connecté.' });
  }
  if (!to || !message) return res.status(400).json({ error: 'to et message sont requis.' });
  try {
    const jid = to.includes('@') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/commands', auth, (req, res) => {
  res.json(loadCustomCommands());
});

app.post('/commands', auth, (req, res) => {
  const { trigger, code } = req.body || {};
  if (!trigger || !code) return res.status(400).json({ error: 'trigger et code sont requis.' });
  const cmds = loadCustomCommands();
  const filtered = cmds.filter((c) => c.trigger.toLowerCase() !== trigger.toLowerCase());
  filtered.push({ trigger, code, type: 'text' });
  saveCustomCommands(filtered);
  res.json({ ok: true, commands: filtered });
});

app.delete('/commands/:trigger', auth, (req, res) => {
  const cmds = loadCustomCommands();
  const filtered = cmds.filter((c) => c.trigger.toLowerCase() !== req.params.trigger.toLowerCase());
  saveCustomCommands(filtered);
  res.json({ ok: true, commands: filtered });
});

app.listen(PORT, () => {
  console.log(`🌐 API interne du bot démarrée sur le port ${PORT}`);
  startSock();
});
