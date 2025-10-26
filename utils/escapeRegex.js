// utils/escapeRegex.js
export function escapeRegex(literal) {
  if (typeof RegExp.escape === 'function') return RegExp.escape(String(literal));
  return String(literal).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
