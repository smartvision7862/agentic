import { config } from "../config.js";
import { getScheduledByZernioId, updateScheduledPost, getDraft, updateDraft } from "../db.js";
import { broadcastGlobal } from "../sse.js";

// Express handler for POST /api/webhooks/zernio
export function handleZernioWebhook(req, res) {
  if (config.zernioWebhookSecret) {
    const provided = req.headers["x-zernio-signature"] || req.query.secret;
    if (provided !== config.zernioWebhookSecret) {
      return res.status(401).json({ error: "Invalid webhook secret" });
    }
  }

  const event = req.body || {};
  const postId = event.postId || event.data?.postId || event.post?._id;
  const type = event.type || event.event || "";

  if (postId) {
    const scheduled = getScheduledByZernioId(postId);
    if (scheduled) {
      let status = scheduled.status;
      if (/publish/i.test(type) && !/fail/i.test(type)) status = "published";
      else if (/fail|error/i.test(type)) status = "failed";

      updateScheduledPost(scheduled.id, { status, status_detail: type });
      const draft = getDraft(scheduled.draft_id);
      if (draft) updateDraft(draft.id, { status: status === "published" ? "published" : "failed" });
      broadcastGlobal({ type: "post-status", postId, status });
    }
  }

  res.json({ ok: true });
}
