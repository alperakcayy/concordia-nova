// supabaseClient.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// 1️⃣ Supabase URL ve ANON KEY burada
const SUPABASE_URL = 'https://shkttorkfcnvkrwnkixf.supabase.co';      // -> kendi Supabase URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoa3R0b3JrZmNudmtyd25raXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY2NzY2ODAsImV4cCI6MjA3MjI1MjY4MH0.GgDA8tSgQoMhCt_BYZU3mCkKaErUs_SQVNeWdCGQOgI'; // -> kendi anon key

// 2️⃣ Supabase client oluştur
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,      // session'ı tarayıcıda sakla
    detectSessionInUrl: true   // redirect URL ile session yakala
  }
});

// 3️⃣ Debug için tarayıcıya ekle
try { window.supabase = supabase; } catch(e){}
