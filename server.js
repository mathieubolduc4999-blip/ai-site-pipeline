import { V0 } from 'v0-sdk'
const v0 = new V0({ apiKey: process.env.V0_API_KEY })
``` :contentReference[oaicite:1]{index=1}

Donc ton code `import { v0 } from "v0-sdk"` risque d’échouer.

## Fais ceci :

GitHub → ouvre `server.js` → ✏️ Edit → remplace TOUT par ce code (copie-colle)

```js
import express from "express";
import { V0 } from "v0-sdk";

const app = express();
app.use(express.json({ limit: "1mb" }));

const API_KEY = process.env.API_KEY || "";
const PORT = process.env.PORT || 3000;

function requireApiKey(req, res, next) {
  if (!API_KEY) return res.status(500).json({ error: "API_KEY not set on server" });
  const provided = req.header("X-Api-Key");
  if (provided !== API_KEY) return res.status(401).json({ error: "Invalid API key" });
  next();
}

app.get("/", (req, res) => res.send("OK"));

app.post("/jobs", requireApiKey, async (req, res) => {
  try {
    const { row_id, prompt, chat_id } = req.body || {};
    if (!row_id || !prompt) {
      return res.status(400).json({ status: "error", error: "Missing row_id or prompt" });
    }

    if (!process.env.V0_API_KEY) {
      return res.status(500).json({ status: "error", error: "V0_API_KEY not set on server" });
    }

    // Init SDK (doc officielle)
    const v0 = new V0({ apiKey: process.env.V0_API_KEY }); :contentReference[oaicite:2]{index=2}

    const job_id =
      "job_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

    let chat;
    if (chat_id && String(chat_id).trim().length > 0) {
      // modifier le même chat/site
      chat = await v0.chats.sendMessage(String(chat_id).trim(), {
        message: prompt
      }); :contentReference[oaicite:3]{index=3}
    } else {
      // créer un nouveau chat/site
      chat = await v0.chats.create({ message: prompt }); :contentReference[oaicite:4]{index=4}
    }

    // La doc montre chat.webUrl (et v0 expose aussi des démos selon les features),
    // on prend ce qu’on a:
    const returnedChatId = chat?.id || null;
    const siteUrl = chat?.webUrl || chat?.demo || chat?.url || null;

    if (!siteUrl) {
      return res.status(500).json({
        status: "error",
        job_id,
        chat_id: returnedChatId,
        site_url: null,
        error: "v0 response did not include webUrl/demo/url"
      });
    }

    return res.json({
      status: "done",
      job_id,
      chat_id: returnedChatId,
      site_url: siteUrl,
      error: null
    });
  } catch (e) {
    return res.status(500).json({ status: "error", error: String(e?.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
