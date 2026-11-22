import { createClient } from "@supabase/supabase-js";
import { supabasePublicKey, supabaseUrl } from "./supabase-env";

export const supabase = supabaseUrl && supabasePublicKey
  ? createClient(supabaseUrl, supabasePublicKey)
  : null;

export const hasSupabaseConfig = Boolean(supabase);
