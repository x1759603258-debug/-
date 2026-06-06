export function extractErrorMessage(raw: string, fallback: string) {
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string } | string;
      message?: string;
      title?: string;
      detail?: string;
      status?: number;
      retry_after?: number;
      cloudflare_error?: boolean;
    };
    if (parsed.cloudflare_error || parsed.status === 502 || (parsed.status !== undefined && parsed.status >= 520 && parsed.status <= 527) || /cloudflare|bad gateway|error 50[24]|error 52[0-7]/i.test(raw)) {
      return `上游 AI 服务暂时不可用（${parsed.status ?? 502}）。这是 api.wenxu339.com 源站/Cloudflare 返回的网关/超时错误，不是本地软件故障。${parsed.retry_after ? `建议 ${parsed.retry_after} 秒后重试。` : "建议稍后重试。"}`;
    }
    if (typeof parsed.error === "string") return parsed.error;
    return parsed.error?.message ?? parsed.message ?? parsed.detail ?? parsed.title ?? (raw || fallback);
  } catch {
    if (/cloudflare|bad gateway|error 50[24]|error 52[0-7]|<html/i.test(raw)) {
      return "上游 AI 服务暂时不可用。这是 api.wenxu339.com 源站/Cloudflare 返回的网关/超时错误，不是本地软件故障。建议稍后重试。";
    }
    return raw || fallback;
  }
}

export async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(extractErrorMessage(text, fallback));
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text || fallback);
  }
}
