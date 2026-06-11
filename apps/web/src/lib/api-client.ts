const API_URL = process.env.RAILWAY_API_URL ?? "http://localhost:4000"
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? ""

export async function apiClient<T>(
  path: string,
  options: RequestInit & { token?: string; internal?: boolean } = {}
): Promise<T> {
  // The localhost fallback only makes sense in local dev. In production a
  // missing RAILWAY_API_URL means every server action dials localhost inside
  // the Vercel function and dies with an unhelpful fetch error — fail loudly.
  if (!process.env.RAILWAY_API_URL && process.env.NODE_ENV === "production") {
    throw new Error("RAILWAY_API_URL 未設定（Vercel 環境變數）— server action 無法連到 API")
  }
  const { token, internal, ...fetchOptions } = options
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(internal && { "X-Internal-Secret": INTERNAL_SECRET }),
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...fetchOptions,
    headers: { ...headers, ...(fetchOptions.headers as Record<string, string>) },
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(`[${res.status}] ${error.message ?? error.error ?? res.statusText}`)
  }
  return res.json() as Promise<T>
}
