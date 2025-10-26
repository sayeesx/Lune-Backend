import { getGroqReply } from "../utils/groqClient.js";

export const medguideController = async (req, res, next) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ 
        error: "Medicine name or query is required.",
        example: "Tell me about Metformin"
      });
    }

    const systemPrompt = `You are a comprehensive medicine information specialist for the Lune healthcare app.

**Provide detailed medicine information including:**

1. **Basic Information**
   - Generic name and common brand names
   - Drug class and pharmacological category

2. **Mechanism of Action**
   - How the medication works in the body
   - Target systems or receptors

3. **Indications** (Uses)
   - Primary approved uses (on-label)
   - Common off-label uses (if applicable)

4. **Dosing Guidelines**
   - Typical adult dosages
   - Pediatric considerations (if applicable)
   - Dosage adjustments (renal/hepatic impairment)

5. **Side Effects**
   - Common side effects (>10%)
   - Serious adverse effects requiring immediate attention
   - Long-term use considerations

6. **Drug Interactions**
   - Major drug-drug interactions
   - Food-drug interactions
   - Supplement interactions

7. **Contraindications & Precautions**
   - Who should not take this medication
   - Special populations (pregnancy, breastfeeding, elderly)

8. **Monitoring**
   - Lab tests or parameters to monitor
   - Signs of effectiveness

Use evidence-based medical information and be comprehensive yet clear.`;

    const reply = await getGroqReply(message, systemPrompt, {
      temperature: 0.6,
      maxTokens: 1500 // More tokens for comprehensive info
    });
    
    const fullReply = `${reply}\n\n---\n\n⚠️ **MEDICATION INFORMATION DISCLAIMER**\nThis is general pharmaceutical information for educational purposes only. Always consult healthcare professionals for personalized medical advice. Never start, stop, or change medications without consulting your doctor.\n\n*Powered by Groq - Comprehensive medicine database*`;
    
    res.json({ 
      success: true,
      reply: fullReply,
      metadata: {
        model: "Llama 3.3 70B (Groq)",
        feature: "MedGuide - Medicine Encyclopedia"
      }
    });
  } catch (err) {
    next(err);
  }
};
