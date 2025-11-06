import "dotenv/config";
import Groq from "groq-sdk";

// --- Environment check ---
const { GROQ_API_KEY } = process.env;
if (!GROQ_API_KEY) {
  throw new Error("GROQ_API_KEY is missing");
}

// --- Initialize Groq client once ---
export const groq = new Groq({ apiKey: GROQ_API_KEY });

// Optional: default options tuned for brief, clinician-style replies
export const SHORT_DOCTOR_REPLY = {
  temperature: 0.5,
  topP: 0.9,
  maxTokens: 280,
  model: "llama-3.3-70b-versatile",
};

/**
 * Get a reply using a full messages array.
 * messages: [{ role: "system"|"user"|"assistant", content: string }, ...]
 */
export async function getGroqChatReply(
  messages,
  {
    model = "llama-3.3-70b-versatile",
    temperature = 0.7,
    maxTokens = 1024,
    topP = 0.95,
    stop,
    stream = false
  } = {}
) {
  const completion = await groq.chat.completions.create({
    model,
    messages,
    temperature,
    top_p: topP,
    max_tokens: maxTokens,
    ...(stop ? { stop } : {}),
    stream,
  });

  const text = completion?.choices?.[0]?.message?.content?.trim() ?? "";
  return text || "No response generated.";
}

/**
 * Backward-compatible helper to build messages from system + user strings.
 * Mirrors legacy signature: (userMessage, systemPrompt, options?)
 */
export async function getGroqReply(
  userMessage,
  systemPrompt,
  options = {}
) {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: userMessage });
  return getGroqChatReply(messages, options);
}

/**
 * Get structured JSON response using Groq's JSON mode.
 * ✅ FIXED: Clean string cleaning without syntax errors
 * 
 * @param {Array} messages - Array of message objects with role and content
 * @param {Object} options - Configuration options
 * @returns {Object|null} - Parsed JSON object or null on failure
 */
export async function getGroqJSON(
  messages,
  {
    model = "llama-3.3-70b-versatile",
    temperature = 0.2,
    maxTokens = 2000,
    topP = 0.95,
  } = {}
) {
  try {
    const completion = await groq.chat.completions.create({
      model,
      messages,
      temperature,
      top_p: topP,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    });

    let rawContent = completion?.choices?.[0]?.message?.content?.trim() ?? "{}";

    // ✅ FIXED: Remove markdown code blocks and "json" label
    rawContent = rawContent.split("```").join("");
    rawContent = rawContent.split("json").join("");
    rawContent = rawContent.replace(/,\s*([}\]])/g, "$1");
    rawContent = rawContent.trim();

    try {
      const parsed = JSON.parse(rawContent);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
      return null;
    } catch (parseError) {
      console.error("JSON parse failed:", parseError.message);
      console.error("Raw content:", rawContent);
      return null;
    }
  } catch (error) {
    console.error("Groq getGroqJSON API error:", error?.message);
    throw new Error("AI service error. Please try again later.");
  }
}

/**
 * Streaming with a messages array.
 * Usage:
 *   for await (const chunk of getGroqStreamReply(messages, opts)) {
 *     process.stdout.write(chunk);
 *   }
 */
export async function* getGroqStreamReply(
  messages,
  {
    model = "llama-3.3-70b-versatile",
    temperature = 0.7,
    maxTokens = 1024,
    topP = 0.95,
    stop,
  } = {}
) {
  const stream = await groq.chat.completions.create({
    model,
    messages,
    temperature,
    top_p: topP,
    max_tokens: maxTokens,
    ...(stop ? { stop } : {}),
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk?.choices?.[0]?.delta?.content || "";
    if (content) yield content;
  }
}

/**
 * Streaming wrapper for (userMessage, systemPrompt).
 */
export async function* getGroqStreamFromPrompt(
  userMessage,
  systemPrompt,
  options = {}
) {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: userMessage });
  yield* getGroqStreamReply(messages, options);
}

/**
 * Lightweight health check.
 */
export async function checkGroqHealth() {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 5,
    });
    const ok = Boolean(completion?.choices?.[0]?.message?.content);
    return { ok, model: "llama-3.3-70b-versatile" };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

/**
 * Query lab report with contextual understanding
 * Uses stored lab report text to answer specific user questions
 * 
 * @param {string} labReportText - Previously extracted lab report text
 * @param {string} userQuery - User's question about the report
 * @returns {Object} - Structured JSON response
 */
export async function queryLabReport(labReportText, userQuery) {
  const systemPrompt = "You are LabSense — an intelligent, helpful, and friendly AI medical lab report companion.\n\nYour role:\n- The user has already uploaded and analyzed a lab report earlier.\n- The backend has stored the extracted lab text from that report in the database.\n- The user may now ask questions about that report (like \"Is my cholesterol high?\" or \"What does low hemoglobin mean?\").\n- Use only the stored lab report text and your medical reasoning to respond.\n\nYour goals:\n1. Focus only on the user's question and the available lab data.\n2. Do not re-analyze the entire report again — summarize or interpret only what's relevant to the query.\n3. Never provide actual medical advice or diagnosis — instead, respond like a virtual lab companion explaining in plain, friendly terms.\n4. Always include a short, clear explanation with educational intent.\n5. If the question cannot be answered using the given report text, say: \"I couldn't find that information in this report. Would you like me to check another section or explain what it usually means?\"\n6. Format your reply in structured JSON like this:\n{\n  \"answer\": \"Direct answer to the user's question in 2-3 sentences\",\n  \"relevant_section\": \"Quote the specific part of the report that answers this question\",\n  \"ai_note\": \"AI-generated insights — not a medical diagnosis. Consult your doctor for personalized advice.\"\n}\n\nContext (Lab Report):\n" + labReportText + "\n\nUser question:\n" + userQuery;

  const messages = [
    {
      role: "system",
      content: systemPrompt
    },
    {
      role: "user",
      content: userQuery
    }
  ];

  return await getGroqJSON(messages, {
    model: "llama-3.3-70b-versatile",
    temperature: 0.3,
    maxTokens: 800,
    topP: 0.9
  });
}