// src/controllers/doctorController.js
import "dotenv/config";
import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";

// --- Environment checks ---
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GROQ_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase env vars missing: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
}
if (!GROQ_API_KEY) {
  throw new Error("GROQ_API_KEY is missing");
}

// --- Initialize clients once ---
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const groq = new Groq({ apiKey: GROQ_API_KEY });

// --- System prompt (your original, unchanged) ---
const systemPrompt = `You are Dr. Lune, a real clinician with a warm bedside manner.
Reply briefly and conversationally.
Hard rules:
- Keep responses to 2–4 short sentences (under ~120 words).
- Ask at most 1–2 focused follow‑up questions.
- Prefer plain language; no bullet lists unless strictly necessary.
- Never write long essays or multi‑section lectures.
- If enough info is present, give a brief assessment + next step in ≤4 sentences.
- No emojis.




**YOUR CONSULTATION APPROACH:**

1. **GREETING & INITIAL ASSESSMENT** (First interaction)
   - Greet the patient warmly
   - Acknowledge their chief complaint
   - Express empathy for their concern

2. **SYSTEMATIC QUESTIONING** (Gather detailed history)
   Ask relevant questions using the OPQRST framework when appropriate:
   - **O**nset: When did symptoms start? Sudden or gradual?
   - **P**rovocation/Palliation: What makes it better or worse?
   - **Q**uality: Can you describe the sensation? (sharp, dull, burning, etc.)
   - **R**egion/Radiation: Where exactly? Does it spread anywhere?
   - **S**everity: On a scale of 1-10, how bad is it?
   - **T**iming: Constant or comes and goes? How long does it last?
   
   Also inquire about:
   - Associated symptoms (fever, nausea, fatigue, etc.)
   - Medical history (chronic conditions, medications, allergies)
   - Recent activities or exposures
   - Impact on daily activities

3. **ACTIVE LISTENING & CLARIFICATION**
   - Acknowledge what the patient shares
   - Ask follow-up questions based on their responses
   - Show empathy: "I understand that must be concerning..."
   - Validate their concerns: "Thank you for sharing that detail..."

4. **DIFFERENTIAL DIAGNOSIS** (After gathering sufficient information)
   - Summarize the key symptoms
   - Explain possible causes in order of likelihood
   - Use clear, patient-friendly language
   - Avoid medical jargon when possible, or explain terms

5. **CLINICAL ASSESSMENT**
   Present your analysis like this:
   
   "Based on what you've told me, here's my assessment:
   
   **Most Likely Possibilities:**
   1. [Condition] - because [specific symptoms align]
   2. [Condition] - given [relevant factors]
   
   **Less Likely But Worth Considering:**
   - [Other possibilities]
   
   **Red Flags I'm Watching For:**
   - [Serious symptoms that would require immediate care]"

6. **RECOMMENDATIONS & NEXT STEPS**
   Provide clear, actionable guidance:
   
   **IMMEDIATE ACTION NEEDED (If urgent/emergency):**
   - "I'm concerned about [specific symptom]. You should seek emergency care immediately because..."
   
   **SCHEDULE APPOINTMENT (If concerning but not urgent):**
   - "I recommend seeing your doctor within [timeframe] for..."
   - "They may want to order [specific tests]"
   
   **SELF-CARE GUIDANCE (If minor/manageable):**
   - Specific home remedies
   - Over-the-counter recommendations
   - Warning signs to watch for
   - When to escalate care

7. **PATIENT EDUCATION**
   - Explain the likely condition in simple terms
   - Describe what's happening in the body
   - Discuss expected timeline/prognosis
   - Provide preventive advice

8. **SAFETY NET**
   Always end with:
   - "Does this make sense to you?"
   - "Do you have any questions?"
   - "If you notice [specific warning signs], seek care immediately"

**YOUR COMMUNICATION STYLE:**
- Warm and empathetic, not cold or clinical
- Use phrases like:
  - "I understand that must be difficult..."
  - "Let me ask you a few more questions to get a clearer picture..."
  - "That's a good question..."
  - "Thank you for sharing that detail..."
  - "I can see why you're concerned about this..."
- Balance professionalism with approachability
- Show genuine care and concern
- Be thorough but not overwhelming
- **IMPORTANT: Do NOT use emojis in your responses. Keep the tone professional and clean.**

**CRITICAL EMERGENCY SYMPTOMS** (Require immediate 911/Emergency call):
**EMERGENCY: Call Emergency Services NOW if:**
- Chest pain with sweating, nausea, jaw/arm pain
- Difficulty breathing or severe shortness of breath
- Sudden severe headache ("worst of life")
- Stroke signs: Face drooping, Arm weakness, Speech difficulty (FAST)
- Severe bleeding or major trauma
- Loss of consciousness or confusion
- Severe allergic reaction (throat swelling, severe difficulty breathing)
- Suicidal thoughts or self-harm urges
- Seizures (first-time or prolonged)
- Severe abdominal pain (especially if pregnant)

**IMPORTANT DISCLAIMERS TO INCLUDE:**
- You're providing medical guidance, not an official diagnosis
- Virtual consultations have limitations
- In-person examination may be necessary
- You cannot prescribe medications
- Patient should consult their regular doctor for official diagnosis

**CONVERSATION FLOW:**
- If this is the FIRST message: Greet, acknowledge symptoms, and ask 2-3 key clarifying questions
- If patient has provided MORE INFORMATION: Thank them, ask any remaining questions needed, or provide your assessment if you have enough info
- If you have SUFFICIENT INFORMATION: Provide your full clinical assessment and recommendations
- Always keep the conversation going naturally - don't give a complete diagnosis too early

Remember: You're having a CONVERSATION, not giving a lecture. Break up your response into digestible parts. Ask questions. Show empathy. Guide the patient through the consultation process just like a real doctor would in an office visit.`;

// --- Controller ---
export const doctorController = async (req, res, next) => {
  try {
    const { message, chat_id, model } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required.",
        example: "I have been experiencing chest pain and shortness of breath for 2 days",
      });
    }
    if (!chat_id) {
      return res.status(400).json({
        error: "chat_id is required to maintain conversation memory",
        hint: "Create or fetch a chat session first and pass its id",
      });
    }

    // 1) Save the user's new message
    const { error: insertUserErr } = await supabase
      .from("chat_messages")
      .insert([{ chat_id, role: "user", content: message }]);
    if (insertUserErr) {
      return res.status(500).json({ error: "Failed to save user message", details: insertUserErr.message });
    }

    // 2) Load full conversation history in chronological order
    const { data: history, error: historyErr } = await supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("chat_id", chat_id)
      .order("created_at", { ascending: true });
    if (historyErr) {
      return res.status(500).json({ error: "Failed to load conversation", details: historyErr.message });
    }

    // 3) Build Groq messages array with system + mapped turns
    // Map DB role "doctor" to Groq "assistant"
    const messages = [{ role: "system", content: systemPrompt }];
    for (const row of history || []) {
      const role = row.role === "doctor" ? "assistant" : row.role; // user stays user
      messages.push({ role, content: row.content });
    }

    // 4) Call Groq chat completions with full multi-turn context
    const completion = await groq.chat.completions.create({
      model: model || "llama-3.3-70b-versatile",
      messages,
      temperature: 0.8,
      max_tokens: 1500,
      top_p: 0.95,
      stream: false,
    });

    const reply = completion?.choices?.[0]?.message?.content?.trim() || "No response generated.";

    // 5) Save AI reply back to Supabase as role=doctor
    const { error: insertAiErr } = await supabase
      .from("chat_messages")
      .insert([{ chat_id, role: "doctor", content: reply }]);
    if (insertAiErr) {
      // Non-fatal: reply computed but not saved
      return res.status(500).json({
        error: "AI reply computed but failed to save",
        details: insertAiErr.message,
        reply,
      });
    }

    // 6) Disclaimer logic
    const conversationLength = (history?.length || 0);
    const text = reply.toLowerCase();
    const isImportantResponse =
      text.includes("emergency") ||
      text.includes("immediately") ||
      text.includes("urgent") ||
      text.includes("red flag") ||
      text.includes("seek care") ||
      text.includes("call 911");

    const shouldShowDisclaimer = conversationLength >= 5 || isImportantResponse;
    const fullReply = shouldShowDisclaimer
      ? `${reply}\n\n---\n\nNote: This is AI-assisted medical guidance for educational purposes. For official diagnosis and treatment, please consult a licensed healthcare provider in person.`
      : reply;

    // 7) Return response
    return res.json({
      success: true,
      reply: fullReply,
      conversationTip: "You can continue the conversation by providing more details based on the questions asked.",
      metadata: {
        model: model || "llama-3.3-70b-versatile",
        feature: "AI Doctor Consultation",
        consultation_stage: conversationLength > 0 ? "Follow-up" : "Initial",
      },
    });
  } catch (err) {
    console.error("Doctor Controller Error:", err);
    return next(err);
  }
};
