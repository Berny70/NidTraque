// /js/supabase.js
//    https://supabase.com/dashboard/project/pqozgsgytzntrqscevrt/settings/general
//    Berny70_chrono

const SUPABASE_URL = "https://pqozgsgytzntrqscevrt.supabase.co";
const SUPABASE_KEY = "sb_publishable_lPacACUx-QTq_-mV7DDc_g_xUQHDCsK";

// Initialisation UNIQUE (globale)
if (!window.supabaseClient) {
  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );
}
