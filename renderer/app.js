const video = document.getElementById('video');
const videoLabel = document.getElementById('videoLabel');
const previewPlaceholder = document.getElementById('previewPlaceholder');
const timeLabel = document.getElementById('timeLabel');
const visibleRange = document.getElementById('visibleRange');
const timelineWrap = document.getElementById('timelineWrap');
const timelineCanvas = document.getElementById('timelineCanvas');
const playhead = document.getElementById('playhead');
const inputStart = document.getElementById('inputStart');
const inputEnd = document.getElementById('inputEnd');
const btnAddSegment = document.getElementById('btnAddSegment');
const segmentList = document.getElementById('segmentList');
const btnProcess = document.getElementById('btnProcess');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const timelineHint = document.getElementById('timelineHint');

let currentFilePath = null;
let duration = 0;
let visibleStart = 0;
let visibleEnd = 10;
let segments = [];
let pendingRangeStart = null;
let isDraggingPlayhead = false;
let isSelecting = false;
let selectStartX = 0;
let selectStartT = 0;
let isOverTimeline = false;
const MIN_VISIBLE_SPAN = 0.5;
let timeupdateThrottle = null;
let hoverPreviewThrottle = null;

const ctx = timelineCanvas.getContext('2d');
let canvasWidth = 0;
let canvasHeight = 0;

function resizeCanvas() {
  const rect = timelineWrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvasWidth = rect.width;
  canvasHeight = rect.height;
  timelineCanvas.width = canvasWidth * dpr;
  timelineCanvas.height = canvasHeight * dpr;
  ctx.scale(dpr, dpr);
  drawTimeline();
}

function timeToX(t) {
  if (visibleEnd <= visibleStart) return 0;
  return ((t - visibleStart) / (visibleEnd - visibleStart)) * canvasWidth;
}

function xToTime(x) {
  if (canvasWidth <= 0) return visibleStart;
  const ratio = x / canvasWidth;
  return visibleStart + ratio * (visibleEnd - visibleStart);
}

function drawTimeline() {
  const w = canvasWidth;
  const h = canvasHeight;
  ctx.clearRect(0, 0, w, h);

  const span = visibleEnd - visibleStart;
  const step = span <= 2 ? 0.2 : span <= 10 ? 0.5 : span <= 60 ? 2 : 10;
  const first = Math.ceil(visibleStart / step) * step;
  ctx.fillStyle = '#333';
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  for (let t = first; t <= visibleEnd; t += step) {
    const x = timeToX(t);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.fillStyle = '#888';
    ctx.font = '10px system-ui';
    ctx.fillText(formatTime(t), x + 2, h - 4);
    ctx.fillStyle = '#333';
  }

  ctx.fillStyle = 'rgba(10, 126, 164, 0.35)';
  segments.forEach((seg) => {
    const x1 = timeToX(seg.start);
    const x2 = timeToX(seg.end);
    ctx.fillRect(x1, 0, x2 - x1, h);
  });

  if (pendingRangeStart !== null) {
    const px1 = timeToX(pendingRangeStart);
    const px2 = timeToX(video.currentTime);
    ctx.fillStyle = 'rgba(10, 126, 164, 0.2)';
    ctx.strokeStyle = '#0a7ea4';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(px1, 0, px2 - px1, h);
    ctx.fillRect(px1, 0, px2 - px1, h);
    ctx.setLineDash([]);
  }

  const headX = timeToX(video.currentTime);
  playhead.style.left = headX + 'px';
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return m + ':' + String(s).padStart(2, '0') + '.' + ms;
}

function updateTimeLabel() {
  const t = video.currentTime;
  timeLabel.textContent = formatTime(t) + ' / ' + formatTime(duration);
  visibleRange.textContent =
    '可见: ' + formatTime(visibleStart) + ' - ' + formatTime(visibleEnd);
  drawTimeline();
}

function setVideoRange() {
  visibleEnd = Math.max(MIN_VISIBLE_SPAN, duration);
  visibleStart = 0;
  updateTimeLabel();
}

video.addEventListener('loadedmetadata', () => {
  duration = video.duration;
  if (isFinite(duration)) setVideoRange();
});

video.addEventListener('timeupdate', () => {
  if (timeupdateThrottle) return;
  timeupdateThrottle = requestAnimationFrame(() => {
    timeupdateThrottle = null;
    if (!isDraggingPlayhead && !isOverTimeline) updateTimeLabel();
  });
});

video.addEventListener('durationchange', () => {
  duration = video.duration;
  if (isFinite(duration)) setVideoRange();
});

timelineWrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (duration <= 0) return;
  const span = visibleEnd - visibleStart;
  const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
  let newSpan = span * factor;
  newSpan = Math.max(MIN_VISIBLE_SPAN, Math.min(duration, newSpan));
  const center = (visibleStart + visibleEnd) / 2;
  visibleStart = Math.max(0, center - newSpan / 2);
  visibleEnd = Math.min(duration, visibleStart + newSpan);
  if (visibleEnd - visibleStart < newSpan) visibleStart = Math.max(0, visibleEnd - newSpan);
  updateTimeLabel();
}, { passive: false });

timelineWrap.addEventListener('mousedown', (e) => {
  if (duration <= 0) return;
  const rect = timelineWrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const t = xToTime(x);
  if (e.target === timelineCanvas) {
    const headX = timeToX(video.currentTime);
    if (Math.abs(x - headX) < 12) {
      isDraggingPlayhead = true;
      return;
    }
    isSelecting = true;
    selectStartX = x;
    selectStartT = t;
  }
});

function updatePreviewAtTimelineX(x) {
  if (duration <= 0) return;
  const t = Math.max(0, Math.min(duration, xToTime(x)));
  video.pause();
  video.currentTime = t;
  updateTimeLabel();
}

timelineWrap.addEventListener('mouseenter', () => {
  isOverTimeline = true;
});

timelineWrap.addEventListener('mouseleave', () => {
  isOverTimeline = false;
});

timelineWrap.addEventListener('mousemove', (e) => {
  const rect = timelineWrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  if (x < 0 || x > rect.width) return;
  if (duration <= 0) return;

  if (isDraggingPlayhead) {
    updatePreviewAtTimelineX(Math.max(0, Math.min(rect.width, x)));
    return;
  }

  if (isSelecting) return;

  if (hoverPreviewThrottle) return;
  hoverPreviewThrottle = requestAnimationFrame(() => {
    hoverPreviewThrottle = null;
    updatePreviewAtTimelineX(x);
  });
});

window.addEventListener('mousemove', (e) => {
  if (isDraggingPlayhead && duration > 0) {
    const rect = timelineWrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    updatePreviewAtTimelineX(x);
  }
});

window.addEventListener('mouseup', (e) => {
  if (isDraggingPlayhead) isDraggingPlayhead = false;
  if (isSelecting) {
    isSelecting = false;
    const rect = timelineWrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const t = xToTime(x);
    const start = Math.min(selectStartT, t);
    const end = Math.max(selectStartT, t);
    if (end - start >= 0.05) {
      addSegment(start, end);
    }
  }
});

function updateTimelineHint() {
  if (!timelineHint) return;
  if (pendingRangeStart === null) {
    timelineHint.textContent = '时间轴：悬停预览，点击设入点';
  } else {
    timelineHint.textContent = '已设入点 ' + formatTime(pendingRangeStart) + '，点击设出点';
  }
}

timelineWrap.addEventListener('click', (e) => {
  if (e.target !== timelineCanvas || isSelecting || isDraggingPlayhead) return;
  if (duration <= 0) return;
  const t = Math.max(0, Math.min(duration, video.currentTime));

  if (pendingRangeStart === null) {
    pendingRangeStart = t;
    inputStart.value = t.toFixed(2);
    inputEnd.value = t.toFixed(2);
    updateTimelineHint();
    drawTimeline();
    return;
  }

  const start = Math.min(pendingRangeStart, t);
  const end = Math.max(pendingRangeStart, t);
  if (end - start >= 0.01) {
    addSegment(start, end);
  }
  pendingRangeStart = null;
  updateTimelineHint();
  drawTimeline();
});

function addSegment(start, end) {
  const s = Math.max(0, Math.min(start, duration));
  const e = Math.max(s, Math.min(end, duration));
  if (e - s < 0.01) return;
  segments.push({ start: s, end: e });
  renderSegmentList();
  drawTimeline();
  inputStart.value = e.toFixed(2);
  inputEnd.value = Math.min(duration, e + 1).toFixed(2);
  updateTimelineHint();
}

function removeSegment(index) {
  segments.splice(index, 1);
  renderSegmentList();
  drawTimeline();
}

function renderSegmentList() {
  segmentList.innerHTML = '';
  segments.forEach((seg, i) => {
    const li = document.createElement('li');
    li.textContent = formatTime(seg.start) + ' - ' + formatTime(seg.end);
    const btn = document.createElement('button');
    btn.textContent = '删除';
    btn.addEventListener('click', () => removeSegment(i));
    li.appendChild(btn);
    segmentList.appendChild(li);
  });
  btnProcess.disabled = !currentFilePath || segments.length === 0;
}

btnAddSegment.addEventListener('click', () => {
  const start = parseFloat(inputStart.value) || 0;
  const end = parseFloat(inputEnd.value) || 1;
  addSegment(start, end);
});

btnOpen.addEventListener('click', async () => {
  const api = window.electronAPI;
  if (!api) return;
  const result = await api.openVideo();
  if (result.canceled || !result.path) return;
  currentFilePath = result.path;
  const url = await api.getVideoUrl(result.path);
  if (!url) return;
  video.classList.remove('hidden');
  previewPlaceholder.classList.add('hidden');
  video.src = url;
  video.load();
  videoLabel.textContent = result.path.split(/[/\\]/).pop();
  segments = [];
  pendingRangeStart = null;
  updateTimelineHint();
  renderSegmentList();
});

btnProcess.addEventListener('click', async () => {
  if (!currentFilePath || segments.length === 0) return;
  const ok = confirm('将对选中片段做左右镜像，并覆盖原视频文件。是否继续？');
  if (!ok) return;
  const api = window.electronAPI;
  if (!api) return;
  progressWrap.classList.remove('hidden');
  progressBar.style.setProperty('--pct', '0%');
  progressText.textContent = '0%';
  api.onProgress((pct) => {
    progressBar.style.setProperty('--pct', pct.toFixed(1) + '%');
    progressText.textContent = pct.toFixed(0) + '%';
  });
  const result = await api.mirrorSegments({
    filePath: currentFilePath,
    segments,
    duration,
  });
  progressWrap.classList.add('hidden');
  if (result.ok) {
    alert('处理完成，原视频已覆盖。');
    video.src = '';
  } else {
    alert('处理失败: ' + (result.error || '未知错误'));
  }
});

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
updateTimeLabel();
