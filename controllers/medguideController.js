import { getOpenAIReply } from "../utils/openaiClient.js";

export const doctorController = async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required." });

    // Doctor system prompt, non-diagnostic disclaimer
    const systemPrompt = `
      You are a helpful medical assistant. Provide general advice on symptoms without offering diagnosis. Always include: "This is not a diagnosis. For emergencies, consult a doctor."
    `;

    const reply = await getOpenAIReply(message, systemPrompt);
    res.json({ reply });
  } catch (err) {
    next(err);
  }
};
