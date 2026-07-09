import PQueue from "p-queue";
import { randomUUID } from "crypto";
import { config } from "./config.js";
import {
  createJob, updateJob, addLog, getJobWithDetails,
  getSource, updateSource, insertArticle,
} from "./db.js";
import { collectSource } from "./collectors/index.js";
import { rankPendingArticles } from "./ai/rankArticles.js";
import { broadcastJob } from "./sse.js";

const queue = new PQueue({ concurrency: config.scrapeConcurrency });

function makeLogger(jobId) {
  return (level, message, detail = null) => {
    const row = addLog(jobId, level, message, detail);
    broadcastJob(jobId, { type: "log", log: row });
  };
}

// Enqueue a scrape for a source. Returns the job immediately; work runs async.
export function enqueueSourceJob(sourceId, trigger = "manual") {
  const source = getSource(sourceId);
  if (!source) throw new Error("Source not found");

  const jobId = randomUUID();
  createJob({ id: jobId, source_id: sourceId, trigger });
  const log = makeLogger(jobId);
  log("info", `Queued scrape for "${source.name}" (${trigger})`);

  queue.add(() => runJob(jobId, source, log));
  return getJobWithDetails(jobId);
}

async function runJob(jobId, source, log) {
  updateJob(jobId, { status: "running", started_at: new Date().toISOString() });
  updateSource(source.id, { last_status: "running", last_run_at: new Date().toISOString() });
  broadcastJob(jobId, { type: "status", status: "running" });

  try {
    const items = await collectSource(source, log);
    let newCount = 0;
    for (const item of items) {
      if (!item.url) continue;
      const { inserted } = insertArticle({
        source_id: source.id,
        job_id: jobId,
        title: item.title,
        url: item.url,
        summary: item.summary,
        raw_markdown: item.raw_markdown,
        topic_tags: item.topic_tags ?? source.topic_tags,
        published_at: item.published_at,
        scraped_at: new Date().toISOString(),
      });
      if (inserted) newCount++;
    }
    log("success", `${newCount} new article(s), ${items.length - newCount} duplicate(s) skipped`);
    updateJob(jobId, { found_count: items.length, new_count: newCount });

    if (newCount > 0 && config.openrouterApiKey) {
      try {
        await rankPendingArticles(log);
      } catch (err) {
        log("warn", "Ranking skipped", err.message);
      }
    } else if (newCount > 0) {
      log("warn", "Skipping AI ranking — OPENROUTER_API_KEY not set");
    }

    updateJob(jobId, { status: "completed", finished_at: new Date().toISOString() });
    updateSource(source.id, { last_status: "completed" });
    broadcastJob(jobId, { type: "done", status: "completed", newCount });
  } catch (err) {
    log("error", "Scrape failed", err.message);
    updateJob(jobId, { status: "failed", failure_reason: err.message, finished_at: new Date().toISOString() });
    updateSource(source.id, { last_status: "failed" });
    broadcastJob(jobId, { type: "done", status: "failed", error: err.message });
  }
}

export function queueSize() {
  return queue.size + queue.pending;
}
