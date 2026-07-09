import twilio from "twilio";
import { createTask } from "../db.js";

const { MessagingResponse } = twilio.twiml;

export function handleWhatsAppWebhook(req, res) {
  const { Body, From } = req.body || {};
  
  if (Body && Body.trim().length > 0) {
    try {
      // Save the incoming WhatsApp message as a task in Content OS
      createTask({
        title: `WhatsApp Note`,
        notes: Body.trim(),
        due_date: new Date().toISOString().slice(0, 10),
        priority: 1,
      });

      // Send a success reply back to WhatsApp
      const twiml = new MessagingResponse();
      twiml.message("✅ Saved to Content OS Tasks!");
      res.type('text/xml').send(twiml.toString());
      return;
    } catch (err) {
      console.error("Failed to save WhatsApp task:", err);
      const twiml = new MessagingResponse();
      twiml.message("❌ Failed to save. Internal error.");
      res.type('text/xml').send(twiml.toString());
      return;
    }
  }

  // Fallback for empty messages
  const twiml = new MessagingResponse();
  res.type('text/xml').send(twiml.toString());
}
