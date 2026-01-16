import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

const API_KEY = process.env.API_KEY || "";
const PORT = process.env.PORT || 3000;

const jobs = new Map();

function requireApiKey(req, res, next) {
  if (!API_KEY) return res.status(500).json({ error: "API_KEY not set on server" });
  const provided = req.header("X-Api-Key");
  if (provided !== API_KEY) return res.status(401).json({ error: "Invalid API key" });
  next();
}

function makeJobId() {
  return "job_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

async function runJob(job_id) {
  const job = jobs.get(job_id);
  if (!job) return;

  job.status = "running";
  jobs.set(job_id, job);

  try {
    // attendre 10 secondes (simulation)
    await new Promise((r) => setTimeout(r, 10000));

    const fakeUrl = `https://example.com/site/${job_id}`;

    job.status = "done";
    job.site_url = fakeUrl;
    jobs.set(job_id, job);

    await fetch(job.callback_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        row_id: job.row_id,
        job_id,
        status: "done",
        site_url: fakeUrl,
        error: null
      })
    });
  } catch (e) {
    job.status = "error";
    job.error = String(e?.message || e);
    jobs.set(job_id, job);

    try {
      await fetch(job.callback_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          row_id: job.row_id,
          job_id,
          status: "error",
          site_url: null,
          error: job.error
        })
      });
    } catch (_) {}
  }
}

app.get("/", (req, res) => res.send("OK"));

app.post("/jobs", requireApiKey, (req, res) => {
  const { row_id, prompt, callback_url } = req.body || {};
  if (!row_id || !prompt || !callback_url) {
    return res.status(400).json({ error: "Missing row_id, prompt, or callback_url" });
  }

  const job_id = makeJobId();
  jobs.set(job_id, {
    job_id,
    status: "queued",
    row_id,
    prompt,
    callback_url,
    site_url: null,
    error: null
  });

  (async () => {
  // Lance le travail et attends la fin (synchrone)
  try {
    await new Promise((r) => setTimeout(r, 10000));
    const fakeUrl = `https://example.com/site/${job_id}`;

    const job = jobs.get(job_id);
    if (job) {
      job.status = "done";
      job.site_url = fakeUrl;
      jobs.set(job_id, job);
    }

    return res.json({ job_id, status: "done", site_url: fakeUrl, error: null });
  } catch (e) {
    const err = String(e?.message || e);
    const job = jobs.get(job_id);
    if (job) {
      job.status = "error";
      job.error = err;
      jobs.set(job_id, job);
    }
    return res.status(500).json({ job_id, status: "error", site_url: null, error: err });
  }
})();

});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
