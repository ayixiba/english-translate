const STORAGE_KEY = "english-study-lite-v1";

const readerEl = document.getElementById("reader");
const sourceInputEl = document.getElementById("source-input");
const fileInputEl = document.getElementById("file-input");
const renderBtnEl = document.getElementById("render-btn");
const annotationListEl = document.getElementById("annotation-list");
const toggleEl = document.getElementById("toggle-annotations");
const clearBtnEl = document.getElementById("clear-btn");
const itemTemplate = document.getElementById("annotation-item-template");
const statusTextEl = document.getElementById("status-text");
const editorPanelEl = document.getElementById("editor-panel");
const editorTitleEl = document.getElementById("editor-title");
const editorWordEl = document.getElementById("editor-word");
const editorMeaningEl = document.getElementById("editor-meaning");
const editorPhrasesEl = document.getElementById("editor-phrases");
const editorSaveBtnEl = document.getElementById("editor-save-btn");
const editorCancelBtnEl = document.getElementById("editor-cancel-btn");

let state = {
  text: "",
  annotationsVisible: true,
  annotations: [],
  translationCache: {}
};
let isAnnotating = false;
let editorDraft = null;

const dictionary = {
  president: {
    meaning: "总统",
    phrases: ["vice president: 副总统", "president-elect: 当选总统"]
  },
  announce: {
    meaning: "宣布",
    phrases: ["announce a plan: 宣布计划", "announce results: 公布结果"]
  },
  concern: {
    meaning: "担忧；关心",
    phrases: ["be concerned about: 对...担忧", "a matter of concern: 令人关注的事"]
  },
  impact: {
    meaning: "影响",
    phrases: ["long-term impact: 长期影响", "have an impact on: 对...有影响"]
  }
};

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.text === "string") state.text = parsed.text;
    if (typeof parsed.annotationsVisible === "boolean") {
      state.annotationsVisible = parsed.annotationsVisible;
    }
    if (Array.isArray(parsed.annotations)) state.annotations = parsed.annotations;
    if (parsed.translationCache && typeof parsed.translationCache === "object") {
      state.translationCache = parsed.translationCache;
    }
  } catch (_err) {
    console.warn("无法读取本地缓存");
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(text) {
  if (statusTextEl) statusTextEl.textContent = `状态：${text}`;
}

async function lookup(text) {
  const norm = text.toLowerCase().trim();
  if (!norm) return null;
  if (dictionary[norm]) return { ...dictionary[norm], source: "内置词典" };
  if (state.translationCache[norm]) return state.translationCache[norm];

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const translated = data?.responseData?.translatedText?.trim();
    if (!translated || translated.toLowerCase() === norm) return null;
    const result = { meaning: translated, phrases: [], source: "在线翻译" };
    state.translationCache[norm] = result;
    saveState();
    return result;
  } catch (_err) {
    return null;
  }
}

function renderReader() {
  const text = state.text || "";
  if (!text) {
    readerEl.innerHTML = "<p>请先在左侧粘贴文本并点击“渲染到阅读区”。</p>";
    return;
  }

  const sorted = [...state.annotations].sort((a, b) => a.start - b.start);
  let cursor = 0;
  let html = "";

  for (const ann of sorted) {
    const safeStart = Math.max(0, Math.min(ann.start, text.length));
    const safeEnd = Math.max(0, Math.min(ann.end, text.length));
    if (safeStart < cursor || safeStart >= safeEnd) continue;

    html += escapeHtml(text.slice(cursor, safeStart));

    const original = text.slice(safeStart, safeEnd);
    html += `<span class="ann" data-id="${ann.id}" data-meaning="${escapeHtml(ann.meaning)}">${escapeHtml(
      original
    )}</span>`;
    cursor = safeEnd;
  }

  html += escapeHtml(text.slice(cursor));
  readerEl.innerHTML = html;

  document.body.classList.toggle("annotations-hidden", !state.annotationsVisible);
}

function renderList() {
  annotationListEl.innerHTML = "";

  if (state.annotations.length === 0) {
    annotationListEl.innerHTML = "<li class=\"annotation-item\">暂无记录</li>";
    return;
  }

  const sorted = [...state.annotations].sort((a, b) => b.createdAt - a.createdAt);
  for (const ann of sorted) {
    const node = itemTemplate.content.cloneNode(true);
    node.querySelector(".word").textContent = ann.text;
    node.querySelector(".meaning").textContent = ann.meaning;
    node.querySelector(".phrases").textContent = ann.phrases.join(" | ");
    const editBtn = node.querySelector(".edit-btn");
    editBtn.dataset.id = ann.id;
    annotationListEl.appendChild(node);
  }
}

function openEditor(draft) {
  editorDraft = draft;
  editorPanelEl.classList.remove("is-hidden");
  editorTitleEl.textContent = draft.mode === "edit" ? "编辑释义" : "新建释义";
  editorWordEl.textContent = draft.text;
  editorMeaningEl.value = draft.meaning || "";
  editorPhrasesEl.value = draft.phrases?.join("; ") || "";
  setStatus(draft.mode === "edit" ? `正在编辑：${draft.text}` : `请补充释义：${draft.text}`);
  editorMeaningEl.focus();
}

function closeEditor(statusText = "等待选中内容") {
  editorDraft = null;
  editorPanelEl.classList.add("is-hidden");
  editorTitleEl.textContent = "新建释义";
  editorWordEl.textContent = "";
  editorMeaningEl.value = "";
  editorPhrasesEl.value = "";
  setStatus(statusText);
}

function saveEditorDraft() {
  if (!editorDraft) return;
  const meaning = editorMeaningEl.value.trim();
  if (!meaning) {
    setStatus("请先填写中文释义");
    editorMeaningEl.focus();
    return;
  }
  const phrases = editorPhrasesEl.value
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  if (editorDraft.mode === "create") {
    state.annotations.push({
      id: crypto.randomUUID(),
      text: editorDraft.text,
      start: editorDraft.start,
      end: editorDraft.end,
      meaning,
      phrases,
      source: "手动填写",
      createdAt: Date.now()
    });
    saveState();
    renderReader();
    renderList();
    closeEditor(`已添加：${editorDraft.text}（手动填写）`);
    return;
  }

  if (editorDraft.mode === "edit") {
    const idx = state.annotations.findIndex((a) => a.id === editorDraft.id);
    if (idx < 0) {
      closeEditor("记录不存在，已取消");
      return;
    }
    state.annotations[idx].meaning = meaning;
    state.annotations[idx].phrases = phrases;
    state.annotations[idx].source = "手动编辑";
    saveState();
    renderReader();
    renderList();
    closeEditor(`已更新：${state.annotations[idx].text}`);
  }
}

function isSelectionInsideReader(range) {
  const common = range.commonAncestorContainer;
  return readerEl.contains(common.nodeType === Node.TEXT_NODE ? common.parentNode : common);
}

function getOffsetWithinReader(container, offset) {
  const range = document.createRange();
  range.selectNodeContents(readerEl);
  range.setEnd(container, offset);
  return range.toString().length;
}

async function addUnderlineFromSelection() {
  if (editorDraft) return;
  if (isAnnotating) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  if (!isSelectionInsideReader(range)) {
    alert("请选择阅读区里的英文内容。");
    return;
  }

  const selected = selection.toString().trim();
  if (!selected) {
    return;
  }

  const start = getOffsetWithinReader(range.startContainer, range.startOffset);
  const end = start + selected.length;
  if (start < 0 || end > state.text.length) {
    setStatus("选区定位失败，请重试");
    return;
  }

  const exists = state.annotations.some((a) => a.start === start && a.end === end);
  if (exists) {
    selection.removeAllRanges();
    setStatus("该内容已存在划线记录");
    return;
  }

  isAnnotating = true;
  try {
    setStatus(`正在翻译：${selected}`);
    const result = await lookup(selected);
    let meaning = result?.meaning || "";
    let phrases = result?.phrases || [];
    let source = result?.source || "手动输入";
    if (!meaning) {
      openEditor({
        mode: "create",
        text: selected,
        start,
        end,
        meaning: "",
        phrases: []
      });
      selection.removeAllRanges();
      return;
    }

    state.annotations.push({
      id: crypto.randomUUID(),
      text: selected,
      start,
      end,
      meaning,
      phrases,
      source,
      createdAt: Date.now()
    });

    saveState();
    renderReader();
    renderList();
    setStatus(`已添加：${selected}（${source}）`);
    selection.removeAllRanges();
  } finally {
    isAnnotating = false;
  }
}

function renderFromInput() {
  const text = sourceInputEl.value.trim();
  state.text = text;
  state.annotations = [];
  saveState();
  renderReader();
  renderList();
  closeEditor("文本已渲染，等待选中内容");
}

function handleFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const content = typeof reader.result === "string" ? reader.result : "";
    sourceInputEl.value = content;
    state.text = content.trim();
    state.annotations = [];
    saveState();
    renderReader();
    renderList();
    closeEditor(`已载入文件：${file.name}`);
  };
  reader.readAsText(file, "utf-8");
}

function editAnnotationMeaning(id) {
  const idx = state.annotations.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const ann = state.annotations[idx];
  openEditor({
    mode: "edit",
    id: ann.id,
    text: ann.text,
    meaning: ann.meaning,
    phrases: ann.phrases
  });
}

function init() {
  loadState();
  sourceInputEl.value = state.text || sourceInputEl.value;
  toggleEl.checked = state.annotationsVisible;

  if (!state.text) {
    state.text = sourceInputEl.value.trim();
    saveState();
  }

  renderReader();
  renderList();
  setStatus("等待选中内容");

  renderBtnEl.addEventListener("click", renderFromInput);
  fileInputEl.addEventListener("change", handleFileUpload);
  readerEl.addEventListener("mouseup", () => {
    addUnderlineFromSelection();
  });
  readerEl.addEventListener("touchend", () => {
    addUnderlineFromSelection();
  });

  toggleEl.addEventListener("change", (event) => {
    state.annotationsVisible = event.target.checked;
    saveState();
    renderReader();
  });

  clearBtnEl.addEventListener("click", () => {
    if (!window.confirm("确认清空当前文档的所有划线记录？")) return;
    state.annotations = [];
    saveState();
    renderReader();
    renderList();
    closeEditor("已清空记录");
  });
  editorSaveBtnEl.addEventListener("click", saveEditorDraft);
  editorCancelBtnEl.addEventListener("click", () => {
    closeEditor("已取消编辑");
  });

  annotationListEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (!target.classList.contains("edit-btn")) return;
    const id = target.dataset.id;
    if (!id) return;
    editAnnotationMeaning(id);
  });
}

init();
