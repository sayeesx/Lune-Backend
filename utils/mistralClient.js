// utils/mistralClient.js
import MistralPkg from '@mistralai/mistralai';
const { Mistral } = MistralPkg;

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
if (!MISTRAL_API_KEY) {
  throw new Error('MISTRAL_API_KEY is not set in environment variables');
}

const client = new Mistral({ apiKey: MISTRAL_API_KEY });

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

function sanitizeToJSONString(s) {
  if (typeof s !== 'string') return '{}';
  let t = s.trim();

  const fencePattern = /``````/g;
  t = t.replace(fencePattern, (match) => {
    const inner = match.replace(/``````\s*/g, '');
    return inner.trim();
  });

  if (!(t.startsWith('{') && t.endsWith('}'))) {
    const first = t.indexOf('{');
    const last = t.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      t = t.slice(first, last + 1).trim();
    }
  }

  return t;
}

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

export async function getMistralJSON({
  user,
  system = '',
  temperature = 0,
  top_p = 1,
  maxTokens = 400,
  model = 'mistral-large-latest',
  useSystemRole = false
} = {}) {
  try {
    const messages = buildMessages({ system, user, useSystemRole });
    const stopSequence = String.fromCharCode(96, 96, 96);

    const resp = await withRetry(
      () =>
        client.chat.complete({
          model,
          messages,
          temperature,
          top_p,
          maxTokens,
          response_format: { type: 'json_object' },
          stop: [stopSequence]
        }),
      { retries: 2, baseDelayMs: 300 }
    );

    const raw = resp.choices?.[0]?.message?.content ?? '{}';
    const jsonText = sanitizeToJSONString(raw);

    try {
      const parsed = JSON.parse(jsonText);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
      return null;
    } catch (parseErr) {
      if (!getMistralJSON._lastError || getMistralJSON._lastError !== parseErr.message) {
        console.warn('JSON parse failed, using fallback heuristics');
        getMistralJSON._lastError = parseErr.message;
      }
      return null;
    }
  } catch (error) {
    if (error.message !== 'AI service error. Please try again later.') {
      console.error('Mistral getMistralJSON API error:', error?.message);
    }
    return null;
  }
}

export async function checkMistralHealth() {
  try {
    const testMessage = buildMessages({ 
      system: '', 
      user: 'test', 
      useSystemRole: false 
    });
    
    const resp = await client.chat.complete({
      model: 'mistral-large-latest',
      messages: testMessage,
      maxTokens: 5,
      temperature: 0
    });
    
    return {
      ok: true,
      model: 'mistral-large-latest',
      status: 'connected'
    };
  } catch (error) {
    console.error('Mistral health check failed:', error?.message);
    return {
      ok: false,
      error: error?.message || 'Connection failed'
    };
  }
}
