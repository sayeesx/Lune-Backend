// src/utils/groqClient.js
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
  temperature: 0.5,          // focused, consistent
  topP: 0.9,                 // modest diversity
  maxTokens: 280,            // ~2–4 short sentences
  // stop: ["###"],          // enable if you add a stop marker in your prompt
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
    stop,          // array or string, optional
    stream = false // disabled here; use getGroqStreamReply for streaming
  } = {}
) {
  const completion = await groq.chat.completions.create({
    model,
    messages,
    temperature,
    top_p: topP,
    // Groq supports both historical max_tokens and the newer max_completion_tokens;
    // use max_tokens for broad compatibility.
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
