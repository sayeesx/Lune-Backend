// controllers/medguideController.js
import { getGroqReply } from "../utils/groqClient.js";

export const medguideController = async (req, res, next) => {
  try {
    const { message, conversationHistory } = req.body;

    if (!message || message.trim() === "") {
      return res.status(400).json({
        error: "Message is required.",
        example: "Tell me the side effects and interactions of Allegra 120mg tablet"
      });
    }

    // Professional, safety-first MedGuide system prompt
    const systemPrompt = `You are MedGuide, a professional, safety-first pharmaceutical assistant for medication questions.
Your priorities are accuracy, clarity, and patient safety. You provide neutral, concise information suitable for patients while avoiding diagnosis or personalized dosing.

SCOPE:
- Indications and how a medicine works (brief mechanism when helpful)
- Common vs serious side effects and what to do if they occur
- Contraindications and key warnings (pregnancy, breastfeeding, liver/kidney impairment)
- Critical drug-drug and drug-food interactions; alcohol cautions where relevant
- Practical details: dosage forms/strengths, typical adult usage ranges (non-personalized), storage, missed dose guidance
- Alternatives overview: by active ingredient equivalence and formulation considerations
- Pricing notes and pack size if asked (avoid guarantees; say it varies by region/pharmacy)

WHEN YOU LACK DATA:
- State what’s unknown and suggest consulting a licensed clinician or pharmacist

TONE AND STYLE:
- Clear, structured, and to-the-point
- Patient-friendly, minimal jargon (define terms briefly if used)
- No promotional language, no emojis, no fear-mongering
- Balance completeness with brevity; prioritize the user’s requested aspect

CONVERSATION FLOW:
- If FIRST message: confirm the exact medicine name, strength, and form (tablet/syrup, etc.) and the user’s goal (price, composition, side effects, interactions, alternatives, usage)
- If FOLLOW-UP: acknowledge details provided, ask only essential clarifying questions
- If SUFFICIENT INFORMATION: provide a well-structured answer with headings-like separation in text (no markdown), then invite follow-up

RED FLAGS (advise urgent care if present):
- Signs of severe allergic reaction: swelling of face/tongue/throat, severe breathing trouble, widespread rash/hives
- Chest pain, severe shortness of breath, sudden confusion, seizure, severe bleeding or black stools
- Overdose suspicion

DISCLAIMERS:
- You provide general medical information, not a diagnosis or prescription
- In-person evaluation may be necessary
- Encourage consulting a clinician/pharmacist for personalized guidance

OUTPUT LENGTH GUIDE:
- Price-only: 2–3 sentences
- Side effects/interactions/alternatives: 3–6 sentences
- Full overview: 5–8 sentences (prioritize top risks and user’s requested aspects)`;

    // Build conversation context
    let conversationContext = "";
    if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      conversationContext = "\n\nPrevious Conversation:\n";
      conversationHistory.forEach((turn) => {
        if (!turn) return;
        if (typeof turn.patient === "string" && turn.patient.trim()) {
          conversationContext += `\nUser: ${turn.patient}`;
        }
        if (typeof turn.assistant === "string" && turn.assistant.trim()) {
          conversationContext += `\nMedGuide: ${turn.assistant}\n`;
        }
      });
      conversationContext += "\nCurrent User Message:\n";
    }

    const fullMessage = conversationContext + message;

    // Settings tuned for factual, professional outputs and long responses
    const reply = await getGroqReply(fullMessage, systemPrompt, {
      temperature: 0.3,      // lower for consistency and safety
      maxTokens: 1600        // ample room for complex medicine queries
    });

    // Heuristic to decide when to append a disclaimer
    const historyLen = conversationHistory?.length || 0;
    const lower = reply.toLowerCase();
    const riskTriggers = [
      "emergency", "immediately", "urgent", "red flag", "seek care", "call 911",
      "anaphylaxis", "overdose", "severe bleeding", "black stools", "throat swelling"
    ];
    const isImportantResponse = riskTriggers.some(k => lower.includes(k));
    const shouldShowDisclaimer = historyLen >= 5 || isImportantResponse;

    const disclaimer = "Note: This is general medical information for educational purposes. For diagnosis or prescriptions, consult a licensed healthcare professional in person.";
    const finalReply = shouldShowDisclaimer ? `${reply}\n\n---\n\n${disclaimer}` : reply;

    return res.json({
      success: true,
      reply: finalReply,
      conversationTip: "You can share the exact medicine name, strength, and form, or ask about price, composition, side effects, interactions, or alternatives.",
      metadata: {
        model: "Llama 3.3 70B (Groq)",
        feature: "MedGuide Assistant",
        consultation_stage: conversationHistory?.length > 0 ? "Follow-up" : "Initial"
      }
    });
  } catch (err) {
    console.error("MedGuide Controller Error:", err);
    next(err);
  }
};
