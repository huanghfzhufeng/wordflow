import { createSpeechController } from './speech.js';

const MODULE_LABELS = {
  foundation: '基础',
  'learning-ledger': '学习账本',
  'iphone-p0': 'iPhone 路径',
  'iphone-p1': 'iPhone 安全',
  'iphone-p2': 'iPhone 权限',
  'iphone-path': '恢复路径',
  'reddit-x': 'Reddit / X',
  'reddit-core': 'Reddit 核心 3000',
  'reddit-forms': '变形与缩写',
  'reddit-reading': '阅读短句',
  tech: 'AI / 技术',
  daily: '日常',
  basketball: '篮球',
  custom: '临时收集'
};
const WORK_MODULES = ['reddit-core', 'reddit-forms', 'reddit-reading', 'reddit-x', 'tech', 'custom'];

const KIND_LABELS = {
  word: '单词',
  phrase: '短语',
  sentence: '句子'
};

const STATUS_LABELS = {
  S0: '已出现',
  S1: '即时理解',
  S2: '延迟记住',
  S3: '真实稳定'
};

const COMPONENT_ROLE_LABELS = {
  word: '单词',
  prefix: '前缀',
  root: '词根',
  suffix: '后缀'
};

const LIBRARY_PAGE_SIZE = 80;
const REVIEW_MODE_KEY = 'wordflow.reviewMode.v1';
const AUTH_USERNAME_KEY = 'wordflow.authUsername.v1';
const APP_BASE_URL = new URL('./', window.location.href);
const speech = createSpeechController();

function emptyWritingState() {
  return {
    active: false,
    compared: false,
    strokes: [],
    startedAt: null,
    result: null,
    durationMs: null
  };
}

const state = {
  view: 'today',
  today: [],
  trainingType: 'words',
  practice: false,
  nextDueAt: null,
  drafts: [],
  editingDraftId: null,
  revealed: false,
  reviewMode: localStorage.getItem(REVIEW_MODE_KEY) === 'listening' ? 'listening' : 'reading',
  audioUnlocked: false,
  progress: null,
  library: [],
  libraryTotal: 0,
  libraryStatus: 'all',
  libraryModule: 'all',
  libraryOtherModules: false,
  libraryQuery: '',
  editingItem: null,
  componentFocus: null,
  writing: emptyWritingState(),
  session: { startedAt: null, reviews: 0 },
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
  state.session = { startedAt: null, reviews: 0 };
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
  state.session.startedAt ||= Date.now();
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
  const item = state.today[0];
  els.today.innerHTML = `
    <div class="practice-toolbar">
      <div class="mode-segment" aria-label="练习模式">
        <button class="${state.reviewMode === 'reading' ? 'active' : ''}" type="button" data-review-mode="reading">
          <i data-lucide="eye"></i><span>认读</span>
        </button>
        <button class="${state.reviewMode === 'listening' ? 'active' : ''}" type="button" data-review-mode="listening">
          <i data-lucide="headphones"></i><span>听辨</span>
        </button>
      </div>
      <button class="text-button training-toggle" id="toggle-training" type="button">${state.trainingType === 'sentence' ? '回到词汇' : '练句子'}</button>
    </div>
    <p class="recall-instruction">${state.practice ? '主动练习：不会改变正式到期日或等级。' : state.trainingType === 'sentence' ? '先想整句意思，再揭晓核对人物、动作和关键关系。' : '先在心里回想中文义，再揭晓。看答案才想起来，请选“没想起来”。'}</p>
    ${state.practice ? '<button class="text-button" id="end-practice" type="button">回到正式复习</button>' : ''}
    ${item ? reviewCard(item) : emptyToday()}
    ${longTermStats()}
  `;
  bindTodayEvents();
  bindSpeechButtons(els.today);
  icons(els.today);
  initializeWritingCanvas();
}

function longTermStats() {
  const progress = state.progress;
  const remembered = (progress?.counts?.S2 || 0) + (progress?.counts?.S3 || 0);
  return `
    <section class="long-term-stats" aria-labelledby="long-term-stats-title">
      <div class="stats-heading">
        <p class="stats-title" id="long-term-stats-title">学习数据</p>
        <p class="session-summary"><i data-lucide="clock-3"></i><span id="session-summary">${sessionSummaryText()}</span></p>
      </div>
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

function sessionSummaryText() {
  const elapsedMs = state.session.startedAt ? Date.now() - state.session.startedAt : 0;
  const minutes = Math.floor(Math.max(0, elapsedMs) / 60_000);
  const duration = minutes < 1 ? '不到 1 分钟' : `${minutes} 分钟`;
  return `本次 ${duration} · ${state.session.reviews} 个`;
}

function updateSessionSummary() {
  const node = document.querySelector('#session-summary');
  if (node) node.textContent = sessionSummaryText();
}

function reviewCard(item) {
  if (state.writing.active) return writingCard(item);
  const listeningPrompt = state.reviewMode === 'listening' && !state.revealed;
  return `
    <article class="review-card ${listeningPrompt ? 'listening-card' : ''} ${item.kind === 'sentence' ? 'sentence-card' : ''}" data-item-id="${item.id}">
      <div class="review-card-top">
        <div class="review-meta">
          ${moduleBadge(item.module)}
          ${statusBadge(item.status)}
        </div>
        <span class="queue-position">${item.coreOrder ? `第 ${item.coreOrder} / 3000 项` : escapeHtml(KIND_LABELS[item.kind] || item.kind)}</span>
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

function writingCard(item) {
  const comparison = state.writing.compared ? `
    <div class="writing-answer" aria-live="polite">
      <span>正确拼写</span>
      <strong>${escapeHtml(item.term)}</strong>
    </div>
    <div class="writing-outcomes" aria-label="书写结果">
      <button class="writing-outcome writing-incorrect" type="button" data-writing-result="incorrect">
        <i data-lucide="x"></i><span>有错</span>
      </button>
      <button class="writing-outcome writing-correct" type="button" data-writing-result="correct">
        <i data-lucide="check"></i><span>写对了</span>
      </button>
    </div>
  ` : `
    <button class="writing-compare-button" id="compare-writing" type="button" ${state.writing.strokes.length ? '' : 'disabled'}>
      <i data-lucide="scan-text"></i><span>对照拼写</span>
    </button>
  `;
  return `
    <article class="review-card writing-card" data-item-id="${item.id}">
      <div class="writing-header">
        <div>
          <p class="answer-label">手写巩固</p>
          <p class="writing-prompt">${escapeHtml(item.meaning)}</p>
        </div>
        <div class="writing-header-actions">
          ${speakerButton(item, 'writing-speaker')}
          <button class="icon-button writing-close" id="close-writing" type="button" aria-label="退出手写" title="退出手写">
            <i data-lucide="x"></i>
          </button>
        </div>
      </div>
      <div class="writing-surface">
        <canvas id="writing-canvas" aria-label="手写区域"></canvas>
        ${state.writing.strokes.length ? '' : '<span class="writing-placeholder">在这里写出英文</span>'}
      </div>
      <div class="writing-tools ${state.writing.compared ? 'is-compared' : ''}">
        <button class="icon-button" id="undo-writing" type="button" aria-label="撤销一笔" title="撤销一笔" ${state.writing.strokes.length ? '' : 'disabled'}>
          <i data-lucide="undo-2"></i>
        </button>
        <button class="icon-button" id="clear-writing" type="button" aria-label="清空笔迹" title="清空笔迹" ${state.writing.strokes.length ? '' : 'disabled'}>
          <i data-lucide="eraser"></i>
        </button>
        <span></span>
        ${comparison}
      </div>
    </article>
  `;
}

function componentBreakdown(item) {
  if (!item.components?.length) return '';
  const focusedIndex = Number.isInteger(state.componentFocus) ? state.componentFocus : -1;
  const focused = item.components[focusedIndex];
  const inspector = focused ? `
    <div class="component-inspector" aria-live="polite">
      <div class="component-inspector-copy">
        <small>${escapeHtml(COMPONENT_ROLE_LABELS[focused.role] || '片段')}</small>
        <strong>${escapeHtml(focused.text)}</strong>
        <span>${escapeHtml(focused.linkedItem?.meaning || focused.meaning)}</span>
      </div>
      <div class="component-inspector-actions">
        <button class="icon-button component-speaker" type="button" data-speak-component-index="${focusedIndex}"
          aria-label="播放 ${escapeHtml(focused.text)} 的发音" title="播放发音" ${speech.supported ? '' : 'disabled'}>
          <i data-lucide="volume-2"></i>
        </button>
        ${focused.linkedItem
          ? statusBadge(focused.linkedItem.status)
          : focused.role === 'word' ? `
            <button class="component-learn-button" type="button" data-add-component-index="${focusedIndex}">
              <i data-lucide="plus"></i><span>加入学习</span>
            </button>
          ` : '<span class="component-kind-label">构词片段</span>'}
      </div>
    </div>
  ` : '';
  return `
    <div class="component-breakdown">
      <p class="answer-label">构词拆解</p>
      <div class="component-flow">
        ${item.components.map((component, index) => `
          ${index ? '<span class="component-plus">+</span>' : ''}
          <button class="component-unit ${focusedIndex === index ? 'active' : ''}" type="button"
            data-component-index="${index}" aria-pressed="${focusedIndex === index}">
            <small>${escapeHtml(COMPONENT_ROLE_LABELS[component.role] || '片段')}</small>
            <strong>${escapeHtml(component.text)}</strong>
            <em>${escapeHtml(component.meaning)}</em>
          </button>
        `).join('')}
      </div>
      ${inspector}
      <p class="component-result"><i data-lucide="arrow-right"></i>${escapeHtml(item.meaning)}</p>
    </div>
  `;
}

function speakComponent(index, button) {
  const component = state.today[0]?.components?.[index];
  if (!component) return;
  if (!speech.supported) {
    toast('当前浏览器不支持系统发音');
    return;
  }
  speech.speak(component.text, {
    onStart: () => button.classList.add('is-speaking'),
    onEnd: () => button.classList.remove('is-speaking'),
    onError: () => {
      button.classList.remove('is-speaking');
      toast('发音没有成功，请再试一次');
    }
  });
}

async function addComponentToLearning(index) {
  const parent = state.today[0];
  const component = parent?.components?.[index];
  if (!parent || !component || component.linkedItem) return;
  const button = document.querySelector(`[data-add-component-index="${index}"]`);
  if (button) button.disabled = true;
  try {
    const result = await api(`/api/items/${parent.id}/components/${index}`, { method: 'POST', body: '{}' });
    component.linkedItem = {
      id: result.item.id,
      term: result.item.term,
      meaning: result.item.meaning,
      status: result.item.status
    };
    toast(result.created ? '已加入学习' : '词库中已有');
    renderToday();
  } catch (error) {
    showError(error);
    if (button) button.disabled = false;
  }
}

function answerPanel(item) {
  const writingLabel = state.writing.result === 'correct'
    ? '已写对'
    : state.writing.result === 'incorrect' ? '有错，再写一次' : '写一下';
  return `
    <div class="answer-panel">
      <p class="answer-label">${item.kind === 'sentence' ? '中文参考解释' : '中文核心义'}</p>
      <p class="answer-meaning">${escapeHtml(item.meaning)}</p>
      ${item.example ? `<p class="answer-detail"><span>上下文</span>${escapeHtml(item.example)}</p>` : ''}
      ${item.note && (item.coreOrder || item.module === 'reddit-forms' || item.kind === 'sentence') ? `<p class="answer-detail"><span>${item.kind === 'sentence' ? '关键关系' : '补充'}</span>${escapeHtml(item.note)}</p>` : ''}
      ${item.sourceUrl ? `<a class="source-link" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看原文来源</a>` : ''}
      ${componentBreakdown(item)}
      <button class="write-practice-button writing-result-${state.writing.result || 'none'}" id="start-writing" type="button">
        <i data-lucide="pen-line"></i><span>${writingLabel}</span>
      </button>
    </div>
    <div class="review-actions" aria-label="复习结果">
      <button class="rating-button rating-again" data-rating="again" type="button">
        <i data-lucide="rotate-ccw"></i><span>没想起来</span>
      </button>
      <button class="rating-button rating-hard" data-rating="hard" type="button">
        <i data-lucide="circle-help"></i><span>想起来但慢</span>
      </button>
      <button class="rating-button rating-good" data-rating="good" type="button">
        <i data-lucide="check"></i><span>记得</span>
      </button>
    </div>
    <details class="review-more">
      <summary>更多操作</summary>
      <p>仅在实际帖文中无提示理解这个词时，记录真实命中。</p>
      <button class="rating-button rating-real" data-rating="real" type="button">
        <i data-lucide="scan-text"></i><span>真实命中</span>
      </button>
    </details>
  `;
}

function emptyToday() {
  return `
    <div class="empty-state">
      <div class="completion-mark"><i data-lucide="check"></i></div>
      <h2>当前没有到期内容</h2>
      <p>${state.nextDueAt ? `下一次到期：${escapeHtml(formatDue(state.nextDueAt))}。` : ''}可以在词句库主动练习或添加工作词句。</p>
      <button class="text-button primary-button" id="open-library" type="button">
        <i data-lucide="notebook-tabs"></i>打开词句
      </button>
    </div>
  `;
}

function startWritingPractice() {
  state.writing = { ...emptyWritingState(), active: true, startedAt: Date.now() };
  renderToday();
}

function closeWritingPractice() {
  state.writing = emptyWritingState();
  renderToday();
}

function compareWriting() {
  if (!state.writing.strokes.length) {
    toast('先写一遍，再对照拼写');
    return;
  }
  state.writing.compared = true;
  renderToday();
}

function recordWritingResult(result) {
  const durationMs = Math.min(600_000, Math.max(0, Date.now() - (state.writing.startedAt || Date.now())));
  state.writing = {
    ...emptyWritingState(),
    result,
    durationMs
  };
  state.revealed = true;
  renderToday();
}

function drawWritingCanvas(canvas) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  context.strokeStyle = '#29262f';
  context.lineWidth = 4.2;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of state.writing.strokes) {
    if (!stroke.length) continue;
    context.beginPath();
    stroke.forEach((point, index) => {
      const x = point.x * rect.width;
      const y = point.y * rect.height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    if (stroke.length === 1) {
      const point = stroke[0];
      context.lineTo(point.x * rect.width + .1, point.y * rect.height + .1);
    }
    context.stroke();
  }
}

function initializeWritingCanvas() {
  const canvas = document.querySelector('#writing-canvas');
  if (!canvas) return;
  drawWritingCanvas(canvas);
  if (state.writing.compared) return;

  const pointFromEvent = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    };
  };
  let activeStroke = null;
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    activeStroke = [pointFromEvent(event)];
    state.writing.strokes.push(activeStroke);
    document.querySelector('.writing-placeholder')?.remove();
    document.querySelector('#undo-writing').disabled = false;
    document.querySelector('#clear-writing').disabled = false;
    document.querySelector('#compare-writing').disabled = false;
    drawWritingCanvas(canvas);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!activeStroke) return;
    event.preventDefault();
    activeStroke.push(pointFromEvent(event));
    drawWritingCanvas(canvas);
  });
  const finishStroke = (event) => {
    if (!activeStroke) return;
    event.preventDefault();
    activeStroke = null;
  };
  canvas.addEventListener('pointerup', finishStroke);
  canvas.addEventListener('pointercancel', finishStroke);
}

function bindTodayEvents() {
  document.querySelector('#toggle-training')?.addEventListener('click', async () => {
    state.trainingType = state.trainingType === 'sentence' ? 'words' : 'sentence';
    state.reviewMode = 'reading';
    speech.cancel();
    try { await loadToday(); } catch (error) { showError(error); }
  });
  document.querySelector('#end-practice')?.addEventListener('click', () => loadToday().catch(showError));
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
      state.componentFocus = null;
      state.writing = emptyWritingState();
      localStorage.setItem(REVIEW_MODE_KEY, state.reviewMode);
      renderToday();
      if (state.reviewMode === 'listening') speakItem(state.today[0]);
    });
  });
  document.querySelector('#start-writing')?.addEventListener('click', startWritingPractice);
  document.querySelector('#close-writing')?.addEventListener('click', closeWritingPractice);
  document.querySelector('#compare-writing')?.addEventListener('click', compareWriting);
  document.querySelector('#undo-writing')?.addEventListener('click', () => {
    state.writing.strokes.pop();
    renderToday();
  });
  document.querySelector('#clear-writing')?.addEventListener('click', () => {
    state.writing.strokes = [];
    state.writing.compared = false;
    renderToday();
  });
  document.querySelectorAll('[data-writing-result]').forEach((button) => {
    button.addEventListener('click', () => recordWritingResult(button.dataset.writingResult));
  });
  document.querySelectorAll('[data-component-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.componentIndex);
      state.componentFocus = state.componentFocus === index ? null : index;
      renderToday();
    });
  });
  document.querySelectorAll('[data-speak-component-index]').forEach((button) => {
    button.addEventListener('click', () => speakComponent(Number(button.dataset.speakComponentIndex), button));
  });
  document.querySelectorAll('[data-add-component-index]').forEach((button) => {
    button.addEventListener('click', () => addComponentToLearning(Number(button.dataset.addComponentIndex)));
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
  const practice = state.practice;
  document.querySelectorAll('[data-rating]').forEach((button) => { button.disabled = true; });
  showReviewReward(rating);
  try {
    const result = await api(`/api/items/${item.id}/reviews`, {
      method: 'POST',
      body: JSON.stringify({
        rating,
        ratingVersion: 2,
        eventKind: practice ? 'practice' : 'review',
        writingResult: state.writing.result,
        writingDurationMs: state.writing.durationMs
      })
    });
    const transition = result.transition;
    const changed = transition.previousStatus !== transition.nextStatus;
    if (practice) {
      toast('练习已记录，正式到期日和等级不变');
    } else {
      toast(`${changed ? `${transition.previousStatus} → ${transition.nextStatus}；` : ''}下次复习：${formatDue(result.item.nextReviewAt)}`);
    }
    state.progress = result.progress;
    state.session.reviews += 1;
    state.revealed = false;
    if (state.today[0]?.id !== item.id) return;
    if (practice) {
      state.today = [result.item]; state.writing = emptyWritingState(); renderToday();
    } else await loadToday();
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
  const data = await api(`/api/today?limit=10&kind=${state.trainingType}`);
  state.practice = false;
  state.nextDueAt = data.nextDueAt;
  state.today = data.items;
  state.progress = data.progress;
  state.revealed = false;
  state.componentFocus = null;
  state.writing = emptyWritingState();
  renderToday();
}

function renderLibrary() {
  const rows = state.library.map((item) => `
    <div class="library-row">
      <button class="library-row-main" type="button" data-edit-id="${item.id}">
        <p class="library-term">${escapeHtml(item.term)}</p>
        <p class="library-meaning">${escapeHtml(item.meaning)}</p>
        <div class="row-badges">
          ${statusBadge(item.status)}
          ${moduleBadge(item.module)}
        </div>
      </button>
      <div class="library-row-actions">
        <button class="text-button practice-item-button" type="button" data-practice-id="${item.id}" aria-label="练习 ${escapeHtml(item.term)}" title="练习本词句">练习</button>
        ${speakerButton(item, 'row-speaker')}
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
        ${segmentButton('learning', '学习中')}
        ${segmentButton('mastered', '已记住')}
      </div>
      <select id="library-module" aria-label="筛选范围">
        ${moduleOptions(state.libraryModule, true, state.libraryOtherModules)}
      </select>
    </div>
    <button class="text-button module-toggle" id="toggle-other-modules" type="button" aria-expanded="${state.libraryOtherModules}">${state.libraryOtherModules ? '收起其他分类' : '其他分类'}</button>
    <section class="draft-collection">
      <button class="text-button" id="collect-reading" type="button">收藏工作原句</button>
      ${state.drafts.length ? `<details><summary>待整理原句 · ${state.drafts.length} 条</summary>${state.drafts.map(draft => `<button class="draft-row" type="button" data-draft-id="${draft.id}">${escapeHtml(draft.text)}</button>`).join('')}</details>` : ''}
    </section>
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

function moduleOptions(selected, allowAll = true, includeOther = true) {
  const option = (value) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(MODULE_LABELS[value])}</option>`;
  const other = Object.keys(MODULE_LABELS).filter(value => !WORK_MODULES.includes(value));
  return `${allowAll ? `<option value="all" ${selected === 'all' ? 'selected' : ''}>全部范围</option>` : ''}
    <optgroup label="工作词库">${WORK_MODULES.map(option).join('')}</optgroup>
    ${includeOther ? `<optgroup label="历史与其他分类">${other.map(option).join('')}</optgroup>` : ''}`;
}

function formatDue(value) {
  if (!value) return '尚未安排';
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Singapore', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function startPractice(id) {
  const { item } = await api(`/api/items/${id}`);
  state.trainingType = item.kind === 'sentence' ? 'sentence' : 'words';
  state.reviewMode = 'reading'; state.practice = true; state.today = [item];
  state.revealed = false; state.componentFocus = null; state.writing = emptyWritingState();
  switchView('today'); renderToday();
}

function openDraftDialog(id = null) {
  const draft = state.drafts.find(entry => entry.id === id);
  state.editingDraftId = draft?.id || null;
  document.querySelector('#draft-form').reset();
  document.querySelector('#draft-text').value = draft?.text || '';
  document.querySelector('#draft-source-url').value = draft?.sourceUrl || '';
  document.querySelector('#draft-text').readOnly = Boolean(draft);
  document.querySelector('#draft-source-url').readOnly = Boolean(draft);
  document.querySelector('#draft-title').textContent = draft ? '核对工作原句' : '收藏工作原句';
  document.querySelector('#save-draft').hidden = Boolean(draft);
  document.querySelector('#publish-draft').hidden = !draft;
  document.querySelector('#draft-reference').hidden = !draft;
  document.querySelector('#draft-dialog').showModal();
}

async function saveDraft(event) {
  event.preventDefault();
  const button = document.querySelector('#save-draft'); button.disabled = true;
  try {
    await api('/api/reading-drafts', { method: 'POST', body: JSON.stringify({
      text: document.querySelector('#draft-text').value, sourceUrl: document.querySelector('#draft-source-url').value
    }) });
    document.querySelector('#draft-dialog').close();
    toast('已收藏，补充并核对参考解释后再练习'); await loadLibrary(true);
  } catch (error) { showError(error); } finally { button.disabled = false; }
}

async function publishDraft() {
  const button = document.querySelector('#publish-draft'); button.disabled = true;
  try {
    await api(`/api/reading-drafts/${state.editingDraftId}/publish`, { method: 'POST', body: JSON.stringify({
      meaning: document.querySelector('#draft-meaning').value, note: document.querySelector('#draft-note').value
    }) });
    document.querySelector('#draft-dialog').close();
    toast('已加入阅读练习'); await loadLibrary(true); await loadToday();
  } catch (error) { showError(error); } finally { button.disabled = false; }
}

function segmentButton(value, label) {
  return `<button class="segment-button ${state.libraryStatus === value ? 'active' : ''}" type="button" data-library-status="${value}">${label}</button>`;
}

let searchTimer;
function bindLibraryEvents() {
  document.querySelector('#collect-reading')?.addEventListener('click', () => openDraftDialog());
  document.querySelectorAll('[data-draft-id]').forEach(button => button.addEventListener('click', () => openDraftDialog(Number(button.dataset.draftId))));
  document.querySelectorAll('[data-practice-id]').forEach(button => button.addEventListener('click', () => startPractice(Number(button.dataset.practiceId)).catch(showError)));
  document.querySelector('#toggle-other-modules')?.addEventListener('click', () => {
    state.libraryOtherModules = !state.libraryOtherModules;
    if (!state.libraryOtherModules && !WORK_MODULES.includes(state.libraryModule)) state.libraryModule = 'all';
    loadLibrary(true);
  });
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
  state.drafts = (await api('/api/reading-drafts')).drafts;
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
  const coreSeen = (progress.coreCounts?.S1 || 0) + (progress.coreCounts?.S2 || 0) + (progress.coreCounts?.S3 || 0);
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
    <section class="progress-section">
      <div class="section-heading"><div><p class="section-kicker">工作阅读词库</p><h2>Reddit 核心 3000</h2></div><strong>${coreSeen}/3000</strong></div>
      <p class="answer-detail">已有认读证据 ${coreSeen} 项；S2 以上 ${(progress.coreCounts?.S2 || 0) + (progress.coreCounts?.S3 || 0)} 项。认读数量不代表真实帖文理解率。</p>
    </section>
    <section class="progress-section">
      <div class="section-heading"><div><p class="section-kicker">词汇证据</p><h2>S0–S3 分布</h2></div></div>
      <p class="answer-detail">新规则正式自评：词汇 ${progress.readingReview.correct}/${progress.readingReview.reviewed}；句子 ${progress.sentenceReview.correct}/${progress.sentenceReview.reviewed}。其中长期排程自评 ${progress.longTermReview.correct}/${progress.longTermReview.reviewed}。主动练习不计入该结果。</p>
      <div class="evidence-list">
        ${['S0', 'S1', 'S2', 'S3'].map((status) => `
          <div class="evidence-row evidence-${status}">
            <span class="evidence-name"><b>${status}</b>${escapeHtml(STATUS_LABELS[status])}</span>
            <div class="evidence-track"><span style="width:${formatPercent(progress.counts[status], evidenceTotal)}%"></span></div>
            <strong>${progress.counts[status]}</strong>
          </div>
        `).join('')}
      </div>
    </section>
    <details class="progress-section iphone-gate history-disclosure">
      <summary>iPhone 专项（历史目标）</summary>
      <div class="section-heading">
        <div><p class="section-kicker">专项复习</p><h2>iPhone 英文切换</h2></div>
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
    </details>
    <details class="progress-section history-disclosure">
      <summary>历史学习档案</summary>
      <p class="answer-detail">以下阶段来自历史档案，不随当前词卡复习自动更新。</p>
      <div class="track-list">
        ${readingTracks.map((track) => `
          <div class="track-row">
            <span class="track-code">${escapeHtml(track.code)}</span>
            <div class="track-body">
              <span class="track-label">${escapeHtml(track.label)}</span>
            </div>
            <span class="track-value">${track.current}/${track.target}</span>
          </div>
        `).join('')}
      </div>
    </details>
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

function componentRoleOptions(selected = 'word') {
  return Object.entries(COMPONENT_ROLE_LABELS).map(([value, label]) => `
    <option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>
  `).join('');
}

function componentRow(component = {}, index = 0) {
  return `
    <div class="component-editor-row" data-component-row>
      <label>
        <span class="sr-only">片段</span>
        <input data-component-text maxlength="60" value="${escapeHtml(component.text || '')}" placeholder="例如 dis-">
      </label>
      <label>
        <span class="sr-only">片段中文义</span>
        <input data-component-meaning maxlength="120" value="${escapeHtml(component.meaning || '')}" placeholder="不；相反">
      </label>
      <label>
        <span class="sr-only">片段类型</span>
        <select data-component-role>${componentRoleOptions(component.role)}</select>
      </label>
      <button class="icon-button component-remove" type="button" data-remove-component="${index}" aria-label="删除构词片段" title="删除构词片段">
        <i data-lucide="trash-2"></i>
      </button>
    </div>
  `;
}

function readComponentRows() {
  return [...document.querySelectorAll('[data-component-row]')].map((row) => ({
    text: row.querySelector('[data-component-text]').value.trim(),
    meaning: row.querySelector('[data-component-meaning]').value.trim(),
    role: row.querySelector('[data-component-role]').value
  })).filter((component) => component.text || component.meaning);
}

function renderComponentEditor(components = []) {
  const details = document.querySelector('#component-editor');
  const rows = document.querySelector('#component-editor-rows');
  rows.innerHTML = components.map(componentRow).join('');
  details.open = components.length > 0;
  rows.querySelectorAll('[data-remove-component]').forEach((button) => {
    button.addEventListener('click', () => {
      const values = readComponentRows();
      values.splice(Number(button.dataset.removeComponent), 1);
      renderComponentEditor(values);
    });
  });
  icons(rows);
  updateAdvancedSummary();
}

function updateAdvancedSummary() {
  const summary = document.querySelector('#item-advanced-summary');
  if (!summary) return;
  const componentCount = readComponentRows().length;
  const hasOptionalValue = Boolean(
    document.querySelector('#item-phonetic').value.trim()
    || document.querySelector('#item-example').value.trim()
    || document.querySelector('#item-source').value.trim()
    || document.querySelector('#item-kind').value !== 'word'
    || document.querySelector('#item-module').value !== 'custom'
  );
  summary.textContent = componentCount ? `${componentCount} 个片段` : hasOptionalValue ? '已填写' : '可选';
}

function addComponentRow() {
  const components = readComponentRows();
  if (components.length >= 8) {
    toast('每条内容最多拆成 8 个片段');
    return;
  }
  components.push({ text: '', meaning: '', role: 'word' });
  renderComponentEditor(components);
  document.querySelector('#item-advanced').open = true;
  document.querySelector('#component-editor').open = true;
  const inputs = document.querySelectorAll('[data-component-text]');
  inputs[inputs.length - 1]?.focus();
}

function openAddDialog() {
  state.editingItem = null;
  els.itemForm.reset();
  document.querySelector('#item-module').innerHTML = moduleOptions('custom', false);
  document.querySelector('#item-id').value = '';
  document.querySelector('#dialog-eyebrow').textContent = '新内容';
  document.querySelector('#dialog-title').textContent = '添加词句';
  document.querySelector('#delete-item').classList.add('hidden');
  renderComponentEditor([]);
  document.querySelector('#item-advanced').open = false;
  updateAdvancedSummary();
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
  document.querySelector('#item-module').innerHTML = moduleOptions(item.module in MODULE_LABELS ? item.module : 'custom', false);
  document.querySelector('#item-example').value = item.example || '';
  document.querySelector('#item-source').value = item.source || '';
  document.querySelector('#item-source-url').value = item.sourceUrl || '';
  document.querySelector('#item-note').value = item.note || '';
  renderComponentEditor(item.components || []);
  document.querySelector('#item-advanced').open = false;
  updateAdvancedSummary();
  document.querySelector('#dialog-eyebrow').textContent = `${item.status} · ${STATUS_LABELS[item.status]}`;
  document.querySelector('#dialog-title').textContent = '编辑词句';
  document.querySelector('#delete-item').classList.remove('hidden');
  els.itemDialog.showModal();
}

function closeItemDialog() {
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
    source: document.querySelector('#item-source').value,
    sourceUrl: document.querySelector('#item-source-url').value,
    note: document.querySelector('#item-note').value,
    components: readComponentRows()
  };
  try {
    await api(id ? `/api/items/${id}` : '/api/items', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(body)
    });
    closeItemDialog();
    toast(id ? '已保存修改' : '已加入今日复习');
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
document.querySelector('#draft-form').addEventListener('submit', saveDraft);
document.querySelector('#publish-draft').addEventListener('click', publishDraft);
document.querySelector('#close-draft').addEventListener('click', () => document.querySelector('#draft-dialog').close());
document.querySelector('#audio-settings-button').addEventListener('click', openAudioDialog);
document.querySelector('#close-dialog').addEventListener('click', closeItemDialog);
document.querySelector('#cancel-dialog').addEventListener('click', closeItemDialog);
document.querySelector('#delete-item').addEventListener('click', deleteItem);
document.querySelector('#add-component').addEventListener('click', addComponentRow);
document.querySelector('#component-editor-rows').addEventListener('input', updateAdvancedSummary);
document.querySelector('#component-editor-rows').addEventListener('change', updateAdvancedSummary);
['#item-phonetic', '#item-kind', '#item-module', '#item-example', '#item-source'].forEach((selector) => {
  const field = document.querySelector(selector);
  field.addEventListener('input', updateAdvancedSummary);
  field.addEventListener('change', updateAdvancedSummary);
});
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
window.addEventListener('resize', () => drawWritingCanvas(document.querySelector('#writing-canvas')));
setInterval(updateSessionSummary, 30_000);

function isEditableTarget(target) {
  return target instanceof Element && Boolean(target.closest('input, textarea, [contenteditable="true"]'));
}

document.addEventListener('selectstart', (event) => {
  if (!isEditableTarget(event.target)) event.preventDefault();
});
document.addEventListener('copy', (event) => {
  if (!isEditableTarget(event.target)) event.preventDefault();
});
document.addEventListener('contextmenu', (event) => {
  if (!isEditableTarget(event.target)) event.preventDefault();
});

const initialView = ['today', 'library', 'progress'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
bootstrapAuth();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(appUrl('/service-worker.js?v=1.8.0'), { scope: APP_BASE_URL.pathname }).catch(console.error);
}
