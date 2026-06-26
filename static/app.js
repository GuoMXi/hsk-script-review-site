const state = {
  config: null,
  levels: [],
  exams: [],
  current: null,
  dirty: false,
  selectedImage: null,
  editorSelectionStart: 0,
  editorSelectionEnd: 0,
  editorScrollTop: 0,
  editorScrollLeft: 0,
  objectUrls: [],
};

const $ = (id) => document.getElementById(id);
const levelSelect = $('levelSelect');
const examSelect = $('examSelect');
const pdfSelect = $('pdfSelect');
const editor = $('editor');
const pdfFrame = $('pdfFrame');
const openPdf = $('openPdf');
const statusEl = $('status');
const meta = $('meta');
const reviewBtn = $('reviewBtn');
const imageGrid = $('imageGrid');
const imageTitle = $('imageTitle');
const copyImagePathBtn = $('copyImagePathBtn');
const insertPictureBtn = $('insertPictureBtn');
const uploadImageBtn = $('uploadImageBtn');
const uploadImageInput = $('uploadImageInput');
const pasteImageTarget = $('pasteImageTarget');
const wrapToggle = $('wrapToggle');
const settingsDialog = $('settingsDialog');
const settingsForm = $('settingsForm');
const settingsBtn = $('settingsBtn');
const cancelSettingsBtn = $('cancelSettingsBtn');
const hoverImagePreview = $('hoverImagePreview');

const TEXT_SCRIPT = '脚本语言试卷.md';
const TEXT_DONE_SCRIPT = '√脚本语言试卷.md';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const PDF_EXTENSIONS = new Set(['.pdf']);

function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${cls}`.trim();
}

function pathJoin(...parts) {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/').replace(/\/\/+/, '/');
}

function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

function fileExt(name) {
  const idx = String(name || '').lastIndexOf('.');
  return idx >= 0 ? name.slice(idx).toLowerCase() : '';
}

function configKey() { return 'hsk-github-review-config'; }
function tokenKey() { return 'hsk-github-review-token'; }

function loadSavedConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem(configKey()) || 'null');
    const token = localStorage.getItem(tokenKey()) || '';
    if (cfg && token) cfg.token = token;
    return cfg;
  } catch {
    return null;
  }
}

function saveConfig(config, rememberToken) {
  const clean = { ...config };
  delete clean.token;
  localStorage.setItem(configKey(), JSON.stringify(clean));
  if (rememberToken) localStorage.setItem(tokenKey(), config.token);
  else localStorage.removeItem(tokenKey());
}

function fillSettings(config = {}) {
  $('ownerInput').value = config.owner || 'GuoMXi';
  $('repoInput').value = config.repo || '';
  $('branchInput').value = config.branch || 'main';
  $('rootPathInput').value = config.rootPath || '';
  $('tokenInput').value = config.token || '';
  $('rememberTokenInput').checked = Boolean(config.token);
}

function readSettings() {
  return {
    owner: $('ownerInput').value.trim(),
    repo: $('repoInput').value.trim(),
    branch: $('branchInput').value.trim() || 'main',
    rootPath: $('rootPathInput').value.trim().replace(/^\/+|\/+$/g, ''),
    token: $('tokenInput').value.trim(),
  };
}

async function github(path, options = {}) {
  if (!state.config?.token) throw new Error('请先配置 GitHub Token');
  const headers = {
    Accept: options.accept || 'application/vnd.github+json',
    Authorization: `Bearer ${state.config.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(options.headers || {}),
  };
  const res = await fetch(`https://api.github.com${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body.message || JSON.stringify(body);
    } catch {
      detail = await res.text();
    }
    throw new Error(`GitHub ${res.status}: ${detail}`);
  }
  if (options.raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

function repoApi(path) {
  return `/repos/${encodeURIComponent(state.config.owner)}/${encodeURIComponent(state.config.repo)}${path}`;
}

async function listContents(path) {
  const q = `?ref=${encodeURIComponent(state.config.branch)}`;
  const data = await github(repoApi(`/contents/${encodePath(path)}${q}`));
  return Array.isArray(data) ? data : [data];
}

async function getContent(path) {
  const q = `?ref=${encodeURIComponent(state.config.branch)}`;
  return github(repoApi(`/contents/${encodePath(path)}${q}`));
}

async function fetchBlob(path, mimeType = '') {
  const q = `?ref=${encodeURIComponent(state.config.branch)}`;
  const res = await github(repoApi(`/contents/${encodePath(path)}${q}`), {
    accept: 'application/vnd.github.raw',
    raw: true,
  });
  const buffer = await res.arrayBuffer();
  return new Blob([buffer], { type: mimeType || res.headers.get('content-type') || '' });
}

async function putContent(path, textOrBase64, message, sha = null, encoded = false) {
  const content = encoded ? textOrBase64 : utf8ToBase64(textOrBase64);
  const body = { message, content, branch: state.config.branch };
  if (sha) body.sha = sha;
  return github(repoApi(`/contents/${encodePath(path)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function deleteContent(path, sha, message) {
  return github(repoApi(`/contents/${encodePath(path)}`), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: state.config.branch }),
  });
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUtf8(base64) {
  const binary = atob(String(base64 || '').replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function rememberEditorPosition() {
  state.editorSelectionStart = editor.selectionStart ?? state.editorSelectionStart ?? 0;
  state.editorSelectionEnd = editor.selectionEnd ?? state.editorSelectionEnd ?? state.editorSelectionStart;
  state.editorScrollTop = editor.scrollTop || 0;
  state.editorScrollLeft = editor.scrollLeft || 0;
}

function keepEditorFocus(event) {
  rememberEditorPosition();
  event.preventDefault();
}

function insertAtCursor(textToInsert) {
  const fallback = editor.value.length;
  const start = Math.min(state.editorSelectionStart ?? fallback, editor.value.length);
  const end = Math.min(state.editorSelectionEnd ?? start, editor.value.length);
  const before = editor.value.slice(0, start);
  const after = editor.value.slice(end);
  editor.value = before + textToInsert + after;
  const cursor = start + textToInsert.length;
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(cursor, cursor);
  editor.scrollTop = state.editorScrollTop || 0;
  editor.scrollLeft = state.editorScrollLeft || 0;
  state.editorSelectionStart = cursor;
  state.editorSelectionEnd = cursor;
  state.dirty = true;
  meta.textContent = `${editor.value.length} 字符 · 未保存`;
  setStatus('已插入图片引用，请保存脚本', 'warn');
}

function applyWrapMode() {
  editor.classList.toggle('no-wrap', !wrapToggle.checked);
  localStorage.setItem('hsk-github-review-wrap', wrapToggle.checked ? '1' : '0');
}

function restoreWrapMode() {
  if (localStorage.getItem('hsk-github-review-wrap') === '0') wrapToggle.checked = false;
  applyWrapMode();
}

async function initializeFromConfig(config) {
  state.config = config;
  saveConfig(config, $('rememberTokenInput').checked);
  setStatus('正在读取仓库...');
  const user = await github('/user');
  setStatus(`已连接 GitHub：${user.login}`, 'ok');
  await loadLevels();
}

async function loadLevels() {
  setStatus('正在读取等级目录...');
  const rows = await listContents(state.config.rootPath);
  state.levels = rows.filter((item) => item.type === 'dir' && /^HSK[1-6]$/.test(item.name)).map((item) => item.name).sort();
  levelSelect.innerHTML = '';
  for (const level of state.levels) {
    const opt = document.createElement('option');
    opt.value = level;
    opt.textContent = level;
    levelSelect.appendChild(opt);
  }
  if (state.levels.includes('HSK5')) levelSelect.value = 'HSK5';
  await loadExams();
}

async function loadExams() {
  const level = levelSelect.value;
  if (!level) return;
  setStatus(`正在读取 ${level} 试卷...`);
  const rows = await listContents(pathJoin(state.config.rootPath, level));
  const dirs = rows.filter((item) => item.type === 'dir').map((item) => item.name).sort();
  state.exams = [];
  examSelect.innerHTML = '';
  for (const exam of dirs) {
    state.exams.push({ level, exam });
    const opt = document.createElement('option');
    opt.value = exam;
    opt.textContent = exam;
    examSelect.appendChild(opt);
  }
  await loadCurrent();
}

async function loadCurrent() {
  if (state.dirty && !confirm('当前脚本有未保存修改，确定切换吗？')) return;
  const level = levelSelect.value;
  const exam = examSelect.value;
  if (!level || !exam) return;
  cleanupObjectUrls();
  const folder = pathJoin(state.config.rootPath, level, exam);
  setStatus(`正在加载 ${exam}...`);
  const files = await listContents(folder);
  const fileMap = new Map(files.map((item) => [item.name, item]));
  const scriptItem = fileMap.get(TEXT_DONE_SCRIPT) || fileMap.get(TEXT_SCRIPT);
  if (!scriptItem) throw new Error(`${exam} 没有脚本语言试卷.md`);
  const content = await getContent(pathJoin(folder, scriptItem.name));
  const scriptText = base64ToUtf8(content.content);
  const pdfs = files.filter((item) => item.type === 'file' && PDF_EXTENSIONS.has(fileExt(item.name))).map((item) => item.name).sort(sortPdfNames);
  const images = await listImagesRecursive(pathJoin(folder, 'images')).catch(() => []);

  state.current = {
    level,
    exam,
    folder,
    files,
    fileMap,
    scriptName: scriptItem.name,
    scriptPath: pathJoin(folder, scriptItem.name),
    scriptSha: content.sha,
    reviewed: scriptItem.name === TEXT_DONE_SCRIPT,
    pdfs,
    images,
  };
  editor.value = scriptText;
  state.dirty = false;
  state.selectedImage = null;
  state.editorSelectionStart = 0;
  state.editorSelectionEnd = 0;
  $('scriptTitle').textContent = `${level} / ${exam} / ${scriptItem.name}`;
  setReviewUi(state.current.reviewed);
  meta.textContent = `${scriptText.length} 字符`;
  renderPdfs();
  renderImages();
  setStatus('已加载', 'ok');
}

function sortPdfNames(a, b) {
  const rank = (name) => name.startsWith('paper_') ? 0 : name.includes('answer') ? 2 : 1;
  return rank(a) - rank(b) || a.localeCompare(b);
}

async function listImagesRecursive(path) {
  const out = [];
  const rows = await listContents(path);
  for (const row of rows) {
    if (row.type === 'dir') out.push(...await listImagesRecursive(row.path));
    else if (row.type === 'file' && IMAGE_EXTENSIONS.has(fileExt(row.name))) out.push(row);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function setReviewUi(reviewed) {
  reviewBtn.textContent = reviewed ? '取消完成' : '标为完成';
  reviewBtn.classList.toggle('reviewed', Boolean(reviewed));
}

function renderPdfs() {
  pdfSelect.innerHTML = '';
  for (const pdf of state.current.pdfs) {
    const opt = document.createElement('option');
    opt.value = pdf;
    opt.textContent = pdf;
    pdfSelect.appendChild(opt);
  }
  if (state.current.pdfs.length) setPdf(state.current.pdfs[0]).catch((err) => setStatus(err.message, 'err'));
  else {
    pdfFrame.removeAttribute('src');
    openPdf.removeAttribute('href');
    $('pdfTitle').textContent = '无 PDF';
  }
}

async function setPdf(name) {
  if (!name || !state.current) return;
  setStatus('正在读取 PDF...');
  const blob = await fetchBlob(pathJoin(state.current.folder, name), 'application/pdf');
  const url = URL.createObjectURL(blob);
  state.objectUrls.push(url);
  pdfFrame.src = url;
  openPdf.href = url;
  openPdf.textContent = '新窗口打开';
  $('pdfTitle').textContent = name;
  setStatus('PDF 已加载', 'ok');
}

function cleanupObjectUrls() {
  for (const url of state.objectUrls) URL.revokeObjectURL(url);
  state.objectUrls = [];
}

async function imageObjectUrl(image) {
  if (image.objectUrl) return image.objectUrl;
  const blob = await fetchBlob(image.path);
  image.objectUrl = URL.createObjectURL(blob);
  state.objectUrls.push(image.objectUrl);
  return image.objectUrl;
}

function renderImages() {
  imageGrid.innerHTML = '';
  const images = state.current?.images || [];
  imageTitle.textContent = images.length ? `图片资源 (${images.length})` : '无图片资源';
  if (!images.length) {
    const empty = document.createElement('div');
    empty.className = 'image-empty';
    empty.textContent = '这套试卷没有 images/ 图片目录';
    imageGrid.appendChild(empty);
    return;
  }
  for (const image of images) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'image-card';
    card.title = relativeImagePath(image.path);
    const img = document.createElement('img');
    img.alt = image.name || image.path;
    img.loading = 'lazy';
    imageObjectUrl(image).then((url) => { img.src = url; }).catch(() => {});
    const label = document.createElement('div');
    label.textContent = image.name || relativeImagePath(image.path);
    card.appendChild(img);
    card.appendChild(label);
    card.addEventListener('click', () => selectImage(image, card));
    imageGrid.appendChild(card);
  }
}

function relativeImagePath(path) {
  const prefix = `${state.current.folder}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function selectImage(image, card) {
  state.selectedImage = image;
  for (const item of imageGrid.querySelectorAll('.image-card')) item.classList.remove('selected');
  if (card) card.classList.add('selected');
  imageTitle.textContent = relativeImagePath(image.path);
}

async function copySelectedImagePath() {
  if (!state.selectedImage) return setStatus('先点选一张图片', 'warn');
  await navigator.clipboard.writeText(relativeImagePath(state.selectedImage.path));
  setStatus('已复制图片相对路径', 'ok');
}

function insertSelectedImage() {
  if (!state.selectedImage) return setStatus('先点选一张图片', 'warn');
  insertAtCursor(`Picture(${relativeImagePath(state.selectedImage.path)})`);
}

async function saveCurrent() {
  if (!state.current) return;
  setStatus('正在保存到 GitHub...');
  const result = await putContent(state.current.scriptPath, editor.value, `Update ${state.current.exam} script`, state.current.scriptSha);
  state.current.scriptSha = result.content.sha;
  state.dirty = false;
  meta.textContent = `${editor.value.length} 字符 · 已保存`;
  setStatus('已保存并提交到 GitHub', 'ok');
}

async function setReviewedCurrent() {
  if (!state.current) return;
  if (state.dirty) await saveCurrent();
  const targetName = state.current.reviewed ? TEXT_SCRIPT : TEXT_DONE_SCRIPT;
  const targetPath = pathJoin(state.current.folder, targetName);
  if (targetPath === state.current.scriptPath) return;
  setStatus(state.current.reviewed ? '正在取消完成...' : '正在标为完成...');
  await putContent(targetPath, editor.value, `${state.current.reviewed ? 'Unmark' : 'Mark'} ${state.current.exam} reviewed`);
  await deleteContent(state.current.scriptPath, state.current.scriptSha, `Remove old script name for ${state.current.exam}`);
  await loadCurrent();
  setStatus(state.current.reviewed ? '已标为完成' : '已取消完成', 'ok');
}

function clipboardImagePayload(event) {
  const clipboard = event.clipboardData;
  const items = Array.from(clipboard?.items || []);
  for (const item of items) {
    if (item.kind === 'file' && item.type && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return { file };
    }
  }
  const html = clipboard?.getData('text/html') || '';
  const dataMatch = html.match(/<img[^>]+src=["'](data:image\/[a-zA-Z0-9.+-]+;base64,[^"']+)["']/i)
    || html.match(/(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/i);
  if (dataMatch) return { dataUrl: dataMatch[1], name: '' };
  return null;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read image failed'));
    reader.readAsDataURL(file);
  });
}

async function uploadImagePayload(payload) {
  if (!state.current) throw new Error('还没有加载试卷');
  const dataUrl = payload.file ? await fileToDataUrl(payload.file) : payload.dataUrl;
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('无法识别图片数据');
  const mime = match[1].toLowerCase();
  const ext = mime.includes('jpeg') ? '.jpg' : mime.includes('webp') ? '.webp' : mime.includes('gif') ? '.gif' : '.png';
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const path = pathJoin(state.current.folder, 'images', `paste_${stamp}_${Math.random().toString(16).slice(2, 8)}${ext}`);
  const result = await putContent(path, match[2], `Upload image for ${state.current.exam}`, null, true);
  const item = result.content;
  state.current.images.push(item);
  renderImages();
  insertAtCursor(`Picture(${relativeImagePath(item.path)})`);
  setStatus(`已上传图片并插入 ${relativeImagePath(item.path)}`, 'ok');
}

async function handleImagePaste(event, warnIfEmpty = false) {
  const payload = clipboardImagePayload(event);
  if (!payload) {
    if (warnIfEmpty) setStatus('剪贴板里没有识别到图片，请试试“上传图片”', 'warn');
    return false;
  }
  event.preventDefault();
  if (event.currentTarget === editor || document.activeElement === editor) rememberEditorPosition();
  pasteImageTarget.classList.add('pasting');
  try {
    setStatus('正在上传粘贴图片...');
    await uploadImagePayload(payload);
  } finally {
    pasteImageTarget.classList.remove('pasting');
  }
  return true;
}

async function handleManualImageUpload() {
  const file = uploadImageInput.files?.[0];
  if (!file) return;
  rememberEditorPosition();
  await uploadImagePayload({ file });
  uploadImageInput.value = '';
}

function editorLineAtPointer(event) {
  const rect = editor.getBoundingClientRect();
  const style = window.getComputedStyle(editor);
  const lineHeight = Number.parseFloat(style.lineHeight) || 24;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const y = event.clientY - rect.top + editor.scrollTop - paddingTop;
  const lineIndex = Math.max(0, Math.floor(y / lineHeight));
  return editor.value.split('\n')[lineIndex] || '';
}

function firstImagePathInText(text) {
  const m = /Picture\(\s*(images\/[^)\s]+)\s*\)/.exec(text);
  return m ? m[1] : '';
}

function hideHoverImage() {
  hoverImagePreview.classList.remove('visible');
}

async function updateHoverImage(event) {
  const rel = firstImagePathInText(editorLineAtPointer(event));
  if (!rel || !state.current) return hideHoverImage();
  const full = pathJoin(state.current.folder, rel);
  const image = state.current.images.find((item) => item.path === full) || { path: full, name: rel };
  hoverImagePreview.innerHTML = '';
  try {
    const img = document.createElement('img');
    img.src = await imageObjectUrl(image);
    hoverImagePreview.appendChild(img);
  } catch {
    const missing = document.createElement('div');
    missing.className = 'hover-image-missing';
    missing.textContent = '图片文件未找到';
    hoverImagePreview.appendChild(missing);
  }
  const label = document.createElement('div');
  label.className = 'hover-image-path';
  label.textContent = rel;
  hoverImagePreview.appendChild(label);
  const margin = 14;
  hoverImagePreview.style.left = `${Math.max(8, Math.min(window.innerWidth - 360, event.clientX + margin))}px`;
  hoverImagePreview.style.top = `${Math.max(8, Math.min(window.innerHeight - 300, event.clientY + margin))}px`;
  hoverImagePreview.classList.add('visible');
}

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const cfg = readSettings();
  settingsDialog.close();
  initializeFromConfig(cfg).catch((err) => setStatus(err.message, 'err'));
});
settingsBtn.addEventListener('click', () => { fillSettings(state.config || loadSavedConfig() || {}); settingsDialog.showModal(); });
cancelSettingsBtn.addEventListener('click', () => settingsDialog.close());
levelSelect.addEventListener('change', () => loadExams().catch((err) => setStatus(err.message, 'err')));
examSelect.addEventListener('change', () => loadCurrent().catch((err) => setStatus(err.message, 'err')));
pdfSelect.addEventListener('change', () => setPdf(pdfSelect.value).catch((err) => setStatus(err.message, 'err')));
$('reloadBtn').addEventListener('click', () => loadCurrent().catch((err) => setStatus(err.message, 'err')));
$('saveBtn').addEventListener('click', () => saveCurrent().catch((err) => setStatus(err.message, 'err')));
reviewBtn.addEventListener('click', () => setReviewedCurrent().catch((err) => setStatus(err.message, 'err')));
wrapToggle.addEventListener('change', applyWrapMode);
imageGrid.addEventListener('pointerdown', keepEditorFocus);
copyImagePathBtn.addEventListener('pointerdown', keepEditorFocus);
insertPictureBtn.addEventListener('pointerdown', keepEditorFocus);
uploadImageBtn.addEventListener('pointerdown', keepEditorFocus);
copyImagePathBtn.addEventListener('click', () => copySelectedImagePath().catch((err) => setStatus(err.message, 'err')));
insertPictureBtn.addEventListener('click', insertSelectedImage);
uploadImageBtn.addEventListener('click', () => uploadImageInput.click());
uploadImageInput.addEventListener('change', () => handleManualImageUpload().catch((err) => setStatus(err.message, 'err')));
pasteImageTarget.addEventListener('paste', (event) => handleImagePaste(event, true).catch((err) => setStatus(err.message, 'err')));
pasteImageTarget.addEventListener('input', () => { pasteImageTarget.textContent = ''; });
editor.addEventListener('paste', (event) => handleImagePaste(event, false).catch((err) => setStatus(err.message, 'err')));
editor.addEventListener('mousemove', (event) => updateHoverImage(event).catch(() => hideHoverImage()));
editor.addEventListener('mouseleave', hideHoverImage);
editor.addEventListener('click', rememberEditorPosition);
editor.addEventListener('keyup', rememberEditorPosition);
editor.addEventListener('select', rememberEditorPosition);
editor.addEventListener('scroll', rememberEditorPosition);
editor.addEventListener('input', () => {
  state.dirty = true;
  rememberEditorPosition();
  meta.textContent = `${editor.value.length} 字符 · 未保存`;
  setStatus('有未保存修改', 'warn');
});
window.addEventListener('beforeunload', (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveCurrent().catch((err) => setStatus(err.message, 'err'));
  }
});

restoreWrapMode();
const saved = loadSavedConfig();
if (saved?.owner && saved?.repo && saved?.token) {
  fillSettings(saved);
  initializeFromConfig(saved).catch((err) => { setStatus(err.message, 'err'); settingsDialog.showModal(); });
} else {
  fillSettings(saved || { owner: 'GuoMXi', branch: 'main', rootPath: '' });
  settingsDialog.showModal();
}



