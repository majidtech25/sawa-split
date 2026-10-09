import { useEffect, useRef, useState } from "react"
import { supabase } from "./supabase"

const TABLES = ["transactions", "wallet_ledger_entries", "withdrawal_requests", "cash_debts"]

// Calls `onChange` (debounced) whenever a row the signed-in user can see changes in
// one of the money tables. Supabase Realtime applies RLS, so a producer or driver
// only hears about their own rows; the coordinator hears about all of them.
// Returns whether the live connection is up, for the "Live" indicator.
export function useLiveChanges(channelName, onChange) {
  const [live, setLive] = useState(false)
  const callback = useRef(onChange)
  useEffect(() => {
    callback.current = onChange
  }, [onChange])

  useEffect(() => {
    let timer = null
    const fire = () => {
      clearTimeout(timer)
      timer = setTimeout(() => callback.current(), 300)
    }
    const channel = supabase.channel(channelName)
    for (const table of TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, fire)
    }
    channel.subscribe((status) => setLive(status === "SUBSCRIBED"))
    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [channelName])

  return live
}
