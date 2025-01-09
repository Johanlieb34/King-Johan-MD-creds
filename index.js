const makeWASocket = require("@whiskeysockets/baileys").default;
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const pino = require("pino");
const { delay, useMultiFileAuthState, fetchLatestBaileysVersion, PHONENUMBER_MCC, makeCacheableSignalKeyStore } = require("@whiskeysockets/baileys");
const Pino = require("pino");
const NodeCache = require("node-cache");
const chalk = require("chalk");
const readline = require("readline");
const { parsePhoneNumber } = require("libphonenumber-js");

let phoneNumber = "916909137213";

const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code");
const useMobile = process.argv.includes("--mobile");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function qr() {
  //------------------------------------------------------
  let { version, isLatest } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(`./sessions`);
  const msgRetryCounterCache = new NodeCache(); // for retry message, "waiting message"
  const XeonBotInc = makeWASocket({
    logger: pino({ level: "silent" }),
    printQRInTerminal: !pairingCode, // popping up QR in terminal log
    mobile: useMobile, // mobile api (prone to bans)
    browser: ["Chrome", "Ubuntu", "87"], // Using Chrome Ubuntu as the browser string
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, Pino({ level: "fatal" }).child({ level: "fatal" })),
    },
    markOnlineOnConnect: true, // set false for offline
    generateHighQualityLinkPreview: true, // make high preview link
    getMessage: async (key) => {
      let jid = jidNormalizedUser(key.remoteJid);
      let msg = await store.loadMessage(jid, key.id);

      return msg?.message || "";
    },
    msgRetryCounterCache, // Resolve waiting messages
    defaultQueryTimeoutMs: undefined, // for this issues https://github.com/WhiskeySockets/Baileys/issues/276
  });

  // login use pairing code
  if (pairingCode && !XeonBotInc.authState.creds.registered) {
    if (useMobile) throw new Error("Cannot use pairing code with mobile api");

    let phoneNumber;
    if (!!phoneNumber) {
      phoneNumber = phoneNumber.replace(/[^0-9]/g, "");

      if (!Object.keys(PHONENUMBER_MCC).some((v) => phoneNumber.startsWith(v))) {
        console.log(chalk.bgBlack(chalk.redBright("Start with country code of your WhatsApp Number, Example : +916909137213")));
        process.exit(0);
      }
    } else {
      phoneNumber = await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number 😍\nFor example: +916909137213 : `)));
      phoneNumber = phoneNumber.replace(/[^0-9]/g, "");

      if (!Object.keys(PHONENUMBER_MCC).some((v) => phoneNumber.startsWith(v))) {
        console.log(chalk.bgBlack(chalk.redBright("Start with country code of your WhatsApp Number, Example : +916909137213")));

        phoneNumber = await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number 😍\nFor example: +916909137213 : `)));
        phoneNumber = phoneNumber.replace(/[^0-9]/g, "");
        rl.close();
      }
    }

    setTimeout(async () => {
      let code = await XeonBotInc.requestPairingCode(phoneNumber);
      code = code?.match(/.{1,4}/g)?.join("-") || code;
      console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)));
    }, 3000);
  }
  //------------------------------------------------------

  XeonBotInc.ev.on("connection.update", async (s) => {
    const { connection, lastDisconnect } = s;
    if (connection == "open") {
      await delay(1000 * 10);

      // Read the contents of creds.json
      let credsContent;
      try {
        credsContent = fs.readFileSync("./sessions/creds.json", "utf-8");

        // Send the image along with session ID as caption
        const imageLink = "https://i.ibb.co/w46VQ8D/Picsart-22-10-08-06-46-30-674.jpg"; // Replace with your image link
        await XeonBotInc.sendMessage(XeonBotInc.user.id, {
          image: { url: imageLink },
          caption: `Session ID: ${state.creds.user.id}\n\nCredentials:\n\`\`\`\n${credsContent}\n\`\`\``,
        });
      } catch (err) {
        console.error("Error reading or sending creds:", err);
        await XeonBotInc.sendMessage(XeonBotInc.user.id, { text: "Error: Unable to read the contents of creds.json." });
      }

      await delay(1000 * 2);
      process.exit(0);
    }
    if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
      qr();
    }
  });
  XeonBotInc.ev.on("creds.update", saveCreds);
  XeonBotInc.ev.on("messages.upsert", () => {});
}

qr();

process.on("uncaughtException", function (err) {
  let e = String(err);
  if (e.includes("Socket connection timeout")) return;
  if (e.includes("rate-overlimit")) return;
  if (e.includes("Connection Closed")) return;
  if (e.includes("Timed Out")) return;
  if (e.includes("Value not found")) return;
  console.log("Caught exception: ", err);
});
