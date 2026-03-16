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
const tabMedia = document.getElementById('tabMedia');
const tabSettings = document.getElementById('tabSettings');
const panelMedia = document.getElementById('panelMedia');
const panelSettings = document.getElementById('panelSettings');
const filePerson = document.getElementById('filePerson');
const personImage = document.getElementById('personImage');
const personUploadStatus = document.getElementById('personUploadStatus');
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
const previewModal = document.getElementById('previewModal');
const previewModalVideo = document.getElementById('previewModalVideo');
const previewModalBtnClose = document.getElementById('previewModalBtnClose');
const previewModalBtnDownload = document.getElementById('previewModalBtnDownload');
const antDialogModal = document.getElementById('antDialogModal');
const antDialogTitle = document.getElementById('antDialogTitle');
const antDialogContent = document.getElementById('antDialogContent');
const antDialogBtnCancel = document.getElementById('antDialogBtnCancel');
const antDialogBtnOk = document.getElementById('antDialogBtnOk');

const STORAGE_APPKEY = 'bailian_appkey';
const THUMB_COUNT = 24;
const THUMB_PX_WIDTH = 48;
const TIMELINE_FPS = 24;

let currentFile = null;
let currentPersonFile = null;
let personOssUrl = null;
let duration = 0;
let visibleStart = 0;
let visibleEnd = 10;
let segments = [];
let pendingRangeStart = null;
let pendingEndPreview = null;
let isDraggingPlayhead = false;
let isSelecting = false;
let selectStartX = 0;
let selectStartT = 0;
let isOverTimeline = false;
let hoverPreviewLastTime = 0;
let hoverPreviewPendingX = null;
let hoverPreviewTime = null;
const HOVER_PREVIEW_THROTTLE_MS = 42;
let spaceKeyHeld = false;
let isSpacePanning = false;
let ignoreNextClickBecausePan = false;
let panStartX = 0;
let panStartVisibleStart = 0;
let panStartVisibleEnd = 0;
const MIN_VISIBLE_SPAN = 1 / TIMELINE_FPS;
const MAX_PX_PER_FRAME = 56;
const ZOOM_FACTOR = 1.2;

function getMinVisibleSpan() {
  if (canvasWidth <= 0) return MIN_VISIBLE_SPAN;
  const spanByPx = canvasWidth / (TIMELINE_FPS * MAX_PX_PER_FRAME);
  return Math.max(MIN_VISIBLE_SPAN, spanByPx);
}
let timeupdateThrottle = null;
let timelineThumbnails = [];
let previewModalBlobUrl = null;
let previewModalDownloadName = '';

function showPreviewModal(blob, downloadName) {
  if (previewModalBlobUrl) URL.revokeObjectURL(previewModalBlobUrl);
  previewModalBlobUrl = URL.createObjectURL(blob);
  previewModalDownloadName = downloadName || 'replaced.mp4';
  if (previewModalVideo) {
    previewModalVideo.pause();
    previewModalVideo.src = previewModalBlobUrl;
  }
  if (previewModal) {
    previewModal.classList.remove('ant-modal-wrap-hidden');
    previewModal.setAttribute('aria-hidden', 'false');
  }
}

function closePreviewModal() {
  if (previewModalVideo) {
    previewModalVideo.pause();
    previewModalVideo.removeAttribute('src');
  }
  if (previewModalBlobUrl) {
    URL.revokeObjectURL(previewModalBlobUrl);
    previewModalBlobUrl = null;
  }
  previewModalDownloadName = '';
  if (previewModal) {
    previewModal.classList.add('ant-modal-wrap-hidden');
    previewModal.setAttribute('aria-hidden', 'true');
  }
}

function showAntAlert(message, title = '提示') {
  return new Promise((resolve) => {
    if (!antDialogModal || !antDialogContent || !antDialogBtnOk) {
      resolve();
      return;
    }
    if (antDialogTitle) antDialogTitle.textContent = title;
    antDialogContent.textContent = message;
    if (antDialogBtnCancel) antDialogBtnCancel.style.display = 'none';
    antDialogModal.classList.remove('ant-modal-wrap-hidden');
    antDialogModal.setAttribute('aria-hidden', 'false');
    const onClose = () => {
      antDialogModal.classList.add('ant-modal-wrap-hidden');
      antDialogModal.setAttribute('aria-hidden', 'true');
      antDialogBtnOk.removeEventListener('click', onOk);
      resolve();
    };
    const onOk = () => onClose();
    antDialogBtnOk.addEventListener('click', onOk);
  });
}

function showAntConfirm(options) {
  const { title = '确认', content, confirmText = '确定', cancelText = '取消' } = options || {};
  return new Promise((resolve) => {
    if (!antDialogModal || !antDialogContent || !antDialogBtnOk) {
      resolve(false);
      return;
    }
    if (antDialogTitle) antDialogTitle.textContent = title;
    antDialogContent.textContent = content;
    if (antDialogBtnCancel) {
      antDialogBtnCancel.style.display = '';
      antDialogBtnCancel.textContent = cancelText;
    }
    antDialogBtnOk.textContent = confirmText;
    antDialogModal.classList.remove('ant-modal-wrap-hidden');
    antDialogModal.setAttribute('aria-hidden', 'false');
    const close = (result) => {
      antDialogModal.classList.add('ant-modal-wrap-hidden');
      antDialogModal.setAttribute('aria-hidden', 'true');
      antDialogBtnOk.removeEventListener('click', onOk);
      if (antDialogBtnCancel) antDialogBtnCancel.removeEventListener('click', onCancel);
      resolve(result);
    };
    const onOk = () => close(true);
    const onCancel = () => close(false);
    antDialogBtnOk.addEventListener('click', onOk);
    if (antDialogBtnCancel) antDialogBtnCancel.addEventListener('click', onCancel);
  });
}

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
  ctx.setTransform(1, 0, 0, 1, 0, 0);
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

function clampTime(t) {
  return Math.max(0, Math.min(duration, t));
}

function drawTimeline() {
  const w = canvasWidth;
  const h = canvasHeight;
  ctx.clearRect(0, 0, w, h);

  const span = visibleEnd - visibleStart;
  const framesVisible = span * TIMELINE_FPS;
  const pxPerFrame = w > 0 && framesVisible > 0 ? w / framesVisible : 0;
  const frameScale = pxPerFrame >= 24;

  if (timelineThumbnails.length > 0 && duration > 0) {
    if (frameScale && pxPerFrame >= 8) {
      const numFrames = Math.ceil(framesVisible);
      const slotW = w / framesVisible;
      for (let i = 0; i < numFrames; i++) {
        const t = visibleStart + (i + 0.5) / TIMELINE_FPS;
        if (t >= visibleEnd) break;
        const thumbIndex = Math.min(THUMB_COUNT - 1, Math.max(0, Math.round((t / duration) * (THUMB_COUNT - 1))));
        const thumb = timelineThumbnails[thumbIndex];
        if (thumb && thumb.width) {
          const x0 = i * slotW;
          ctx.drawImage(thumb, x0, 0, slotW, h);
        }
      }
    } else {
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
  }

  let step;
  let stepFrame = 0;
  if (frameScale) {
    stepFrame = framesVisible <= 15 ? 1 : framesVisible <= 40 ? 2 : framesVisible <= 80 ? 5 : 10;
    step = stepFrame / TIMELINE_FPS;
  } else {
    step = span <= 2 ? 0.2 : span <= 10 ? 0.5 : span <= 60 ? 2 : 10;
  }
  const first = step > 0 ? (frameScale ? Math.ceil(visibleStart * TIMELINE_FPS / stepFrame) * stepFrame / TIMELINE_FPS : Math.ceil(visibleStart / step) * step) : visibleStart;
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
    if (frameScale && stepFrame > 0) {
      const startF = Math.max(0, Math.floor(visibleStart * TIMELINE_FPS));
      const endF = Math.ceil(visibleEnd * TIMELINE_FPS);
      for (let f = startF; f <= endF; f += stepFrame) {
        const t = f / TIMELINE_FPS;
        if (t < visibleStart) continue;
        const x = timeToX(t);
        scaleCtx.fillText((f + 1) + 'f', x + 2, sh / 2);
      }
    } else {
      for (let t = first; t <= visibleEnd; t += step) {
        const x = timeToX(t);
        scaleCtx.fillText(formatTime(t), x + 2, sh / 2);
      }
    }
  }

  ctx.fillStyle = 'rgba(22, 119, 255, 0.35)';
  segments.forEach((seg) => {
    const x1 = timeToX(seg.start);
    const x2 = timeToX(seg.end);
    ctx.fillRect(x1, 0, x2 - x1, h);
  });

  if (pendingRangeStart !== null) {
    const endT = pendingEndPreview !== null ? pendingEndPreview : (duration > 0 ? video.currentTime : pendingRangeStart);
    const px1 = timeToX(pendingRangeStart);
    const px2 = timeToX(endT);
    const left = Math.min(px1, px2);
    const right = Math.max(px1, px2);
    const pw = right - left;
    const dur = Math.abs(endT - pendingRangeStart);
    ctx.fillStyle = 'rgba(22, 119, 255, 0.5)';
    ctx.fillRect(left, 0, pw, h);
    ctx.strokeStyle = '#1677ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(left, 0, pw, h);
    if (pw > 36) {
      ctx.fillStyle = '#fff';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(formatTime(dur), left + pw / 2, h / 2);
    }
  }

  const headT = hoverPreviewTime != null ? hoverPreviewTime : video.currentTime;
  const headX = timeToX(headT);
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
  updateTimelineHint();
  drawTimeline();
}

function setVisibleRangeAroundAnchor(anchor, newSpan) {
  visibleStart = Math.max(0, anchor - newSpan / 2);
  visibleEnd = Math.min(duration, anchor + newSpan / 2);
  if (visibleEnd - visibleStart < newSpan) {
    if (anchor < duration / 2) visibleEnd = Math.min(duration, visibleStart + newSpan);
    else visibleStart = Math.max(0, visibleEnd - newSpan);
  }
}

function centerVisibleOnPlayhead() {
  if (duration <= 0) return;
  const span = visibleEnd - visibleStart;
  setVisibleRangeAroundAnchor(video.currentTime, span);
  updateZoomSlider();
}

function setVideoRange() {
  visibleEnd = Math.max(getMinVisibleSpan(), duration);
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
  const minSpan = getMinVisibleSpan();
  if (duration <= minSpan) return 100;
  const r = (span - minSpan) / (duration - minSpan);
  return Math.max(0, Math.min(100, 100 - r * 100));
}

function zoomValueToSpan(value) {
  const minSpan = getMinVisibleSpan();
  if (duration <= minSpan) return minSpan;
  const r = (100 - Math.max(0, Math.min(100, value))) / 100;
  return minSpan + r * (duration - minSpan);
}

const ZOOM_KNOB_WIDTH = 12;

function updateZoomSlider() {
  if (!zoomFill || !zoomKnob || !zoomSlider) return;
  const track = zoomSlider.querySelector('.timeline-zoom-track');
  if (!track || duration <= 0) return;
  const span = visibleEnd - visibleStart;
  const value = zoomSpanToValue(span);
  const trackW = track.getBoundingClientRect().width;
  const pct = value / 100;
  const knobMaxLeft = trackW - ZOOM_KNOB_WIDTH;
  zoomFill.style.width = pct * trackW + 'px';
  zoomKnob.style.left = pct * knobMaxLeft + 'px';
}

function doZoom(factor) {
  if (duration <= 0) return;
  const span = visibleEnd - visibleStart;
  const newSpan = Math.max(getMinVisibleSpan(), Math.min(duration, span * factor));
  setVisibleRangeAroundAnchor(video.currentTime, newSpan);
  updateTimeLabel();
  updateZoomSlider();
}

function doZoomByValue(value) {
  if (duration <= 0) return;
  const newSpan = zoomValueToSpan(value);
  setVisibleRangeAroundAnchor(video.currentTime, newSpan);
  updateTimeLabel();
  updateZoomSlider();
}

if (btnZoomOut) btnZoomOut.addEventListener('click', () => doZoom(ZOOM_FACTOR));
if (btnZoomIn) btnZoomIn.addEventListener('click', () => doZoom(1 / ZOOM_FACTOR));

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
    if (ignoreNextClickBecausePan) {
      ignoreNextClickBecausePan = false;
      return;
    }
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
    doZoom(e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR);
  }, { passive: false });
}

timelineWrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (duration <= 0) return;
  doZoom(e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR);
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') spaceKeyHeld = true;
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') spaceKeyHeld = false;
});

timelineWrap.addEventListener('mousedown', (e) => {
  ignoreNextClickBecausePan = false;
  if (duration <= 0) return;
  if (e.button === 0 && spaceKeyHeld) {
    hoverPreviewTime = null;
    isSpacePanning = true;
    panStartX = e.clientX;
    panStartVisibleStart = visibleStart;
    panStartVisibleEnd = visibleEnd;
    e.preventDefault();
    return;
  }
  const rect = timelineWrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const t = xToTime(x);
  if (e.target === timelineCanvas) {
    const headX = timeToX(video.currentTime);
    if (Math.abs(x - headX) < 12) {
      hoverPreviewTime = null;
      isDraggingPlayhead = true;
      return;
    }
    hoverPreviewTime = null;
    isSelecting = true;
    selectStartX = x;
    selectStartT = t;
  }
});

function updatePreviewAtTimelineX(x) {
  if (duration <= 0) return;
  video.pause();
  video.currentTime = clampTime(xToTime(x));
  updateTimeLabel();
}

function updatePreviewAtTimelineXThrottled(x) {
  hoverPreviewPendingX = x;
  const now = performance.now();
  if (now - hoverPreviewLastTime >= HOVER_PREVIEW_THROTTLE_MS) {
    hoverPreviewLastTime = now;
    if (hoverPreviewPendingX != null) {
      updatePreviewAtTimelineX(hoverPreviewPendingX);
      hoverPreviewPendingX = null;
    }
  }
}

timelineWrap.addEventListener('mouseenter', () => {
  isOverTimeline = true;
});

timelineWrap.addEventListener('mouseleave', () => {
  isOverTimeline = false;
  hoverPreviewTime = null;
  if (hoverPreviewPendingX != null) {
    updatePreviewAtTimelineX(hoverPreviewPendingX);
    hoverPreviewPendingX = null;
  }
  if (pendingEndPreview !== null) {
    pendingEndPreview = null;
    updateTimelineHint();
    drawTimeline();
  }
});

function doSpacePan(deltaX) {
  if (duration <= 0 || canvasWidth <= 0) return;
  const span = panStartVisibleEnd - panStartVisibleStart;
  const dt = (deltaX / canvasWidth) * span;
  let start = panStartVisibleStart - dt;
  let end = panStartVisibleEnd - dt;
  if (start < 0) {
    start = 0;
    end = span;
  }
  if (end > duration) {
    end = duration;
    start = duration - span;
  }
  visibleStart = start;
  visibleEnd = end;
  updateTimeLabel();
  updateZoomSlider();
  drawTimeline();
}

function applySpacePanWithPlayhead(clientX) {
  doSpacePan(clientX - panStartX);
  const rect = timelineWrap.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
  video.pause();
  video.currentTime = clampTime(xToTime(x));
  updateTimeLabel();
}

timelineWrap.addEventListener('mousemove', (e) => {
  const rect = timelineWrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  if (duration <= 0) return;

  if (isSpacePanning) {
    applySpacePanWithPlayhead(e.clientX);
    return;
  }
  if (x < 0 || x > rect.width) return;

  if (isDraggingPlayhead) {
    updatePreviewAtTimelineX(Math.max(0, Math.min(rect.width, x)));
    return;
  }

  if (pendingRangeStart !== null) {
    const t = clampTime(xToTime(x));
    if (pendingEndPreview !== t) {
      pendingEndPreview = t;
      updateTimelineHint();
      drawTimeline();
    }
    return;
  }

  if (isSelecting) return;

  const t = clampTime(xToTime(x));
  hoverPreviewTime = t;
  playhead.style.left = timeToX(t) + 'px';
  updatePreviewAtTimelineXThrottled(x);
});

window.addEventListener('mousemove', (e) => {
  if (isSpacePanning && duration > 0) {
    applySpacePanWithPlayhead(e.clientX);
    return;
  }
  if (isDraggingPlayhead && duration > 0) {
    const rect = timelineWrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    updatePreviewAtTimelineX(x);
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 0 && isSpacePanning) {
    isSpacePanning = false;
    ignoreNextClickBecausePan = true;
  }
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
  if (ignoreNextClickBecausePan) {
    ignoreNextClickBecausePan = false;
    return;
  }
  if (e.target !== timelineCanvas || isSelecting || isDraggingPlayhead) return;
  if (duration <= 0) return;
  const rect = timelineWrap.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const t = Math.max(0, Math.min(duration, xToTime(x)));
  video.currentTime = t;

  if (pendingRangeStart === null) {
    if (isTimeInSegment(t)) return;
    hoverPreviewTime = null;
    pendingRangeStart = t;
    pendingEndPreview = null;
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
  pendingEndPreview = null;
  updateTimelineHint();
  drawTimeline();
});

function isTimeInSegment(t) {
  return segments.some((seg) => t >= seg.start && t <= seg.end);
}

function rangeOverlapsSegment(start, end) {
  return segments.some((seg) => !(end <= seg.start || start >= seg.end));
}

function getMergedDuration(segs) {
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  let total = 0;
  for (const seg of sorted) {
    if (seg.end > seg.start) total += seg.end - seg.start;
  }
  return total;
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
  const mergedDur = getMergedDuration(segments);
  segments.forEach((seg, i) => {
    const li = document.createElement('li');
    const dur = seg.end - seg.start;
    li.textContent = formatTime(seg.start) + ' - ' + formatTime(seg.end) + '（' + dur.toFixed(1) + ' 秒）';
    const btn = document.createElement('button');
    btn.textContent = '删除';
    btn.addEventListener('click', () => removeSegment(i));
    li.appendChild(btn);
    segmentList.appendChild(li);
  });
  if (segments.length > 0) {
    const totalLi = document.createElement('li');
    totalLi.className = 'segment-total';
    totalLi.textContent = '片段总时长：' + mergedDur.toFixed(1) + ' 秒';
    segmentList.appendChild(totalLi);
  }
  const durationOk = mergedDur > 2 && mergedDur < 30;
  btnProcess.disabled = !currentFile || !currentPersonFile || !personOssUrl || segments.length === 0 || !durationOk;
}

function getFriendlyProcessErrorMessage(raw) {
  const msg = (raw || '').trim();
  if (!msg) return '处理失败，请稍后重试。';
  if (msg.includes('任务超时')) {
    return '百炼任务超过 10 分钟仍未完成，可能队列繁忙或片段总时长过长，请适当缩短片段后重试。';
  }
  if (msg.includes('替换合并超时')) {
    return '替换合并阶段超过 120 秒仍未完成，已自动终止，请尝试缩短视频或片段总时长后重试。';
  }
  if (msg.includes('视频时间戳异常')) {
    return '替换合并失败：检测到视频时间戳异常（重复帧过多），建议重新导出源视频或缩短片段后再试。';
  }
  return '处理失败：' + msg;
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
    fileInput && fileInput.click();
  });
}
if (previewPlaceholder) {
  previewPlaceholder.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput && fileInput.click();
  });
}

function switchSidebarTab(tab) {
  [tabMedia, tabSettings].forEach((el) => el && el.classList.remove('active'));
  [panelMedia, panelSettings].forEach((el) => el && el.classList.add('hidden'));
  if (tab === 'media') {
    tabMedia && tabMedia.classList.add('active');
    panelMedia && panelMedia.classList.remove('hidden');
  } else if (tab === 'settings') {
    tabSettings && tabSettings.classList.add('active');
    panelSettings && panelSettings.classList.remove('hidden');
    if (inputAppkey) inputAppkey.value = localStorage.getItem(STORAGE_APPKEY) || '';
  }
}

if (tabMedia) tabMedia.addEventListener('click', () => switchSidebarTab('media'));
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
  filePerson.addEventListener('change', async () => {
    const file = filePerson.files && filePerson.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (currentPersonFile && personImage && personImage.src) URL.revokeObjectURL(personImage.src);
    currentPersonFile = file;
    personOssUrl = null;
    if (personImage) {
      personImage.src = URL.createObjectURL(file);
      personImage.classList.remove('hidden');
    }
    if (personPlaceholder) personPlaceholder.classList.add('hidden');
    if (personUploadStatus) personUploadStatus.textContent = '上传中…';
    const apiKey = (localStorage.getItem(STORAGE_APPKEY) || '').trim();
    if (!apiKey) {
      if (personUploadStatus) personUploadStatus.textContent = '请先在设置中保存 API Key';
      renderSegmentList();
      return;
    }
    try {
      const form = new FormData();
      form.append('type', 'person');
      form.append('apiKey', apiKey);
      form.append('file', file);
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 25000);
      const res = await fetch('/api/upload', { method: 'POST', body: form, signal: ctrl.signal });
      clearTimeout(timeoutId);
      const raw = await res.text();
      let data = {};
      try {
        data = JSON.parse(raw);
      } catch (_) {
        data = { ok: false, error: raw || '服务器返回异常' };
      }
      if (data.ok && data.ossUrl) {
        personOssUrl = data.ossUrl;
        if (personUploadStatus) personUploadStatus.textContent = '人物正面图上传成功';
      } else {
        if (personUploadStatus) personUploadStatus.textContent = '上传失败：' + (data.error || '未知错误');
      }
    } catch (e) {
      if (personUploadStatus) {
        personUploadStatus.textContent = e.name === 'AbortError' ? '上传失败：请求超时（25秒）' : ('上传失败：' + (e.message || '网络错误'));
      }
    }
    renderSegmentList();
  });
}

if (btnSaveAppkey && inputAppkey) {
  btnSaveAppkey.addEventListener('click', () => {
    const key = (inputAppkey.value || '').trim();
    localStorage.setItem(STORAGE_APPKEY, key);
    showAntAlert(key ? 'API Key 已保存' : '已清除 API Key');
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
});

btnProcess.addEventListener('click', async () => {
  if (!currentFile || !currentPersonFile || !personOssUrl || segments.length === 0) return;
  const mergedDur = getMergedDuration(segments);
  if (mergedDur <= 2 || mergedDur >= 30) {
    showAntAlert('合并片段总时长需大于 2 秒且小于 30 秒，当前为 ' + mergedDur.toFixed(1) + ' 秒', '提示');
    return;
  }
  const ok = await showAntConfirm({
    title: '确认',
    content: '本次处理视频时长共 ' + mergedDur.toFixed(1) + ' 秒，是否确认处理？',
    confirmText: '确定',
    cancelText: '取消',
  });
  if (!ok) return;

  progressWrap.classList.remove('hidden');
  progressText.textContent = '上传并处理中…';
  btnProcess.disabled = true;

  const apiKey = (localStorage.getItem(STORAGE_APPKEY) || '').trim();
  const form = new FormData();
  form.append('video', currentFile);
  form.append('segments', JSON.stringify(segments));
  form.append('duration', String(duration));
  form.append('personOssUrl', personOssUrl);
  form.append('apiKey', apiKey);

  try {
    const res = await fetch('/api/process', { method: 'POST', body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '处理失败');
    }
    const blob = await res.blob();
    const disp = res.headers.get('content-disposition') || '';
    const match = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i) || disp.match(/filename=["']?([^"';]+)/i);
    const name = (match && match[1] && match[1].trim()) ? match[1].trim() : 'replaced-' + currentFile.name;
    progressText.textContent = '处理完成';
    showPreviewModal(blob, name || 'replaced.mp4');
  } catch (err) {
    progressText.textContent = '';
    showAntAlert(getFriendlyProcessErrorMessage(err.message), '提示');
  } finally {
    progressWrap.classList.add('hidden');
    renderSegmentList();
  }
});

if (previewModalBtnClose) {
  previewModalBtnClose.addEventListener('click', closePreviewModal);
}
if (previewModalBtnDownload) {
  previewModalBtnDownload.addEventListener('click', () => {
    if (!previewModalBlobUrl || !previewModalDownloadName) return;
    const a = document.createElement('a');
    a.href = previewModalBlobUrl;
    a.download = previewModalDownloadName;
    a.click();
  });
}

// 测试按钮逻辑已移除，仅保留正式处理流程

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
updateTimeLabel();
