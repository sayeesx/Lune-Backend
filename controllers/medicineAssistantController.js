// controllers/medicineAssistantController.js
import Medicine from "../models/Medicine.js";
import dbConnect from "../lib/mongodb.js";
import { getMistralJSON, getMistralText } from "../utils/mistralClient.js";

// In-memory cache
const queryCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Escape regex metacharacters for safe literal matching
function escapeRegex(literal) {
  if (typeof RegExp.escape === 'function') return RegExp.escape(String(literal));
  return String(literal).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Normalize a medicine name into a safe search key
function cleanMedicineName(name) {
  if (!name) return '';
  let s = String(name).trim();
  s = s.replace(/\b(what is|tell me|show|about|the|content in|price of|side effects of)\b/gi, '').trim();
  s = s.replace(/[-\s]+/g, ' ').trim();
  s = s.replace(/[^a-zA-Z0-9+\-\s]/g, '').trim();
  return s;
}

// Keep payloads compact for prompts (include key medical fields)
function pickMedicineFields(doc) {
  if (!doc) return null;
  return {
    name: doc.name ?? null,
    type: doc.type ?? null,
    pack_size_label: doc.pack_size_label ?? null,
    price: doc.price ?? null,
    manufacturer_name: doc.manufacturer_name ?? null,
    is_discontinued: doc.is_discontinued ?? null,
    short_composition1: doc.short_composition1 ?? null,
    salt_composition: doc.salt_composition ?? null,
    medicine_desc: doc.medicine_desc ?? null,
    side_effects: doc.side_effects ?? null,
    drug_interactions: doc.drug_interactions ?? null
  };
}

// Professional, safety-first instruction for final text generation
const PROFESSIONAL_SYSTEM = [
  'You are Lune’s Medicine Information Assistant, a professional and safety-focused source of medication information.',
  'Answer the user’s requested aspect first and keep the tone neutral and factual.',
  'Avoid diagnosis, personalized dosing, and promotional language; emphasize precautions when relevant.',
  'Be concise and mobile-friendly; include manufacturer, type, price, pack size, composition, side effects, interactions, alternatives when available.',
  'If any field is missing or null in the provided data, explicitly write "Information not available" for that field.',
  'If the database has no matching medicine, say "Sorry, we don’t have that information."'
].join(' ');

// Intent extraction with a fast heuristic + JSON Mode fallback
async function extractQueryIntent(message) {
  const m = String(message || '').trim();

  // Quick patterns
  const make = (overrides = {}) => ({
    medicine_name: null,
    manufacturer: null,
    type: null,
    query_type: "full_details",
    confidence: 0.7,
    ...overrides
  });

  const comp = m.match(/(?:content|composition|ingredients?)(?:\s+(?:of|in))?\s+([A-Za-z0-9\- ]+)/i);
  if (comp) return make({ medicine_name: comp[1].trim(), query_type: "composition", confidence: 0.9 });

  const price = m.match(/(?:price|cost|how much|rate)\s+(?:of|for)\s+(.+?)(?:\s+(?:by|from|tablet|capsule|syrup|$)|$)/i);
  if (price) return make({ medicine_name: price[1].trim(), query_type: "price", confidence: 0.9 });

  const alt = m.match(/(?:alternative|similar|substitute)(?:s)?\s+(?:to|for)\s+(.+?)(?:\s+(?:by|from|tablet|capsule|syrup|$)|$)/i);
  if (alt) return make({ medicine_name: alt[1].trim(), query_type: "alternatives", confidence: 0.9 });

  const se = m.match(/(?:side effects?|effects?|reactions?)\s+(?:of|for|from)\s+(.+?)(?:\s+(?:by|from|tablet|capsule|syrup|$)|$)/i);
  if (se) return make({ medicine_name: se[1].trim(), query_type: "side_effects", confidence: 0.9 });

  const mfg = m.match(/\bby\s+([^,]+?)(?=\s*(?:,|\.|$))/i) || m.match(/\bfrom\s+([^,]+?)(?=\s*(?:,|\.|$))/i);
  const typeHints = ['tablet','capsule','syrup','injection','cream','gel','ointment','drops','inhaler','spray','suspension'];
  let type = null;
  for (const t of typeHints) if (m.toLowerCase().includes(t)) { type = t; break; }

  const cap = m.match(/\b([A-Z][a-z0-9-]+)\b/);
  if (cap) {
    return make({
      medicine_name: cap[1],
      manufacturer: mfg ? mfg[1].trim() : null,
      type,
      confidence: 0.8
    });
  }

  // JSON Mode deterministic extraction
  const system = 'Extract medicine query intent in strict JSON for downstream parsing.';
  const user = `
Analyze this user query: "${message}"

Return ONLY a JSON object:
{
  "medicine_name": "exact medicine name with strength if mentioned",
  "manufacturer": "company name if mentioned, otherwise null",
  "type": "medicine form if mentioned (tablet/syrup/etc), otherwise null",
  "query_type": "one of: price, composition, side_effects, alternatives, full_details",
  "confidence": 0.95
}`.trim();

  try {
    const parsed = await getMistralJSON({ user, system, temperature: 0, top_p: 1, maxTokens: 300 });
    return parsed;
  } catch {
    return make();
  }
}

async function findAlternatives(medicine) {
  if (!medicine?.short_composition1 && !medicine?.salt_composition) return [];
  const query = {
    $or: [
      ...(medicine.short_composition1 ? [{ short_composition1: medicine.short_composition1 }, { short_composition2: medicine.short_composition1 }] : []),
      ...(medicine.salt_composition ? [{ salt_composition: medicine.salt_composition }] : [])
    ],
    manufacturer_name: { $ne: medicine.manufacturer_name },
    is_discontinued: false
  };
  return Medicine.find(query)
    .select('name manufacturer_name price type pack_size_label short_composition1 salt_composition')
    .sort('price')
    .limit(5)
    .lean()
    .exec();
}

async function generateResponse(queryIntent, medicines, originalMessage) {
  if (!medicines?.length) {
    return {
      reply: `Sorry, we don’t have that information for "${queryIntent.medicine_name}".`,
      matches: [],
      alternatives: []
    };
  }

  const primary = medicines[0];
  const slimPrimary = pickMedicineFields(primary);
  const alternatives = await findAlternatives(primary);
  const slimAlts = alternatives.map(pickMedicineFields);

  const userPrompt = `
Task: Provide a clear, professional answer using the database fields supplied.

User query: "${String(originalMessage || '').trim()}"
Query type: ${queryIntent.query_type}

Primary medicine (fields may be null; if null, write "Information not available"):
${JSON.stringify(slimPrimary)}

Alternatives (up to 5, fields may be null; if null, write "Information not available"):
${JSON.stringify(slimAlts)}

Instructions:
- Start with the requested aspect (${queryIntent.query_type}) first.
- Include manufacturer, type, price, and pack size if available; if missing, write "Information not available".
- Summarize composition; if missing, write "Information not available".
- If present, mention key side effects and notable drug interactions briefly; otherwise state "Information not available".
- For alternatives, list 1–3 with a brief price/composition comparison; if none, say "Information not available".
- Avoid dosing and diagnosis; include relevant precautions.
- If the database lacks details for a requested field, explicitly say "Information not available".

Length:
- Price: 2–3 sentences.
- Other topics: 3–5 sentences.
`.trim();

  const reply = await getMistralText({
    user: userPrompt,
    system: PROFESSIONAL_SYSTEM,
    temperature: 0.2,
    top_p: 1,
    maxTokens: 600
  });

  return { reply: reply.trim(), matches: [primary], alternatives };
}

export async function medicineAssistantController(req, res, next) {
  try {
    const { message } = req.body || {};
    if (!message?.trim()) {
      return res.status(400).json({
        error: "Please provide a medicine query",
        examples: [
          "What is the price of Paracetamol 500mg?",
          "Tell me about Allegra tablet",
          "Show alternatives to Azithral by Alembic"
        ]
      });
    }

    await dbConnect();

    // Cache
    const cacheKey = message.toLowerCase().trim();
    const cached = queryCache.get(cacheKey);
    if (cached?.timestamp && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json(cached.data);
    }

    // Intent
    const intent = await extractQueryIntent(message);
    if (!intent?.medicine_name) {
      return res.status(400).json({
        error: "Could not identify a medicine name in your query.",
        examples: [
          "What is the price of Paracetamol 650?",
          "Tell me about Allegra 120mg tablet",
          "Show alternatives to Azithral"
        ],
        tip: "Include the complete medicine name and strength (if known)"
      });
    }

    // Build safe search
    const rawName = intent.medicine_name;
    const cleaned = cleanMedicineName(rawName);
    const searchKey = escapeRegex(cleaned || rawName || '');

    // Prefer starts-with, then contains
    const baseOr = [
      { name: { $regex: `^${searchKey}`, $options: "i" } },
      { name: { $regex: searchKey, $options: "i" } }
    ];
    const search = { $and: [{ $or: baseOr }] };
    if (intent.manufacturer) {
      search.$and.push({ manufacturer_name: { $regex: escapeRegex(intent.manufacturer), $options: "i" } });
    }
    if (intent.type) {
      search.$and.push({ type: { $regex: escapeRegex(intent.type), $options: "i" } });
    }

    // Narrow select to needed fields to reduce tokens
    const projection = 'name price is_discontinued manufacturer_name type pack_size_label short_composition1 salt_composition medicine_desc side_effects drug_interactions';

    // Query DB
    let medicines = await Medicine.find({ name: { $regex: `^${searchKey}`, $options: "i" } })
      .select(projection)
      .limit(5)
      .lean();
    if (!medicines.length) {
      medicines = await Medicine.find(search).select(projection).limit(5).lean();
    }

    // Generate response
    const response = await generateResponse(intent, medicines, message);
    response.reply += "\n\nThis information is for educational purposes only; consult a licensed healthcare professional for personalized advice.";

    const result = {
      success: true,
      query: intent,
      ...response,
      metadata: {
        model: "mistral-large-latest",
        feature: "Medicine Assistant"
      }
    };

    // Cache success
    if (medicines.length > 0) {
      queryCache.set(cacheKey, { timestamp: Date.now(), data: result });
    }

    return res.json(result);
  } catch (err) {
    console.error("Medicine Assistant Error:", err);
    return next(err);
  }
}
