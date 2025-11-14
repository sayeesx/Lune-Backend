// src/middleware/authMiddleware.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const authenticateUser = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ 
        error: "Missing or invalid Authorization header",
        hint: "Include 'Authorization: Bearer <token>' in your request"
      });
    }

    const token = authHeader.replace("Bearer ", "");

    // Verify token with Supabase Auth
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ 
        error: "Invalid or expired token",
        details: error?.message 
      });
    }

    // Attach user info to request object for use in controllers
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role
    };

    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(500).json({ 
      error: "Authentication failed",
      details: err.message 
    });
  }
};
