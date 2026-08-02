const axios = require("axios");

const GRAPH_API_VERSION = "v21.0";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

function client() {
  return axios.create({
    baseURL: `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}`,
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
}

// Plain text message
async function sendText(to, body) {
  return client().post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  });
}

// Up to 3 quick-reply buttons. Each button: { id, title } — title max 20 chars.
async function sendButtons(to, bodyText, buttons) {
  return client().post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  });
}

// For more than 3 options. rows: [{ id, title, description? }] — max 10 rows.
async function sendList(to, bodyText, buttonLabel, rows) {
  return client().post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: {
        button: buttonLabel,
        sections: [{ title: "Options", rows }],
      },
    },
  });
}

// Extracts a normalized { type: 'text' | 'button' | 'list', value } from an incoming message
function parseIncoming(message) {
  if (message.type === "text") {
    return { type: "text", value: message.text.body.trim() };
  }
  if (message.type === "interactive") {
    const interactive = message.interactive;
    if (interactive.type === "button_reply") {
      return { type: "button", value: interactive.button_reply.id };
    }
    if (interactive.type === "list_reply") {
      return { type: "list", value: interactive.list_reply.id };
    }
  }
  return { type: "unsupported", value: null };
}

module.exports = { sendText, sendButtons, sendList, parseIncoming };
