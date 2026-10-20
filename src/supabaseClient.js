import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasBackendConfig = Boolean(supabaseUrl && supabaseAnonKey);
export const isLocalPreview = import.meta.env.DEV && !hasBackendConfig;
export const supabase = hasBackendConfig ? createClient(supabaseUrl, supabaseAnonKey) : null;
