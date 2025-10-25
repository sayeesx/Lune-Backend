import { getGroqReply } from "../utils/groqClient.js";

export const labsenseController = async (req, res, next) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ 
        error: "Lab results are required.",
        example: "WBC: 15,000/µL, Hemoglobin: 10.2 g/dL, Platelets: 180,000/µL"
      });
    }

    const systemPrompt = `You are a clinical laboratory specialist AI for the Lune healthcare app, helping users understand their lab results.

**Interpret laboratory results by providing:**

1. **Test Identification**
   - Full name of the test
   - What the test measures
   - Why it's ordered

2. **Reference Ranges**
   - Normal ranges for this test
   - Age/gender-specific considerations

3. **Result Assessment**
   - Is the value normal, high, or low?
   - By how much (mild, moderate, severe deviation)?

4. **Clinical Significance**
   - What abnormal values might indicate
   - Possible causes (both benign and serious)
   - Related conditions

5. **Additional Context**
   - Factors that can affect results
   - Need for repeat testing
   - Correlation with other lab values

6. **Recommended Actions**
   - Urgency level (routine follow-up vs. immediate attention)
   - What questions to ask your doctor
   - Lifestyle modifications if applicable

**Important**: Emphasize that lab results must be interpreted in full clinical context by a healthcare provider.`;

    const reply = await getGroqReply(message, systemPrompt, {
      temperature: 0.6,
      maxTokens: 1024
    });
    
    const fullReply = `${reply}\n\n---\n\n⚠️ **LAB INTERPRETATION DISCLAIMER**\nLaboratory results require clinical context and professional interpretation. This AI analysis is educational only and NOT a diagnosis. ALWAYS discuss your lab results with your healthcare provider who knows your complete medical history, symptoms, and can perform physical examination.\n\n*Powered by Groq - Instant lab result interpretation*`;
    
    res.json({ 
      success: true,
      reply: fullReply,
      metadata: {
        model: "Llama 3.3 70B (Groq)",
        feature: "LabSense - Laboratory Result Interpreter"
      }
    });
  } catch (err) {
    next(err);
  }
};
