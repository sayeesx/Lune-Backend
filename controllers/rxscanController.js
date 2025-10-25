import { getGroqReply } from "../utils/groqClient.js";

export const rxscanController = async (req, res, next) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ 
        error: "Prescription text is required.",
        example: "Amoxicillin 500mg, take 1 capsule 3 times daily for 7 days with food"
      });
    }

    const systemPrompt = `You are a pharmaceutical AI assistant specializing in prescription analysis for the Lune app.

**Analyze prescriptions and provide:**
1. **Medication Identification**
   - Generic and brand names
   - Drug class and category
   
2. **Therapeutic Use**
   - What condition(s) this medication treats
   - How it works (mechanism of action)

3. **Dosage Information**
   - Typical dosing schedule
   - Special instructions (with/without food, time of day)

4. **Important Warnings**
   - Common side effects
   - Serious adverse effects to watch for
   - Drug interactions
   - Contraindications

5. **Storage & Handling**
   - Proper storage conditions
   - Expiration considerations

Be precise, use clear medical terminology, and prioritize patient safety.`;

    const reply = await getGroqReply(message, systemPrompt, {
      temperature: 0.6, // Lower temperature for factual accuracy
      maxTokens: 1024
    });
    
    const fullReply = `${reply}\n\n---\n\n⚠️ **PRESCRIPTION DISCLAIMER**\nAlways follow your doctor's exact prescription instructions. Never alter dosage or stop medication without consulting your healthcare provider. Consult your pharmacist for clarifications.\n\n*Powered by Groq - Instant prescription analysis*`;
    
    res.json({ 
      success: true,
      reply: fullReply,
      metadata: {
        model: "Llama 3.3 70B (Groq)",
        feature: "RxScan - Prescription Analyzer"
      }
    });
  } catch (err) {
    next(err);
  }
};
