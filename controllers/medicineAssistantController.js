// controllers/medicineAssistantController.js
import Medicine from "../models/Medicine.js";
import dbConnect from "../lib/mongodb.js";
import { getMistralJSON, getMistralText } from "../utils/mistralClient.js";
import { getCache, setCache, CACHE_KEYS, buildKey } from "../lib/redis.js";

function escapeRegex(literal) {
  if (typeof RegExp.escape === 'function') return RegExp.escape(String(literal));
  return String(literal).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanMedicineName(name) {
  if (!name) return '';
  let s = String(name).trim();
  s = s.replace(/\b(what is|tell me|show|about|the|content in|price of|rate of|side effects of|actual|real|exact|current|more about|information about)\b/gi, '').trim();
  s = s.replace(/\b(ware|where|were|wear|more|info|information|details|tell|please)\b/gi, '').trim();
  s = s.replace(/\b(for|of|with|in)\s+\d+\s*(pieces?|tablets?|capsules?|strips?|ml|mg|gm?|bottles?|packs?)\b/gi, '').trim();
  s = s.replace(/\b\d+\s*(pieces?|tablets?|capsules?|strips?|ml|mg|gm?|bottles?|packs?)\b/gi, '').trim();
  s = s.replace(/\b(pack|strip|bottle|box)\s+of\s+\d+\b/gi, '').trim();
  s = s.replace(/[-\s]+/g, ' ').trim();
  s = s.replace(/[^a-zA-Z0-9+\-\s]/g, '').trim();
  return s;
}

function normalizeSearchTerm(term) {
  return term.toLowerCase()
    .replace(/[o0]/g, 'o')
    .replace(/[l1]/g, 'l')
    .replace(/[s5]/g, 's')
    .replace(/[i1]/g, 'i')
    .trim();
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

function calculateSimilarity(str1, str2) {
  const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
  const maxLength = Math.max(str1.length, str2.length);
  return ((maxLength - distance) / maxLength) * 100;
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
    'mg', 'ml', 'mcg', 'g', 'medicine', 'drug', 'manufacturer', 'pieces', 'pack', 'strip'
  ];
  if (keywords.some(k => q.includes(k))) return true;
  
  if (/\b[a-z]{3,}\s*\d+/i.test(q)) return true;
  
  const genericPatterns = /^(who|when|where|why|how are|how do|what are|tell me about life|explain politics|weather)/i;
  if (genericPatterns.test(q)) return false;
  
  return true;
}

const FOCUSED_SYSTEM = `You are Lune MedGuide. Respond ONLY to what the user asked.

Rules:
- If they ask about PRICE → mention price, manufacturer, and available pack sizes
- If they ask about COMPOSITION → mention only composition/ingredients
- If they ask about ALTERNATIVES → mention alternatives with similar composition
- If they ask about SIDE EFFECTS → mention only side effects
- For general queries → brief summary (name, manufacturer, price, composition, use)

Keep responses 2-4 sentences, conversational and friendly.

Always end with: "This is for educational purposes only. Consult a healthcare professional."`;

// NEW: Focused encyclopedia system prompt
const ENCYCLOPEDIA_SYSTEM = `You are a focused pharmaceutical assistant. Answer ONLY what the user specifically asked about the medicine.

Response rules based on query type:
- PRICE query → "I don't have specific Indian pricing data for this medicine. Please check with local pharmacies for current prices."
- COMPOSITION query → Provide composition/active ingredients in 2-3 sentences
- SIDE EFFECTS query → List common and serious side effects in 3-4 sentences
- ALTERNATIVES query → Suggest alternatives with similar composition in 2-3 sentences
- GENERAL query → Brief overview (what it is, main use, key composition) in 3-4 sentences

Keep responses SHORT (3-5 sentences max), factual, and directly answering the question.

Always end with: "This is general information. For India-specific brands and pricing, consult local pharmacies. Always consult a healthcare professional."`;

async function extractQueryIntent(message) {
  const m = String(message || '').trim();

  const make = (overrides = {}) => ({
    medicine_name: null,
    manufacturer: null,
    type: null,
    query_type: "full_details",
    confidence: 0.7,
    packaging_context: null,
    ...overrides
  });

  const packagingMatch = m.match(/\b(?:for|of|with)?\s*(\d+)\s*(pieces?|tablets?|capsules?|strips?|ml|mg|bottles?|packs?)\b/i);
  const packagingContext = packagingMatch ? `${packagingMatch[1]} ${packagingMatch[2]}` : null;

  const stopwordsPattern = /\b(what|how|do|does|did|you|think|about|is|are|the|tell|me|show|give|looking|for|search|want|need|know|opinion|thoughts|view|feel)\b/gi;
  const cleanedMessage = m.replace(stopwordsPattern, '').trim();

  const comp = m.match(/(?:content|composition|ingredients?)(?:\s+(?:of|in))?\s+([A-Za-z0-9\- ]+)/i);
  if (comp) return make({ medicine_name: comp[1].trim(), query_type: "composition", confidence: 0.9, packaging_context: packagingContext });

  const pricePatterns = [
    /(?:price|cost|rate|how much)\s+(?:of|for|is)\s+(.+?)(?:\s+(?:for|of|by|from|tablet|capsule|syrup|pieces?|$)|$)/i,
    /what\s+is\s+(?:the\s+)?(?:price|cost|rate)\s+(?:of|for)\s+(.+?)(?:\s+(?:for|of|by|from|tablet|capsule|syrup|pieces?|$)|$)/i,
    /(.+?)\s+(?:actual|real|exact|current|latest)?\s*(?:price|cost|rate)(?:\s|$)/i
  ];
  
  for (const pattern of pricePatterns) {
    const match = m.match(pattern);
    if (match) {
      let name = match[1].trim();
      name = name.replace(/\b(actual|real|exact|current|latest|today|now)\b/gi, '').trim();
      name = name.replace(/\b(?:for|of|with)?\s*\d+\s*(?:pieces?|tablets?|capsules?|strips?|ml|mg|bottles?|packs?)\b/gi, '').trim();
      if (name && !/^(what|show|tell|give|find|get|the|is|are)$/i.test(name)) {
        return make({ medicine_name: name, query_type: "price", confidence: 0.9, packaging_context: packagingContext });
      }
    }
  }

  const altTo = m.match(/(?:alternative|similar|substitute)(?:s)?\s+(?:to|for)\s+(.+?)(?:\s+(?:by|from|tablet|capsule|syrup|$)|$)/i);
  if (altTo) return make({ medicine_name: altTo[1].trim(), query_type: "alternatives", confidence: 0.9, packaging_context: packagingContext });

  const altFrom = m.match(/(.+?)\s+(?:alternative|similar|substitute)(?:s)?(?:\s|$)/i);
  if (altFrom) {
    const name = altFrom[1].trim();
    if (!/^(what|show|tell|give|find|get)$/i.test(name)) {
      return make({ medicine_name: name, query_type: "alternatives", confidence: 0.9, packaging_context: packagingContext });
    }
  }

  const se = m.match(/(?:side effects?|effects?|reactions?)\s+(?:of|for|from)\s+(.+?)(?:\s+(?:by|from|tablet|capsule|syrup|$)|$)/i);
  if (se) return make({ medicine_name: se[1].trim(), query_type: "side_effects", confidence: 0.9, packaging_context: packagingContext });

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
      confidence: 0.8,
      packaging_context: packagingContext
    });
  }

  const withDose = m.match(/\b([a-z]+)\s+(\d+(?:\.\d+)?)\s*(?:mg|ml|mcg|g)?\b/i);
  if (withDose) {
    return make({
      medicine_name: `${withDose[1]} ${withDose[2]}`,
      manufacturer: mfg ? mfg[1].trim() : null,
      type,
      confidence: 0.85,
      packaging_context: packagingContext
    });
  }

  const singleWord = m.match(/\b([a-z]{3,})\b/i);
  if (singleWord) {
    const word = singleWord[1].toLowerCase();
    const stopWords = [
      'what', 'tell', 'show', 'about', 'side', 'effect', 'tablet', 'capsule', 
      'price', 'cost', 'rate', 'the', 'for', 'and', 'with', 'you', 'think', 
      'opinion', 'thoughts', 'view', 'feel', 'how', 'when', 'where', 'pieces', 'pack'
    ];
    if (!stopWords.includes(word)) {
      return make({
        medicine_name: singleWord[1],
        manufacturer: mfg ? mfg[1].trim() : null,
        type,
        confidence: 0.75,
        packaging_context: packagingContext
      });
    }
  }

  if (cleanedMessage.length >= 3) {
    const words = cleanedMessage.split(/\s+/).filter(w => {
      const wl = w.toLowerCase();
      const filterWords = [
        'you', 'think', 'opinion', 'thoughts', 'view', 'feel', 'how', 'when', 
        'where', 'why', 'which', 'what', 'who', 'can', 'could', 'would', 'should',
        'pieces', 'tablets', 'capsules', 'strips', 'pack', 'bottle'
      ];
      return w.length >= 3 && !filterWords.includes(wl) && !/^\d+$/.test(w);
    });
    
    if (words.length > 0) {
      const medicineName = words[words.length - 1];
      return make({
        medicine_name: medicineName.trim(),
        confidence: 0.7,
        packaging_context: packagingContext
      });
    }
  }

  return make({ medicine_name: m.length >= 3 ? m : null, confidence: 0.3, packaging_context: packagingContext });
}

async function findHighlySimilarMedicines(searchTerm, minSimilarity = 70, limit = 5) {
  const term = normalizeSearchTerm(searchTerm);
  
  const candidates = await Medicine.find({
    name: { $regex: escapeRegex(term.substring(0, Math.min(4, term.length))), $options: 'i' }
  }).select('name').limit(50).lean();

  const withSimilarity = candidates.map(med => ({
    name: med.name,
    similarity: calculateSimilarity(term, med.name)
  }));

  return withSimilarity
    .filter(m => m.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

async function findAlternatives(medicine) {
  if (!medicine?.short_composition1 && !medicine?.salt_composition) return [];
  const query = {
    $or: [
      ...(medicine.short_composition1 ? [{ short_composition1: medicine.short_composition1 }] : []),
      ...(medicine.salt_composition ? [{ salt_composition: medicine.salt_composition }] : [])
    ],
    manufacturer_name: { $ne: medicine.manufacturer_name },
    is_discontinued: false
  };
  return Medicine.find(query).select('name manufacturer_name price type pack_size_label short_composition1').sort('price').limit(5).lean();
}

async function generateResponse(queryIntent, medicines, originalMessage) {
  if (!medicines?.length) {
    return {
      reply: `Sorry, I couldn't find "${queryIntent.medicine_name}" in our database.`,
      matches: [],
      alternatives: []
    };
  }

  const primary = medicines[0];
  const slimPrimary = pickMedicineFields(primary);
  const alternatives = await findAlternatives(primary);
  const slimAlts = alternatives.map(pickMedicineFields);

  const packagingNote = queryIntent.packaging_context 
    ? `\nUser asked specifically about: ${queryIntent.packaging_context}. Mention this if relevant to pricing/availability.` 
    : '';

  const userPrompt = `User: "${originalMessage}"\nQuery Type: ${queryIntent.query_type}\nMedicine: ${JSON.stringify(slimPrimary)}\nAlternatives: ${JSON.stringify(slimAlts)}${packagingNote}\n\nRespond in 2-4 sentences focusing ONLY on ${queryIntent.query_type}. Be conversational and include relevant pack sizes if discussing price.`;

  const reply = await getMistralText({
    user: userPrompt,
    system: FOCUSED_SYSTEM,
    temperature: 0.2,
    top_p: 1,
    maxTokens: 400
  });

  return { reply: reply.trim(), matches: [primary], alternatives };
}

// IMPROVED: Better database search with multiple strategies
async function searchMedicineInDatabase(medicineName) {
  const cleaned = cleanMedicineName(medicineName);
  const normalized = normalizeSearchTerm(cleaned || medicineName);

  const projection = 'name price manufacturer_name type pack_size_label short_composition1 salt_composition medicine_desc side_effects drug_interactions';

  console.log(`Searching for: "${normalized}" (from: "${medicineName}")`);

  // Strategy 1: Exact match (case-insensitive)
  let medicines = await Medicine.find({
    name: { $regex: `^${escapeRegex(normalized)}$`, $options: 'i' }
  }).select(projection).limit(5).lean();

  if (medicines.length > 0) {
    console.log(`✅ Exact match found: ${medicines.length}`);
    return medicines;
  }

  // Strategy 2: Starts with (handles "dolo 650", "dolo650", etc.)
  const normalizedNoSpace = normalized.replace(/\s+/g, '');
  medicines = await Medicine.find({
    $or: [
      { name: { $regex: `^${escapeRegex(normalized)}`, $options: 'i' } },
      { name: { $regex: `^${escapeRegex(normalizedNoSpace)}`, $options: 'i' } }
    ]
  }).select(projection).limit(5).lean();

  if (medicines.length > 0) {
    console.log(`✅ Prefix match found: ${medicines.length}`);
    return medicines;
  }

  // Strategy 3: Contains (broader search)
  medicines = await Medicine.find({
    $or: [
      { name: { $regex: escapeRegex(normalized), $options: 'i' } },
      { name: { $regex: escapeRegex(normalizedNoSpace), $options: 'i' } }
    ]
  }).select(projection).limit(10).lean();

  if (medicines.length > 0) {
    console.log(`✅ Contains match found: ${medicines.length}`);
    return medicines;
  }

  // Strategy 4: Similarity search
  console.log(`No matches. Checking similar medicines...`);
  const similarMedicines = await findHighlySimilarMedicines(normalized, 70, 5);
  
  if (similarMedicines.length > 0) {
    return { awaiting_confirmation: true, suggestions: similarMedicines };
  }

  return [];
}

export async function medicineAssistantController(req, res, next) {
  try {
    const { message } = req.body || {};
    if (!message?.trim()) {
      return res.status(400).json({
        error: "Please provide a medicine query",
        examples: ["Azithral", "Dolo 650 price", "Paracetamol side effects"]
      });
    }

    if (!isLikelyMedicineQuery(message)) {
      return res.json({
        success: false,
        reply: "I'd love to help! Could you tell me which medicine you're asking about?",
        examples: ["Azithral", "Dolo 650", "Paracetamol alternatives"],
        tip: "Just type the medicine name - I'll understand!"
      });
    }

    await dbConnect();

    const cacheKey = buildKey(CACHE_KEYS.MEDICINE_QUERY, message.toLowerCase().trim());
    
    const cached = await getCache(cacheKey);
    if (cached) {
      console.log('✅ Cache hit');
      return res.json(cached);
    }

    console.log('❌ Cache miss');

    const intent = await extractQueryIntent(message);
    
    if (!intent?.medicine_name || (intent.medicine_name.length < 2 && intent.confidence < 0.5)) {
      return res.json({
        success: false,
        reply: "I'd love to help! Could you tell me which medicine you're asking about?",
        examples: ["Azithral", "Dolo 650 price", "Paracetamol alternatives"],
        tip: "Just type the medicine name - I'll understand!"
      });
    }

    const searchResult = await searchMedicineInDatabase(intent.medicine_name);
    
    if (searchResult.awaiting_confirmation) {
      const suggestionResponse = {
        success: false,
        awaiting_confirmation: true,
        reply: `I couldn't find "${intent.medicine_name}" exactly. Did you mean one of these?`,
        suggestions: searchResult.suggestions.map(m => m.name),
        similarity_scores: searchResult.suggestions.map(m => Math.round(m.similarity)),
        tip: "Please type the correct medicine name from the suggestions above."
      };
      
      await setCache(cacheKey, suggestionResponse, 300);
      return res.json(suggestionResponse);
    }

    const medicines = Array.isArray(searchResult) ? searchResult : [];

    // NOT FOUND in database - Use Encyclopedia with focused response
    if (!medicines.length) {
      console.log(`Medicine "${intent.medicine_name}" not found. Using Encyclopedia...`);
      
      const encyclopediaPrompt = `User asked: "${message}"\nQuery type: ${intent.query_type}\nMedicine: ${intent.medicine_name}\n\nProvide a SHORT, focused answer (3-5 sentences) about ${intent.query_type === 'price' ? 'the medicine (but mention no Indian pricing available)' : intent.query_type}.`;

      const encyclopediaReply = await getMistralText({
        user: encyclopediaPrompt,
        system: ENCYCLOPEDIA_SYSTEM,
        temperature: 0.3,
        top_p: 0.95,
        maxTokens: 500,
        model: 'mistral-large-latest'
      });

      const encyclopediaResult = {
        success: true,
        source: "encyclopedia",
        query: intent,
        reply: encyclopediaReply.trim(),
        matches: [],
        alternatives: [],
        metadata: {
          model: "mistral-large-latest",
          feature: "Encyclopedia",
          note: "Not found in Indian medicines database"
        }
      };

      await setCache(cacheKey, encyclopediaResult, 600);
      return res.json(encyclopediaResult);
    }

    console.log(`✅ Found ${medicines.length} medicine(s)`);
    
    const response = await generateResponse(intent, medicines, message);

    const result = {
      success: true,
      source: "database",
      query: intent,
      ...response,
      metadata: {
        model: "mistral-large-latest",
        feature: "Lune MedGuide"
      }
    };

    await setCache(cacheKey, result, 300);

    return res.json(result);
  } catch (err) {
    console.error("Medicine Assistant Error:", err);
    return next(err);
  }
}
