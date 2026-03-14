const video = document.getElementById('video');
const previewPlaceholder = document.getElementById('previewPlaceholder');
const fileInput = document.getElementById('fileInput');
const timeLabel = document.getElementById('timeLabel');
const visibleRange = document.getElementById('visibleRange');
const timelineAnchorWrap = document.getElementById('timelineAnchorWrap');
const timelineRuler = document.getElementById('timelineRuler');
const timelineWrap = document.getElementById('timelineWrap');
const timelineCanvas = document.getElementById('timelineCanvas');
const timelineScaleCanvas = document.getElementById('timelineScaleCanvas');
const playhead = document.getElementById('playhead');
const inputStart = document.getElementById('inputStart');
const inputEnd = document.getElementById('inputEnd');
const btnAddSegment = document.getElementById('btnAddSegment');
const segmentList = document.getElementById('segmentList');
const btnProcess = document.getElementById('btnProcess');
const progressWrap = document.getElementById('progressWrap');
const progressText = document.getElementById('progressText');
const timelineHint = document.getElementById('timelineHint');
const btnMute = document.getElementById('btnMute');
const volumeIcon = document.getElementById('volumeIcon');
const videoDropZone = document.getElementById('videoDropZone');
const personDropZone = document.getElementById('personDropZone');
const personPlaceholder = document.getElementById('personPlaceholder');
const tabVideo = document.getElementById('tabVideo');
const tabPerson = document.getElementById('tabPerson');
const tabSettings = document.getElementById('tabSettings');
const panelVideo = document.getElementById('panelVideo');
const panelPerson = document.getElementById('panelPerson');
const panelSettings = document.getElementById('panelSettings');
const filePerson = document.getElementById('filePerson');
const personImage = document.getElementById('personImage');
const inputAppkey = document.getElementById('inputAppkey');
const btnSaveAppkey = document.getElementById('btnSaveAppkey');
const btnZoomOut = document.getElementById('btnZoomOut');
const btnZoomIn = document.getElementById('btnZoomIn');
const zoomSlider = document.getElementById('zoomSlider');
const currentPosDisplay = document.getElementById('currentPosDisplay');
const inputGoTo = document.getElementById('inputGoTo');
const btnGoTo = document.getElementById('btnGoTo');
const zoomFill = document.getElementById('zoomFill');
const zoomKnob = document.getElementById('zoomKnob');

const STORAGE_APPKEY = 'bailian_appkey';
const THUMB_COUNT = 24;
const THUMB_PX_WIDTH = 48;
const TIMELINE_FPS = 24;

let currentFile = null;
let currentPersonFile = null;
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
let timelineThumbnails = [];

const ctx = timelineCanvas.getContext('2d');
let scaleCtx = timelineScaleCanvas ? timelineScaleCanvas.getContext('2d') : null;
let canvasWidth = 0;
let canvasHeight = 0;
let scaleCanvasWidth = 0;
let thumbVideo = null;

function resizeCanvas() {
  const rect = timelineWrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvasWidth = rect.width;
  canvasHeight = rect.height;
  timelineCanvas.width = canvasWidth * dpr;
  timelineCanvas.height = canvasHeight * dpr;
  ctx.scale(dpr, dpr);
  if (timelineScaleCanvas && scaleCtx) {
    scaleCanvasWidth = canvasWidth;
    timelineScaleCanvas.width = canvasWidth * dpr;
    timelineScaleCanvas.height = 20 * dpr;
    timelineScaleCanvas.style.width = canvasWidth + 'px';
    timelineScaleCanvas.style.height = '20px';
    scaleCtx.setTransform(1, 0, 0, 1, 0, 0);
    scaleCtx.scale(dpr, dpr);
  }
  drawTimeline();
  updateZoomSlider();
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

  if (timelineThumbnails.length > 0 && duration > 0) {
    const span = visibleEnd - visibleStart;
    const numSlots = Math.max(1, Math.floor(w / THUMB_PX_WIDTH));
    for (let i = 0; i < numSlots; i++) {
      const t = visibleStart + (i + 0.5) * span / numSlots;
      const thumbIndex = Math.min(THUMB_COUNT - 1, Math.max(0, Math.round((t / duration) * (THUMB_COUNT - 1))));
      const thumb = timelineThumbnails[thumbIndex];
      if (thumb && thumb.width) {
        const x0 = i * THUMB_PX_WIDTH;
        ctx.drawImage(thumb, x0, 0, THUMB_PX_WIDTH, h);
      }
    }
  }

  const span = visibleEnd - visibleStart;
  const step = span <= 2 ? 0.2 : span <= 10 ? 0.5 : span <= 60 ? 2 : 10;
  const first = Math.ceil(visibleStart / step) * step;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  for (let t = first; t <= visibleEnd; t += step) {
    const x = timeToX(t);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  if (scaleCtx && scaleCanvasWidth > 0) {
    const sh = 20;
    scaleCtx.clearRect(0, 0, scaleCanvasWidth, sh);
    scaleCtx.fillStyle = 'rgba(255,255,255,0.85)';
    scaleCtx.font = '11px system-ui';
    scaleCtx.textBaseline = 'middle';
    for (let t = first; t <= visibleEnd; t += step) {
      const x = timeToX(t);
      scaleCtx.fillText(formatTime(t), x + 2, sh / 2);
    }
  }

  ctx.fillStyle = 'rgba(22, 119, 255, 0.35)';
  segments.forEach((seg) => {
    const x1 = timeToX(seg.start);
    const x2 = timeToX(seg.end);
    ctx.fillRect(x1, 0, x2 - x1, h);
  });

  if (pendingRangeStart !== null) {
    const px1 = timeToX(pendingRangeStart);
    const px2 = timeToX(video.currentTime);
    ctx.fillStyle = 'rgba(22, 119, 255, 0.2)';
    ctx.strokeStyle = '#1677ff';
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

function timeToFrame(sec) {
  return Math.round(sec * TIMELINE_FPS);
}

function formatFrame(sec) {
  return timeToFrame(sec) + 'f';
}

function updateTimeLabel() {
  const t = video.currentTime;
  if (timeLabel) timeLabel.textContent = formatTime(t) + ' / ' + formatTime(duration);
  if (visibleRange) visibleRange.textContent =
    '可见: ' + formatTime(visibleStart) + ' - ' + formatTime(visibleEnd);
  if (currentPosDisplay) currentPosDisplay.textContent = formatTime(t) + ' (' + formatFrame(t) + ')';
  drawTimeline();
}

function centerVisibleOnPlayhead() {
  if (duration <= 0) return;
  const anchor = video.currentTime;
  const span = visibleEnd - visibleStart;
  visibleStart = Math.max(0, anchor - span / 2);
  visibleEnd = Math.min(duration, anchor + span / 2);
  if (visibleEnd - visibleStart < span) {
    if (anchor < duration / 2) visibleEnd = Math.min(duration, visibleStart + span);
    else visibleStart = Math.max(0, visibleEnd - span);
  }
  updateZoomSlider();
}

function updatePlayIcon() {}

function setVideoRange() {
  visibleEnd = Math.max(MIN_VISIBLE_SPAN, duration);
  visibleStart = 0;
  updateTimeLabel();
  updateZoomSlider();
}

function generateTimelineThumbnails() {
  timelineThumbnails = [];
  if (!video.src || duration <= 0) return;
  if (!thumbVideo) {
    thumbVideo = document.createElement('video');
    thumbVideo.preload = 'auto';
    thumbVideo.muted = true;
    thumbVideo.playsInline = true;
    thumbVideo.setAttribute('style', 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;');
    document.body.appendChild(thumbVideo);
  }
  thumbVideo.src = video.src;
  thumbVideo.currentTime = 0;
  const thumbW = 160;
  const thumbH = 90;
  const offCanvas = document.createElement('canvas');
  offCanvas.width = thumbW;
  offCanvas.height = thumbH;
  const offCtx = offCanvas.getContext('2d');
  let index = 0;

  function captureNext() {
    if (index >= THUMB_COUNT) {
      drawTimeline();
      return;
    }
    const t = (index * duration) / THUMB_COUNT;
    thumbVideo.currentTime = t;
    const onSeeked = () => {
      thumbVideo.removeEventListener('seeked', onSeeked);
      try {
        offCtx.drawImage(thumbVideo, 0, 0, thumbW, thumbH);
        const img = document.createElement('canvas');
        img.width = thumbW;
        img.height = thumbH;
        img.getContext('2d').drawImage(offCanvas, 0, 0);
        timelineThumbnails[index] = img;
      } catch (e) {}
      index++;
      captureNext();
    };
    thumbVideo.addEventListener('seeked', onSeeked);
    thumbVideo.addEventListener('error', () => { index++; captureNext(); });
  }

  thumbVideo.addEventListener('loadeddata', () => {
    captureNext();
  }, { once: true });
}

video.addEventListener('loadedmetadata', () => {
  duration = video.duration;
  if (isFinite(duration)) setVideoRange();
  generateTimelineThumbnails();
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

function zoomSpanToValue(span) {
  if (duration <= MIN_VISIBLE_SPAN) return 100;
  const r = (span - MIN_VISIBLE_SPAN) / (duration - MIN_VISIBLE_SPAN);
  return Math.max(0, Math.min(100, 100 - r * 100));
}

function zoomValueToSpan(value) {
  if (duration <= MIN_VISIBLE_SPAN) return MIN_VISIBLE_SPAN;
  const r = (100 - Math.max(0, Math.min(100, value))) / 100;
  return MIN_VISIBLE_SPAN + r * (duration - MIN_VISIBLE_SPAN);
}

function updateZoomSlider() {
  if (!zoomFill || !zoomKnob || !zoomSlider) return;
  const track = zoomSlider.querySelector('.timeline-zoom-track');
  if (!track || duration <= 0) return;
  const span = visibleEnd - visibleStart;
  const value = zoomSpanToValue(span);
  const trackW = track.getBoundingClientRect().width;
  const pct = value / 100;
  zoomFill.style.width = pct * trackW + 'px';
  zoomKnob.style.left = pct * trackW + 'px';
}

function doZoom(factor) {
  if (duration <= 0) return;
  const span = visibleEnd - visibleStart;
  let newSpan = span * factor;
  newSpan = Math.max(MIN_VISIBLE_SPAN, Math.min(duration, newSpan));
  const anchor = video.currentTime;
  visibleStart = Math.max(0, anchor - newSpan / 2);
  visibleEnd = Math.min(duration, anchor + newSpan / 2);
  if (visibleEnd - visibleStart < newSpan) {
    if (anchor < duration / 2) visibleEnd = Math.min(duration, visibleStart + newSpan);
    else visibleStart = Math.max(0, visibleEnd - newSpan);
  }
  updateTimeLabel();
  updateZoomSlider();
}

function doZoomByValue(value) {
  if (duration <= 0) return;
  const newSpan = zoomValueToSpan(value);
  const anchor = video.currentTime;
  visibleStart = Math.max(0, anchor - newSpan / 2);
  visibleEnd = Math.min(duration, anchor + newSpan / 2);
  if (visibleEnd - visibleStart < newSpan) {
    if (anchor < duration / 2) visibleEnd = Math.min(duration, visibleStart + newSpan);
    else visibleStart = Math.max(0, visibleEnd - newSpan);
  }
  updateTimeLabel();
  updateZoomSlider();
}

if (btnZoomOut) btnZoomOut.addEventListener('click', () => doZoom(1.2));
if (btnZoomIn) btnZoomIn.addEventListener('click', () => doZoom(1 / 1.2));

if (zoomSlider && zoomKnob) {
  const track = zoomSlider.querySelector('.timeline-zoom-track');
  if (track) {
    function valueFromEvent(e) {
      const rect = track.getBoundingClientRect();
      const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      return pct * 100;
    }
    function onPointerDown(e) {
      e.preventDefault();
      zoomSlider.classList.add('dragging');
      doZoomByValue(valueFromEvent(e));
      function onPointerMove(ev) {
        doZoomByValue(valueFromEvent(ev));
      }
      function onPointerUp() {
        zoomSlider.classList.remove('dragging');
        document.removeEventListener('mousemove', onPointerMove);
        document.removeEventListener('mouseup', onPointerUp);
        document.removeEventListener('touchmove', onPointerMove);
        document.removeEventListener('touchend', onPointerUp);
      }
      document.addEventListener('mousemove', onPointerMove);
      document.addEventListener('mouseup', onPointerUp);
      document.addEventListener('touchmove', onPointerMove, { passive: false });
      document.addEventListener('touchend', onPointerUp);
    }
    track.addEventListener('mousedown', onPointerDown);
    track.addEventListener('touchstart', onPointerDown, { passive: false });
  }
}

function goToInputPosition() {
  if (duration <= 0 || !inputGoTo) return;
  const raw = (inputGoTo.value || '').trim();
  if (!raw) return;
  let t;
  if (raw.toLowerCase().endsWith('f')) {
    const frame = parseInt(raw.slice(0, -1), 10);
    if (!Number.isFinite(frame) || frame < 0) return;
    t = frame / TIMELINE_FPS;
  } else {
    t = parseFloat(raw);
    if (!Number.isFinite(t) || t < 0) return;
  }
  t = Math.max(0, Math.min(duration, t));
  video.currentTime = t;
  centerVisibleOnPlayhead();
  updateTimeLabel();
}

if (btnGoTo) btnGoTo.addEventListener('click', goToInputPosition);
if (inputGoTo) {
  inputGoTo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') goToInputPosition();
  });
}

if (timelineRuler) {
  timelineRuler.addEventListener('click', (e) => {
    if (duration <= 0) return;
    const rect = timelineWrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(canvasWidth, e.clientX - rect.left));
    const t = xToTime(x);
    video.currentTime = t;
    centerVisibleOnPlayhead();
    updateTimeLabel();
  });
  timelineRuler.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (duration <= 0) return;
    const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    doZoom(factor);
  }, { passive: false });
}

timelineWrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (duration <= 0) return;
  const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
  doZoom(factor);
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
});

window.addEventListener('mousemove', (e) => {
  if (isDraggingPlayhead && duration > 0) {
    const rect = timelineWrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    updatePreviewAtTimelineX(x);
  }
});

window.addEventListener('mouseup', (e) => {
  if (isDraggingPlayhead) {
    isDraggingPlayhead = false;
    if (duration > 0) {
      centerVisibleOnPlayhead();
      updateTimeLabel();
    }
  }
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
    timelineHint.textContent = '时间轴：点击选中当前位置(白线)，点击设入点';
  } else {
    timelineHint.textContent = '已设入点 ' + formatTime(pendingRangeStart) + '，点击设出点';
  }
}

timelineWrap.addEventListener('click', (e) => {
  if (e.target !== timelineCanvas || isSelecting || isDraggingPlayhead) return;
  if (duration <= 0) return;
  const rect = timelineWrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const t = Math.max(0, Math.min(duration, xToTime(x)));
  video.currentTime = t;

  if (pendingRangeStart === null) {
    if (isTimeInSegment(t)) return;
    pendingRangeStart = t;
    if (inputStart) inputStart.value = t.toFixed(2);
    if (inputEnd) inputEnd.value = t.toFixed(2);
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

function isTimeInSegment(t) {
  return segments.some((seg) => t >= seg.start && t <= seg.end);
}

function rangeOverlapsSegment(start, end) {
  return segments.some((seg) => !(end <= seg.start || start >= seg.end));
}

function addSegment(start, end) {
  const s = Math.max(0, Math.min(start, duration));
  const e = Math.max(s, Math.min(end, duration));
  if (e - s < 0.01) return;
  if (rangeOverlapsSegment(s, e)) return;
  segments.push({ start: s, end: e });
  renderSegmentList();
  drawTimeline();
  if (inputStart) inputStart.value = e.toFixed(2);
  if (inputEnd) inputEnd.value = Math.min(duration, e + 1).toFixed(2);
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
  btnProcess.disabled = !currentFile || segments.length === 0;
}

if (btnAddSegment && inputStart && inputEnd) {
  btnAddSegment.addEventListener('click', () => {
    const start = parseFloat(inputStart.value) || 0;
    const end = parseFloat(inputEnd.value) || 1;
    addSegment(start, end);
  });
}

if (videoDropZone) {
  videoDropZone.addEventListener('click', () => {
    if (!previewPlaceholder.classList.contains('hidden')) fileInput.click();
  });
}
if (previewPlaceholder) {
  previewPlaceholder.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });
}

function switchSidebarTab(tab) {
  [tabVideo, tabPerson, tabSettings].forEach((el) => el && el.classList.remove('active'));
  [panelVideo, panelPerson, panelSettings].forEach((el) => el && el.classList.add('hidden'));
  if (tab === 'video') {
    tabVideo && tabVideo.classList.add('active');
    panelVideo && panelVideo.classList.remove('hidden');
  } else if (tab === 'person') {
    tabPerson && tabPerson.classList.add('active');
    panelPerson && panelPerson.classList.remove('hidden');
  } else if (tab === 'settings') {
    tabSettings && tabSettings.classList.add('active');
    panelSettings && panelSettings.classList.remove('hidden');
    if (inputAppkey) inputAppkey.value = localStorage.getItem(STORAGE_APPKEY) || '';
  }
}

if (tabVideo) tabVideo.addEventListener('click', () => switchSidebarTab('video'));
if (tabPerson) tabPerson.addEventListener('click', () => switchSidebarTab('person'));
if (tabSettings) tabSettings.addEventListener('click', () => switchSidebarTab('settings'));

if (personDropZone) {
  personDropZone.addEventListener('click', () => filePerson && filePerson.click());
}
if (personPlaceholder) {
  personPlaceholder.addEventListener('click', (e) => {
    e.stopPropagation();
    filePerson && filePerson.click();
  });
}
if (filePerson) {
  filePerson.addEventListener('change', () => {
    const file = filePerson.files && filePerson.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (currentPersonFile && personImage && personImage.src) URL.revokeObjectURL(personImage.src);
    currentPersonFile = file;
    if (personImage) {
      personImage.src = URL.createObjectURL(file);
      personImage.classList.remove('hidden');
    }
    if (personPlaceholder) personPlaceholder.classList.add('hidden');
  });
}

if (btnSaveAppkey && inputAppkey) {
  btnSaveAppkey.addEventListener('click', () => {
    const key = (inputAppkey.value || '').trim();
    localStorage.setItem(STORAGE_APPKEY, key);
    alert(key ? 'APPKEY 已保存' : '已清除 APPKEY');
  });
}
if (inputAppkey) inputAppkey.value = localStorage.getItem(STORAGE_APPKEY) || '';

if (btnMute) {
  btnMute.addEventListener('click', () => {
    video.muted = !video.muted;
    if (volumeIcon) volumeIcon.textContent = video.muted ? '🔇' : '🔊';
  });
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  if (currentFile && video.src) URL.revokeObjectURL(video.src);
  timelineThumbnails = [];
  currentFile = file;
  video.preload = 'auto';
  video.src = URL.createObjectURL(file);
  video.load();
  previewPlaceholder.classList.add('hidden');
  video.classList.remove('hidden');
  segments = [];
  pendingRangeStart = null;
  updateTimelineHint();
  renderSegmentList();
  updatePlayIcon();
});

btnProcess.addEventListener('click', async () => {
  if (!currentFile || segments.length === 0) return;
  const ok = confirm('将对选中片段做左右镜像并生成新视频，是否继续？');
  if (!ok) return;

  progressWrap.classList.remove('hidden');
  progressText.textContent = '处理中，请稍候…';
  btnProcess.disabled = true;

  const form = new FormData();
  form.append('video', currentFile);
  form.append('segments', JSON.stringify(segments));
  form.append('duration', String(duration));

  try {
    const res = await fetch('/api/process', { method: 'POST', body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '处理失败');
    }
    const blob = await res.blob();
    const disp = res.headers.get('content-disposition') || '';
    const match = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i) || disp.match(/filename=["']?([^"';]+)/i);
    const name = (match && match[1] && match[1].trim()) ? match[1].trim() : 'mirrored-' + currentFile.name;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'mirrored.mp4';
    a.click();
    URL.revokeObjectURL(url);
    progressText.textContent = '处理完成，已开始下载';
  } catch (err) {
    progressText.textContent = '';
    alert('处理失败: ' + (err.message || '未知错误'));
  } finally {
    progressWrap.classList.add('hidden');
    btnProcess.disabled = !currentFile || segments.length === 0;
  }
});

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
updateTimeLabel();
updatePlayIcon();
