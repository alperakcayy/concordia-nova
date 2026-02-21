'use strict';

import { supabase } from './supabaseClient.js';

/* ====== GLOBAL AYARLAR ====== */
let currentUser = null;           // supabase user id
let currentUserData = null;       // profile row
const PAGE_SIZE = 8;
let feedRendered = 0;
let isLoading = false;
let reachedEnd = false;
let realtimeChannel = null;

/* HELPERS */
function fmtTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleString('tr-TR', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  } catch {
    return String(ts);
  }
}

function escapeHTML(str) {
  return (str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

function debounce(fn, delay = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function showError(label, err) {
  console.error(label, err);
  const msg = (err && (err.message || err.error_description || JSON.stringify(err))) || 'Bilinmeyen hata';
  if (typeof alert === 'function') alert(`${label}: ${msg}`);
  else console.warn(`${label}: ${msg}`); // Node.js veya test ortamı için
}

/* FALLBACK AVATAR */
function fallbackAvatar(username) {
  const c = (username || 'U')[0].toUpperCase();
  const svg = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='100%' height='100%' fill='#222'/><text x='50%' y='56%' font-family='Arial' font-size='38' fill='#fff' text-anchor='middle' dominant-baseline='middle'>${c}</text></svg>`);
  return `data:image/svg+xml;charset=utf-8,${svg}`;
}

/* RENDER TEK TWEET (DOM) */
function renderSingleTweet(tweet, { prepend = true, isTemp = false } = {}) {
  const feed = document.getElementById('feed');
  if (!feed) return;

  // Duplicate check
  if (document.querySelector(`[data-tweet="${tweet.id}"]`)) return;

  const article = document.createElement('article');
  article.className = 'tweet';
  if (isTemp) article.classList.add('temp');
  article.setAttribute('data-tweet', tweet.id);

  // Profil bilgileri
  const profile = tweet.profiles || {};
  const username = profile.username || (tweet.user_id || '').slice(0, 6);
  const display = profile.display_name || username;
  const avatar = profile.avatar_url || fallbackAvatar(username);

  const headerHTML = `
    <header style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;" onclick="window.location.href='profile.html?id=${tweet.user_id}'">
      <img class="avatar" src="${escapeHTML(avatar)}" alt="avatar" width="48" height="48" style="border-radius:50%;object-fit:cover;background:#222;border:1px solid rgba(255,255,255,.08);">
      <div style="flex:1">
        <div class="name">${escapeHTML(display)} <span class="uname" style="margin-left:8px;color:#bbb;font-weight:500;font-size:13px">@${escapeHTML(username)}</span></div>
        <div class="time muted" style="color:#bbb;font-size:12px;margin-top:4px;">${fmtTime(tweet.created_at)}</div>
      </div>
      ${tweet.user_id !== currentUser ? `<div><button class="follow-btn" data-user="${tweet.user_id}" style="background:var(--accent);color:#fff;border:none;padding:4px 8px;border-radius:6px;font-size:12px;cursor:pointer;">${tweet._is_following ? 'Takibi Bırak' : 'Takip Et'}</button></div>` : ''}
    </header>`;

  const textHTML = `<p style="margin:10px 0 0 0;word-break:break-word;line-height:1.4;">${escapeHTML(tweet.text || '')}</p>`;
  const imgHTML = tweet.image_url ? `<div style="margin-top:8px;"><img src="${escapeHTML(tweet.image_url)}" alt="tweet-img" style="max-width:100%;border-radius:8px;height:auto;"></div>` : '';

  const actionsHTML = `
    <div class="actions" style="margin-top:10px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
      <button class="action like" onclick="window.__app_likeTweet('${tweet.id}')" style="background:transparent;border:none;color:#ddd;cursor:pointer;padding:6px 8px;border-radius:6px;display:flex;gap:6px;font-size:13px;transition:var(--transition);">
        <i class="fa-regular fa-heart"></i><span class="like-count">${tweet.likes_count || 0}</span>
      </button>
      <button class="action" onclick="window.__app_addComment('${tweet.id}')" style="background:transparent;border:none;color:#ddd;cursor:pointer;padding:6px 8px;border-radius:6px;display:flex;gap:6px;font-size:13px;transition:var(--transition);">
        <i class="fa-solid fa-comment"></i><span>Yorum</span>
      </button>
      <button class="action" onclick="window.location.href='profile.html?tweetId=${tweet.id}'" style="background:transparent;border:none;color:#ddd;cursor:pointer;padding:6px 8px;border-radius:6px;display:flex;gap:6px;font-size:13px;transition:var(--transition);">
        <i class="fa-solid fa-eye"></i><span>Detay</span>
      </button>
      ${tweet.user_id === currentUser ? 
        `<button class="action" onclick="window.__app_deleteTweet('${tweet.id}')" style="background:transparent;border:none;color:var(--danger);cursor:pointer;padding:6px 8px;border-radius:6px;display:flex;gap:6px;font-size:13px;transition:var(--transition);">
          <i class="fa-solid fa-trash"></i><span>Sil</span>
        </button>` : ''}
    </div>`;

  article.innerHTML = headerHTML + textHTML + imgHTML + actionsHTML;

  // Follow button listener
  const followBtn = article.querySelector('.follow-btn');
  if (followBtn) {
    followBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const targetId = e.currentTarget.getAttribute('data-user');
      if (!currentUser) { alert('Takip etmek için giriş yapın'); return; }
      if (e.currentTarget.textContent.trim() === 'Takip Et') {
        const success = await followUser(targetId);
        if (success) e.currentTarget.textContent = 'Takibi Bırak';
      } else {
        const success = await unfollowUser(targetId);
        if (success) e.currentTarget.textContent = 'Takip Et';
      }
    });
  }

  if (prepend) feed.prepend(article);
  else feed.appendChild(article);
}

/* AUTH & PROFILE */
async function loadCurrentUser() {
  try {
    const { data } = await supabase.auth.getUser();
    const user = data?.user || null;
    if (!user) {
      currentUser = null;
      currentUserData = null;
      return;
    }
    currentUser = user.id;
    // Profilleri profiles tablosunda tuttuk: id = auth user id
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, bio')
      .eq('id', currentUser)
      .single();
    if (error && error.code !== 'PGRST116') showError('profile load', error); // ignore not found
    currentUserData = profile || null;
    // Update UI (ör. profile sayfasındaki email gösterme)
    const emailEl = document.getElementById('email');
    if (emailEl && user.email) emailEl.innerText = user.email;
  } catch (err) { showError('loadCurrentUser', err); }
}

export async function signUp(email, password, username = null, display_name = null) {
  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { showError('Kayıt hatası', error); return null; }

    // Eğer anında user dönmüşse (konfigürasyona bağlı), profile oluştur
    const userId = data?.user?.id || null;
    if (userId && (username || display_name)) {
      const { error: pErr } = await supabase.from('profiles').insert([{
        id: userId,
        username: username || ('u' + userId.slice(0, 6)),
        display_name: display_name || username || ('User ' + userId.slice(0, 6))
      }]);
      if (pErr) showError('profile create', pErr);
    }

    alert('Kayıt başarılı. Eğer e-posta doğrulama açıksa e-postanı kontrol et.');
    return data;
  } catch (err) { showError('signUp catch', err); return null; }
}

export async function signIn(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { showError('Giriş hatası', error); return null; }
    await loadCurrentUser();
    // Redirect profile page if exists
    if (window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/')) {
      window.location.href = 'profile.html';
    }
    return data;
  } catch (err) { showError('signIn catch', err); return null; }
}

export async function signOut() {
  try {
    await supabase.auth.signOut();
    currentUser = null;
    currentUserData = null;
    // Go to login
    window.location.href = 'index.html';
  } catch (err) { showError('signOut catch', err); }
}

/* TWEET ATMA - ÖN İZLEME + GERÇEK KAYIT */
export async function tweetAt() {
  try {
    if (!currentUser) { alert('Tweet atmak için giriş yap!'); return; }
    const txtEl = document.getElementById('tweetInput');
    const fileEl = document.getElementById('tweetImage');
    const file = fileEl?.files?.[0];
    const text = (txtEl.value || '').trim();
    if (!text && !file) { alert('Metin veya görsel gir.'); return; }

    const btn = document.getElementById('tweetBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Gönderiliyor...'; }

    const createdAt = new Date().toISOString();
    let publicImageUrl = null;

    // 1) Görsel varsa Supabase storage'a yükle
    if (file) {
      try {
        const uuid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
        const path = `${currentUser}/${uuid}-${file.name.replace(/\s+/g, '_')}`;
        const { data: uploadData, error: uploadErr } = await supabase.storage.from('tweet_images').upload(path, file);
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from('tweet_images').getPublicUrl(path);
        publicImageUrl = urlData?.publicUrl || null;
      } catch (imgErr) {
        console.warn('Image upload failed', imgErr);
        showError('Görsel yüklenirken hata', imgErr);
      }
    }

    // 2) Tweet'i DB'ye ekle
    const insertObj = {
      user_id: currentUser,
      text: text || null,
      image_url: publicImageUrl,
      created_at: createdAt
    };
    const { data: inserted, error: insertErr } = await supabase
      .from('tweets')
      .insert([insertObj])
      .select('id, user_id, text, image_url, created_at, likes_count, profiles(id, username, display_name, avatar_url)')
      .single();

    if (insertErr) throw insertErr;

    // 3) DOM: Eklenen tweeti en başa koy
    renderSingleTweet(inserted, { prepend: true, isTemp: false });

    if (txtEl) txtEl.value = '';
    if (fileEl) fileEl.value = '';

  } catch (innerErr) {
    showError('tweetAt catch', innerErr);
  } finally {
    const btn = document.getElementById('tweetBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'Tweetle'; }
  }
}

/* TWEETLERİ ÇEKME / LİSTELEME (timeline) */
async function fetchTimeline(offset = 0, limit = PAGE_SIZE) {
  try {
    // Eğer giriş yapılmışsa: Takip edilenlerin + kendi tweetleri
    if (currentUser) {
      const { data: follows, error: fErr } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', currentUser);
      if (fErr) throw fErr;
      const followingIds = (follows || []).map(r => r.following_id);
      const userList = [currentUser, ...followingIds];

      const { data, error } = await supabase
        .from('tweets')
        .select('id, user_id, text, image_url, created_at, likes_count, profiles(id, username, display_name, avatar_url)')
        .in('user_id', userList)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // Mark whether each tweet's author is followed by current user (for follow button state)
      const followingSet = new Set(followingIds);
      return data.map(t => ({ ...t, _is_following: followingSet.has(t.user_id) }));
    } else {
      // Public timeline (tüm tweetler) - sayfalama
      const { data, error } = await supabase
        .from('tweets')
        .select('id, user_id, text, image_url, created_at, likes_count, profiles(id, username, display_name, avatar_url)')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return data;
    }
  } catch (err) {
    showError('fetchTimeline', err);
    return [];
  }
}

async function initialRender() {
  feedRendered = 0;
  reachedEnd = false;
  const feed = document.getElementById('feed');
  if (feed) feed.innerHTML = '';
  await loadMore();
  setupRealtime(); // Aç realtime aboneliğini
}

async function loadMore() {
  try {
    if (isLoading || reachedEnd) return;
    isLoading = true;
    const loadingEl = document.getElementById('loadingMore');
    if (loadingEl) loadingEl.style.display = 'block';

    const tweets = await fetchTimeline(feedRendered, PAGE_SIZE);
    if (!tweets || tweets.length === 0) {
      reachedEnd = true;
      const noMoreEl = document.getElementById('noMore');
      if (noMoreEl) noMoreEl.style.display = 'block';
      if (loadingEl) loadingEl.style.display = 'none';
      isLoading = false;
      return;
    }

    for (const t of tweets) {
      renderSingleTweet(t, { prepend: false, isTemp: false });
    }

    feedRendered += tweets.length;
    if (loadingEl) loadingEl.style.display = 'none';
    isLoading = false;
  } catch (err) {
    showError('loadMore catch', err);
    const loadingEl = document.getElementById('loadingMore');
    if (loadingEl) loadingEl.style.display = 'none';
    isLoading = false;
  }
}

/* BASIC INTERACTIONS: LIKE / COMMENT / DELETE / FOLLOW */
window.__app_likeTweet = async function likeTweet(tweetId) {
  try {
    if (!currentUser) { alert('Giriş yapmalısın!'); return; }

    // Toggle - önce var mı kontrol et
    const { data: existing, error: eErr } = await supabase
      .from('likes')
      .select('id')
      .eq('tweet_id', tweetId)
      .eq('user_id', currentUser)
      .limit(1)
      .maybeSingle();

    if (eErr) throw eErr;

    if (existing) {
      // Sil (unlike)
      const { error: delErr } = await supabase.from('likes').delete().eq('id', existing.id);
      if (delErr) throw delErr;
    } else {
      // Ekle
      const { error: insErr } = await supabase.from('likes').insert([{ tweet_id: tweetId, user_id: currentUser }]);
      if (insErr) throw insErr;
    }

    // Güncel like sayısını al
    const { count } = await supabase.from('likes').select('*', { count: 'exact', head: false }).eq('tweet_id', tweetId);
    // Güncelle tweets tablosundaki likes_count (isteğe bağlı)
    await supabase.from('tweets').update({ likes_count: count }).eq('id', tweetId);

    // DOM güncelle
    const cnt = document.querySelector(`[data-tweet="${tweetId}"] .like-count`);
    if (cnt) cnt.textContent = count;

    const btn = document.querySelector(`[data-tweet="${tweetId}"] .action.like`);
    if (btn) {
      if (existing) btn.classList.remove('liked');
      else btn.classList.add('liked');
      // Icon güncelle
      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = existing ? 'fa-regular fa-heart' : 'fa-solid fa-heart';
      }
    }
  } catch (err) { showError('likeTweet catch', err); }
};

window.__app_addComment = async function addComment(tweetId) {
  try {
    if (!currentUser) { alert('Giriş yapmalısın!'); return; }
    const commentText = prompt('Yorum yazın:');
    if (!commentText || commentText.trim() === '') return;
    const { error } = await supabase.from('comments').insert([{
      tweet_id: tweetId,
      user_id: currentUser,
      text: commentText.trim(),
      created_at: new Date().toISOString()
    }]);
    if (error) throw error;
    // DOM: Dilersen burada yorumları hemen gösterebilirsin; basitçe uyar
    alert('Yorum kaydedildi.');
    // Realtime ile timeline güncellenecek, veya reload et
    await loadMore(); // Basit reload
  } catch (err) { showError('addComment catch', err); }
};

window.__app_deleteTweet = async function deleteTweet(id) {
  try {
    if (!currentUser) { alert('Giriş yapmalısın!'); return; }
    // Kontrol et tweet sahibi mi
    const { data: t, error: tErr } = await supabase.from('tweets').select('user_id, image_url').eq('id', id).single();
    if (tErr) throw tErr;
    if (!t || t.user_id !== currentUser) { alert('Sadece kendi tweetini silebilirsin.'); return; }
    if (!confirm('Bu tweeti silmek istediğine emin misin?')) return;

    // Eğer image varsa storage'dan sil (image_url içindeki path'i biliyorsan)
    try {
      if (t.image_url) {
        // Eğer getPublicUrl kullanarak aldığın url ise path'i çıkarman gerekebilir.
        // Biz burada image path'i tweet_images/{user}/{filename} tuttuğumuzu varsayıyoruz.
        // Eğer path bilinmiyorsa bu kısmı atla veya path'ı tweets tablosuna ayrı bir field olarak sakla.
        // Örnek: image_url: publicUrl -> path saklanmadıysa silemeyebiliriz.
      }
    } catch (e) { console.warn('image delete error', e); }

    // Likes/comments sil (opsiyonel)
    await supabase.from('likes').delete().eq('tweet_id', id);
    await supabase.from('comments').delete().eq('tweet_id', id);

    // Tweet sil
    const { error: delErr } = await supabase.from('tweets').delete().eq('id', id);
    if (delErr) throw delErr;

    const card = document.querySelector(`[data-tweet="${id}"]`);
    if (card) card.remove();
  } catch (err) { showError('deleteTweet catch', err); }
};

/* FOLLOW / UNFOLLOW */
async function followUser(targetUserId) {
  try {
    if (!currentUser) { alert('Giriş yapmalısın!'); return false; }
    const { error } = await supabase.from('follows').insert([{ follower_id: currentUser, following_id: targetUserId }]);
    if (error) {
      if (error.code === '23505') alert('Bu kullanıcıyı zaten takip ediyorsun!');
      else showError('follow error', error);
      return false;
    }
    return true;
  } catch (err) { showError('followUser catch', err); return false; }
}

async function unfollowUser(targetUserId) {
  try {
    if (!currentUser) { alert('Giriş yapmalısın!'); return false; }
    const { error } = await supabase.from('follows').delete().eq('follower_id', currentUser).eq('following_id', targetUserId);
    if (error) showError('unfollow error', error);
    return true;
  } catch (err) { showError('unfollowUser catch', err); return false; }
}

/* SEARCH */
async function doSearch(q) {
  try {
    q = (q || '').trim();
    if (!q) {
      initialRender();
      return;
    }

    // 1) Kullanıcı adı araması
    const { data: users } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .ilike('username', `%${q}%`)
      .limit(20);

    // 2) Tweet içinde metin arama (basit)
    const { data: tweets } = await supabase
      .from('tweets')
      .select('id, user_id, text, image_url, created_at, likes_count, profiles(id, username, display_name, avatar_url)')
      .ilike('text', `%${q}%`)
      .order('created_at', { ascending: false })
      .limit(50);

    // Gösterim: Temiz feed ve ekle (kendi arama görünümünü yapabilirsin)
    const feed = document.getElementById('feed');
    if (feed) feed.innerHTML = '';
    (users || []).forEach(u => {
      const div = document.createElement('div');
      div.className = 'search-user';
      div.innerHTML = `<img src="${escapeHTML(u.avatar_url || fallbackAvatar(u.username))}" width="40" height="40" style="border-radius:50%;margin-right:8px;vertical-align:middle;"> <strong>${escapeHTML(u.display_name || u.username)}</strong> <span style="color:#bbb">@${escapeHTML(u.username)}</span>`;
      div.onclick = () => window.location.href = `profile.html?id=${u.id}`;
      feed.appendChild(div);
    });
    (tweets || []).forEach(t => renderSingleTweet(t, { prepend: false, isTemp: false }));
  } catch (err) { showError('doSearch catch', err); }
}

/* SCROLL */
const onScroll = debounce(() => {
  if (reachedEnd || isLoading) return;
  if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight * 0.85) loadMore();
}, 120);

function attachScroll() { window.addEventListener('scroll', onScroll, { passive: true }); }
function detachScroll() { window.removeEventListener('scroll', onScroll); }

/* REALTIME (yeni tweet geldiğinde timeline'a ekle) */
function setupRealtime() {
  try {
    if (realtimeChannel) return; // Zaten açık
    realtimeChannel = supabase.channel('public:tweets')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tweets' }, payload => {
        const newTweet = payload.new;
        if (!newTweet) return;
        // Burada payload.new, profile relation gelmez; istersen fetch et
        // Basit durumda yeni tweeti başa ekle (kullanıcının timeline'ına uygun mu kontrol etmek için hızlı fetch yap)
        (async () => {
          if (!currentUser) {
            // Anonim timeline gösteriliyorsa ekle
            const { data: full } = await supabase.from('tweets').select('id, user_id, text, image_url, created_at, likes_count, profiles(id, username, display_name, avatar_url)').eq('id', newTweet.id).single();
            if (full) renderSingleTweet(full, { prepend: true });
            return;
          }
          // Check if owner is currentUser or someone currentUser follows
          const { data: f } = await supabase.from('follows').select('following_id').eq('follower_id', currentUser).eq('following_id', newTweet.user_id);
          if ((newTweet.user_id === currentUser) || (f && f.length > 0)) {
            const { data: full } = await supabase.from('tweets').select('id, user_id, text, image_url, created_at, likes_count, profiles(id, username, display_name, avatar_url)').eq('id', newTweet.id).single();
            if (full) renderSingleTweet(full, { prepend: true });
          }
        })();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tweets' }, async payload => {
        const updatedTweet = payload.new;
        if (!updatedTweet) return;
        const tweetId = updatedTweet.id;
        const tweetEl = document.querySelector(`[data-tweet="${tweetId}"]`);
        if (tweetEl) {
          const likeCountEl = tweetEl.querySelector('.like-count');
          if (likeCountEl) likeCountEl.textContent = updatedTweet.likes_count || 0;
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') console.log('Realtime subscribed');
        else console.warn('Realtime status:', status);
      });
  } catch (err) { console.warn('realtime setup error', err); }
}

/* INIT - bağla element listener'ları (login/register sayfalarında veya profil sayfasında kullanılacak) */
async function tryInit() {
  try {
    // Load auth state
    await loadCurrentUser();

    // Auth state değişikliklerini dinle (session değiştiğinde yeniden yükle)
    supabase.auth.onAuthStateChange(async (event, session) => {
      await loadCurrentUser(); // Güncelle
    });

    // Tweet buton
    const btn = document.getElementById('tweetBtn');
    if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); tweetAt(); });

    // Search input (varsa)
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', debounce((e) => {
        const q = e.target.value;
        if (!q) { initialRender(); return; }
        doSearch(q);
      }, 400));
    }

    // Register/login forms (varsa) — HTML sayfanda form id'leri varsa otomatik bağla
    const regForm = document.getElementById('register-form');
    if (regForm) regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email')?.value;
      const password = document.getElementById('password')?.value;
      const username = document.getElementById('username')?.value || null;
      const display_name = document.getElementById('display_name')?.value || null;
      await signUp(email, password, username, display_name);
    });

    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email')?.value;
      const password = document.getElementById('password')?.value;
      await signIn(email, password);
    });

    // Logout button (varsa)
    const logoutBtn = document.getElementById('logout');
    if (logoutBtn) logoutBtn.addEventListener('click', async () => { await signOut(); });

    // Profile page yüklemesi (varsa) - profil sayfası için user bilgilerini doldur
    if (window.location.pathname.endsWith('profile.html')) {
      // Profil bilgilerini sayfaya yaz
      await loadCurrentUser();
      // Örn: #profile-username, #profile-display, #profile-avatar, #profile-bio
      if (currentUserData) {
        const pu = document.getElementById('profile-username');
        if (pu) pu.innerText = '@' + (currentUserData.username || currentUser.slice(0, 6));
        const pd = document.getElementById('profile-display');
        if (pd) pd.innerText = currentUserData.display_name || '';
        const pa = document.getElementById('profile-avatar');
        if (pa) pa.src = currentUserData.avatar_url || fallbackAvatar(currentUserData.username || '');
        const pb = document.getElementById('profile-bio');
        if (pb) pb.innerText = currentUserData.bio || '';
      }
    }

    // Feed render
    await initialRender();
    attachScroll();
  } catch (err) { console.error('tryInit error', err); }
}

// Expose some functions for HTML inline handlers if needed
window.app = {
  signUp, signIn, signOut, tweetAt, followUser, unfollowUser, doSearch
};

tryInit();