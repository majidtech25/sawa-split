import { supabase } from "./supabase"

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "")

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// FastAPI puts a readable message in `detail` — a string for our own errors, a list
// of field errors for request validation.
function messageFrom(body, status) {
  const detail = body?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg.replace(/^Value error, /, "")
  return `Something went wrong (HTTP ${status}). Try again.`
}

export async function api(path, { method = "GET", body, auth = false } = {}) {
  const headers = {}
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (auth) {
    const { data } = await supabase.auth.getSession()
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`
  }
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, "Can't reach Sawa Split. Check the connection and try again.")
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, messageFrom(data, response.status))
  return data
}
