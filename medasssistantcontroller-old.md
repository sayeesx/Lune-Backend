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
  s = s.replace(/\b(what is|tell me|show|about|the|content in|price of|rate of|side effects of|actual|real|exact|current)\b/gi, '').trim();
  s = s.replace(/[-\s]+/g, ' ').trim();
  s = s.replace(/[^a-zA-Z0-9+\-\s]/g, '').trim();
  return s;
}

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

function isLikelyMedicineQuery(text) {
  const q = String(text || '').toLowerCase().trim();
  
  if (q.length < 3) return false;
  
  const blacklist = ['hello', 'hi', 'hey', 'thanks', 'thank you', 'ok', 'okay', 'yes', 'no', 'bye', 'goodbye'];
  if (blacklist.includes(q)) return false;
  
  const keywords = [
    'price', 'cost', 'rate', 'composition', 'content', 'ingredients', 'side effect', 'effects',
    'interactions', 'alternative', 'substitute', 'tablet', 'capsule', 'syrup', 'injection',
    'mg', 'ml', 'mcg', 'g', 'medicine', 'drug', 'manufacturer'
  ];
  if (keywords.some(k => q.includes(k))) return true;
  
  if (/\b[a-z]{3,}\s*\d+/i.test(q)) return true;
  
  const genericPatterns = /^(who|when|where|why|how are|how do|what are|tell me about life|explain politics|weather)/i;
  if (genericPatterns.test(q)) return false;
  
  return true;
}

const EMPATHETIC_SYSTEM = `You are Lune MedGuide, a helpful and intelligent AI assistant specializing in Indian medicines.

Be conversational, natural, and helpful - like a friendly pharmacist or medical advisor.

TONE:
- Talk naturally, not robotically
- Be warm and helpful
- Show intelligence and understanding
- Use varied phrasing

EXAMPLES OF GOOD RESPONSES:
- "Ah, looking for info on Azithral! It's an antibiotic containing Azithromycin, made by Alembic Pharmaceuticals. A pack of 3 tablets (500mg each) costs around ₹350. It's commonly prescribed for bacterial infections."
- "Duoflo 500? Great choice for respiratory infections. It's made by Cipla, costs about ₹132 for 5 tablets, and contains Azithromycin 500mg."
- "I see you're asking about Dolo 650. It's a popular paracetamol-based fever reducer. Manufactured by Micro Labs, usually costs ₹30-35 for a strip of 15 tablets."
- "Hmm, I couldn't find 'duooflo' but did you mean Duoflo? Let me know and I'll get you the details!"

WHEN USER JUST TYPES A MEDICINE NAME:
- Understand they want general information
- Provide: name, manufacturer, price, composition, what it's used for, pack size
- Be comprehensive but concise (3-5 sentences)

ALWAYS INCLUDE:
- Price (if available)
- Manufacturer
- Composition/Active ingredient
- Brief use case ("commonly used for...")
- Pack size/type

HANDLING TYPOS:
- Be understanding: "I think you meant..."
- Offer suggestions naturally
- Don't be pedantic

END WITH:
"This information is for educational purposes only. Please consult a licensed healthcare professional for proper diagnosis and treatment."

BE CONVERSATIONAL AND INTELLIGENT - you're a smart AI, not a rigid system!`;

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

  const comp = m.match(/(?:content|composition|ingredients?)(?:\s+(?:of|in))?\s+([A-Za-z0-9\- ]+)/i);
  if (comp) return make({ medicine_name: comp[1].trim(), query_type: "composition", confidence: 0.9 });

  const pricePatterns = [
    /(?:price|cost|rate|how much)\s+(?:of|for|is)\s+(.+?)(?:\s+(?:by|from|tablet|capsule|syrup|$)|$)/i,
    /what\s+is\s+(?:the\s+)?(?:price|cost|rate)\s+(?:of|for)\s+(.+?)(?:\s+(?:by|from|tablet|capsule|syrup|$)|$)/i,
    /(.+?)\s+(?:actual|real|exact|current|latest)?\s*(?:price|cost|rate)(?:\s|$)/i
  ];
  
  for (const pattern of pricePatterns) {
    const match = m.match(pattern);
    if (match) {
      let name = match[1].trim();
      name = name.replace(/\b(actual|real|exact|current|latest|today|now)\b/gi, '').trim();
      if (name && !/^(what|show|tell|give|find|get|the)\b/i.test(name)) {
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
    const stopWords = ['what', 'tell', 'show', 'about', 'side', 'effect', 'tablet', 'capsule', 'actual', 'real', 'price', 'cost', 'rate'];
    if (!stopWords.includes(word)) {
      return make({
        medicine_name: singleWord[1],
        manufacturer: mfg ? mfg[1].trim() : null,
        type,
        confidence: 0.75
      });
    }
  }

  const system = 'You are a JSON extractor. Return ONLY valid JSON, no explanations, no markdown.';
  const user = `Extract medicine info from: "${message}"

RETURN ONLY THIS JSON (complete it fully):
{
"medicine_name": "name here",
"manufacturer": null,
"type": null,
"query_type": "price",
"confidence": 0.95
}

Valid query_type: price, composition, side_effects, alternatives, full_details`;

  const parsed = await getMistralJSON({ 
    user, 
    system, 
    temperature: 0, 
    top_p: 1, 
    maxTokens: 400
  });
  
  if (parsed && parsed.medicine_name) {
    return parsed;
  }
  
  return make();
}

async function findSimilarMedicines(searchTerm, limit = 5) {
  const term = searchTerm.toLowerCase().trim();
  const candidates = await Medicine.find({
    $or: [
      { name: { $regex: `^${escapeRegex(term.charAt(0))}`, $options: 'i' } },
      { name: { $regex: escapeRegex(term.substring(0, 3)), $options: 'i' } }
    ]
  }).select('name').limit(50).lean();

  const withDistance = candidates.map(med => ({
    name: med.name,
    distance: levenshteinDistance(term, med.name.toLowerCase())
  }));

  return withDistance.filter(m => m.distance <= 3).sort((a, b) => a.distance - b.distance).slice(0, limit).map(m => m.name);
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
  return Medicine.find(query).select('name manufacturer_name price type pack_size_label short_composition1 salt_composition').sort('price').limit(5).lean();
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

  const userPrompt = `User: "${originalMessage}"\nQuery: ${queryIntent.query_type}\nMedicine: ${JSON.stringify(slimPrimary)}\nAlternatives: ${JSON.stringify(slimAlts)}\n\nRespond naturally and friendly (2-5 sentences) focusing on ${queryIntent.query_type}. Include price, manufacturer, composition if available. Say "Information not available" for missing fields.`;

  const reply = await getMistralText({
    user: userPrompt,
    system: EMPATHETIC_SYSTEM,
    temperature: 0.3,
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
          "Azithral",
          "Dolo 650 price",
          "Paracetamol side effects"
        ]
      });
    }

    if (!isLikelyMedicineQuery(message)) {
      return res.json({
        success: false,
        reply: "I'd love to help! Could you tell me which medicine you're asking about? You can just type the name, or ask something specific.",
        examples: [
          "Azithral",
          "Dolo 650",
          "Paracetamol alternatives"
        ],
        tip: "Just type the medicine name - I'll understand!"
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
        reply: "I'd love to help! Could you tell me which medicine you're asking about? You can just type the name.",
        examples: [
          "Azithral",
          "Dolo 650 price",
          "Paracetamol alternatives"
        ],
        tip: "Just type the medicine name - I'll understand!"
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

    // NEW: Auto-fallback to Encyclopedia
    if (!medicines.length) {
      const similarNames = await findSimilarMedicines(cleaned || rawName);
      
      if (similarNames.length > 0) {
        return res.json({
          success: false,
          reply: `Hmm, I couldn't find "${rawName}" exactly. Did you mean one of these?`,
          suggestions: similarNames,
          tip: "Just type the correct name and I'll get you the details!"
        });
      }

      // Fallback to Encyclopedia
      console.log(`Medicine "${rawName}" not found in database. Switching to Encyclopedia...`);
      
      const encyclopediaPrompt = `You are a comprehensive pharmaceutical encyclopedia for the Lune healthcare app.

Provide evidence-based, educational information about medicines in a clear format.

RESPONSE STRUCTURE:
1. **Overview** - Brief 2-3 sentence summary
2. **Mechanism of Action** - How it works (simplified)
3. **Uses** - Primary indications
4. **Dosing** - General guidelines (mention to consult doctor)
5. **Side Effects** - Common and serious effects
6. **Interactions** - Major drug/food interactions
7. **Precautions** - Who should avoid it

TONE: Clear, educational, empathetic
LENGTH: 300-500 words`;

      const encyclopediaReply = await getMistralText({
        user: message,
        system: encyclopediaPrompt,
        temperature: 0.4,
        top_p: 0.95,
        maxTokens: 1200,
        model: 'mistral-large-latest'
      });

      const fullReply = `${encyclopediaReply}\n\n---\n\n📚 **Note:** This medicine was not found in our Indian medicines database, so I've provided general pharmaceutical information instead.\n\nFor India-specific brands and pricing, please check with local pharmacies.\n\n⚠️ **Disclaimer:** This is educational information only. Always consult qualified healthcare professionals before starting, stopping, or changing any medication.\n\n*Switched to Encyclopedia Mode*`;

      const result = {
        success: true,
        fallback: true,
        source: "encyclopedia",
        query: intent,
        reply: fullReply,
        matches: [],
        alternatives: [],
        metadata: {
          model: "mistral-large-latest",
          feature: "Medicine Encyclopedia (Fallback)",
          original_query: rawName
        }
      };

      queryCache.set(cacheKey, { timestamp: Date.now(), data: result });
      return res.json(result);
    }

    // When medicines ARE found in database
    const response = await generateResponse(intent, medicines, message);
    response.reply += "\n\nThis information is for educational purposes only. Please consult a licensed healthcare professional for proper diagnosis and treatment.";

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
