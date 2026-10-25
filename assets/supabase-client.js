import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';
const cfg = window.ARCH_FAMILY_CONFIG || {};
if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
  throw new Error('Не задана конфигурация Supabase. Проверьте config.js.');
}
export const supabase = createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
