import { createSpeechController } from './speech.js';

const MODULE_LABELS = {
  foundation: '基础',
  'learning-ledger': '学习账本',
  'iphone-p0': 'iPhone 路径',
  'iphone-p1': 'iPhone 安全',
  'iphone-p2': 'iPhone 权限',
  'iphone-path': '恢复路径',
  'reddit-x': 'Reddit / X',
  tech: 'AI / 技术',
  daily: '日常',
  basketball: '篮球',
  custom: '临时收集'
};

const KIND_LABELS = {
  word: '单词',
  phrase: '短语',
  sentence: '句子'
};

const STATUS_LABELS = {
  candidate: '待加入',
  S0: '已出现',
  S1: '即时理解',
  S2: '延迟记住',
  S3: '真实稳定'
};

const LIBRARY_PAGE_SIZE = 80;
const REVIEW_MODE_KEY = 'wordflow.reviewMode.v1';
const AUTH_USERNAME_KEY = 'wordflow.authUsername.v1';
const APP_BASE_URL = new URL('./', window.location.href);
const speech = createSpeechController();

const state = {
  view: 'today',
  today: [],
  revealed: false,
  reviewMode: localStorage.getItem(REVIEW_MODE_KEY) === 'listening' ? 'listening' : 'reading',
  audioUnlocked: false,
  progress: null,
  library: [],
  libraryTotal: 0,
  libraryStatus: 'all',
  libraryModule: 'all',
  libraryQuery: '',
  editingItem: null,
  pendingActivateId: null,
  authEnabled: false,
  started: false
};

const els = {
  boot: document.querySelector('#boot-screen'),
  login: document.querySelector('#login-screen'),
  loginForm: document.querySelector('#login-form'),
  appShell: document.querySelector('#app-shell'),
  today: document.querySelector('#today-view'),
  library: document.querySelector('#library-view'),
  progress: document.querySelector('#progress-view'),
  main: document.querySelector('#app-main'),
  itemDialog: document.querySelector('#item-dialog'),
  itemForm: document.querySelector('#item-form'),
  audioDialog: document.querySelector('#audio-dialog'),
  toast: document.querySelector('#toast')
};

function icons(root = document) {
  window.lucide?.createIcons({
    attrs: { 'aria-hidden': 'true' },
    nameAttr: 'data-lucide',
    root
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function appUrl(path) {
  return new URL(String(path).replace(/^\//, ''), APP_BASE_URL).href;
}

async function api(path, options = {}) {
  const response = await fetch(appUrl(path), {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (response.status === 401) {
    showLogin('登录状态已过期，请重新登录');
    const error = new Error('请重新登录');
    error.code = 'AUTH_REQUIRED';
    throw error;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `请求失败 (${response.status})`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function authRequest(path, options = {}) {
  const response = await fetch(appUrl(path), {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body;
}

function showLogin(message = '') {
  speech.cancel();
  els.boot.hidden = true;
  els.appShell.hidden = true;
  els.login.hidden = false;
  document.body.classList.remove('is-booting');
  document.body.classList.add('is-authenticating');
  const error = document.querySelector('#login-error');
  error.textContent = message;
  error.hidden = !message;
  document.querySelector('#login-username').value = localStorage.getItem(AUTH_USERNAME_KEY) || '';
  document.querySelector('#login-password').value = '';
  icons(els.login);
  setTimeout(() => {
    const username = document.querySelector('#login-username');
    const password = document.querySelector('#login-password');
    (username.value ? password : username).focus();
  }, 80);
}

function showApp() {
  els.boot.hidden = true;
  els.login.hidden = true;
  els.appShell.hidden = false;
  document.body.classList.remove('is-booting', 'is-authenticating');
}

async function enterApp() {
  showApp();
  document.querySelector('#account-row').hidden = !state.authEnabled;
  if (!state.started) {
    state.started = true;
    await loadToday();
    switchView(initialView);
    return;
  }
  await loadToday();
  switchView(state.view);
}

async function bootstrapAuth() {
  icons();
  try {
    const session = await authRequest('/api/auth/session');
    state.authEnabled = session.authEnabled;
    if (!session.authenticated) {
      showLogin();
      return;
    }
    await enterApp();
  } catch (error) {
    showLogin('暂时无法连接，请稍后重试');
    console.error(error);
  }
}

let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('show');
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function showError(error) {
  if (error.code === 'AUTH_REQUIRED') return;
  console.error(error);
  toast(error.message || '操作失败');
}

function statusBadge(status) {
  return `<span class="status-badge status-${escapeHtml(status)}"><b>${escapeHtml(status)}</b>${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
}

function moduleBadge(module) {
  return `<span class="module-badge">${escapeHtml(MODULE_LABELS[module] || module)}</span>`;
}

function formatPercent(current, target) {
  if (!target) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

function dateLabel() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short'
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.month}月${parts.day}日 ${parts.weekday}`;
}

function findItem(id) {
  return state.today.find((item) => item.id === id)
    || state.library.find((item) => item.id === id)
    || null;
}

function setSpeaking(itemId, active) {
  document.querySelectorAll(`[data-speak-id="${itemId}"]`).forEach((button) => {
    button.classList.toggle('is-speaking', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function speakItem(item) {
  if (!item) return;
  if (!speech.supported) {
    toast('当前浏览器不支持系统发音');
    return;
  }
  state.audioUnlocked = true;
  speech.speak(item.term, {
    onStart: () => setSpeaking(item.id, true),
    onEnd: () => setSpeaking(item.id, false),
    onError: () => {
      setSpeaking(item.id, false);
      toast('发音没有成功，请再试一次');
    }
  });
}

function speakerButton(item, className = '') {
  return `
    <button class="speaker-button ${className}" type="button" data-speak-id="${item.id}"
      aria-label="播放 ${escapeHtml(item.term)} 的发音" aria-pressed="false" title="播放发音"
      ${speech.supported ? '' : 'disabled'}>
      <i data-lucide="volume-2"></i>
    </button>
  `;
}

function bindSpeechButtons(root = document) {
  root.querySelectorAll('[data-speak-id]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      speakItem(findItem(Number(button.dataset.speakId)));
    });
  });
}

function renderToday() {
  const remembered = (state.progress?.counts?.S2 || 0) + (state.progress?.counts?.S3 || 0);
  const item = state.today[0];
  els.today.innerHTML = `
    <div class="today-dashboard">
      <div class="today-copy">
        <p class="today-date">${escapeHtml(dateLabel())}</p>
        <h1 id="today-title">今天</h1>
        <p class="today-motivation">坚持学习，词汇流动起来。</p>
      </div>
      <div class="today-progress" aria-label="长期已记住 ${remembered} 条">
        <div class="daily-count"><strong>${remembered}</strong></div>
        <p>已记住</p>
      </div>
    </div>
    <div class="practice-toolbar">
      <div class="mode-segment" aria-label="练习模式">
        <button class="${state.reviewMode === 'reading' ? 'active' : ''}" type="button" data-review-mode="reading">
          <i data-lucide="eye"></i><span>认读</span>
        </button>
        <button class="${state.reviewMode === 'listening' ? 'active' : ''}" type="button" data-review-mode="listening">
          <i data-lucide="headphones"></i><span>听辨</span>
        </button>
      </div>
    </div>
    ${item ? reviewCard(item) : emptyToday()}
    ${longTermStats()}
  `;
  bindTodayEvents();
  bindSpeechButtons(els.today);
  icons(els.today);
}

function longTermStats() {
  const progress = state.progress;
  const remembered = (progress?.counts?.S2 || 0) + (progress?.counts?.S3 || 0);
  return `
    <section class="long-term-stats" aria-labelledby="long-term-stats-title">
      <p class="stats-title" id="long-term-stats-title">学习数据</p>
      <div class="stats-grid">
        <div class="stat-item stat-reviews">
          <span class="stat-icon"><i data-lucide="rotate-cw"></i></span>
          <span><strong>${progress?.totalReviews || 0}</strong><small>累计复习</small></span>
        </div>
        <div class="stat-item stat-mastered">
          <span class="stat-icon"><i data-lucide="check"></i></span>
          <span><strong>${remembered}</strong><small>已记住</small></span>
        </div>
        <div class="stat-item stat-days">
          <span class="stat-icon"><i data-lucide="calendar-days"></i></span>
          <span><strong>${progress?.totalReviewDays || 0}<em>天</em></strong><small>学习天数</small></span>
        </div>
      </div>
    </section>
  `;
}

function reviewCard(item) {
  const listeningPrompt = state.reviewMode === 'listening' && !state.revealed;
  return `
    <article class="review-card ${listeningPrompt ? 'listening-card' : ''}" data-item-id="${item.id}">
      <div class="review-card-top">
        <div class="review-meta">
          ${moduleBadge(item.module)}
          ${statusBadge(item.status)}
        </div>
        <span class="queue-position">${escapeHtml(KIND_LABELS[item.kind] || item.kind)}</span>
      </div>

      <div class="review-stage">
        ${listeningPrompt ? `
          <button class="listening-trigger" type="button" data-speak-id="${item.id}"
            aria-label="播放英文发音" aria-pressed="false">
            <span class="sound-rings" aria-hidden="true"><i data-lucide="audio-lines"></i></span>
            <strong>播放发音</strong>
            <small>${speech.getPreferences().rate.toFixed(2).replace(/0$/, '')}× · ${speech.getPreferences().accent === 'en-GB' ? '英式' : '美式'}</small>
          </button>
        ` : `
          <div class="review-term">${escapeHtml(item.term)}</div>
          <div class="pronunciation-row">
            ${item.phonetic ? `<span>${escapeHtml(item.phonetic)}</span>` : ''}
            ${speakerButton(item, 'term-speaker')}
          </div>
          <p class="review-source">${escapeHtml(item.source || '学习内容')}</p>
        `}
      </div>

      ${state.revealed ? answerPanel(item) : `
        <button class="reveal-button" id="reveal-answer" type="button">
          <span>${listeningPrompt ? '看答案' : '显示答案'}</span>
          <i data-lucide="chevron-down"></i>
        </button>
      `}
    </article>
  `;
}

function answerPanel(item) {
  return `
    <div class="answer-panel">
      <p class="answer-label">中文核心义</p>
      <p class="answer-meaning">${escapeHtml(item.meaning)}</p>
      ${item.example ? `<p class="answer-detail"><span>上下文</span>${escapeHtml(item.example)}</p>` : ''}
      ${item.note ? `<p class="answer-detail note-detail"><span>易错点</span>${escapeHtml(item.note)}</p>` : ''}
    </div>
    <div class="review-actions" aria-label="复习结果">
      <button class="rating-button rating-again" data-rating="again" type="button">
        <i data-lucide="rotate-ccw"></i><span>忘了</span>
      </button>
      <button class="rating-button rating-hard" data-rating="hard" type="button">
        <i data-lucide="circle-help"></i><span>模糊</span>
      </button>
      <button class="rating-button rating-good" data-rating="good" type="button">
        <i data-lucide="check"></i><span>记得</span>
      </button>
      <button class="rating-button rating-real" data-rating="real" type="button">
        <i data-lucide="scan-text"></i><span>真实命中</span>
      </button>
    </div>
  `;
}

function emptyToday() {
  return `
    <div class="empty-state">
      <div class="completion-mark"><i data-lucide="check"></i></div>
      <h2>今天完成了</h2>
      <p>到期内容已经清空。</p>
      <button class="text-button primary-button" id="open-library" type="button">
        <i data-lucide="notebook-tabs"></i>打开词句
      </button>
    </div>
  `;
}

function bindTodayEvents() {
  document.querySelector('#reveal-answer')?.addEventListener('click', () => {
    state.revealed = true;
    renderToday();
  });
  document.querySelectorAll('[data-rating]').forEach((button) => {
    button.addEventListener('click', () => submitRating(button.dataset.rating));
  });
  document.querySelectorAll('[data-review-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.reviewMode = button.dataset.reviewMode;
      state.revealed = false;
      localStorage.setItem(REVIEW_MODE_KEY, state.reviewMode);
      renderToday();
      if (state.reviewMode === 'listening') speakItem(state.today[0]);
    });
  });
  document.querySelector('#open-library')?.addEventListener('click', () => switchView('library'));
}

function showReviewReward(rating) {
  const feedback = {
    again: ['rotate-ccw', '再见一次', 'reward-again'],
    hard: ['brain', '正在变熟', 'reward-hard'],
    good: ['check', '记住了', 'reward-good'],
    real: ['sparkles', '真实命中', 'reward-real']
  }[rating];
  const node = document.createElement('div');
  node.className = `reward-flash ${feedback[2]}`;
  node.innerHTML = `<i data-lucide="${feedback[0]}"></i><strong>${feedback[1]}</strong>`;
  document.body.append(node);
  icons(node);
  navigator.vibrate?.(rating === 'good' || rating === 'real' ? 24 : 10);
  setTimeout(() => node.remove(), 720);
}

async function submitRating(rating) {
  const item = state.today[0];
  if (!item) return;
  document.querySelectorAll('[data-rating]').forEach((button) => { button.disabled = true; });
  showReviewReward(rating);
  try {
    const result = await api(`/api/items/${item.id}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ rating })
    });
    const transition = result.transition;
    const changed = transition.previousStatus !== transition.nextStatus;
    if (changed) {
      toast(`${transition.previousStatus} → ${transition.nextStatus}，证据已更新`);
    } else if (rating === 'good' && !transition.isDelayedReview) {
      toast('今天记住了；跨天答对才会升 S2');
    }
    state.progress = result.progress;
    state.revealed = false;
    await loadToday();
    const preferences = speech.getPreferences();
    if (preferences.autoplay && state.audioUnlocked && state.today[0]) {
      setTimeout(() => speakItem(state.today[0]), 180);
    }
  } catch (error) {
    showError(error);
    renderToday();
  }
}

async function loadToday() {
  const data = await api('/api/today?limit=10');
  state.today = data.items;
  state.progress = data.progress;
  renderToday();
}

function renderLibrary() {
  const rows = state.library.map((item) => `
    <div class="library-row">
      <button class="library-row-main" type="button" data-edit-id="${item.id}">
        <p class="library-term">${escapeHtml(item.term)}</p>
        <p class="library-meaning">${escapeHtml(item.meaning || '补充中文后加入')}</p>
        <div class="row-badges">
          ${statusBadge(item.status)}
          ${moduleBadge(item.module)}
        </div>
      </button>
      <div class="library-row-actions">
        ${speakerButton(item, 'row-speaker')}
        ${item.status === 'candidate' ? `
          <button class="icon-button activate-button" type="button" data-activate-id="${item.id}"
            aria-label="${item.meaning ? '加入复习' : '补充中文后加入'}" title="${item.meaning ? '加入复习' : '补充中文后加入'}">
            <i data-lucide="${item.meaning ? 'plus' : 'pencil'}"></i>
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');
  const hasMore = state.library.length < state.libraryTotal;

  els.library.innerHTML = `
    <div class="page-heading">
      <div>
        <p class="eyebrow">COLLECTION</p>
        <h1 id="library-title">词句</h1>
      </div>
      <span class="page-metric">${state.libraryTotal} 条</span>
    </div>
    <label class="search-field">
      <i data-lucide="search"></i>
      <input id="library-search" type="search" value="${escapeHtml(state.libraryQuery)}" placeholder="搜索英文或中文" aria-label="搜索词句">
    </label>
    <div class="library-filter-row">
      <div class="segment-row" aria-label="掌握状态">
        ${segmentButton('all', '全部')}
        ${segmentButton('candidate', '待加入')}
        ${segmentButton('learning', '学习中')}
        ${segmentButton('mastered', '已记住')}
      </div>
      <select id="library-module" aria-label="筛选范围">
        ${moduleOptions(state.libraryModule)}
      </select>
    </div>
    <p class="result-count">显示 ${state.library.length} / ${state.libraryTotal}</p>
    <div class="library-list">
      ${rows || '<div class="list-empty"><i data-lucide="search-x"></i><p>没有找到</p></div>'}
    </div>
    ${hasMore ? '<button class="load-more-button" id="load-more" type="button">加载更多</button>' : ''}
  `;
  bindLibraryEvents();
  bindSpeechButtons(els.library);
  icons(els.library);
}

function moduleOptions(selected) {
  const choices = [['all', '全部范围'], ...Object.entries(MODULE_LABELS)];
  return choices.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function segmentButton(value, label) {
  return `<button class="segment-button ${state.libraryStatus === value ? 'active' : ''}" type="button" data-library-status="${value}">${label}</button>`;
}

let searchTimer;
function bindLibraryEvents() {
  const search = document.querySelector('#library-search');
  search?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    state.libraryQuery = search.value;
    searchTimer = setTimeout(() => loadLibrary(true), 220);
  });
  document.querySelector('#library-module')?.addEventListener('change', (event) => {
    state.libraryModule = event.target.value;
    loadLibrary(true);
  });
  document.querySelectorAll('[data-library-status]').forEach((button) => {
    button.addEventListener('click', () => {
      state.libraryStatus = button.dataset.libraryStatus;
      loadLibrary(true);
    });
  });
  document.querySelector('#load-more')?.addEventListener('click', () => loadLibrary(false));
  document.querySelectorAll('[data-activate-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const item = state.library.find((entry) => entry.id === Number(button.dataset.activateId));
        if (item && !item.meaning.trim()) {
          state.pendingActivateId = item.id;
          openEditDialog(item.id);
          toast('补充中文，保存后自动加入');
          return;
        }
        await api(`/api/items/${button.dataset.activateId}/activate`, { method: 'POST', body: '{}' });
        toast('已加入今日复习');
        await loadLibrary(true);
      } catch (error) {
        showError(error);
      }
    });
  });
  document.querySelectorAll('[data-edit-id]').forEach((button) => {
    button.addEventListener('click', () => openEditDialog(Number(button.dataset.editId)));
  });
}

async function loadLibrary(reset = true) {
  const offset = reset ? 0 : state.library.length;
  const query = new URLSearchParams({
    q: state.libraryQuery,
    status: state.libraryStatus,
    module: state.libraryModule,
    limit: String(LIBRARY_PAGE_SIZE),
    offset: String(offset)
  });
  const data = await api(`/api/items?${query}`);
  state.library = reset ? data.items : [...state.library, ...data.items];
  state.libraryTotal = data.total;
  renderLibrary();
}

function renderProgress() {
  const progress = state.progress;
  if (!progress) {
    els.progress.innerHTML = '<div class="skeleton"></div>';
    return;
  }
  const e0 = progress.tracks.find((track) => track.code === 'E0') || { current: 0, target: 4 };
  const readingTracks = progress.tracks.filter((track) => track.code !== 'E0');
  const remembered = progress.counts.S2 + progress.counts.S3;
  const evidenceTotal = Object.values(progress.counts).reduce((sum, value) => sum + value, 0);
  els.progress.innerHTML = `
    <div class="page-heading">
      <div>
        <p class="eyebrow">EVIDENCE</p>
        <h1 id="progress-title">进度</h1>
      </div>
      <div class="progress-tools">
        <button class="icon-button" id="sync-button" type="button" aria-label="同步学习档案" title="同步学习档案">
          <i data-lucide="refresh-cw"></i>
        </button>
        <a class="icon-button" href="${appUrl('/api/export')}" download aria-label="导出学习数据" title="导出学习数据">
          <i data-lucide="download"></i>
        </a>
      </div>
    </div>
    <div class="progress-summary">
      <div><strong>${progress.totalReviews}</strong><span>累计复习</span></div>
      <div><strong>${progress.totalReviewDays}</strong><span>应用学习日</span></div>
      <div><strong>${remembered}</strong><span>S2 以上</span></div>
    </div>
    <section class="progress-section iphone-gate">
      <div class="section-heading">
        <div><p class="section-kicker">当前优先</p><h2>iPhone 英文切换</h2></div>
        <strong>${e0.current}/${e0.target}</strong>
      </div>
      <div class="goal-list">
        ${progress.e0Goals.map((goal) => `
          <div class="goal-row ${goal.done ? 'done' : ''}">
            <span class="goal-check"><i data-lucide="${goal.done ? 'check' : 'minus'}"></i></span>
            <span class="goal-label">${escapeHtml(goal.label)}</span>
            <span class="goal-value">${escapeHtml(goal.value)}</span>
          </div>
        `).join('')}
      </div>
    </section>
    <section class="progress-section">
      <div class="section-heading"><div><p class="section-kicker">最终目标</p><h2>独立阅读 Reddit / X</h2></div></div>
      <div class="track-list">
        ${readingTracks.map((track) => `
          <div class="track-row">
            <span class="track-code">${escapeHtml(track.code)}</span>
            <div class="track-body">
              <span class="track-label">${escapeHtml(track.label)}</span>
              <div class="progress-bar"><span class="progress-fill" style="width:${formatPercent(track.current, track.target)}%"></span></div>
            </div>
            <span class="track-value">${track.current}/${track.target}</span>
          </div>
        `).join('')}
      </div>
    </section>
    <section class="progress-section">
      <div class="section-heading"><div><p class="section-kicker">词汇证据</p><h2>S0–S3 分布</h2></div></div>
      <div class="evidence-list">
        ${['candidate', 'S0', 'S1', 'S2', 'S3'].map((status) => `
          <div class="evidence-row evidence-${status}">
            <span class="evidence-name"><b>${status === 'candidate' ? '待' : status}</b>${escapeHtml(STATUS_LABELS[status])}</span>
            <div class="evidence-track"><span style="width:${formatPercent(progress.counts[status], evidenceTotal)}%"></span></div>
            <strong>${progress.counts[status]}</strong>
          </div>
        `).join('')}
      </div>
    </section>
  `;
  document.querySelector('#sync-button')?.addEventListener('click', syncMemory);
  icons(els.progress);
}

async function loadProgress() {
  state.progress = await api('/api/progress');
  renderProgress();
}

function switchView(view) {
  speech.cancel();
  state.view = view;
  document.querySelectorAll('.view').forEach((node) => node.classList.toggle('active', node.id === `${view}-view`));
  document.querySelectorAll('.nav-item').forEach((node) => node.classList.toggle('active', node.dataset.view === view));
  history.replaceState(null, '', `#${view}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'library') loadLibrary(true).catch(showError);
  if (view === 'progress') loadProgress().catch(showError);
  els.main.focus({ preventScroll: true });
}

function openAddDialog() {
  state.editingItem = null;
  state.pendingActivateId = null;
  els.itemForm.reset();
  document.querySelector('#item-id').value = '';
  document.querySelector('#dialog-eyebrow').textContent = '新内容';
  document.querySelector('#dialog-title').textContent = '添加词句';
  document.querySelector('#delete-item').classList.add('hidden');
  els.itemDialog.showModal();
  document.querySelector('#item-term').focus();
}

function openEditDialog(id) {
  const item = state.library.find((entry) => entry.id === id);
  if (!item) return;
  state.editingItem = item;
  document.querySelector('#item-id').value = item.id;
  document.querySelector('#item-term').value = item.term;
  document.querySelector('#item-meaning').value = item.meaning;
  document.querySelector('#item-phonetic').value = item.phonetic || '';
  document.querySelector('#item-kind').value = item.kind;
  document.querySelector('#item-module').value = item.module in MODULE_LABELS ? item.module : 'custom';
  document.querySelector('#item-example').value = item.example || '';
  document.querySelector('#item-note').value = item.note || '';
  document.querySelector('#item-source').value = item.source || '';
  document.querySelector('#dialog-eyebrow').textContent = item.status === 'candidate' ? '待加入' : `${item.status} · ${STATUS_LABELS[item.status]}`;
  document.querySelector('#dialog-title').textContent = '编辑词句';
  document.querySelector('#delete-item').classList.remove('hidden');
  els.itemDialog.showModal();
}

function closeItemDialog() {
  state.pendingActivateId = null;
  els.itemDialog.close();
}

async function saveItem(event) {
  event.preventDefault();
  const id = document.querySelector('#item-id').value;
  const body = {
    term: document.querySelector('#item-term').value,
    meaning: document.querySelector('#item-meaning').value,
    phonetic: document.querySelector('#item-phonetic').value,
    kind: document.querySelector('#item-kind').value,
    module: document.querySelector('#item-module').value,
    example: document.querySelector('#item-example').value,
    note: document.querySelector('#item-note').value,
    source: document.querySelector('#item-source').value
  };
  try {
    const response = await api(id ? `/api/items/${id}` : '/api/items', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(body)
    });
    const savedId = Number(id || response.item.id);
    if (state.pendingActivateId && savedId === state.pendingActivateId) {
      await api(`/api/items/${savedId}/activate`, { method: 'POST', body: '{}' });
    }
    const activatedAfterEdit = Boolean(state.pendingActivateId && savedId === state.pendingActivateId);
    closeItemDialog();
    toast(activatedAfterEdit ? '已补充并加入今日复习' : id ? '已保存修改' : '已加入今日复习');
    await loadToday();
    if (state.view === 'library') await loadLibrary(true);
  } catch (error) {
    showError(error);
  }
}

async function deleteItem() {
  const id = document.querySelector('#item-id').value;
  if (!id || !window.confirm('删除这条学习内容？')) return;
  try {
    await api(`/api/items/${id}`, { method: 'DELETE' });
    closeItemDialog();
    toast('已删除');
    await loadLibrary(true);
    await loadToday();
  } catch (error) {
    showError(error);
  }
}

async function syncMemory() {
  const button = document.querySelector('#sync-button');
  if (button) button.disabled = true;
  try {
    const data = await api('/api/sync', { method: 'POST', body: '{}' });
    state.progress = data.progress;
    toast(`已同步 ${data.result.total} 条学习档案`);
    await loadToday();
    if (state.view === 'library') await loadLibrary(true);
    if (state.view === 'progress') renderProgress();
  } catch (error) {
    showError(error);
  } finally {
    if (button) button.disabled = false;
  }
}

function renderAudioSettings() {
  const preferences = speech.getPreferences();
  document.querySelectorAll('[data-accent]').forEach((button) => {
    button.classList.toggle('active', button.dataset.accent === preferences.accent);
  });
  document.querySelector('#speech-rate').value = String(preferences.rate);
  document.querySelector('#speech-rate-value').value = `${preferences.rate.toFixed(2).replace(/0$/, '')}×`;
  document.querySelector('#speech-autoplay').checked = preferences.autoplay;
}

function openAudioDialog() {
  renderAudioSettings();
  els.audioDialog.showModal();
}

function closeAudioDialog() {
  speech.cancel();
  els.audioDialog.close();
}

async function submitLogin(event) {
  event.preventDefault();
  const submit = document.querySelector('#login-submit');
  const error = document.querySelector('#login-error');
  const username = document.querySelector('#login-username').value.trim();
  const password = document.querySelector('#login-password').value;
  submit.disabled = true;
  error.hidden = true;
  try {
    const result = await authRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    localStorage.setItem(AUTH_USERNAME_KEY, username);
    state.authEnabled = result.authEnabled;
    document.querySelector('#login-password').value = '';
    await enterApp();
  } catch (loginError) {
    error.textContent = loginError.message;
    error.hidden = false;
    document.querySelector('#login-password').select();
  } finally {
    submit.disabled = false;
  }
}

async function logout() {
  const button = document.querySelector('#logout-button');
  button.disabled = true;
  try {
    await authRequest('/api/auth/logout', { method: 'POST', body: '{}' });
    closeAudioDialog();
    showLogin();
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
}

function togglePasswordVisibility() {
  const input = document.querySelector('#login-password');
  const button = document.querySelector('#password-toggle');
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  button.setAttribute('aria-label', visible ? '显示密码' : '隐藏密码');
  button.setAttribute('title', visible ? '显示密码' : '隐藏密码');
  button.innerHTML = `<i data-lucide="${visible ? 'eye' : 'eye-off'}"></i>`;
  icons(button);
  input.focus();
}

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => switchView(button.dataset.view));
});
document.querySelector('.brand').addEventListener('click', (event) => {
  event.preventDefault();
  switchView('today');
});
document.querySelector('#add-button').addEventListener('click', openAddDialog);
document.querySelector('#audio-settings-button').addEventListener('click', openAudioDialog);
document.querySelector('#close-dialog').addEventListener('click', closeItemDialog);
document.querySelector('#cancel-dialog').addEventListener('click', closeItemDialog);
document.querySelector('#delete-item').addEventListener('click', deleteItem);
els.itemForm.addEventListener('submit', saveItem);
els.itemDialog.addEventListener('click', (event) => {
  if (event.target === els.itemDialog) closeItemDialog();
});

document.querySelector('#close-audio-dialog').addEventListener('click', closeAudioDialog);
document.querySelector('#save-audio-settings').addEventListener('click', closeAudioDialog);
document.querySelectorAll('[data-accent]').forEach((button) => {
  button.addEventListener('click', () => {
    speech.setPreferences({ accent: button.dataset.accent });
    renderAudioSettings();
  });
});
document.querySelector('#speech-rate').addEventListener('input', (event) => {
  speech.setPreferences({ rate: Number(event.target.value) });
  renderAudioSettings();
});
document.querySelector('#speech-autoplay').addEventListener('change', (event) => {
  speech.setPreferences({ autoplay: event.target.checked });
});
document.querySelector('#speech-preview').addEventListener('click', () => {
  state.audioUnlocked = true;
  speech.speak('Ready to learn. Let us begin.', {
    onStart: () => document.querySelector('#speech-preview').classList.add('is-speaking'),
    onEnd: () => document.querySelector('#speech-preview').classList.remove('is-speaking'),
    onError: () => toast('发音没有成功，请再试一次')
  });
});
els.audioDialog.addEventListener('click', (event) => {
  if (event.target === els.audioDialog) closeAudioDialog();
});
els.loginForm.addEventListener('submit', submitLogin);
document.querySelector('#password-toggle').addEventListener('click', togglePasswordVisibility);
document.querySelector('#logout-button').addEventListener('click', logout);

const initialView = ['today', 'library', 'progress'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
bootstrapAuth();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(appUrl('/service-worker.js?v=1.4.2'), { scope: APP_BASE_URL.pathname }).catch(console.error);
}
