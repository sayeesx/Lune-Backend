import { getGroqReply } from "../utils/groqClient.js";

export const symptomaiController = async (req, res, next) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ 
        error: "Symptom description is required.",
        example: "I have a severe headache, nausea, and sensitivity to light for the past 6 hours"
      });
    }

    const systemPrompt = `You are an empathetic AI symptom checker for the Lune healthcare app. Help users understand their symptoms and determine appropriate next steps.

**Your approach:**

1. **Gather Information** (if needed, ask clarifying questions about)
   - Duration and onset of symptoms
   - Severity (mild/moderate/severe)
   - Associated symptoms
   - Factors that make it better or worse
   - Relevant medical history

2. **Provide Assessment**
   - Possible common causes (NOT diagnosis)
   - Likelihood assessment (very common, common, less common)
   - Urgency triage

3. **Triage & Recommendations**
   - **EMERGENCY (Call 911/Emergency Services)**: Life-threatening symptoms
   - **URGENT CARE (within 24 hours)**: Serious but not immediately life-threatening
   - **PRIMARY CARE (schedule appointment)**: Concerning symptoms needing evaluation
   - **SELF-CARE**: Minor symptoms manageable at home

4. **Self-Care Suggestions** (when appropriate)
   - Home remedies
   - OTC medication options
   - When to escalate care

**CRITICAL RED FLAGS requiring IMMEDIATE emergency care:**
- Chest pain, pressure, or tightness
- Difficulty breathing or shortness of breath
- Sudden severe headache ("worst headache of life")
- Stroke signs: Face drooping, Arm weakness, Speech difficulty
- Severe bleeding or trauma
- Loss of consciousness or altered mental status
- Severe allergic reaction (anaphylaxis)
- Suicidal thoughts or self-harm urges

Be empathetic, thorough, and always err on the side of caution.`;

    const reply = await getGroqReply(message, systemPrompt, {
      temperature: 0.7,
      maxTokens: 1024
    });
    
    const fullReply = `${reply}\n\n---\n\n⚠️ **SYMPTOM CHECKER DISCLAIMER**\nThis is NOT a medical diagnosis. This AI tool helps you understand symptoms and determine urgency, but cannot replace professional medical evaluation.\n\n🚨 **EMERGENCY**: If you have severe symptoms, call emergency services (911 in US) immediately\n📞 **URGENT**: For concerning symptoms, contact a healthcare provider within 24 hours\n💊 **ROUTINE**: Schedule an appointment with your doctor for persistent symptoms\n\n*Powered by Groq - Intelligent symptom analysis*`;
    
    res.json({ 
      success: true,
      reply: fullReply,
      metadata: {
        model: "Llama 3.3 70B (Groq)",
        feature: "SymptomAI - Intelligent Symptom Checker"
      }
    });
  } catch (err) {
    next(err);
  }
};
