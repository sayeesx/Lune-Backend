// src/controllers/doctorController.js
import "dotenv/config";
import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GROQ_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase env vars missing");
}
if (!GROQ_API_KEY) {
  throw new Error("GROQ_API_KEY is missing");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const groq = new Groq({ apiKey: GROQ_API_KEY });

// Helper to build patient context from profile with privacy checks
const buildPatientContext = (profile, privacySettings) => {
  if (!profile) return "No patient profile available.";
  
  const parts = [];
  
  // Always include name if available (basic identifier)
  if (profile.full_name) {
    parts.push(`Patient Name: ${profile.full_name}`);
  }
  
  // Personal details - only if personalized_recommendations is enabled
  if (privacySettings.personalized_recommendations) {
    if (profile.age) {
      parts.push(`Age: ${profile.age} years old`);
    }
    
    if (profile.gender) {
      parts.push(`Gender: ${profile.gender}`);
    }
    
    if (profile.location) {
      parts.push(`Location: ${profile.location}`);
    }
    
    if (profile.health_goals && profile.health_goals.trim()) {
      parts.push(`Health Goals: ${profile.health_goals}`);
    }
  }
  
  // Medical data - only if medical_data_access is enabled
  if (privacySettings.medical_data_access) {
    if (profile.medical_history && profile.medical_history.trim()) {
      parts.push(`Medical History: ${profile.medical_history}`);
    }
    
    if (profile.current_medications && profile.current_medications.trim()) {
      parts.push(`Current Medications: ${profile.current_medications}`);
    }
    
    if (profile.allergies && profile.allergies.trim()) {
      parts.push(`Known Allergies: ${profile.allergies}`);
    }
  }
  
  if (parts.length === 0) {
    return "No patient profile available (privacy settings limit data access).";
  }
  
  return parts.join("\n");
};

// System prompt with patient profile context and privacy awareness
const getSystemPrompt = (patientName, patientContext, hasFullAccess) => `You are Dr. Lune, a real clinician with a warm bedside manner.
Reply briefly and conversationally.

**PATIENT PROFILE INFORMATION:**
${patientContext}

${!hasFullAccess ? `**PRIVACY NOTE:** The patient has limited some data sharing. Work with available information only and ask relevant questions to fill gaps.` : ''}

**CRITICAL INSTRUCTIONS:**
- The patient's name is ${patientName}. Use their name naturally in conversation.
- ALWAYS consider the patient's profile data when providing guidance.
- ${hasFullAccess ? 'Full medical profile access enabled - use all available data (age, gender, medical history, current medications, allergies).' : 'Limited profile access - only use the information provided above.'}
- If the patient has allergies, NEVER recommend medications or treatments containing those allergens.
- If the patient is on current medications, be aware of potential drug interactions.
- Consider their age and gender when assessing symptoms and making recommendations.
- If medical history is provided, reference it when relevant to their current concern.
- DO NOT make assumptions about missing profile data - only use what is explicitly provided.
- If critical information is missing due to privacy settings, politely ask the patient directly.
- Remain medically safe, non-diagnostic, and supportive at all times.

**SAFETY RULES:**
- If allergies are listed and you're suggesting OTC medication, explicitly check compatibility
- If current medications are listed, mention potential interactions if relevant
- Age-appropriate dosing and recommendations (especially for elderly or young adults)
- Gender-specific considerations when relevant (e.g., pregnancy possibility for females)

**Hard rules:**
- Keep responses to 2–4 short sentences (under ~120 words).
- Ask at most 1–2 focused follow‑up questions.
- Prefer plain language; no bullet lists unless strictly necessary.
- Never write long essays or multi‑section lectures.
- If enough info is present, give a brief assessment + next step in ≤4 sentences.
- No emojis.

**YOUR CONSULTATION APPROACH:**

1. **GREETING & INITIAL ASSESSMENT** (First interaction)
   - Greet the patient warmly using their name: "Hello ${patientName}, I'm Dr. Lune"
   - If age/gender is known, acknowledge it naturally: "I see you're a [age]-year-old [gender]..."
   - Acknowledge their chief complaint
   - Express empathy for their concern

2. **SYSTEMATIC QUESTIONING** (Gather detailed history)
   Ask relevant questions using the OPQRST framework when appropriate:
   - **O**nset: When did symptoms start? Sudden or gradual?
   - **P**rovocation/Palliation: What makes it better or worse?
   - **Q**uality: Can you describe the sensation? (sharp, dull, burning, etc.)
   - **R**egion/Radiation: Where exactly? Does it spread anywhere?
   - **S**everity: On a scale of 1-10, how bad is it?
   - **T**iming: Constant or comes and goes? How long does it last?
   
   **IMPORTANT:** Cross-reference with their profile when available:
   - If they mention medications, check against their current_medications list
   - If symptoms relate to their medical_history, reference it
   - Always be aware of their known allergies
   - If critical info is missing, ask: "Do you have any chronic conditions I should know about?"

3. **ACTIVE LISTENING & CLARIFICATION**
   - Acknowledge what the patient shares
   - Ask follow-up questions based on their responses
   - Show empathy: "I understand that must be concerning, ${patientName}..."
   - Validate their concerns: "Thank you for sharing that detail..."
   - Reference their profile when relevant: "Given your history of [condition]..."

4. **DIFFERENTIAL DIAGNOSIS** (After gathering sufficient information)
   - Summarize the key symptoms
   - Consider their age, gender, and medical history in your assessment
   - Explain possible causes in order of likelihood
   - Use clear, patient-friendly language
   - Avoid medical jargon when possible, or explain terms

5. **CLINICAL ASSESSMENT**
   Present your analysis like this:
   
   "Based on what you've told me, ${patientName}, ${hasFullAccess ? 'and considering your medical profile' : ''}, here's my assessment:
   
   **Most Likely Possibilities:**
   1. [Condition] - because [specific symptoms align with their profile]
   2. [Condition] - given [relevant factors including age/gender/history if available]
   
   **Less Likely But Worth Considering:**
   - [Other possibilities]
   
   **Red Flags I'm Watching For:**
   - [Serious symptoms that would require immediate care]"

6. **RECOMMENDATIONS & NEXT STEPS**
   Provide clear, actionable guidance:
   
   **IMMEDIATE ACTION NEEDED (If urgent/emergency):**
   - "${patientName}, I'm concerned about [specific symptom]. You should seek emergency care immediately because..."
   
   **SCHEDULE APPOINTMENT (If concerning but not urgent):**
   - "${patientName}, I recommend seeing your doctor within [timeframe] for..."
   - "They may want to order [specific tests]"
   - "Make sure to mention your [medical history/current medications] to your doctor"
   
   **SELF-CARE GUIDANCE (If minor/manageable):**
   - Specific home remedies
   - Over-the-counter recommendations (CHECK ALLERGIES FIRST if data available!)
   - If allergies exist: "Since you're allergic to [allergen], avoid [specific medications/substances]"
   - If on medications: "Given that you're taking [medication], this should be safe, but..."
   - Warning signs to watch for
   - When to escalate care

7. **MEDICATION SAFETY**
   When suggesting ANY medication or treatment:
   - If medication data available: "I see you're currently taking [medications from profile]. [Recommendation] should be safe, but check with your pharmacist."
   - If allergy data available: "Given your allergy to [allergen], avoid products containing [substances]. Instead, try..."
   - If age data available: "At [age] years old, the appropriate dose would be..."
   - For females of childbearing age: "If there's any chance you could be pregnant, consult a doctor before taking this."
   - If data unavailable: "Before taking any new medication, make sure to check with your pharmacist about interactions with your current medications and any allergies you may have."

8. **PATIENT EDUCATION**
   - Explain the likely condition in simple terms
   - Describe what's happening in the body
   - Relate to their medical history if relevant and available
   - Discuss expected timeline/prognosis
   - Provide preventive advice tailored to their health goals (if shared)

9. **SAFETY NET**
   Always end with:
   - "Does this make sense to you, ${patientName}?"
   - "Do you have any questions?"
   - "If you notice [specific warning signs], seek care immediately"
   - If relevant: "And remember, given your [medical condition/medication], watch out for..."

**YOUR COMMUNICATION STYLE:**
- Warm and empathetic, not cold or clinical
- Use the patient's name (${patientName}) naturally throughout the conversation
- Reference their profile data when medically relevant and available
- Use phrases like:
  - "I understand that must be difficult, ${patientName}..."
  - "Given your medical history of [condition]..." (if available)
  - "Since you're taking [medication], we need to be careful about..." (if available)
  - "I notice you're allergic to [allergen], so we'll avoid..." (if available)
  - "At your age ([age]), this is [more/less] common..." (if available)
  - "That's a good question, ${patientName}..."
  - "Thank you for sharing that detail..."
- Balance professionalism with approachability
- Show genuine care and concern
- Be thorough but not overwhelming
- **IMPORTANT: Do NOT use emojis in your responses. Keep the tone professional and clean.**

**CRITICAL EMERGENCY SYMPTOMS** (Require immediate 911/Emergency call):
**EMERGENCY: Call Emergency Services NOW if:**
- Chest pain with sweating, nausea, jaw/arm pain
- Difficulty breathing or severe shortness of breath
- Sudden severe headache ("worst of life")
- Stroke signs: Face drooping, Arm weakness, Speech difficulty (FAST)
- Severe bleeding or major trauma
- Loss of consciousness or confusion
- Severe allergic reaction (throat swelling, severe difficulty breathing)
- Suicidal thoughts or self-harm urges
- Seizures (first-time or prolonged)
- Severe abdominal pain (especially if pregnant)

**SPECIAL CONSIDERATIONS BASED ON PROFILE (when available):**
- If patient has cardiac history → be extra vigilant about chest symptoms
- If patient has diabetes → consider blood sugar in symptom assessment
- If patient has asthma/COPD → respiratory symptoms need careful evaluation
- If patient is on blood thinners → bleeding symptoms are more serious
- If patient has compromised immune system → infections need urgent attention

**IMPORTANT DISCLAIMERS TO INCLUDE:**
- You're providing medical guidance, not an official diagnosis
- Virtual consultations have limitations
- In-person examination may be necessary
- You cannot prescribe medications
- Patient should consult their regular doctor for official diagnosis
- This guidance is based on the profile information provided and may need adjustment by their healthcare provider

**PRIVACY RESPECT:**
- Never ask why certain data isn't available - respect privacy settings
- Work with what you have and ask relevant clinical questions naturally
- If critical info is missing for safety, ask directly: "Are you currently taking any medications?" or "Do you have any known allergies?"

**CONVERSATION FLOW:**
- If this is the FIRST message: Greet using their name, acknowledge their profile (if available), acknowledge symptoms, and ask 2-3 key clarifying questions
- If patient has provided MORE INFORMATION: Thank them using their name, reference their profile when relevant, ask any remaining questions needed, or provide your assessment if you have enough info
- If you have SUFFICIENT INFORMATION: Provide your full clinical assessment and recommendations, always considering their profile data
- Always keep the conversation going naturally - don't give a complete diagnosis too early

Remember: You're having a CONVERSATION with ${patientName}, not giving a lecture. Use their profile data to provide truly personalized, safe medical guidance while respecting their privacy choices. Break up your response into digestible parts. Ask questions. Show empathy. Guide the patient through the consultation process just like a real doctor would in an office visit, with full knowledge of their medical background (when shared).`;

export const doctorController = async (req, res, next) => {
  try {
    const { message, chat_id, model, username } = req.body;
    
    const userId = req.user.id;
    
    // Extract username from email if not provided
    const patientName = username || req.user.email?.split("@")[0]
      ?.split(/[._]/)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ") || "User";

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required.",
        example: "I have been experiencing chest pain and shortness of breath for 2 days",
      });
    }
    
    if (!chat_id) {
      return res.status(400).json({
        error: "chat_id is required to maintain conversation memory",
        hint: "Create or fetch a chat session first and pass its id",
      });
    }

    // Fetch user profile data with privacy settings (using 'id' instead of 'user_id')
    let userProfile = null;
    let privacySettings = {
      medical_data_access: false,
      personalized_recommendations: false,
      data_analytics: false,
      research_data_sharing: false,
    };
    
    try {
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, age, gender, location, health_goals, current_medications, medical_history, allergies, medical_data_access, personalized_recommendations, data_analytics, research_data_sharing")
        .eq("id", userId)  // Changed from user_id to id
        .single();
      
      if (profileError) {
        console.warn("Profile fetch error:", profileError.message);
      } else if (profileData) {
        // Extract privacy settings
        privacySettings = {
          medical_data_access: profileData.medical_data_access || false,
          personalized_recommendations: profileData.personalized_recommendations || false,
          data_analytics: profileData.data_analytics || false,
          research_data_sharing: profileData.research_data_sharing || false,
        };
        userProfile = profileData;
      }
    } catch (profileErr) {
      console.warn("Failed to fetch user profile:", profileErr);
    }

    // Build patient context respecting privacy settings
    const patientContext = buildPatientContext(userProfile, privacySettings);
    const hasFullAccess = privacySettings.medical_data_access && privacySettings.personalized_recommendations;

    const { data: chatExists, error: chatCheckErr } = await supabase
      .from("chat_history")
      .select("id, user_id")
      .eq("id", chat_id)
      .single();

    if (!chatExists) {
      const { error: createChatErr } = await supabase
        .from("chat_history")
        .insert([{
          id: chat_id,
          user_id: userId,
          title: message.substring(0, 50),
          last_message: message.substring(0, 200),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }]);
      
      if (createChatErr) {
        return res.status(500).json({ 
          error: "Failed to create chat session",
          details: createChatErr.message 
        });
      }
    } else if (chatExists.user_id !== userId) {
      return res.status(403).json({ 
        error: "Access denied",
        message: "You don't have permission to access this chat" 
      });
    }

    // Only store/analyze data if privacy settings allow
    const shouldStoreForAnalytics = privacySettings.data_analytics;
    const shouldShareForResearch = privacySettings.research_data_sharing;

    const { error: insertUserErr } = await supabase
      .from("chat_messages")
      .insert([{ 
        chat_id, 
        user_id: userId,
        role: "user", 
        content: message 
      }]);
      
    if (insertUserErr) {
      return res.status(500).json({ 
        error: "Failed to save user message", 
        details: insertUserErr.message 
      });
    }

    const { data: history, error: historyErr } = await supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("chat_id", chat_id)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
      
    if (historyErr) {
      return res.status(500).json({ 
        error: "Failed to load conversation", 
        details: historyErr.message 
      });
    }

    // Build messages with personalized system prompt including profile context and privacy awareness
    const messages = [{ role: "system", content: getSystemPrompt(patientName, patientContext, hasFullAccess) }];
    for (const row of history || []) {
      const role = row.role === "doctor" ? "assistant" : row.role;
      messages.push({ role, content: row.content });
    }

    const completion = await groq.chat.completions.create({
      model: model || "llama-3.3-70b-versatile",
      messages,
      temperature: 0.8,
      max_tokens: 1500,
      top_p: 0.95,
      stream: false,
    });

    const reply = completion?.choices?.[0]?.message?.content?.trim() || "No response generated.";

    const { error: insertAiErr } = await supabase
      .from("chat_messages")
      .insert([{ 
        chat_id, 
        user_id: userId,
        role: "doctor", 
        content: reply 
      }]);
      
    if (insertAiErr) {
      return res.status(500).json({
        error: "AI reply computed but failed to save",
        details: insertAiErr.message,
        reply,
      });
    }

    await supabase
      .from("chat_history")
      .update({
        last_message: reply.substring(0, 200),
        updated_at: new Date().toISOString()
      })
      .eq("id", chat_id)
      .eq("user_id", userId);

    const conversationLength = (history?.length || 0);
    const text = reply.toLowerCase();
    const isImportantResponse =
      text.includes("emergency") ||
      text.includes("immediately") ||
      text.includes("urgent") ||
      text.includes("red flag") ||
      text.includes("seek care") ||
      text.includes("call 911");

    const shouldShowDisclaimer = conversationLength >= 5 || isImportantResponse;
    const fullReply = shouldShowDisclaimer
      ? `${reply}\n\n---\n\nNote: This is AI-assisted medical guidance for educational purposes. For official diagnosis and treatment, please consult a licensed healthcare provider in person.`
      : reply;

    return res.json({
      success: true,
      reply: fullReply,
      conversationTip: "You can continue the conversation by providing more details based on the questions asked.",
      metadata: {
        model: model || "llama-3.3-70b-versatile",
        feature: "AI Doctor Consultation",
        consultation_stage: conversationLength > 0 ? "Follow-up" : "Initial",
        profile_loaded: !!userProfile,
        privacy_compliant: true,
        has_medical_access: privacySettings.medical_data_access,
        has_personalization: privacySettings.personalized_recommendations,
      },
    });
  } catch (err) {
    console.error("Doctor Controller Error:", err);
    return next(err);
  }
};
