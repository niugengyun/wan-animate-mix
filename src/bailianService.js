const path = require('path');
const fs = require('fs');
const https = require('https');
const FormData = require('form-data');

const DASHSCOPE_UPLOAD_MODEL = 'wan2.2-animate-mix';
const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com';

async function getUploadPolicy(apiKey) {
  const url = `${DASHSCOPE_BASE}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(DASHSCOPE_UPLOAD_MODEL)}`;
  console.log('[upload] 步骤1 获取凭证: GET', url.replace(apiKey, '***'));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    console.log('[upload] 步骤1 响应 status=', res.status, 'body长度=', text.length);
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      console.log('[upload] 步骤1 解析失败 body前200字:', text.slice(0, 200));
      throw new Error('获取上传凭证返回格式异常');
    }
    if (!res.ok) {
      console.log('[upload] 步骤1 失败 code=', data.code, 'message=', data.message);
      throw new Error(data.message || data.code || text || '获取上传凭证失败');
    }
    if (!data.data || !data.data.upload_host || !data.data.upload_dir) {
      console.log('[upload] 步骤1 返回数据不完整 data=', JSON.stringify(data).slice(0, 300));
      throw new Error(data.message || '获取上传凭证返回数据不完整');
    }
    console.log('[upload] 步骤1 成功 upload_host=', data.data.upload_host, 'upload_dir=', data.data.upload_dir);
    return data.data;
  } catch (err) {
    clearTimeout(t);
    console.log('[upload] 步骤1 异常', err.name, err.message);
    if (err.name === 'AbortError') throw new Error('获取上传凭证超时');
    throw err;
  }
}

async function uploadFileToOss(apiKey, filePath, originalFilename) {
  console.log('[upload] 步骤2 开始  filePath=', filePath, 'originalFilename=', originalFilename);
  const policyData = await getUploadPolicy(apiKey);
  const fileName = (originalFilename && path.basename(originalFilename)) || path.basename(filePath) || 'file';
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
  const key = `${policyData.upload_dir}/${safeName}`;
  console.log('[upload] 步骤2 key=', key, 'safeName=', safeName);

  const form = new FormData();
  form.append('OSSAccessKeyId', policyData.oss_access_key_id);
  form.append('Signature', policyData.signature);
  form.append('policy', policyData.policy);
  form.append('x-oss-object-acl', policyData.x_oss_object_acl);
  form.append('x-oss-forbid-overwrite', policyData.x_oss_forbid_overwrite);
  form.append('key', key);
  form.append('success_action_status', '200');
  const fileStream = fs.createReadStream(filePath);
  form.append('file', fileStream, { filename: safeName });
  console.log('[upload] 步骤2 使用流式上传，正在 POST 到 OSS...');

  const uploadUrl = new URL(policyData.upload_host);
  const headers = form.getHeaders();

  const res = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: uploadUrl.hostname,
        port: uploadUrl.port || 443,
        path: uploadUrl.pathname || '/',
        method: 'POST',
        headers,
      },
      (incoming) => {
        const chunks = [];
        incoming.on('data', (c) => chunks.push(c));
        incoming.on('end', () => {
          clearTimeout(t);
          resolve({ status: incoming.statusCode, body: Buffer.concat(chunks).toString('utf8') });
        });
        incoming.on('error', (err) => {
          clearTimeout(t);
          reject(err);
        });
      }
    );
    const t = setTimeout(() => {
      req.destroy();
      reject(new Error('上传到 OSS 超时'));
    }, 60000);
    req.on('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
    form.pipe(req);
  });

  console.log('[upload] 步骤2 OSS 响应 status=', res.status, 'body长度=', res.body.length);
  if (res.status !== 200) {
    console.log('[upload] 步骤2 OSS 失败 body=', res.body.slice(0, 500));
    throw new Error(res.body || '上传到 OSS 失败');
  }
  const ossUrl = `oss://${key}`;
  console.log('[upload] 步骤2 成功 ossUrl=', ossUrl);
  return ossUrl;
}

async function createVideoSynthesisTask(apiKey, imageUrl, videoUrl) {
  const url = `${DASHSCOPE_BASE}/api/v1/services/aigc/image2video/video-synthesis`;
  console.log('[process] 正在创建 video-synthesis 任务...');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-DashScope-Async': 'enable',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-OssResourceResolve': 'enable',
      },
      body: JSON.stringify({
        model: DASHSCOPE_UPLOAD_MODEL,
        input: {
          image_url: imageUrl,
          video_url: videoUrl,
          watermark: false,
        },
        parameters: { mode: 'wan-std' },
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
  const raw = await res.text();
  console.log('[process] 步骤1 创建任务 响应 status=', res.status);
  const data = raw ? JSON.parse(raw) : {};
  if (!res.ok || !data.output || !data.output.task_id) {
    throw new Error(data.message || data.code || '创建视频合成任务失败');
  }
  return data.output.task_id;
}

async function pollTaskResult(apiKey, taskId, maxWaitMs = 600000) {
  const url = `${DASHSCOPE_BASE}/api/v1/tasks/${taskId}`;
  const start = Date.now();
  console.log('[process] 步骤2 开始根据任务ID查询结果 task_id=', taskId);
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json();
    console.log('[process] 步骤2 查询结果 响应 status=', res.status, 'task_status=', data.output?.task_status);
    const status = data.output && data.output.task_status;
    if (!res.ok) throw new Error(data.message || data.code || '查询任务失败');
    if (status === 'SUCCEEDED') {
      const videoUrl = data.output.results && data.output.results.video_url;
      if (!videoUrl) throw new Error('任务成功但无视频链接');
      return videoUrl;
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      throw new Error(data.output?.message || data.output?.code || status || '任务失败');
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error('任务超时');
}

async function downloadToFile(url, filePath, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VideoReplace/1.0)' },
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(t);
    if (err.name === 'AbortError') throw new Error('下载结果视频超时');
    throw err;
  }
  clearTimeout(t);
  if (!res.ok) {
    throw new Error(`下载结果视频失败(status=${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buf);
  console.log('[process] 下载写入完成 path=', filePath, 'size=', buf.length);
}

module.exports = {
  uploadFileToOss,
  createVideoSynthesisTask,
  pollTaskResult,
  downloadToFile,
};

