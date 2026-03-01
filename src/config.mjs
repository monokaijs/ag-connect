export const MODELS = [
  { label: 'Gemini 3.1 Pro (High)', modelUid: 'MODEL_PLACEHOLDER_M35' },
  { label: 'Gemini 3.1 Pro (Low)', modelUid: 'MODEL_PLACEHOLDER_M36' },
  { label: 'Gemini 3 Flash', modelUid: 'MODEL_PLACEHOLDER_M26' },
  { label: 'Claude Sonnet 4.6 (Thinking)', modelUid: 'MODEL_CLAUDE_4_5_SONNET_THINKING' },
  { label: 'Claude Opus 4.6 (Thinking)', modelUid: 'MODEL_PLACEHOLDER_M37' },
  { label: 'GPT-OSS 120B (Medium)', modelUid: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM' },
];

export const DEFAULT_MODEL_UID = 'MODEL_PLACEHOLDER_M35';

const quotaCache = new Map();
const QUOTA_TTL = 30_000;

export function getCachedQuota(key) {
  const entry = quotaCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > QUOTA_TTL) {
    quotaCache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCachedQuota(key, data) {
  quotaCache.set(key, { data, ts: Date.now() });
}

export function getAllCachedQuotas() {
  const result = {};
  for (const [key, entry] of quotaCache) {
    if (Date.now() - entry.ts <= QUOTA_TTL) {
      result[key] = entry.data;
    }
  }
  return result;
}
