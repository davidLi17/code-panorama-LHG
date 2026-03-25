import OpenAI from "openai";

export function normalizeBaseUrl(url: string): string {
  // 0. 如果url为空，直接返回
  if (!url) return url;
  // 1. 去除末尾多余的斜杠（例："/v1/" → "/v1"）
  let normalized = url.replace(/\/+$/, "");

  // 2. 剥离客户端会自动拼接的后缀（避免最终变成 /v1/chat/completions/chat/completions）
  normalized = normalized.replace(/\/chat\/completions$/, "");
  normalized = normalized.replace(/\/completions$/, "");

  // 3. 检查是否已包含版本号（例：/v1, /v2）
  if (/\/(v\d+)/i.test(normalized)) {
    return normalized; // 有版本号直接返回，不再追加
  }

  // 4. 啥都没有，补上默认的 /v1
  return `${normalized}/v1`;
}
export const llmBaseUrl = normalizeBaseUrl(
  process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
);
export const llmApiKey = process.env.LLM_API_KEY || "";
export const llmModel =
  process.env.LLM_MODEL || "google/gemini-3.1-flash-lite-preview";

const clientMap = new Map<string, OpenAI>();

export function getLlmClient(options?: { baseUrl?: string; apiKey?: string }) {
  const resolvedApiKey = String(options?.apiKey || llmApiKey || "").trim();
  if (!resolvedApiKey) {
    throw new Error("LLM_API_KEY is not exist.");
  }

  const resolvedBaseUrl = normalizeBaseUrl(options?.baseUrl || llmBaseUrl);
  const cacheKey = `${resolvedBaseUrl || "__default__"}::${resolvedApiKey}`;
  const hit = clientMap.get(cacheKey);
  if (hit) return hit;

  const client = new OpenAI({
    baseURL: resolvedBaseUrl,
    apiKey: resolvedApiKey,
    timeout: 120000,
  });

  clientMap.set(cacheKey, client);
  return client;
}

export function extractJsonFromText(text: string) {
  const trimmed = text.trim().replace(/^\uFEFF/, "");

  const sanitizeJsonControlCharsInStrings = (input: string) => {
    let out = "";
    let inString = false;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];

      if (inString) {
        if (escaped) {
          out += ch;
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          out += ch;
          escaped = true;
          continue;
        }
        if (ch === '"') {
          out += ch;
          inString = false;
          continue;
        }

        const code = ch.charCodeAt(0);
        // Escape illegal control chars only when they appear inside JSON strings.
        if (code <= 0x1f) {
          switch (ch) {
            case "\n":
              out += "\\n";
              break;
            case "\r":
              out += "\\r";
              break;
            case "\t":
              out += "\\t";
              break;
            case "\b":
              out += "\\b";
              break;
            case "\f":
              out += "\\f";
              break;
            default:
              out += `\\u${code.toString(16).padStart(4, "0")}`;
          }
          continue;
        }

        out += ch;
        continue;
      }

      if (ch === '"') {
        inString = true;
      }
      out += ch;
    }

    return out;
  };

  const tryParse = (candidate: string) => {
    try {
      return JSON.parse(candidate);
    } catch {
      return JSON.parse(sanitizeJsonControlCharsInStrings(candidate));
    }
  };

  try {
    return tryParse(trimmed);
  } catch {
    // Try fenced code block: ```json ... ```
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch?.[1]) {
      return tryParse(fenceMatch[1]);
    }

    // Fallback: find first JSON object block
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return tryParse(trimmed.slice(firstBrace, lastBrace + 1));
    }

    throw new Error("Model did not return valid JSON.");
  }
}
