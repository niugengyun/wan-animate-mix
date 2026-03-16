const previewModal = document.getElementById('previewModal');
const previewModalVideo = document.getElementById('previewModalVideo');
const previewModalBtnClose = document.getElementById('previewModalBtnClose');
const previewModalBtnDownload = document.getElementById('previewModalBtnDownload');

const antDialogModal = document.getElementById('antDialogModal');
const antDialogTitle = document.getElementById('antDialogTitle');
const antDialogContent = document.getElementById('antDialogContent');
const antDialogBtnCancel = document.getElementById('antDialogBtnCancel');
const antDialogBtnOk = document.getElementById('antDialogBtnOk');

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

// 暴露到全局，供 app.js 使用
window.showPreviewModal = showPreviewModal;
window.closePreviewModal = closePreviewModal;
window.showAntAlert = showAntAlert;
window.showAntConfirm = showAntConfirm;
window.getFriendlyProcessErrorMessage = getFriendlyProcessErrorMessage;

