import express from "express";
import { v0 } from "v0-sdk";

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

/**
 * POST /jobs
 * Body:
 * {
 *   "row_id": "123",
 *   "prompt": "...",
 *   "chat_id": "optional existing chat id"
 * }
 *
 * Returns:
 * { "status": "done", "job_id": "...", "chat_id": "...", "site_url": "...", "error": null }
 */
app.post("/jobs", requireApiKey, async (req, res) => {
  try {
    const V0_API_KEY = process.env.V0_API_KEY;
    if (!V0_API_KEY) {
      return res.status(500).json({ status: "error", error: "V0_API_KEY not set on server" });
    }

    const { row_id, prompt, chat_id } = req.body || {};

    if (!row_id || !prompt) {
      return res.status(400).json({ status: "error", error: "Missing row_id or prompt" });
    }

    // Juste pour tracer côté Make si tu veux
    const job_id =
      "job_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

    // IMPORTANT:
    // v0-sdk utilise la variable d'env V0_API_KEY (ou la config interne du SDK).
    // Ici on suppose que ton SDK lit process.env.V0_API_KEY tout seul.
    // (Sinon Render va logguer une erreur; on ajustera.)
    let chat;

    if (chat_id && String(chat_id).trim().length > 0) {
      // Modifier / itérer sur le même site (même contexte)
      chat = await v0.chats.sendMessage({
        chatId: String(chat_id).trim(),
        message: prompt
      });
    } else {
      // Créer un nouveau site
      chat = await v0.chats.create({
        message: prompt
      });
    }

    // Selon l’API, la démo partageable est souvent dans chat.demo.
    // On met des fallbacks au cas où la forme varie.
    const returnedChatId =
      chat?.id || chat?.chatId || chat?.chat_id || chat_id || null;

    const siteUrl =
      chat?.demo ||
      chat?.webUrl ||
      chat?.url ||
      chat?.output?.demo ||
      null;

    if (!siteUrl) {
      return res.status(500).json({
        status: "error",
        job_id,
        chat_id: returnedChatId,
        site_url: null,
        error: "v0 response did not include a site URL (demo/webUrl/url)"
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
    const msg = String(e?.message || e);
    return res.status(500).json({ status: "error", error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
