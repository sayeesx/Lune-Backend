// controllers/medicineAssistantController.js
import Medicine from "../models/Medicine.js";
import dbConnect from "../lib/mongodb.js";
import { getMistralJSON, getMistralText } from "../utils/mistralClient.js";

const queryCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function escapeRegex(literal) {
  if (typeof RegExp.escape === 'function') return RegExp.escape(String(literal));
  return String(literal).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanMedicineName(name) {
  if (!name) return '';
  let s = String(name).trim();
  s = s.replace(/\b(what is|tell me|show|about|the|content in|price of|rate of|side effects of)\b/gi, '').trim();
  s = s.replace(/[-\s]+/g, ' ').trim();
  s = s.replace(/[^a-zA-Z0-9+\-\s]/g, '').trim();
  return s;
}

// Levenshtein distance for fuzzy matching
function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

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

// More permissive medicine query detector
function isLikelyMedicineQuery(text) {
  const q = String(text || '').toLowerCase();
  const keywords = [
    'price', 'cost', 'rate', 'composition', 'content', 'ingredients', 'side effect', 'effects',
    'interactions', 'alternative', 'substitute', 'tablet', 'capsule', 'syrup', 'injection',
    'mg', 'ml', 'mcg', 'g', 'medicine', 'drug', 'manufacturer', 'pack size', 'what is', 'tell me'
  ];
  
  // Also check if query has medicine-like structure (word + number pattern)
  const hasMedicinePattern = /\b[a-z]{3,}\s*\d+/i.test(q);
  
  return keywords.some(k => q.includes(k)) || hasMedicinePattern;
}

const MEDGUIDE_SYSTEM = `You are Lune MedGuide, an intelligent medical information assistant connected to a MongoDB database of Indian medicines.
Your primary job is to understand user queries related to medicines and respond with accurate information from the database.

Guidelines:
1. If the user's query is not related to any medicine, politely respond: "I can only provide information about medicines. Please ask about a specific medicine name or related detail."
2. If the query mentions a specific medicine, analyze the query to understand what information the user needs — such as price, manufacturer, type, composition, side effects, or alternatives.
3. Search the MongoDB medicines collection for that medicine name. Available fields: name, price, manufacturer_name, type, pack_size_label, short_composition1, salt_composition, medicine_desc, side_effects, drug_interactions.
4. Provide a clear and helpful reply containing only the relevant details asked for by the user.
5. If no details are found, respond: "Sorry, I couldn't find specific information about that medicine in my database."
6. If any field is missing or null, say "Information not available" for that field.
7. Keep responses concise and mobile-friendly (2-5 sentences depending on query complexity).
8. Always emphasize safety and suggest consulting a healthcare professional for personalized advice.`;

async function extractQueryIntent(message) {
  const m = String(message || '').trim();

  const make = (overrides = {}) => ({
    medicine_name: null,
    manufacturer: null,
    type: null,
    query_type: "full_details",
    confidence: 0.7,
    ...overrides
  });

  // Enhanced patterns for better understanding
  const comp = m.match(/(?:content|composition|ingredients?)(?:\s+(?:of|in))?\s+([A-Za-z0-9\- ]+)/i);
  if (comp) return make({ medicine_name: comp[1].trim(), query_type: "composition", confidence: 0.9 });

  // Better price patterns - including "rate"
  const pricePatterns = [
    /(?:price|cost|rate|how much)\s+(?:of|for|is)\s+(.+?)(?:\s+(?:by|from|tablet|capsule|syrup|$)|$)/i,
    /what\s+is\s+(?:the\s+)?(?:price|cost|rate)\s+(?:of|for)\s+(.+?)(?:\s+(?:by|from|tablet|capsule|syrup|$)|$)/i,
    /(.+?)\s+(?:price|cost|rate)(?:\s|$)/i
  ];
  
  for (const pattern of pricePatterns) {
    const match = m.match(pattern);
    if (match) {
      const name = match[1].trim();
      if (!/^(what|show|tell|give|find|get|the)\b/i.test(name)) {
        return make({ medicine_name: name, query_type: "price", confidence: 0.9 });
      }
    }
  }

  const altTo = m.match(/(?:alternative|similar|substitute)(?:s)?\s+(?:to|for)\s+(.+?)(?:\s+(?:by|from|tablet|capsule|syrup|$)|$)/i);
  if (altTo) return make({ medicine_name: altTo[1].trim(), query_type: "alternatives", confidence: 0.9 });

  const altFrom = m.match(/(.+?)\s+(?:alternative|similar|substitute)(?:s)?(?:\s|$)/i);
  if (altFrom) {
    const name = altFrom[1].trim();
    if (!/^(what|show|tell|give|find|get)\b/i.test(name)) {
      return make({ medicine_name: name, query_type: "alternatives", confidence: 0.9 });
    }
  }

  const se = m.match(/(?:side effects?|effects?|reactions?)\s+(?:of|for|from)\s+(.+?)(?:\s+(?:by|from|tablet|capsule|syrup|$)|$)/i);
  if (se) return make({ medicine_name: se[1].trim(), query_type: "side_effects", confidence: 0.9 });

  const mfg = m.match(/\bby\s+([^,]+?)(?=\s*(?:,|\.|$))/i) || m.match(/\bfrom\s+([^,]+?)(?=\s*(?:,|\.|$))/i);
  const types = ['tablet','capsule','syrup','injection','cream','gel','ointment','drops','inhaler','spray','suspension'];
  let type = null;
  for (const t of types) if (m.toLowerCase().includes(t)) { type = t; break; }

  const cap = m.match(/\b([A-Z][a-z0-9-]+)\b/);
  if (cap) {
    return make({
      medicine_name: cap[1],
      manufacturer: mfg ? mfg[1].trim() : null,
      type,
      confidence: 0.8
    });
  }

  const withDose = m.match(/\b([a-z]+)\s+(\d+(?:\.\d+)?)\s*(?:mg|ml|mcg|g)?\b/i);
  if (withDose) {
    return make({
      medicine_name: `${withDose[1]} ${withDose[2]}`,
      manufacturer: mfg ? mfg[1].trim() : null,
      type,
      confidence: 0.85
    });
  }

  const singleWord = m.match(/\b([a-z]{3,})\b/i);
  if (singleWord) {
    const word = singleWord[1].toLowerCase();
    const stopWords = ['what', 'tell', 'show', 'about', 'price', 'side', 'effect', 'alternative', 'tablet', 'capsule', 'rate', 'cost'];
    if (!stopWords.includes(word)) {
      return make({
        medicine_name: singleWord[1],
        manufacturer: mfg ? mfg[1].trim() : null,
        type,
        confidence: 0.75
      });
    }
  }

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

  const parsed = await getMistralJSON({ user, system, temperature: 0, top_p: 1, maxTokens: 300 });
  return parsed || make();
}

// Fuzzy search for similar medicine names
async function findSimilarMedicines(searchTerm, limit = 5) {
  const term = searchTerm.toLowerCase().trim();
  
  // Get medicines that start with similar letters or have similar length
  const candidates = await Medicine.find({
    $or: [
      { name: { $regex: `^${escapeRegex(term.charAt(0))}`, $options: 'i' } },
      { name: { $regex: escapeRegex(term.substring(0, 3)), $options: 'i' } }
    ]
  })
  .select('name')
  .limit(50)
  .lean();

  // Calculate distance and sort
  const withDistance = candidates.map(med => ({
    name: med.name,
    distance: levenshteinDistance(term, med.name.toLowerCase())
  }));

  return withDistance
    .filter(m => m.distance <= 3) // Max 3 character difference
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(m => m.name);
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
    .lean();
}

async function generateResponse(queryIntent, medicines, originalMessage) {
  if (!medicines?.length) {
    return {
      reply: `Sorry, I couldn't find specific information about "${queryIntent.medicine_name}" in my database.`,
      matches: [],
      alternatives: []
    };
  }

  const primary = medicines[0];
  const slimPrimary = pickMedicineFields(primary);
  const alternatives = await findAlternatives(primary);
  const slimAlts = alternatives.map(pickMedicineFields);

  const userPrompt = `
User query: "${String(originalMessage || '').trim()}"
Query type: ${queryIntent.query_type}
Primary medicine: ${JSON.stringify(slimPrimary)}
Alternatives (up to 5): ${JSON.stringify(slimAlts)}

Instructions:
- Start with ${queryIntent.query_type}.
- Include manufacturer, type, price, pack size if available; if missing, write "Information not available".
- Summarize composition; if missing, write "Information not available".
- Note key side effects and drug interactions if present; else "Information not available".
- For alternatives, list 1–3 brief comparisons or "Information not available".
- Keep response 2-5 sentences, mobile-friendly.
- No dosing or diagnosis; include relevant precautions.
`.trim();

  const reply = await getMistralText({
    user: userPrompt,
    system: MEDGUIDE_SYSTEM,
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

    if (!isLikelyMedicineQuery(message)) {
      return res.json({
        success: false,
        reply: "I can only provide information about medicines. Please ask about a specific medicine name or related detail.",
        examples: [
          "Price of Paracetamol 650 tablet",
          "Side effects of Allegra 120mg",
          "Alternatives to Azithral by Alembic"
        ],
        tip: "Include the complete medicine name and strength (if known)"
      });
    }

    await dbConnect();

    const cacheKey = message.toLowerCase().trim();
    const cached = queryCache.get(cacheKey);
    if (cached?.timestamp && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json(cached.data);
    }

    const intent = await extractQueryIntent(message);
    if (!intent?.medicine_name) {
      return res.json({
        success: false,
        reply: "I can only provide information about medicines. Please specify a medicine name clearly.",
        examples: [
          "What is the price of Paracetamol 650?",
          "Tell me about Allegra 120mg tablet",
          "Show alternatives to Azithral"
        ],
        tip: "Include the complete medicine name and strength (if known)"
      });
    }

    const rawName = intent.medicine_name;
    const cleaned = cleanMedicineName(rawName);
    const searchKey = escapeRegex(cleaned || rawName || '');
    const searchKeyLC = escapeRegex((cleaned || rawName || '').toLowerCase());

    const projection =
      'name price is_discontinued manufacturer_name type pack_size_label short_composition1 salt_composition medicine_desc side_effects drug_interactions';

    let medicines = await Medicine.find({ name_lc: { $regex: `^${searchKeyLC}` } })
      .select(projection)
      .limit(5)
      .lean();

    if (!medicines.length) {
      medicines = await Medicine.find({ name: { $regex: `^${searchKey}`, $options: "i" } })
        .select(projection)
        .limit(5)
        .lean();
    }

    if (!medicines.length) {
      const andFilters = [
        {
          $or: [
            { name_lc: { $regex: searchKeyLC } },
            { name: { $regex: searchKey, $options: "i" } }
          ]
        }
      ];

      medicines = await Medicine.find({ $and: andFilters })
        .select(projection)
        .limit(5)
        .lean();
    }

    // Fuzzy matching if still no results
    if (!medicines.length) {
      const similarNames = await findSimilarMedicines(cleaned || rawName);
      
      if (similarNames.length > 0) {
        return res.json({
          success: false,
          reply: `I couldn't find "${rawName}" in the database. Did you mean one of these?`,
          suggestions: similarNames,
          tip: "Please try again with one of the suggested medicine names"
        });
      }
    }

    const response = await generateResponse(intent, medicines, message);
    response.reply += "\n\nThis information is for educational purposes only; consult a licensed healthcare professional for personalized advice.";

    const result = {
      success: true,
      query: intent,
      ...response,
      metadata: {
        model: "mistral-large-latest",
        feature: "Lune MedGuide"
      }
    };

    if (medicines.length > 0) {
      queryCache.set(cacheKey, { timestamp: Date.now(), data: result });
    }

    return res.json(result);
  } catch (err) {
    console.error("Medicine Assistant Error:", err);
    return next(err);
  }
}
