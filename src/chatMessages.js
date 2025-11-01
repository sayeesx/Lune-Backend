// src/services/chatMessages.js
import { supabase } from "../lib/supabase.js";

export async function saveUserMessage(chat_id, content) {
  const { error } = await supabase.from("chat_messages").insert({ chat_id, role: "user", content });
  if (error) throw new Error(`Failed to save user message: ${error.message}`);
}

export async function saveDoctorReply(chat_id, content) {
  const { error } = await supabase.from("chat_messages").insert({ chat_id, role: "doctor", content });
  if (error) throw new Error(`Failed to save AI reply: ${error.message}`);
}

export async function buildGroqMessages(chat_id, systemPrompt) {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("chat_id", chat_id)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to load conversation: ${error.message}`);

  const msgs = [{ role: "system", content: systemPrompt }];
  for (const row of data || []) {
    const role = row.role === "doctor" ? "assistant" : row.role;
    msgs.push({ role, content: row.content });
  }
  return msgs;
}
