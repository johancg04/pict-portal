"use client";

import { createClient } from "@supabase/supabase-js";

// Public anon key only: it is meant for the browser. Row-level security on the
// `room_messages` table (see supabase/schema.sql) is what limits what it can do.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surfaced in the browser console so setup mistakes are obvious.
  console.warn(
    "[pict-portal] Falta NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY. Copia .env.local.example a .env.local.",
  );
}

export const supabase = createClient(
  url ?? "https://placeholder.supabase.co",
  anonKey ?? "placeholder",
  { auth: { persistSession: false } },
);
