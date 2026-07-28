require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GRAPH_API_VERSION = "v21.0";

// -----------------------------
// 1. Webhook verification (GET)
// Meta calls this once when you save the webhook config in the dashboard.
// -----------------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully.");
    return res.status(200).send(challenge);
  }

  console.log("Webhook verification failed. Token mismatch.");
  return res.sendStatus(403);
});

// -----------------------------
// 2. Incoming messages (POST)
// Meta calls this every time a user sends your number a message.
// -----------------------------
app.post("/webhook", async (req, res) => {
  // Always respond 200 fast so Meta doesn't retry/flag your webhook.
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return; // could be a status update (delivered/read), ignore

    const from = message.from; // sender's phone number
    const text = message.text?.body;

    console.log(`Message from ${from}: ${text}`);

    // Simple echo bot logic — replace this with your own logic later
    await sendMessage(from, `You said: ${text}`);
  } catch (err) {
    console.error("Error handling webhook event:", err.response?.data || err.message);
  }
});

// -----------------------------
// Helper: send a message via the Graph API
// -----------------------------
async function sendMessage(to, body) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// Health check route — useful to confirm the app is alive
app.get("/", (req, res) => {
  res.send("WhatsApp bot is running.");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
