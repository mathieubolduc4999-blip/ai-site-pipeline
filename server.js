import express from "express";
import { generateText } from "ai";
import { v0 } from "v0-sdk";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;

// Secret pour que personne d'autre que Make puisse appeler ton API
const API_KEY = process.env.API_KEY || "";

// v0
const V0_API_KEY = process.env.V0_API_KEY || "";

// Vercel AI Gateway (AI SDK lit AI_GATEWAY_API_KEY automatiquement)
const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY || "";

// Nano Banana (Gemini 2.5 Flash Image) via AI Gateway + AI SDK
const IMAGE_MODEL = process.env.IMAGE_MODEL || "google/gemini-2.5-flash-image";

function requireApiKey(req, res, next) {
  if (!API_KEY) return res.status(500).json({ error: "API_KEY not set on server" });
  const provided = req.header("X-Api-Key");
  if (provided !== API_KEY) return res.status(401).json({ error: "Invalid API key" });
  next();
}

function makeJobId() {
  return "job_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// stockage simple en RAM (OK pour demo). Pour prod: Redis/DB.
const jobs = new Map(); // job_id -> {status, row_id, chat_id, site_url, image_urls, error}

app.get("/", (req, res) => res.send("OK"));

app.get("/jobs/:job_id", requireApiKey, (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ status: "error", error: "Job not found" });
  res.json(job);
});

// Helper: POST vers Make callback
async function postCallback(callback_url, payload) {
  try {
    await fetch(callback_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("Callback failed:", e?.message || e);
  }
}

// Helper: genere 1 image (data URL) avec Nano Banana via AI SDK (AI Gateway)
async function genOneNanoBananaImage(prompt) {
  if (!AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY not set on server");

  const result = await generateText({
    model: IMAGE_MODEL, // ex: google/gemini-2.5-flash-image
    prompt,
  });

  // Nano Banana retourne les images dans result.files
  const file = (result.files || []).find(
    (f) => (f?.mediaType || "").startsWith("image/") && f?.uint8Array
  );

  if (!file) throw new Error("No image returned in result.files");

  const base64 = Buffer.from(file.uint8Array).toString("base64");
  return `data:${file.mediaType};base64,${base64}`;
}

// Helper: generer 2 images
async function generateImages({ businessName, businessType, location }) {
  const heroPrompt =
    `Photorealistic hero image for a local service business website. ` +
    `Business: ${businessName || "Local Services"}. Type: ${businessType || "services"}. ` +
    `Location: ${location || "Quebec"}. Clean, modern, professional, natural lighting. ` +
    `No text, no logos, no watermarks.`;

  const contactPrompt =
    `Photorealistic image for the contact section of a local services website. ` +
    `Business: ${businessName || "Local Services"}. Type: ${businessType || "services"}. ` +
    `Location: ${location || "Quebec"}. Friendly, trustworthy, professional. ` +
    `No text, no logos, no watermarks.`;

  const heroUrl = await genOneNanoBananaImage(heroPrompt);
  const contactUrl = await genOneNanoBananaImage(contactPrompt);

  return { heroUrl, contactUrl };
}

/**
 * POST /jobs
 * Body JSON:
 * {
 *   "row_id": "123",
 *   "chat_id": "",            // optionnel (pour modifier un site existant)
 *   "site_name": "ABC",
 *   "prompt": "....",
 *   "callback_url": "https://hook.make.com/....",
 *   "business_type": "plomberie",       // optionnel
 *   "location": "Montreal, QC"          // optionnel
 * }
 */
app.post("/jobs", requireApiKey, async (req, res) => {
  const { row_id, prompt, callback_url } = req.body || {};
  if (!row_id || !prompt || !callback_url) {
    return res.status(400).json({ error: "Missing row_id, prompt, or callback_url" });
  }
  if (!V0_API_KEY) return res.status(500).json({ error: "V0_API_KEY not set on server" });

  const job_id = makeJobId();
  jobs.set(job_id, {
    status: "queued",
    job_id,
    row_id,
    chat_id: req.body?.chat_id || "",
    site_url: null,
    image_urls: null,
    error: null,
  });

  // Repond tout de suite -> pas de timeout Make
  res.json({ status: "queued", job_id });

  // background job
  (async () => {
    const job = jobs.get(job_id);
    if (!job) return;

    job.status = "running";
    jobs.set(job_id, job);

    try {
      // 1) generer images (2 seulement)
      const image_urls = await generateImages({
        businessName: req.body?.site_name || "",
        businessType: req.body?.business_type || "",
        location: req.body?.location || "",
      });

      // 2) demander a v0 de generer/mettre a jour le site en incluant ces URLs
      const imageInstruction =
        `IMPORTANT: Use these exact image URLs in the page.\n` +
        `- Hero image URL: ${image_urls.heroUrl}\n` +
        `- Contact image URL: ${image_urls.contactUrl}\n` +
        `Do not use placeholders. Do not generate additional images.\n`;

      const finalPrompt = `${prompt}\n\n${imageInstruction}`;

      let chat;
      const incomingChatId = String(req.body?.chat_id || "").trim();

      if (incomingChatId) {
        chat = await v0.chats.sendMessage({
          chatId: incomingChatId,
          message: finalPrompt,
        });
      } else {
        chat = await v0.chats.create({
          message: finalPrompt,
        });
      }

      const chat_id = chat?.id || incomingChatId || "";
      const site_url = chat?.demo || chat?.webUrl || chat?.url || null;

      if (!site_url) throw new Error("v0 did not return a demo/webUrl/url");

      job.status = "done";
      job.chat_id = chat_id;
      job.site_url = site_url;
      job.image_urls = image_urls;
      job.error = null;
      jobs.set(job_id, job);

      await postCallback(callback_url, {
        row_id,
        job_id,
        status: "done",
        chat_id,
        site_url,
        hero_image_url: image_urls.heroUrl,
        contact_image_url: image_urls.contactUrl,
        error: null,
      });
    } catch (e) {
      const msg = String(e?.message || e);
      job.status = "error";
      job.error = msg;
      jobs.set(job_id, job);

      await postCallback(callback_url, {
        row_id,
        job_id,
        status: "error",
        chat_id: job.chat_id || "",
        site_url: null,
        hero_image_url: null,
        contact_image_url: null,
        error: msg,
      });
    }
  })();
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
