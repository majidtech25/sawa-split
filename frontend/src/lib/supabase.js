import { createClient } from "@supabase/supabase-js"

// Publishable key only: every read the browser makes is limited by Row Level
// Security to the signed-in user's own rows (CLAUDE.md section 5). Money-moving
// writes go through the API, never from here.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)

const PROFILE_KEY = "sawa.profile"

// The API's /auth/login returns Supabase session tokens plus who the user is.
export async function startSession(login) {
  const { error } = await supabase.auth.setSession({
    access_token: login.access_token,
    refresh_token: login.refresh_token,
  })
  if (error) throw error
  const profile = { role: login.role, producerId: login.producer_id, driverId: login.driver_id }
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  return profile
}

export function currentProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null
  } catch {
    return null
  }
}

export async function endSession() {
  localStorage.removeItem(PROFILE_KEY)
  await supabase.auth.signOut()
}
