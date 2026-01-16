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

const jobs = new Map(); // job_id -> {status, row_id, chat_id, site_url, error}

function makeJobId() {
  return "job_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

app.get("/", (req, res) => res.send("OK"));

// GET job status (polling)
app.get("/jobs/:job_id", requireApiKey, (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ status: "error", error: "Job not found" });
  res.json(job);
});

// POST start job (returns immediately)
app.post("/jobs", requireApiKey, async (req, res) => {
  try {
    if (!process.env.V0_API_KEY) {
      return res.status(500).json({ status: "error", error: "V0_API_KEY not set on server" });
    }

    const { row_id, prompt, chat_id } = req.body || {};
    if (!row_id || !prompt) {
      return res.status(400).json({ status: "error", error: "Missing row_id or prompt" });
    }

    const job_id = makeJobId();
    jobs.set(job_id, {
      status: "queued",
      job_id,
      row_id,
      chat_id: chat_id && String(chat_id).trim() ? String(chat_id).trim() : null,
      site_url: null,
      error: null
    });

    // Répond immédiatement à Make (évite timeout)
    res.json({ status: "queued", job_id });

    // Travaille en arrière-plan
    (async () => {
      const v0 = new V0({ apiKey: process.env.V0_API_KEY });
      const job = jobs.get(job_id);
      if (!job) return;

      job.status = "running";
      jobs.set(job_id, job);

      try {
        let chat;
        if (job.chat_id) {
          chat = await v0.chats.sendMessage(job.chat_id, { message: prompt });
        } else {
          chat = await v0.chats.create({ message: prompt });
        }

        const returnedChatId = chat?.id || job.chat_id || null;
        const siteUrl = chat?.webUrl || chat?.demo || chat?.url || null;

        job.status = "done";
        job.chat_id = returnedChatId;
        job.site_url = siteUrl;
        job.error = null;

        if (!siteUrl) {
          job.status = "error";
          job.error = "v0 response did not include webUrl/demo/url";
        }

        jobs.set(job_id, job);
      } catch (e) {
        job.status = "error";
        job.error = String(e?.message || e);
        jobs.set(job_id, job);
      }
    })();
  } catch (e) {
    return res.status(500).json({ status: "error", error: String(e?.message || e) });
  }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
