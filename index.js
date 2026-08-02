require("dotenv").config();
const express = require("express");
const { handleIncoming, askWelcome } = require("./src/engine");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// -----------------------------
// 1. Webhook verification (GET)
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
// -----------------------------
app.post("/webhook", async (req, res) => {
  // Respond fast so Meta doesn't retry/flag the webhook.
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return; // status update (delivered/read), not a real message

    const from = message.from;
    const displayName = value?.contacts?.[0]?.profile?.name;

    console.log(`Incoming from ${from}:`, JSON.stringify(message.text || message.interactive || message.type));

    // Any free-text greeting with no active flow should also trigger the welcome menu,
    // not just the very first message ever — handled inside handleIncoming already,
    // but as a safety net for "hi"/"hello" style messages before any flow exists:
    if (message.type === "text" && /^(hi|hello|hey|start)$/i.test(message.text.body.trim())) {
      const { supabase } = require("./src/supabaseClient");
      const { data } = await supabase
        .from("conversation_state")
        .select("current_flow")
        .eq("whatsapp_number", from)
        .maybeSingle();

      if (!data || !data.current_flow) {
        await askWelcome(from);
        return;
      }
    }

    await handleIncoming(from, message, displayName);
  } catch (err) {
    console.error("Error handling webhook event:", err.response?.data || err.message || err);
  }
});

app.get("/", (req, res) => {
  res.send("WhatsApp bot is running.");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
