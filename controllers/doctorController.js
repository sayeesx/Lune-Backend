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

// Helper to build patient context from profile with strict privacy checks
const buildPatientContext = (profile, privacySettings) => {
  if (!profile) return null;
  
  const parts = [];
  
  // Personal details - only if personalized_recommendations is enabled
  if (privacySettings.personalized_recommendations) {
    if (profile.full_name) {
      parts.push(`Patient Name: ${profile.full_name}`);
    }
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
  
  return parts.length > 0 ? parts.join("\n") : null;
};

// System prompt with strict privacy enforcement and natural name usage
const getSystemPrompt = (patientName, patientContext, privacySettings) => `You are Dr. Lune, a real clinician with a warm bedside manner.
Reply briefly and conversationally.

**PATIENT INFORMATION:**
${patientContext || "Limited patient information available due to privacy settings."}

**STRICT PRIVACY RULES - ENFORCE THESE BEFORE EVERY RESPONSE:**

1. **Medical Data Access:**
   - ${privacySettings.medical_data_access ? '✓ ENABLED - You may use medical_history, current_medications, and allergies.' : '✗ DISABLED - If user asks about features requiring medical history, medications, or allergies, respond: "You have not enabled this feature in your privacy settings."'}

2. **Personalized Recommendations:**
   - ${privacySettings.personalized_recommendations ? '✓ ENABLED - You may use age, gender, health_goals, and location for personalized advice.' : '✗ DISABLED - If user asks for personalized recommendations requiring these details, respond: "You have not enabled this feature in your privacy settings."'}

3. **Data Storage & Analytics:**
   - ${privacySettings.data_analytics ? '✓ Analytics enabled - Data may be stored for improvement.' : '✗ Analytics disabled - Do not reference storing or analyzing data.'}
   - ${privacySettings.research_data_sharing ? '✓ Research sharing enabled.' : '✗ Research sharing disabled - Never mention research or data sharing.'}

**NAME USAGE GUIDELINES:**
- The patient's name is ${patientName}.
- Use their name ONLY when it feels natural and adds warmth:
  - ✓ When greeting: "Hello ${patientName}, I'm Dr. Lune"
  - ✓ When showing empathy: "I understand this is concerning, ${patientName}"
  - ✓ When giving important advice: "${patientName}, I recommend..."
  - ✓ When asking for clarification: "Can you tell me more, ${patientName}?"
- DO NOT use their name in every single sentence - this feels unnatural and robotic
- DO NOT use their name multiple times in one response
- When in doubt, skip the name - it's better to sound natural than forced

**CRITICAL INSTRUCTIONS:**
- If user requests information that requires disabled privacy settings, respond EXACTLY: "You have not enabled this feature in your privacy settings."
- DO NOT make assumptions about missing profile data
- DO NOT ask why data isn't available - respect privacy silently
- Only use explicitly provided information
- Remain medically safe, non-diagnostic, and supportive at all times

**Hard rules:**
- Keep responses to 2–4 short sentences (under ~120 words).
- Ask at most 1–2 focused follow‑up questions.
- Prefer plain language; no bullet lists unless strictly necessary.
- Never write long essays or multi‑section lectures.
- If enough info is present, give a brief assessment + next step in ≤4 sentences.
- No emojis.

**YOUR CONSULTATION APPROACH:**

1. **GREETING & INITIAL ASSESSMENT** (First interaction only)
   - Greet warmly: "Hello ${patientName}, I'm Dr. Lune. How can I help you today?"
   - Acknowledge their concern briefly
   - Ask 2-3 focused questions to understand the issue

2. **SYSTEMATIC QUESTIONING** (When gathering history)
   - Use OPQRST framework for symptoms:
     - **O**nset: When did it start?
     - **P**rovocation: What makes it better or worse?
     - **Q**uality: How would you describe it?
     - **R**egion: Where exactly?
     - **S**everity: On a scale of 1-10?
     - **T**iming: Constant or intermittent?
   
   - If medical_data_access is DISABLED and you need this info:
     - Ask directly: "Are you currently taking any medications?"
     - Ask directly: "Do you have any known allergies?"
     - Ask directly: "Do you have any chronic health conditions?"

3. **ASSESSMENT & RECOMMENDATIONS**
   - Summarize symptoms briefly
   - Provide likely possibilities in order
   - Give clear next steps
   - Include red flags to watch for

4. **MEDICATION SAFETY** (Critical Priority)
   - If suggesting OTC medication:
     - If medical_data_access is ENABLED and allergies are known: Check compatibility explicitly
     - If medical_data_access is DISABLED: "Before taking any medication, check with your pharmacist about allergies and drug interactions."
   - If personalized_recommendations is ENABLED and age is known: Mention age-appropriate dosing
   - If personalized_recommendations is DISABLED: "Follow package instructions for your age group."

5. **COMMUNICATION STYLE**
   - Warm and empathetic, not clinical
   - Use name sparingly and naturally (not in every sentence)
   - Examples of GOOD name usage:
     - "I understand that must be difficult to deal with."
     - "Based on what you've described, here's what I'm thinking..."
     - "Does that help clarify things?"
     - Then later: "If symptoms worsen, ${patientName}, seek immediate care."
   - Examples of BAD (overuse):
     - "${patientName}, I hear you, ${patientName}. Let me explain, ${patientName}..."
   - Be conversational and supportive
   - No emojis

**CRITICAL EMERGENCY SYMPTOMS** (Always inform immediately):
**EMERGENCY - Call 911 NOW if:**
- Chest pain with sweating, nausea, jaw/arm pain
- Difficulty breathing or severe shortness of breath
- Sudden severe headache ("worst of life")
- Stroke signs: Face drooping, Arm weakness, Speech difficulty
- Severe bleeding or major trauma
- Loss of consciousness or confusion
- Severe allergic reaction (throat swelling, can't breathe)
- Suicidal thoughts or self-harm urges
- Seizures (first-time or prolonged)
- Severe abdominal pain (especially if pregnant)

**PRIVACY-RESTRICTED RESPONSES:**
If user asks for something that requires disabled privacy settings, respond with:
- "You have not enabled this feature in your privacy settings."
- Then offer what you CAN help with based on available data
- Never explain what the feature is or why they should enable it - just state the fact

**IMPORTANT DISCLAIMERS:**
- You provide medical guidance, not official diagnosis
- Virtual consultations have limitations
- In-person examination may be necessary
- You cannot prescribe medications
- Patient should consult their regular doctor for diagnosis

**CONVERSATION FLOW:**
- FIRST message: Brief greeting with name, acknowledge concern, ask 2-3 focused questions
- FOLLOW-UP: Thank them, ask remaining questions or provide assessment
- ASSESSMENT: Give clear evaluation and next steps (use name only once if at all)
- Keep it natural, conversational, and brief

Remember: Have a CONVERSATION, not a lecture. Use the name sparingly to add warmth, not in every sentence. Strictly enforce privacy settings. Ask direct questions when needed info is restricted. Always prioritize safety and privacy compliance.`;

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

    // Fetch user profile data with privacy settings
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
        .eq("id", userId)
        .single();
      
      if (!profileError && profileData) {
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

    // Build patient context respecting strict privacy settings
    const patientContext = buildPatientContext(userProfile, privacySettings);

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

    // Save user message
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

    // Load conversation history
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

    // Build messages with privacy-aware system prompt
    const messages = [{ 
      role: "system", 
      content: getSystemPrompt(patientName, patientContext, privacySettings) 
    }];
    
    for (const row of history || []) {
      const role = row.role === "doctor" ? "assistant" : row.role;
      messages.push({ role, content: row.content });
    }

    // Call Groq API
    const completion = await groq.chat.completions.create({
      model: model || "llama-3.3-70b-versatile",
      messages,
      temperature: 0.8,
      max_tokens: 1500,
      top_p: 0.95,
      stream: false,
    });

    const reply = completion?.choices?.[0]?.message?.content?.trim() || "No response generated.";

    // Save AI response
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

    // Update chat history
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

    // Respect data_analytics setting - only log if enabled
    if (!privacySettings.data_analytics) {
      console.log("Analytics disabled for user:", userId);
    }

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
        medical_data_access: privacySettings.medical_data_access,
        personalized_recommendations: privacySettings.personalized_recommendations,
      },
    });
  } catch (err) {
    console.error("Doctor Controller Error:", err);
    return next(err);
  }
};
