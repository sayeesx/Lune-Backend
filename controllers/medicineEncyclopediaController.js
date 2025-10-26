// controllers/medicineEncyclopediaController.js
import { getMistralText } from "../utils/mistralClient.js";

const encyclopediaCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes for encyclopedia

export const medicineEncyclopediaController = async (req, res, next) => {
  try {
    const { message } = req.body;
    
    if (!message?.trim()) {
      return res.status(400).json({ 
        error: "Please ask a question about a medicine.",
        examples: [
          "How does metformin work?",
          "What are the side effects of aspirin?",
          "Can I take ibuprofen during pregnancy?",
          "What is the mechanism of action of lisinopril?"
        ]
      });
    }

    // Check cache
    const cacheKey = message.toLowerCase().trim();
    const cached = encyclopediaCache.get(cacheKey);
    if (cached?.timestamp && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json(cached.data);
    }

    const systemPrompt = `You are a comprehensive pharmaceutical encyclopedia and medical educator for the Lune healthcare app.

Your role is to provide evidence-based, educational information about medicines in a clear, structured format.

RESPONSE STRUCTURE:
1. **Overview** - Brief 2-3 sentence summary of the medicine
2. **Mechanism of Action** - How it works in the body (simplified for patients)
3. **Uses** - Primary indications and common off-label uses
4. **Dosing** - General adult dosing guidelines (mention to consult doctor)
5. **Side Effects** - Common and serious adverse effects
6. **Interactions** - Major drug, food, and supplement interactions
7. **Precautions** - Who should avoid it, pregnancy/breastfeeding, special populations
8. **Monitoring** - What to watch for while taking this medication

TONE:
- Clear, educational, and empathetic
- Use simple language, explain medical terms
- Be comprehensive but concise (300-500 words)
- Focus on patient education

IMPORTANT:
- Always emphasize consulting healthcare professionals
- Never provide personalized medical advice or dosing
- Use evidence-based information only
- If asked about specific brands or prices, say "For specific brand information and pricing in India, please use the Medicine Assistant feature."

HANDLE NON-MEDICINE QUERIES:
- Politely redirect to medicine-related topics
- Example: "I specialize in medicine information. Please ask about a specific medication."`;

    const reply = await getMistralText({
      user: message,
      system: systemPrompt,
      temperature: 0.4, // Lower for more factual responses
      top_p: 0.95,
      maxTokens: 1200,
      model: 'mistral-large-latest'
    });
    
    const fullReply = `${reply}\n\n---\n\n⚠️ **Medical Information Disclaimer**\n\nThis is general pharmaceutical information for educational purposes only. It is not a substitute for professional medical advice, diagnosis, or treatment. Always consult qualified healthcare professionals before starting, stopping, or changing any medication.\n\nFor specific brand names, prices, and availability in India, please use the **Medicine Assistant** feature.\n\n*Powered by Mistral AI - Medical Encyclopedia*`;
    
    const result = {
      success: true,
      reply: fullReply,
      metadata: {
        model: "mistral-large-latest",
        feature: "Medicine Encyclopedia",
        type: "general_knowledge"
      }
    };

    // Cache the result
    encyclopediaCache.set(cacheKey, { timestamp: Date.now(), data: result });

    res.json(result);
  } catch (err) {
    console.error("Medicine Encyclopedia Error:", err);
    next(err);
  }
};
