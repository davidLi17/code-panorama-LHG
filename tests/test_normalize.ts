import { normalizeBaseUrl } from "../lib/openaiCompat";

const urls = [
  "https://api.openai.com",
  "https://api.openai.com/v1",
  "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  "https://open.bigmodel.cn/api/paas/v4",
];

urls.forEach((url) => {
  console.log(`Original: ${url} -> Normalized: ${normalizeBaseUrl(url)}`);
});
