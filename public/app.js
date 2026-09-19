let currentRepoPath = ''; // Default starts at repository root
let currentArchivePickerPath = ''; // Active path in Archive module picker
let selectedArchiveFolder = ''; // Selected folder path for archiving
let pollingInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  // Tab Navigation
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');

  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');

      navItems.forEach((n) => n.classList.remove('active'));
      tabContents.forEach((t) => t.classList.remove('active'));

      item.classList.add('active');
      document.getElementById(targetTab).classList.add('active');

      if (targetTab === 'gallery-tab') {
        loadRemoteFiles(currentRepoPath);
      } else if (targetTab === 'archive-tab') {
        loadArchivePickerFolders(currentArchivePickerPath);
      } else if (targetTab === 'tasks-tab') {
        loadTasks();
        startPolling();
      } else if (targetTab === 'logs-tab') {
        loadLogs();
        startPolling();
      } else if (targetTab === 'repos-tab') {
        loadUserRepositories();
        stopPolling();
      } else {
        stopPolling();
      }
    });
  });

  // Load configuration on startup
  loadConfig();

  // File Upload Drag and Drop setup
  setupDropzone();

  // Local directory path upload button
  document.getElementById('btn-upload-local-path').addEventListener('click', uploadLocalPath);

  // Repository management listeners
  document.getElementById('btn-refresh-user-repos')?.addEventListener('click', loadUserRepositories);
  document.getElementById('btn-toggle-create-repo-form')?.addEventListener('click', () => {
    document.getElementById('create-repo-card').classList.toggle('hidden');
  });
  document.getElementById('create-repo-form')?.addEventListener('submit', handleCreateRepository);

  // Upload results grid batch actions
  document.getElementById('btn-upload-select-all').addEventListener('click', toggleUploadResultsSelectAll);
  document.getElementById('btn-upload-copy-raw').addEventListener('click', copyUploadedRawUrls);
  document.getElementById('btn-upload-copy-md').addEventListener('click', copyUploadedMarkdownUrls);

  // Settings form submit
  document.getElementById('config-form').addEventListener('submit', saveConfigForm);

  // Repo Navigation Bar Listeners
  document.getElementById('btn-repo-back').addEventListener('click', navigateUp);
  document.getElementById('btn-repo-refresh').addEventListener('click', () => loadRemoteFiles(currentRepoPath));
  document.getElementById('btn-toggle-select-all').addEventListener('click', toggleSelectAllCards);

  // Batch action listeners
  document.getElementById('btn-batch-copy-raw').addEventListener('click', executeBatchCopyRaw);
  document.getElementById('btn-batch-copy-md').addEventListener('click', executeBatchCopyMarkdown);
  document.getElementById('btn-batch-delete').addEventListener('click', executeBatchDelete);
  document.getElementById('btn-batch-move').addEventListener('click', executeBatchMove);
  document.getElementById('btn-download-archive').addEventListener('click', downloadFolderArchive);

  // Archive module scope & picker listeners
  setupArchiveModule();

  // Task & Log listeners
  document.getElementById('btn-refresh-tasks').addEventListener('click', loadTasks);
  document.getElementById('log-level-select').addEventListener('change', loadLogs);
  document.getElementById('btn-clear-logs').addEventListener('click', clearLogs);
  document.getElementById('btn-copy-logs').addEventListener('click', copyLogs);
});

/**
 * Toast Notification System
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const iconMap = {
    success: 'fa-circle-check',
    error: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };

  toast.innerHTML = `<i class="fa-solid ${iconMap[type] || 'fa-circle-info'}"></i> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}

/* ==========================================================================
   Tailwind CSS Settings Page Handlers & Helper Functions
   ========================================================================== */

function toggleTokenVisibility(e) {
  const tokenInput = document.getElementById('gh-token');
  const btn = e ? e.currentTarget : null;
  if (tokenInput.type === 'password') {
    tokenInput.type = 'text';
    if (btn) btn.textContent = '隐藏';
  } else {
    tokenInput.type = 'password';
    if (btn) btn.textContent = '显示';
  }
}

function updateQualitySync(val) {
  let num = parseInt(val, 10);
  if (isNaN(num)) num = 80;
  if (num > 100) num = 100;
  if (num < 1) num = 1;

  document.getElementById('quality-range').value = num;
  document.getElementById('quality-num').value = num;
  const badge = document.getElementById('cfg-quality-val-badge');
  if (badge) badge.textContent = num;
  const qualityValUpload = document.getElementById('quality-val');
  if (qualityValUpload) qualityValUpload.textContent = num;
  const uploadQualitySlider = document.getElementById('upload-quality');
  if (uploadQualitySlider) uploadQualitySlider.value = num;
}

function updateConcurrencySync(val) {
  let num = parseInt(val, 10);
  if (isNaN(num)) num = 5;
  if (num > 20) num = 20;
  if (num < 1) num = 1;

  const rangeEl = document.getElementById('concurrency-range');
  const numEl = document.getElementById('concurrency-num');
  const badgeEl = document.getElementById('cfg-concurrency-val-badge');

  if (rangeEl) rangeEl.value = num;
  if (numEl) numEl.value = num;
  if (badgeEl) badgeEl.textContent = num;
}

function toggleQualityInput() {
  const isChecked = document.getElementById('webp-toggle').checked;
  const wrapper = document.getElementById('quality-wrapper');
  if (wrapper) {
    wrapper.style.opacity = isChecked ? '1' : '0.4';
    wrapper.style.pointerEvents = isChecked ? 'auto' : 'none';
  }
}

function handleArchiveModeChange() {
  const mode = document.getElementById('archive-mode').value;
  const fixedWrapper = document.getElementById('fixed-folder-wrapper');
  if (fixedWrapper) {
    fixedWrapper.style.display = (mode === '2') ? 'block' : 'none';
  }
}

/**
 * Update CDN radio card visual states (selected border, dot indicator)
 */
function updateCdnRadioCards() {
  const cards = document.querySelectorAll('.cdn-radio-card');
  const selectedVal = document.querySelector('input[name="cdnProvider"]:checked')?.value;
  const customWrapper = document.getElementById('custom-cdn-template-wrapper');
  if (customWrapper) {
    customWrapper.classList.toggle('hidden', selectedVal !== 'Custom');
  }

  cards.forEach((card) => {
    const radio = card.querySelector('.cdn-provider-radio');
    const dot = card.querySelector('.cdn-radio-dot > div');
    if (radio && radio.checked) {
      card.classList.add('border-indigo-500', 'bg-indigo-50/30');
      card.classList.remove('border-gray-200');
      if (dot) dot.classList.remove('hidden');
    } else {
      card.classList.remove('border-indigo-500', 'bg-indigo-50/30');
      card.classList.add('border-gray-200');
      if (dot) dot.classList.add('hidden');
    }
  });
}

// Setup radio card change listeners
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.cdn-provider-radio').forEach((radio) => {
    radio.addEventListener('change', updateCdnRadioCards);
  });
});

/**
 * Load System Configuration
 */
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.success && data.config) {
      const cfg = data.config;

      document.getElementById('gh-token').value = cfg.githubToken || '';
      document.getElementById('gh-owner').value = cfg.owner || '';
      document.getElementById('gh-repo').value = cfg.repo || '';
      document.getElementById('gh-branch').value = cfg.branch || 'main';
      document.getElementById('base-path').value = cfg.uploadBasePath || '';
      
      const modeStr = String(cfg.uploadMode || '1');
      document.getElementById('archive-mode').value = modeStr;
      document.getElementById('fixed-folder').value = cfg.customFolderName || 'uploads';
      document.getElementById('webp-toggle').checked = cfg.enableCompression ?? true;

      const q = cfg.imageQuality || 80;
      updateQualitySync(q);
      const c = cfg.concurrencyLimit || 5;
      updateConcurrencySync(c);

      handleArchiveModeChange();
      toggleQualityInput();

      // CDN Provider radio cards & Custom template & Supported Image Extensions
      const cdnProvider = cfg.cdnProvider || 'jsDelivr';
      const cdnRadio = document.querySelector(`input[name="cdnProvider"][value="${cdnProvider}"]`);
      if (cdnRadio) cdnRadio.checked = true;
      const customTplInput = document.getElementById('custom-cdn-template');
      if (customTplInput) customTplInput.value = cfg.customCdnTemplate || '';

      activeSupportedImageExts = cfg.supportedImageExts || 'jpg, jpeg, png, webp, gif, tiff, bmp, svg, avif, ico';
      const supportedExtsInput = document.getElementById('supported-image-exts');
      if (supportedExtsInput) supportedExtsInput.value = activeSupportedImageExts;

      updateCdnRadioCards();

      if (!cfg.githubToken || !cfg.owner || !cfg.repo) {
        showToast('请先在【系统参数设置】中填写 GitHub Token 和仓库信息', 'info');
      }
    }
  } catch (err) {
    showToast(`加载配置失败: ${err.message}`, 'error');
  }
}

/**
 * Save System Configuration Form
 */
async function saveConfigForm(e) {
  e.preventDefault();
  const newConfig = {
    githubToken: document.getElementById('gh-token').value.trim(),
    owner: document.getElementById('gh-owner').value.trim(),
    repo: document.getElementById('gh-repo').value.trim(),
    branch: document.getElementById('gh-branch').value.trim(),
    uploadBasePath: document.getElementById('base-path').value.trim(),
    uploadMode: document.getElementById('archive-mode').value,
    customFolderName: document.getElementById('fixed-folder').value.trim() || 'uploads',
    enableCompression: document.getElementById('webp-toggle').checked,
    imageQuality: parseInt(document.getElementById('quality-num').value, 10),
    concurrencyLimit: parseInt(document.getElementById('concurrency-num').value || '5', 10),
    cdnProvider: document.querySelector('input[name="cdnProvider"]:checked')?.value || 'jsDelivr',
    customCdnTemplate: document.getElementById('custom-cdn-template')?.value.trim() || '',
    supportedImageExts: document.getElementById('supported-image-exts')?.value.trim() || 'jpg, jpeg, png, webp, gif, tiff, bmp, svg, avif, ico',
  };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig)
    });
    const data = await res.json();
    if (data.success) {
      showToast('系统配置已成功保存！', 'success');
      const statusEl = document.getElementById('save-status');
      if (statusEl) {
        statusEl.classList.remove('hidden');
        setTimeout(() => statusEl.classList.add('hidden'), 3000);
      }
      loadConfig();
    } else {
      showToast(`保存失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`保存请求失败: ${err.message}`, 'error');
  }
}

/**
 * Drag and Drop & File Upload Logic
 */
function setupDropzone() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      uploadBrowserFiles(files);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      uploadBrowserFiles(fileInput.files);
    }
  });
}

/**
 * Upload Files Selected via Browser
 */
async function uploadBrowserFiles(files) {
  const formData = new FormData();
  const quality = document.getElementById('upload-quality').value;

  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }
  formData.append('quality', quality);

  showToast(`正在处理并上传 ${files.length} 个图片...`, 'info');

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      showToast(`成功上传 ${data.total} 个文件`, 'success');
      displayUploadResults(data.results);
    } else {
      showToast(`上传失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`上传出错: ${err.message}`, 'error');
  }
}

/**
 * Upload via Local Path
 */
async function uploadLocalPath() {
  const localPath = document.getElementById('local-dir-path').value.trim();
  if (!localPath) {
    showToast('请输入有效的本地目录或文件路径', 'error');
    return;
  }

  const quality = document.getElementById('upload-quality').value;

  showToast(`正在处理本地目录: ${localPath}...`, 'info');

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localPath, quality })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`处理完成！共上传 ${data.total} 个文件`, 'success');
      displayUploadResults(data.results);
    } else {
      showToast(`处理失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`请求失败: ${err.message}`, 'error');
  }
}

let activeSupportedImageExts = 'jpg, jpeg, png, webp, gif, tiff, bmp, svg, avif, ico';

function getFileExtension(filename) {
  if (!filename) return '';
  const idx = filename.lastIndexOf('.');
  return idx !== -1 ? filename.substring(idx + 1).toLowerCase() : '';
}

function isImageFileName(filename) {
  const ext = getFileExtension(filename);
  if (!ext) return false;
  const parts = activeSupportedImageExts.split(/[,|\s]+/).map(p => p.trim().toLowerCase().replace(/^\./, ''));
  return parts.includes(ext);
}

function getFileIconClass(filename) {
  const ext = getFileExtension(filename);
  if (['md', 'txt', 'doc', 'docx', 'rtf', 'log', 'csv'].includes(ext)) return 'fa-file-lines text-indigo-400';
  if (['json', 'js', 'ts', 'py', 'html', 'css', 'sh', 'yml', 'yaml', 'xml', 'c', 'cpp', 'java', 'go', 'php'].includes(ext)) return 'fa-file-code text-amber-500';
  if (['zip', 'rar', '7z', 'gz', 'tar', 'bz2', 'xz'].includes(ext)) return 'fa-file-zipper text-emerald-500';
  if (['pdf'].includes(ext)) return 'fa-file-pdf text-red-500';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) return 'fa-file-audio text-purple-400';
  if (['mp4', 'avi', 'mkv', 'mov', 'webm'].includes(ext)) return 'fa-file-video text-blue-400';
  return 'fa-file text-slate-400';
}

function renderThumbHtml(cdnUrl, filename) {
  if (isImageFileName(filename)) {
    return `<img src="${cdnUrl}" class="card-thumb" alt="${filename}" loading="lazy" decoding="async">`;
  } else {
    const ext = getFileExtension(filename) || 'FILE';
    return `
      <div class="file-thumb-placeholder">
        <i class="fa-solid ${getFileIconClass(filename)}"></i>
        <span class="file-ext-badge">${ext.toUpperCase()}</span>
      </div>
    `;
  }
}

/**
 * Display Upload Results Grid with Checkboxes (Fixes filename undefined bug)
 */
function displayUploadResults(results) {
  const card = document.getElementById('upload-results-card');
  const grid = document.getElementById('upload-results-grid');
  grid.innerHTML = '';
  card.style.display = 'block';

  const fragment = document.createDocumentFragment();

  results.forEach((item) => {
    const filename = item.filename || item.originalName || (item.repoPath ? item.repoPath.split('/').pop() : 'file.bin');
    const imgCard = document.createElement('div');
    imgCard.className = 'img-card';
    imgCard.setAttribute('data-cdn', item.cdnUrl);
    imgCard.setAttribute('data-name', filename);

    imgCard.innerHTML = `
      <div class="card-chk-wrapper">
        <input type="checkbox" class="upload-card-chk" checked>
      </div>
      <div class="card-hover-actions">
        <button class="btn-mini-icon" title="复制 Markdown" onclick="copyMarkdown('${item.cdnUrl}', '${filename}');">
          <i class="fa-solid fa-code"></i>
        </button>
      </div>
      <div class="card-thumb-wrapper">
        ${renderThumbHtml(item.cdnUrl, filename)}
      </div>
      <div class="card-body">
        <div class="card-title" title="${filename}">${filename}</div>
      </div>
      <button class="card-btn-copy" onclick="copyText('${item.cdnUrl}');">
        ${isImageFileName(filename) ? '复制图片链接' : '复制文件链接'}
      </button>
    `;

    const chk = imgCard.querySelector('.upload-card-chk');
    chk.addEventListener('change', () => {
      imgCard.classList.toggle('selected', chk.checked);
    });

    imgCard.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
        chk.checked = !chk.checked;
        imgCard.classList.toggle('selected', chk.checked);
      }
    });

    fragment.appendChild(imgCard);
  });

  grid.appendChild(fragment);
}

function toggleUploadResultsSelectAll() {
  const cards = document.querySelectorAll('#upload-results-grid .img-card');
  const allChecked = Array.from(cards).every((c) => c.querySelector('.upload-card-chk').checked);

  cards.forEach((card) => {
    const chk = card.querySelector('.upload-card-chk');
    chk.checked = !allChecked;
    card.classList.toggle('selected', !allChecked);
  });
}

function copyUploadedRawUrls() {
  const checkedCards = document.querySelectorAll('#upload-results-grid .img-card .upload-card-chk:checked');
  const urls = Array.from(checkedCards).map((chk) => {
    return chk.closest('.img-card').getAttribute('data-cdn');
  });

  if (urls.length === 0) {
    showToast('请先选择要复制的图片卡片', 'warn');
    return;
  }

  navigator.clipboard.writeText(urls.join('\n')).then(() => {
    showToast(`已批量复制 ${urls.length} 个普通 CDN 链接！`, 'success');
  });
}

function copyUploadedMarkdownUrls() {
  const checkedCards = document.querySelectorAll('#upload-results-grid .img-card .upload-card-chk:checked');
  const mdList = Array.from(checkedCards).map((chk) => {
    const card = chk.closest('.img-card');
    const cdnUrl = card.getAttribute('data-cdn');
    const name = card.getAttribute('data-name');
    return `![${name}](${cdnUrl})`;
  });

  if (mdList.length === 0) {
    showToast('请先选择要复制的图片卡片', 'warn');
    return;
  }

  navigator.clipboard.writeText(mdList.join('\n')).then(() => {
    showToast(`已批量复制 ${mdList.length} 个 Markdown 链接！`, 'success');
  });
}

/* ==========================================================================
   Hierarchical Repository Drill-Down & Card Grid Navigation Logic
   ========================================================================== */

function navigateTo(folderPath) {
  currentRepoPath = (folderPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
  loadRemoteFiles(currentRepoPath);
}

function navigateUp() {
  if (!currentRepoPath) return;
  const parts = currentRepoPath.split('/');
  parts.pop();
  navigateTo(parts.join('/'));
}

function renderBreadcrumbs(pathStr) {
  const container = document.getElementById('repo-breadcrumbs');
  const btnBack = document.getElementById('btn-repo-back');

  container.innerHTML = '';
  btnBack.disabled = !pathStr;

  const rootCrumb = document.createElement('span');
  rootCrumb.className = 'crumb-item';
  rootCrumb.innerHTML = '<i class="fa-solid fa-house"></i> 根目录';
  rootCrumb.addEventListener('click', () => navigateTo(''));
  container.appendChild(rootCrumb);

  if (!pathStr) return;

  const parts = pathStr.split('/');
  let accumulatedPath = '';

  parts.forEach((part) => {
    accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;
    const targetPath = accumulatedPath;

    const sep = document.createElement('span');
    sep.className = 'crumb-separator';
    sep.innerText = '/';
    container.appendChild(sep);

    const crumb = document.createElement('span');
    crumb.className = 'crumb-item';
    crumb.innerHTML = `<i class="fa-solid fa-folder"></i> ${part}`;
    crumb.addEventListener('click', () => navigateTo(targetPath));
    container.appendChild(crumb);
  });
}

let currentFilesList = [];
let loadedFileIndex = 0;
const GALLERY_PAGE_SIZE = 20;
let fileIntersectionObserver = null;

function renderFileChunk() {
  const grid = document.getElementById('repo-grid');
  const sentinel = document.getElementById('repo-grid-sentinel');
  if (sentinel) sentinel.remove();

  const nextChunk = currentFilesList.slice(loadedFileIndex, loadedFileIndex + GALLERY_PAGE_SIZE);
  if (nextChunk.length === 0) return;

  const fragment = document.createDocumentFragment();

  nextChunk.forEach((file) => {
    const card = document.createElement('div');
    card.className = 'img-card';
    card.setAttribute('data-path', file.path);
    card.setAttribute('data-cdn', file.cdnUrl);
    card.setAttribute('data-name', file.name);

    card.innerHTML = `
      <div class="card-chk-wrapper">
        <input type="checkbox" class="card-chk">
      </div>
      <div class="card-hover-actions">
        <button class="btn-mini-icon" title="重命名/移动" onclick="event.stopPropagation(); renameRemoteFile('${file.path}');">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn-mini-icon danger" title="删除" onclick="event.stopPropagation(); deleteRemoteFile('${file.path}');">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
      <div class="card-thumb-wrapper">
        ${renderThumbHtml(file.cdnUrl, file.name)}
      </div>
      <div class="card-body">
        <div class="card-title" title="${file.name}">${file.name}</div>
      </div>
      <button class="card-btn-copy" onclick="event.stopPropagation(); copyText('${file.cdnUrl}');">
        ${isImageFileName(file.name) ? '复制图片链接' : '复制文件链接'}
      </button>
    `;

    const chk = card.querySelector('.card-chk');
    chk.addEventListener('change', () => {
      card.classList.toggle('selected', chk.checked);
      updateBatchActionBar();
    });

    card.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
        chk.checked = !chk.checked;
        card.classList.toggle('selected', chk.checked);
        updateBatchActionBar();
      }
    });

    fragment.appendChild(card);
  });

  requestAnimationFrame(() => {
    grid.appendChild(fragment);
    loadedFileIndex += nextChunk.length;

    if (loadedFileIndex < currentFilesList.length) {
      const newSentinel = document.createElement('div');
      newSentinel.id = 'repo-grid-sentinel';
      newSentinel.style.gridColumn = '1 / -1';
      newSentinel.className = 'col-span-full py-4 text-center text-slate-400 text-sm font-medium flex items-center justify-center gap-2 cursor-pointer hover:text-indigo-500 transition-colors';
      newSentinel.innerHTML = `
        <i class="fa-solid fa-arrow-down-short-wide"></i>
        <span>已加载 ${loadedFileIndex} / ${currentFilesList.length} 项 (向下滚动自动加载...)</span>
      `;
      newSentinel.addEventListener('click', () => renderFileChunk());
      grid.appendChild(newSentinel);

      if (fileIntersectionObserver) {
        fileIntersectionObserver.disconnect();
      }
      fileIntersectionObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          renderFileChunk();
        }
      }, { rootMargin: '200px' });
      fileIntersectionObserver.observe(newSentinel);
    }
  });
}

async function loadRemoteFiles(folderPath = '') {
  renderBreadcrumbs(folderPath);
  const grid = document.getElementById('repo-grid');
  grid.innerHTML = '<div class="grid-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>正在从 GitHub 抓取数据...</p></div>';

  updateBatchActionBar();

  if (fileIntersectionObserver) {
    fileIntersectionObserver.disconnect();
    fileIntersectionObserver = null;
  }

  try {
    const res = await fetch(`/api/files?folder=${encodeURIComponent(folderPath)}`);
    const data = await res.json();

    if (!data.success) {
      grid.innerHTML = `<div class="grid-empty text-danger"><i class="fa-solid fa-circle-xmark"></i><p>加载失败: ${data.error}</p></div>`;
      showToast(`加载失败: ${data.error}`, 'error');
      return;
    }

    if (data.files.length === 0) {
      grid.innerHTML = '<div class="grid-empty"><i class="fa-solid fa-folder-open"></i><p>当前目录为空</p></div>';
      return;
    }

    grid.innerHTML = '';

    const dirs = data.files.filter((f) => f.isDir);
    const files = data.files.filter((f) => !f.isDir);

    dirs.forEach((dir) => {
      const card = document.createElement('div');
      card.className = 'folder-card';
      card.innerHTML = `
        <div class="folder-hover-actions">
          <button class="btn-mini-icon danger" title="删除文件夹及内部所有文件" onclick="event.stopPropagation(); deleteRemoteFolder('${dir.path}');">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
        <i class="fa-solid fa-folder folder-icon"></i>
        <div class="folder-name">${dir.name}</div>
      `;
      card.addEventListener('click', () => navigateTo(dir.path));
      grid.appendChild(card);
    });

    currentFilesList = files;
    loadedFileIndex = 0;
    renderFileChunk();

  } catch (err) {
    grid.innerHTML = `<div class="grid-empty text-danger"><i class="fa-solid fa-triangle-exclamation"></i><p>请求失败: ${err.message}</p></div>`;
    showToast(`请求失败: ${err.message}`, 'error');
  }
}

async function deleteRemoteFolder(folderPath) {
  if (!confirm(`⚠️ 确认删除 GitHub 仓库中的文件夹及其包含的所有文件？\n目录: '${folderPath}'`)) {
    return;
  }

  showToast(`正在从 GitHub 递归删除文件夹: ${folderPath}...`, 'info');

  try {
    const res = await fetch('/api/files/delete-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`文件夹 '${folderPath}' 及内部文件已全部成功删除！`, 'success');
      loadRemoteFiles(currentRepoPath);
    } else {
      showToast(`删除文件夹失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`请求失败: ${err.message}`, 'error');
  }
}

function toggleSelectAllCards() {
  const cards = document.querySelectorAll('.img-card');
  const allChecked = Array.from(cards).every((c) => c.querySelector('.card-chk').checked);

  cards.forEach((card) => {
    const chk = card.querySelector('.card-chk');
    chk.checked = !allChecked;
    card.classList.toggle('selected', !allChecked);
  });

  updateBatchActionBar();
}

function updateBatchActionBar() {
  const selectedCards = document.querySelectorAll('.img-card .card-chk:checked');
  const count = selectedCards.length;
  const bar = document.getElementById('batch-action-bar');
  const countSpan = document.getElementById('selected-count');

  countSpan.innerText = count;
  bar.style.display = count > 0 ? 'flex' : 'none';
}

function executeBatchCopyRaw() {
  const selectedCards = document.querySelectorAll('.img-card .card-chk:checked');
  const cdnUrls = Array.from(selectedCards).map((chk) => {
    return chk.closest('.img-card').getAttribute('data-cdn');
  });

  if (cdnUrls.length === 0) return;

  const textToCopy = cdnUrls.join('\n');
  navigator.clipboard.writeText(textToCopy).then(() => {
    showToast(`已批量复制 ${cdnUrls.length} 个普通 CDN 链接！`, 'success');
  });
}

function executeBatchCopyMarkdown() {
  const selectedCards = document.querySelectorAll('.img-card .card-chk:checked');
  const mdList = Array.from(selectedCards).map((chk) => {
    const card = chk.closest('.img-card');
    const cdnUrl = card.getAttribute('data-cdn');
    const name = card.getAttribute('data-name');
    return `![${name}](${cdnUrl})`;
  });

  if (mdList.length === 0) return;

  const textToCopy = mdList.join('\n');
  navigator.clipboard.writeText(textToCopy).then(() => {
    showToast(`已批量复制 ${mdList.length} 个 Markdown 格式链接！`, 'success');
  });
}

async function executeBatchDelete() {
  const selectedCards = document.querySelectorAll('.img-card .card-chk:checked');
  const filePaths = Array.from(selectedCards).map((chk) => chk.closest('.img-card').getAttribute('data-path'));

  if (filePaths.length === 0) return;

  if (!confirm(`⚠️ 确定要批量删除选中的 ${filePaths.length} 个文件吗？此操作无法撤销！`)) {
    return;
  }

  showToast(`正在批量删除 ${filePaths.length} 个文件...`, 'info');

  try {
    const res = await fetch('/api/files/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePaths })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`成功批量删除文件！`, 'success');
      loadRemoteFiles(currentRepoPath);
    } else {
      showToast(`批量删除失败: ${data.error}`, 'error');
      loadRemoteFiles(currentRepoPath);
    }
  } catch (err) {
    showToast(`批量删除请求失败: ${err.message}`, 'error');
  }
}

async function executeBatchMove() {
  const selectedCards = document.querySelectorAll('.img-card .card-chk:checked');
  const filePaths = Array.from(selectedCards).map((chk) => chk.closest('.img-card').getAttribute('data-path'));

  if (filePaths.length === 0) return;

  const targetFolder = prompt(`请输入目标转移子目录 (例如: "archive" 或 "2026-09-18"):`, 'archive');
  if (targetFolder === null) return;

  showToast(`正在批量移动 ${filePaths.length} 个文件至目录 '${targetFolder}'...`, 'info');

  try {
    const res = await fetch('/api/files/batch-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePaths, targetFolder })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`成功批量移动 ${data.result.movedCount} 个文件！`, 'success');
      loadRemoteFiles(currentRepoPath);
    } else {
      showToast(`批量移动失败: ${data.error}`, 'error');
      loadRemoteFiles(currentRepoPath);
    }
  } catch (err) {
    showToast(`批量移动请求失败: ${err.message}`, 'error');
  }
}

async function deleteRemoteFile(filePath) {
  if (!confirm(`确认删除 GitHub 仓库中的远程文件？\n${filePath}`)) return;

  try {
    const res = await fetch('/api/files/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath })
    });
    const data = await res.json();
    if (data.success) {
      showToast('文件已成功删除！', 'success');
      loadRemoteFiles(currentRepoPath);
    } else {
      showToast(`删除失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`删除请求失败: ${err.message}`, 'error');
  }
}

async function renameRemoteFile(oldPath) {
  const newPath = prompt('请输入新的仓库路径或文件名:', oldPath);
  if (!newPath || newPath === oldPath) return;

  try {
    const res = await fetch('/api/files/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath })
    });
    const data = await res.json();
    if (data.success) {
      showToast('文件已重命名/移动成功！', 'success');
      loadRemoteFiles(currentRepoPath);
    } else {
      showToast(`操作失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`请求失败: ${err.message}`, 'error');
  }
}

async function downloadFolderArchive() {
  const outputDir = prompt(`请输入要归档保存到的本地目录路径:`, './downloaded_archive');
  if (!outputDir) return;

  showToast(`正在下载 '${currentRepoPath || '根目录'}' 文件夹到本地 '${outputDir}'...`, 'info');

  try {
    const res = await fetch('/api/files/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: currentRepoPath, outputDir })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`归档完成！成功下载 ${data.result.totalFiles} 个文件到 ${data.result.localDirectory}`, 'success');
    } else {
      showToast(`下载归档失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`下载请求失败: ${err.message}`, 'error');
  }
}

/* ==========================================================================
   Archive Module Interactive Visual Folder Picker Logic
   ========================================================================== */

function setupArchiveModule() {
  const lblSub = document.getElementById('lbl-scope-subfolder');
  const lblFull = document.getElementById('lbl-scope-full');
  const radSub = lblSub.querySelector('input');
  const radFull = lblFull.querySelector('input');
  const boxPicker = document.getElementById('archive-folder-picker-box');

  lblSub.addEventListener('click', () => {
    lblSub.classList.add('selected');
    lblFull.classList.remove('selected');
    radSub.checked = true;
    boxPicker.style.display = 'block';
  });

  lblFull.addEventListener('click', () => {
    lblFull.classList.add('selected');
    lblSub.classList.remove('selected');
    radFull.checked = true;
    boxPicker.style.display = 'none';
  });

  document.getElementById('btn-archive-picker-back').addEventListener('click', () => {
    if (!currentArchivePickerPath) return;
    const parts = currentArchivePickerPath.split('/');
    parts.pop();
    loadArchivePickerFolders(parts.join('/'));
  });

  document.getElementById('btn-start-archive').addEventListener('click', executeArchiveTask);
}

async function loadArchivePickerFolders(folderPath = '') {
  currentArchivePickerPath = (folderPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
  const container = document.getElementById('archive-picker-breadcrumbs');
  const btnBack = document.getElementById('btn-archive-picker-back');
  const list = document.getElementById('archive-folder-picker-list');

  container.innerHTML = '';
  btnBack.disabled = !currentArchivePickerPath;

  const rootCrumb = document.createElement('span');
  rootCrumb.className = 'crumb-item';
  rootCrumb.innerHTML = '<i class="fa-solid fa-house"></i> 根目录';
  rootCrumb.addEventListener('click', () => loadArchivePickerFolders(''));
  container.appendChild(rootCrumb);

  if (currentArchivePickerPath) {
    const parts = currentArchivePickerPath.split('/');
    let acc = '';
    parts.forEach((p) => {
      acc = acc ? `${acc}/${p}` : p;
      const targetP = acc;
      const sep = document.createElement('span');
      sep.className = 'crumb-separator';
      sep.innerText = '/';
      container.appendChild(sep);

      const crumb = document.createElement('span');
      crumb.className = 'crumb-item';
      crumb.innerHTML = `<i class="fa-solid fa-folder"></i> ${p}`;
      crumb.addEventListener('click', () => loadArchivePickerFolders(targetP));
      container.appendChild(crumb);
    });
  }

  list.innerHTML = '<div style="grid-column: 1/-1; padding: 10px;" class="text-muted"><i class="fa-solid fa-spinner fa-spin"></i> 正在加载目录...</div>';

  try {
    const res = await fetch(`/api/files?folder=${encodeURIComponent(currentArchivePickerPath)}`);
    const data = await res.json();
    if (!data.success) {
      list.innerHTML = `<div class="text-danger" style="grid-column: 1/-1;">加载失败: ${data.error}</div>`;
      return;
    }

    const dirs = data.files.filter((f) => f.isDir);

    list.innerHTML = '';

    const selectSelfItem = document.createElement('div');
    const isSelectedSelf = selectedArchiveFolder === currentArchivePickerPath;
    selectSelfItem.className = `picker-folder-item ${isSelectedSelf ? 'selected' : ''}`;
    selectSelfItem.style.background = '#eef2ff';
    selectSelfItem.style.borderColor = '#818cf8';
    selectSelfItem.innerHTML = `
      <i class="fa-solid fa-folder-check text-primary"></i>
      <span>【打包含此目录】: ${currentArchivePickerPath || '根目录'}</span>
    `;
    selectSelfItem.addEventListener('click', () => {
      selectedArchiveFolder = currentArchivePickerPath;
      loadArchivePickerFolders(currentArchivePickerPath);
      showToast(`已选中打包目标目录: '${currentArchivePickerPath || '根目录'}'`, 'success');
    });
    list.appendChild(selectSelfItem);

    dirs.forEach((dir) => {
      const item = document.createElement('div');
      const isSelected = selectedArchiveFolder === dir.path;
      item.className = `picker-folder-item ${isSelected ? 'selected' : ''}`;
      item.innerHTML = `
        <i class="fa-solid fa-folder text-warning"></i>
        <span>${dir.name}</span>
      `;

      item.addEventListener('click', () => {
        loadArchivePickerFolders(dir.path);
      });

      list.appendChild(item);
    });

  } catch (err) {
    list.innerHTML = `<div class="text-danger" style="grid-column: 1/-1;">请求错误: ${err.message}</div>`;
  }
}

async function executeArchiveTask() {
  const isFull = document.querySelector('input[name="archive-scope"]:checked').value === 'full';
  const folderPath = isFull ? '' : selectedArchiveFolder;
  const outputDir = document.getElementById('archive-local-output').value.trim() || './downloaded_archive';

  showToast(`正在启动打包归档任务 (${isFull ? '全仓库' : folderPath || '根目录'})...`, 'info');

  try {
    const res = await fetch('/api/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        archiveScope: isFull ? 'full' : 'subfolder',
        folderPath,
        outputDir
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('打包归档完成！', 'success');
      displayArchiveReport(data.result);
    } else {
      showToast(`归档失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`归档请求失败: ${err.message}`, 'error');
  }
}

function displayArchiveReport(result) {
  const card = document.getElementById('archive-results-card');
  const content = document.getElementById('archive-report-content');
  card.style.display = 'block';

  content.innerHTML = `
    <div><strong><i class="fa-solid fa-folder-check"></i> 远程检索目录:</strong> <code>${result.remoteFolder || '仓库根目录 (全仓库)'}</code></div>
    <div><strong><i class="fa-solid fa-hard-drive"></i> 本地保存位置:</strong> <code>${result.localDirectory}</code></div>
    <div><strong><i class="fa-solid fa-file"></i> 导出的文件总数:</strong> <span class="badge" style="background:#10b981; color:#fff;">${result.totalFiles} 个文件</span></div>
  `;
}

/* ==========================================================================
   Task Progress & System Logs Functions
   ========================================================================== */

async function loadTasks() {
  try {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    if (!data.success) return;

    const tasks = data.tasks;
    let running = 0, completed = 0, failed = 0;

    tasks.forEach((t) => {
      if (t.status === 'running') running++;
      else if (t.status === 'completed') completed++;
      else if (t.status === 'failed') failed++;
    });

    document.getElementById('stat-running-count').innerText = running;
    document.getElementById('stat-completed-count').innerText = completed;
    document.getElementById('stat-failed-count').innerText = failed;

    const container = document.getElementById('tasks-list-container');
    if (tasks.length === 0) {
      container.innerHTML = '<div class="text-center text-muted" style="padding: 20px;">暂无历史任务记录</div>';
      return;
    }

    container.innerHTML = '';
    tasks.forEach((task) => {
      const card = document.createElement('div');
      card.className = 'task-card-item';
      card.innerHTML = `
        <div class="task-item-header">
          <div class="task-item-title">
            <i class="fa-solid fa-list-check"></i> ${task.name}
          </div>
          <span class="task-badge ${task.status}">${task.status}</span>
        </div>
        <div class="task-progress-bar-bg">
          <div class="task-progress-bar-fill ${task.status}" style="width: ${task.progress}%"></div>
        </div>
        <div class="task-meta-info">
          <span>进度: ${task.progress}% (${task.processed}/${task.total})</span>
          <span>成功: ${task.succeeded} | 失败: ${task.failedCount}</span>
          <span>开始时间: ${new Date(task.startTime).toLocaleTimeString()}</span>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load tasks:', err);
  }
}

async function loadLogs() {
  try {
    const level = document.getElementById('log-level-select').value;
    const res = await fetch(`/api/logs?level=${level}`);
    const data = await res.json();
    if (!data.success) return;

    const terminal = document.getElementById('logs-terminal');
    terminal.innerHTML = '';

    if (data.logs.length === 0) {
      terminal.innerHTML = '<div style="color: #64748b;">[System] 暂无符合条件的日志记录</div>';
      return;
    }

    data.logs.forEach((log) => {
      const line = document.createElement('div');
      line.className = 'log-line';
      line.innerHTML = `
        <span class="log-time">[${log.timeFormatted}]</span>
        <span class="log-tag ${log.level}">${log.level}</span>
        <span class="log-msg">${log.message}</span>
      `;
      terminal.appendChild(line);
    });
  } catch (err) {
    console.error('Failed to load logs:', err);
  }
}

async function clearLogs() {
  try {
    const res = await fetch('/api/logs', { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('日志已成功清空', 'success');
      loadLogs();
    }
  } catch (err) {
    showToast(`清空日志失败: ${err.message}`, 'error');
  }
}

function copyLogs() {
  const terminal = document.getElementById('logs-terminal');
  const text = terminal.innerText;
  navigator.clipboard.writeText(text).then(() => {
    showToast('所有日志已复制到剪贴板', 'success');
  });
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('已复制 jsDelivr CDN 链接到剪贴板！', 'success');
  });
}

function copyMarkdown(url, name = 'image') {
  const md = `![${name}](${url})`;
  navigator.clipboard.writeText(md).then(() => {
    showToast('已复制 Markdown 格式链接！', 'success');
  });
}

function copyAllCdnUrls() {
  const cards = document.querySelectorAll('#upload-results-grid .img-card');
  const urls = Array.from(cards).map((c) => c.getAttribute('data-cdn')).join('\n');
  if (urls) {
    navigator.clipboard.writeText(urls).then(() => {
      showToast(`已批量复制 ${cards.length} 个 CDN 链接！`, 'success');
    });
  }
}

/* ==========================================================================
   Repository Management Functions
   ========================================================================== */

async function loadUserRepositories() {
  const grid = document.getElementById('user-repos-grid');
  const activeDisplay = document.getElementById('active-repo-display');
  if (!grid) return;
  grid.innerHTML = '<div class="col-span-full text-center py-10 text-gray-400"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2"></i><p>正在获取 GitHub 账户仓库列表...</p></div>';

  try {
    const res = await fetch('/api/repos');
    const data = await res.json();
    if (!data.success) {
      grid.innerHTML = `<div class="col-span-full text-center py-10 text-red-500"><i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i><p>加载失败: ${data.error}</p></div>`;
      showToast(`加载仓库失败: ${data.error}`, 'error');
      return;
    }

    if (activeDisplay) {
      activeDisplay.innerText = `${data.activeOwner}/${data.activeRepo} (默认分支: ${data.activeBranch})`;
    }

    renderUserRepositories(data.repos, data.activeOwner, data.activeRepo, data.activeBranch);
  } catch (err) {
    grid.innerHTML = `<div class="col-span-full text-center py-10 text-red-500"><i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i><p>请求错误: ${err.message}</p></div>`;
    showToast(`请求失败: ${err.message}`, 'error');
  }
}

function renderUserRepositories(repos, activeOwner, activeRepo, activeBranch) {
  const grid = document.getElementById('user-repos-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (repos.length === 0) {
    grid.innerHTML = '<div class="col-span-full text-center py-10 text-gray-400"><i class="fa-solid fa-folder-open text-2xl mb-2"></i><p>未找到 GitHub 账户仓库</p></div>';
    return;
  }

  repos.forEach((repo) => {
    const isActive = (repo.owner.toLowerCase() === activeOwner.toLowerCase() && repo.name.toLowerCase() === activeRepo.toLowerCase());
    const card = document.createElement('div');
    card.className = `bg-white rounded-2xl border ${isActive ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200'} p-5 flex flex-col justify-between shadow-xs hover:shadow-md transition-all-custom`;

    const updateDate = new Date(repo.updatedAt).toLocaleDateString();

    card.innerHTML = `
      <div>
        <div class="flex items-start justify-between mb-3">
          <div class="flex items-center space-x-2">
            <i class="fa-solid fa-book-bookmark ${isActive ? 'text-indigo-600' : 'text-gray-400'} text-lg"></i>
            <a href="${repo.htmlUrl}" target="_blank" class="font-bold text-gray-900 hover:text-indigo-600 truncate max-w-[180px]" title="${repo.fullName}">${repo.name}</a>
          </div>
          <span class="text-xs px-2.5 py-0.5 rounded-full font-medium ${repo.isPrivate ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}">
            ${repo.isPrivate ? '私有' : '公开'}
          </span>
        </div>

        <p class="text-xs text-gray-500 mb-4 line-clamp-2 h-8">${repo.description || '无描述'}</p>

        <div class="flex items-center space-x-4 text-xs text-gray-400 mb-4">
          <span><i class="fa-solid fa-code-branch mr-1"></i>${repo.defaultBranch}</span>
          <span><i class="fa-solid fa-star mr-1"></i>${repo.stars}</span>
          <span><i class="fa-solid fa-clock mr-1"></i>${updateDate}</span>
        </div>
      </div>

      <div class="pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
        ${isActive 
          ? '<span class="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-100"><i class="fa-solid fa-check mr-1"></i>当前图床</span>'
          : `<button class="btn btn-sm btn-outline text-xs" onclick="handleSelectActiveRepo('${repo.owner}', '${repo.name}', '${repo.defaultBranch}')"><i class="fa-solid fa-bolt mr-1"></i>设为图床</button>`
        }

        <div class="flex items-center space-x-1">
          <button class="btn-mini-icon" title="切换公开/私有属性" onclick="handleToggleRepoVisibility('${repo.owner}', '${repo.name}', '${repo.visibility}')">
            <i class="fa-solid fa-shield-halved"></i>
          </button>
          <button class="btn-mini-icon danger" title="删除仓库" onclick="handleDeleteRepository('${repo.owner}', '${repo.name}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}

async function handleCreateRepository(e) {
  e.preventDefault();
  const name = document.getElementById('new-repo-name').value.trim();
  const description = document.getElementById('new-repo-desc').value.trim();
  const isPrivate = document.querySelector('input[name="newRepoVisibility"]:checked').value === 'private';

  if (!name) {
    showToast('请输入仓库名称', 'error');
    return;
  }

  showToast(`正在创建 GitHub 仓库 '${name}'...`, 'info');

  try {
    const res = await fetch('/api/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, isPrivate })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`仓库 '${name}' 创建成功！`, 'success');
      document.getElementById('create-repo-form').reset();
      document.getElementById('create-repo-card').classList.add('hidden');
      loadUserRepositories();
    } else {
      showToast(`创建仓库失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`请求失败: ${err.message}`, 'error');
  }
}

async function handleToggleRepoVisibility(owner, repo, currentVisibility) {
  const newVisibility = currentVisibility === 'public' ? 'private' : 'public';
  const isPrivate = newVisibility === 'private';

  let confirmMsg = `确定将仓库 '${owner}/${repo}' 的属性修改为【${newVisibility === 'public' ? '公开' : '私有'}】？`;
  if (isPrivate) {
    confirmMsg += '\n⚠️ 警告: 切换为私有仓库后，jsDelivr / Statically 等 CDN 外链将无法访问！';
  }

  if (!confirm(confirmMsg)) return;

  showToast(`正在修改仓库 '${owner}/${repo}' 属性...`, 'info');

  try {
    const res = await fetch(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: newVisibility, private: isPrivate })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`仓库属性已成功更新为: ${newVisibility}`, 'success');
      loadUserRepositories();
    } else {
      showToast(`更新属性失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`请求失败: ${err.message}`, 'error');
  }
}

async function handleDeleteRepository(owner, repo) {
  const inputName = prompt(`⚠️ 危险操作: 删除仓库将清除该仓库内所有图片与提交历史！\n请输入仓库名称以确认删除 (${repo}):`);
  if (!inputName || inputName.trim() !== repo) {
    if (inputName !== null) showToast('输入的仓库名称不匹配，操作已取消', 'warn');
    return;
  }

  showToast(`正在从 GitHub 删除仓库 '${owner}/${repo}'...`, 'info');

  try {
    const res = await fetch(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      showToast(`仓库 '${owner}/${repo}' 已成功删除！`, 'success');
      loadUserRepositories();
    } else {
      showToast(`删除仓库失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`请求失败: ${err.message}`, 'error');
  }
}

async function handleSelectActiveRepo(owner, repo, defaultBranch = 'main') {
  if (!confirm(`确认将当前图床工作仓库切换为 '${owner}/${repo}' (默认分支: ${defaultBranch})？`)) return;

  showToast(`正在切换工作仓库至 '${owner}/${repo}'...`, 'info');

  try {
    const res = await fetch('/api/repos/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner, repo, branch: defaultBranch })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`图床工作仓库已切换为 '${owner}/${repo}'！`, 'success');
      loadUserRepositories();
      loadConfig();
    } else {
      showToast(`切换工作仓库失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`请求失败: ${err.message}`, 'error');
  }
}
