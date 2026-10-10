# MR SOLARYS — Vrai bot WhatsApp (Baileys)

Ce dossier contient le **vrai** bot. Il doit être hébergé sur un service qui
reste allumé en continu : Railway, Render (Web Service, pas une fonction
serverless), Fly.io, ou un VPS. **Pas sur Vercel** — voir pourquoi dans le
README du dossier `vercel-site/`.

## Déploiement sur Railway (exemple)

1. Créez un nouveau projet Railway → "Deploy from folder" → sélectionnez ce dossier.
2. Ajoutez un **Volume** et montez-le sur `/app/session` (clic droit sur le service → Volumes).
   C'est obligatoire : sans volume persistant, la session WhatsApp est perdue à chaque redéploiement/redémarrage et il faut relier le numéro à chaque fois.
3. Variables d'environnement (Settings → Variables) :
   - `API_KEY` : une longue clé aléatoire (générez-en une avec `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `OWNER_NUMBER` : votre numéro, format international sans `+`
   - `PORT` : Railway la fournit automatiquement, pas besoin de la fixer
4. Déployez. Dans les logs, vous verrez soit un vrai QR code, soit vous pouvez demander un code de pairing réel via l'endpoint `/pair` (voir plus bas).
5. Notez l'URL publique que Railway vous donne (ex: `https://votre-bot.up.railway.app`) — c'est le `WA_API_URL` à mettre dans Vercel.

Render fonctionne pareil (Web Service + Persistent Disk payant pour le volume).

## Lier votre numéro WhatsApp (vraie liaison)

Deux méthodes réelles, au choix :

**A. QR code** : regardez les logs du service juste après le démarrage, un vrai QR s'affiche en ASCII. Scannez-le depuis WhatsApp > Appareils connectés.

**B. Code à 8 caractères (pairing code)** : appelez l'API du bot :

```bash
curl -X POST https://votre-bot.up.railway.app/pair \
  -H "x-api-key: VOTRE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone":"33612345678"}'
```

La réponse contient un `code` réel généré par WhatsApp. Entrez-le dans
WhatsApp > Appareils connectés > Lier avec un numéro de téléphone. Il n'y a
**aucune génération aléatoire côté bot** — c'est WhatsApp qui fabrique ce code.

Une fois lié, la session est sauvegardée dans `session/` (sur le volume
persistant) et le bot reste connecté même après un redémarrage.

## Commandes disponibles dans WhatsApp

- `.ping`, `.menu`, `.jid`
- `.add <numero>`, `.kick`, `.promote`, `.demote`, `.open`, `.close` (dans un groupe, réservé aux admins du groupe)
- Commandes personnalisées définies dans `custom_commands.json` (texte uniquement — l'exécution de JavaScript arbitraire a été retirée du pack original pour des raisons de sécurité)

## Ce qui n'est pas inclus (dites-le-moi si vous le voulez)

Anti-view-once, sauvegarde de statuts, conversion en sticker : possibles avec
Baileys, mais demandent du code de traitement média en plus. Je ne les ai pas
mis par défaut pour rester sur une base honnête et testée plutôt que
d'empiler des fonctionnalités non vérifiées. Dites-moi si vous voulez que je
les ajoute.

## Rappel important

Baileys est une bibliothèque **non officielle**. Elle imite le protocole
WhatsApp Multi-Device. Ça fonctionne réellement, mais ça viole les
conditions d'utilisation de WhatsApp — il y a un risque (faible mais réel)
que le numéro soit banni, surtout en cas d'usage massif/spam. Utilisez de
préférence un numéro secondaire, pas votre numéro personnel principal.
