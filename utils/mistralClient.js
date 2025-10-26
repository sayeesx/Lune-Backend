// utils/mistralClient.js
import MistralPkg from '@mistralai/mistralai';
const { Mistral } = MistralPkg;

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
if (!MISTRAL_API_KEY) {
  throw new Error('MISTRAL_API_KEY is not set in environment variables');
}

const client = new Mistral({ apiKey: MISTRAL_API_KEY });

// Build messages while remaining compatible across SDK role handling.
// By default, system instructions are prepended to the first user message.
function buildMessages({ system, user, useSystemRole = false }) {
  const sys = typeof system === 'string' ? system.trim() : '';
  const usr = typeof user === 'string' ? user.trim() : '';
  if (useSystemRole && sys) {
    return [
      { role: 'system', content: sys },
      { role: 'user', content: usr }
    ];
  }
  return [{ role: 'user', content: (sys ? `${sys}\n\n` : '') + usr }];
}

// Simple retry with exponential backoff
async function withRetry(fn, { retries = 2, baseDelayMs = 300 } = {}) {
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
      attempt += 1;
    }
  }
  throw lastErr;
}

// Text completion (chat) for narrative responses
export async function getMistralText({
  user,
  system = '',
  temperature = 0.2,
  top_p = 1,
  maxTokens = 600,
  model = 'mistral-large-latest',
  useSystemRole = false
} = {}) {
  try {
    const messages = buildMessages({ system, user, useSystemRole });
    const resp = await withRetry(
      () => client.chat.complete({ model, messages, temperature, top_p, maxTokens }),
      { retries: 2, baseDelayMs: 300 }
    );
    return resp.choices?.[0]?.message?.content ?? '';
  } catch (error) {
    console.error('Mistral getMistralText error:', error);
    throw new Error('AI service error. Please try again later.');
  }
}

// JSON mode completion for strict extraction
export async function getMistralJSON({
  user,
  system = '',
  temperature = 0,
  top_p = 1,
  maxTokens = 300,
  model = 'mistral-large-latest',
  useSystemRole = false
} = {}) {
  try {
    const messages = buildMessages({ system, user, useSystemRole });
    const resp = await withRetry(
      () => client.chat.complete({
        model,
        messages,
        temperature,
        top_p,
        maxTokens,
        response_format: { type: 'json_object' } // JSON Mode
      }),
      { retries: 2, baseDelayMs: 300 }
    );
    const content = resp.choices?.[0]?.message?.content ?? '{}'; // stringified JSON
    return JSON.parse(content);
  } catch (error) {
    console.error('Mistral getMistralJSON error:', error);
    throw new Error('AI service error. Please try again later.');
  }
}
 