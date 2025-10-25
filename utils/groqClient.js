import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

/**
 * Get AI response from Groq using Llama 3.3 70B
 * Ultra-fast inference optimized for medical queries
 * 
 * @param {string} userMessage - User's medical query
 * @param {string} systemPrompt - System instructions/context
 * @param {Object} options - Additional options
 * @returns {Promise<string>} - AI-generated response
 */
export const getGroqReply = async (userMessage, systemPrompt, options = {}) => {
  try {
    const {
      model = "llama-3.3-70b-versatile", // Best balance of speed & quality
      temperature = 0.7,
      maxTokens = 1024,
      topP = 0.95
    } = options;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      model: model,
      temperature: temperature,
      max_tokens: maxTokens,
      top_p: topP,
      stream: false,
    });

    return chatCompletion.choices[0]?.message?.content || "No response generated.";

  } catch (error) {
    console.error("Groq API Error:", error);
    
    // Handle specific error types
    if (error.status === 429) {
      throw new Error("Rate limit exceeded. Please try again in a moment.");
    } else if (error.status === 401) {
      throw new Error("Invalid API key. Please check your Groq API configuration.");
    } else if (error.status === 503) {
      throw new Error("Groq service temporarily unavailable. Please try again.");
    }
    
    throw new Error("AI service error. Please try again later.");
  }
};

/**
 * Stream responses for better UX (optional feature)
 */
export const getGroqStreamReply = async function* (userMessage, systemPrompt, options = {}) {
  try {
    const {
      model = "llama-3.3-70b-versatile",
      temperature = 0.7,
      maxTokens = 1024
    } = options;

    const stream = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      model: model,
      temperature: temperature,
      max_tokens: maxTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        yield content;
      }
    }

  } catch (error) {
    console.error("Groq Streaming Error:", error);
    throw error;
  }
};

/**
 * Health check for Groq API
 */
export const checkGroqHealth = async () => {
  try {
    const testResponse = await groq.chat.completions.create({
      messages: [{ role: "user", content: "test" }],
      model: "llama-3.3-70b-versatile",
      max_tokens: 5,
    });

    return {
      status: "healthy",
      model: "llama-3.3-70b-versatile",
      responseTime: Date.now(),
      available: true
    };
  } catch (error) {
    return {
      status: "unhealthy",
      error: error.message,
      available: false
    };
  }
};
