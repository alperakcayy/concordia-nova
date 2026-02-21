import { supabase } from './supabaseClient.js';

const form = document.getElementById('registerForm');

form.addEventListener('submit', async (e) => {
  e.preventDefault(); // Sayfanın reload olmasını engeller

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    alert('Hata: ' + error.message);
  } else {
    alert('Kayıt başarılı! Lütfen emailini kontrol et.');
    console.log(data);
  }
});
