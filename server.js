const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3000;

const DASHSCOPE_UPLOAD_MODEL = 'wan2.2-animate-mix';
const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com';

const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) =>
    cb(null, Date.now() + '-' + (file.originalname || 'video')),
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

/**
 * 步骤1：获取文件上传凭证
 * 文档：GET https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=模型名
 * Header: Authorization: Bearer <apiKey>, Content-Type: application/json
 */
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

/**
 * 步骤2：上传文件至临时存储空间
 * 文档：POST data.upload_host，form-data 且 file 必须为最后一个表单域
 * 表单域：OSSAccessKeyId, Signature, policy, x-oss-object-acl, x-oss-forbid-overwrite, key, success_action_status, file
 */
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

function getMergedDuration(segments) {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  let total = 0;
  for (const seg of sorted) {
    const start = seg.start;
    const end = seg.end;
    if (end > start) total += end - start;
  }
  return total;
}

function fmtTime(t) {
  if (!Number.isFinite(t)) return 0;
  return Number(t.toFixed(3));
}

function fmtTimeStr(t) {
  return String(fmtTime(t));
}

function buildMergeFilterComplex(segments, duration) {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const videoFilters = [];
  const audioFilters = [];
  const concatVideoInputs = [];
  const concatAudioInputs = [];
  sorted.forEach((seg, i) => {
    const start = fmtTime(Math.max(0, seg.start));
    const end = fmtTime(Math.min(duration, seg.end));
    if (start >= end) return;
    const vLabel = `v${i}`;
    const aLabel = `a${i}`;
    videoFilters.push(
      `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[${vLabel}]`
    );
    audioFilters.push(
      `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[${aLabel}]`
    );
    concatVideoInputs.push(`[${vLabel}]`);
    concatAudioInputs.push(`[${aLabel}]`);
  });
  const n = concatVideoInputs.length;
  const vConcat = concatVideoInputs.join('') + `concat=n=${n}:v=1:a=0[outv]`;
  const aConcat = concatAudioInputs.join('') + `concat=n=${n}:v=0:a=1[outa]`;
  return {
    withAudio: videoFilters.join(';') + ';' + audioFilters.join(';') + ';' + vConcat + ';' + aConcat,
    videoOnly: videoFilters.join(';') + ';' + vConcat,
  };
}

function buildFilterComplex(segments, duration) {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const parts = [];
  let t = 0;
  for (const seg of sorted) {
    const start = fmtTime(Math.max(0, seg.start));
    const end = fmtTime(Math.min(duration, seg.end));
    if (start >= end) continue;
    if (t < start - 0.001) parts.push({ start: t, end: start, mirror: false });
    parts.push({ start, end, mirror: true });
    t = end;
  }
  if (t < duration - 0.001) parts.push({ start: t, end: duration, mirror: false });

  const videoFilters = [];
  const audioFilters = [];
  const concatVideoInputs = [];
  const concatAudioInputs = [];

  parts.forEach((p, i) => {
    const vLabel = `v${i}`;
    const aLabel = `a${i}`;
    if (p.mirror) {
      videoFilters.push(
        `[0:v]trim=start=${p.start}:end=${p.end},setpts=PTS-STARTPTS,hflip[${vLabel}]`
      );
    } else {
      videoFilters.push(
        `[0:v]trim=start=${p.start}:end=${p.end},setpts=PTS-STARTPTS[${vLabel}]`
      );
    }
    audioFilters.push(
      `[0:a]atrim=start=${p.start}:end=${p.end},asetpts=PTS-STARTPTS[${aLabel}]`
    );
    concatVideoInputs.push(`[${vLabel}]`);
    concatAudioInputs.push(`[${aLabel}]`);
  });

  const n = parts.length;
  const vConcat =
    concatVideoInputs.join('') + `concat=n=${n}:v=1:a=0[outv]`;
  const aConcat =
    concatAudioInputs.join('') + `concat=n=${n}:v=0:a=1[outa]`;
  return {
    withAudio:
      videoFilters.join(';') +
      ';' +
      audioFilters.join(';') +
      ';' +
      vConcat +
      ';' +
      aConcat,
    videoOnly: videoFilters.join(';') + ';' + vConcat,
  };
}

function runFfmpeg(inputPath, outputPath, filterStr, duration, withAudio) {
  const args = [
    '-y',
    '-i',
    inputPath,
    '-filter_complex',
    filterStr,
    '-map',
    '[outv]',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
  ];
  if (withAudio) {
    args.push('-map', '[outa]', '-c:a', 'aac', outputPath);
  } else {
    args.push('-an', outputPath);
  }

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: stderr.slice(-500) || 'FFmpeg 失败',
          stderr,
        });
        return;
      }
      resolve({ ok: true });
    });
    proc.on('error', (err) => {
      resolve({ ok: false, error: '启动 FFmpeg 失败: ' + err.message });
    });
  });
}

function runFfmpegMerge(inputPath, outputPath, segments, duration) {
  const { withAudio: filterWithAudio, videoOnly: filterVideoOnly } =
    buildMergeFilterComplex(segments, duration);
  return runFfmpeg(inputPath, outputPath, filterWithAudio, duration, true).then((r) => {
    if (!r.ok && r.stderr && /Stream.*0:a|Invalid stream specifier|does not contain/.test(r.stderr)) {
      return runFfmpeg(inputPath, outputPath, filterVideoOnly, duration, false);
    }
    return r;
  });
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

async function splitResultBySegmentDurations(resultPath, segments, outputDir, sourceDuration = null) {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const durations = sorted.map((s) => s.end - s.start);
  console.log('[process] 切分参数 片段数=', durations.length, 'sourceDuration=', sourceDuration);
  const paths = [];
  let t = 0;
  for (let i = 0; i < durations.length; i++) {
    let d = durations[i];
    if (d <= 0) continue;
    if (sourceDuration != null) {
      const remaining = sourceDuration - t;
      if (remaining <= 0) break;
      d = Math.min(d, remaining);
    }
    const outPath = path.join(outputDir, `repl-${i}-${Date.now()}.mp4`);
    const args = ['-y', '-ss', fmtTimeStr(t), '-i', resultPath, '-t', fmtTimeStr(d), '-map', '0:v', '-map', '0:a?', '-c', 'copy', outPath];
    console.log('[process] 切分 i=', i, 'start=', t.toFixed(2), 'duration=', d.toFixed(2), 'out=', outPath);
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      proc.on('close', (code) => {
        if (code !== 0) {
      console.log('[process] 切分失败 i=', i, 'code=', code, 'stderr末尾:', stderr.slice(-200));
          reject(new Error(stderr.slice(-300) || '切分失败'));
        } else {
          console.log('[process] 切分成功 i=', i);
          resolve();
        }
      });
      proc.on('error', reject);
    });
    paths.push(outPath);
    t = fmtTime(t + d);
  }
  console.log('[process] 切分完成 共', paths.length, '个文件');
  return paths;
}

async function normalizeResultVideo(inputPath, outputPath) {
  return new Promise((resolve) => {
    console.log('[process] 规范化合成结果视频 fps/时间戳 input=', inputPath);
    const args = [
      '-y',
      '-i', inputPath,
      '-vf', 'fps=30',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-c:a', 'aac',
      outputPath,
    ];
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) {
        console.log('[process] 规范化合成结果失败 code=', code, 'stderr末尾:', stderr.slice(-200));
        resolve(false);
      } else {
        console.log('[process] 规范化合成结果成功');
        resolve(true);
      }
    });
    proc.on('error', (err) => {
      console.log('[process] 规范化合成结果异常', err.message);
      resolve(false);
    });
  });
}

function probeHasVideo(filePath, logLabel = null) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-i', filePath, '-f', 'null', '-'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', () => {
      const hasVideo = /Stream\s+#\d+:\d+.*Video:\s*\w+/.test(stderr);
      if (!hasVideo && logLabel) {
        console.log('[process] probeHasVideo 无视频', logLabel, 'path=', filePath);
        console.log('[process] ffmpeg stderr 末尾:', stderr.slice(-800));
      }
      resolve(!!hasVideo);
    });
    proc.on('error', () => resolve(false));
  });
}

function getVideoDuration(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-i', filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)[.,](\d+)/);
      if (!m) return resolve(null);
      const h = parseInt(m[1], 10), min = parseInt(m[2], 10), s = parseInt(m[3], 10), cs = parseInt(m[4], 10);
      resolve(h * 3600 + min * 60 + s + cs / 100);
    });
    proc.on('error', () => resolve(null));
  });
}

function buildReplaceFilterComplex(segments, duration, withAudio = true) {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const parts = [];
  parts.push({ type: 'orig', start: 0, end: fmtTime(sorted[0].start) });
  for (let i = 0; i < sorted.length; i++) {
    parts.push({ type: 'repl', index: i });
    if (i < sorted.length - 1) {
      parts.push({ type: 'orig', start: fmtTime(sorted[i].end), end: fmtTime(sorted[i + 1].start) });
    } else {
      parts.push({ type: 'orig', start: fmtTime(sorted[i].end), end: fmtTime(duration) });
    }
  }
  const videoFilters = [];
  const concatInputs = [];
  let idx = 0;
  for (const p of parts) {
    const label = `v${idx}`;
    if (p.type === 'orig' && p.end > p.start) {
      videoFilters.push(
        `[0:v]trim=start=${fmtTime(p.start)}:end=${fmtTime(p.end)},setpts=PTS-STARTPTS[${label}]`
      );
      concatInputs.push(`[${label}]`);
      idx++;
    } else if (p.type === 'repl') {
      videoFilters.push(`[${p.index + 1}:v]setpts=PTS-STARTPTS[${label}]`);
      concatInputs.push(`[${label}]`);
      idx++;
    }
  }
  const n = concatInputs.length;
  const vConcat = concatInputs.join('') + `concat=n=${n}:v=1:a=0[vtmp];[vtmp]fps=30[outv]`;
  if (!withAudio) return videoFilters.join(';') + ';' + vConcat;
  const aFilter = `[0:a]atrim=start=0:end=${fmtTime(duration)},asetpts=PTS-STARTPTS[outa]`;
  return videoFilters.join(';') + ';' + vConcat + ';' + aFilter;
}

const MAX_REPLACE_TIMEOUT_MS = 120000;

function runFfmpegReplace(originalPath, replacementPaths, segments, duration, outputPath) {
  const filterStr = buildReplaceFilterComplex(segments, duration, true);
  const args = ['-y', '-i', originalPath];
  replacementPaths.forEach((p) => args.push('-i', p));
  args.push('-filter_complex', filterStr, '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'fast', '-c:a', 'aac', outputPath);
  console.log('[process] runFfmpegReplace 启动 filterComplex(head)=', filterStr.slice(0, 200));
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const start = Date.now();
    const timer = setTimeout(() => {
      console.log('[process] runFfmpegReplace 超时，准备 kill，已运行 ms=', Date.now() - start);
      try {
        proc.kill('SIGKILL');
      } catch (e) {
        console.log('[process] runFfmpegReplace kill 异常', e.message);
      }
    }, MAX_REPLACE_TIMEOUT_MS);
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      console.log('[process] runFfmpegReplace 结束 code=', code);
      if (code !== 0) {
        console.log('[process] runFfmpegReplace 失败 stderr末尾:', stderr.slice(-400));
        let msg = stderr.slice(-500) || 'FFmpeg 失败';
        if (code === null) {
          msg = '替换合并超时（超过 120 秒），请尝试缩短视频或片段总时长后重试';
        } else if (/More than \d+ frames duplicated/.test(stderr)) {
          msg = '替换合并失败：视频时间戳异常（重复帧过多），请尝试缩短片段或重新导出源视频后重试';
        }
        resolve({ ok: false, error: msg });
      } else {
        resolve({ ok: true });
      }
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      console.log('[process] runFfmpegReplace error', err.message);
      resolve({ ok: false, error: err.message });
    });
  });
}

function runFfmpegReplaceNoAudio(originalPath, replacementPaths, segments, duration, outputPath) {
  const filterStr = buildReplaceFilterComplex(segments, duration, false);
  const args = ['-y', '-i', originalPath];
  replacementPaths.forEach((p) => args.push('-i', p));
  args.push('-filter_complex', filterStr, '-map', '[outv]', '-c:v', 'libx264', '-preset', 'fast', '-an', outputPath);
  console.log('[process] runFfmpegReplaceNoAudio 启动 filterComplex(head)=', filterStr.slice(0, 200));
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const start = Date.now();
    const timer = setTimeout(() => {
      console.log('[process] runFfmpegReplaceNoAudio 超时，准备 kill，已运行 ms=', Date.now() - start);
      try {
        proc.kill('SIGKILL');
      } catch (e) {
        console.log('[process] runFfmpegReplaceNoAudio kill 异常', e.message);
      }
    }, MAX_REPLACE_TIMEOUT_MS);
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      console.log('[process] runFfmpegReplaceNoAudio 结束 code=', code);
      if (code !== 0) {
        console.log('[process] runFfmpegReplaceNoAudio 失败 stderr末尾:', stderr.slice(-400));
        let msg = stderr.slice(-500) || 'FFmpeg 失败';
        if (code === null) {
          msg = '替换合并超时（超过 120 秒），请尝试缩短视频或片段总时长后重试';
        } else if (/More than \d+ frames duplicated/.test(stderr)) {
          msg = '替换合并失败：视频时间戳异常（重复帧过多），请尝试缩短片段或重新导出源视频后重试';
        }
        resolve({ ok: false, error: msg });
      } else {
        resolve({ ok: true });
      }
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      console.log('[process] runFfmpegReplaceNoAudio error', err.message);
      resolve({ ok: false, error: err.message });
    });
  });
}

app.use(express.json({ limit: '1mb' }));

app.post('/api/upload', upload.single('file'), async (req, res) => {
  console.log('[api/upload] 收到请求 type=', req.body?.type, '有file=', !!req.file);
  const file = req.file;
  const body = req.body || {};
  const apiKey = (body.apiKey != null ? String(body.apiKey) : '').trim();
  const type = (body.type != null ? String(body.type) : '').trim();
  if (!file) {
    return res.status(400).json({ ok: false, error: '缺少文件' });
  }
  if (!type) {
    fs.unlink(file.path, () => {});
    return res.status(400).json({ ok: false, error: '缺少 type 参数' });
  }
  if (!apiKey) {
    fs.unlink(file.path, () => {});
    return res.status(400).json({ ok: false, error: '缺少 apiKey，请先在设置中保存 API Key' });
  }
  if (type !== 'person') {
    fs.unlink(file.path, () => {});
    return res.status(400).json({ ok: false, error: 'type 仅支持 person' });
  }
  try {
    const ossUrl = await uploadFileToOss(apiKey, file.path, file.originalname);
    fs.unlink(file.path, () => {});
    console.log('[api/upload] 成功 ossUrl=', ossUrl);
    return res.json({ ok: true, ossUrl });
  } catch (err) {
    console.log('[api/upload] 失败', err.message);
    if (file && fs.existsSync(file.path)) fs.unlink(file.path, () => {});
    return res.status(500).json({ ok: false, error: err.message || '上传失败' });
  }
});

app.post('/api/process', upload.single('video'), async (req, res) => {
  const file = req.file;
  const apiKey = (req.body && req.body.apiKey) ? req.body.apiKey.trim() : '';
  const personOssUrl = (req.body && req.body.personOssUrl) ? req.body.personOssUrl.trim() : '';
  const testMode = req.body && (req.body.testMode === 'true' || req.body.testMode === true);
  let segments = [];
  let duration = 0;
  try {
    segments = JSON.parse(req.body.segments || '[]');
    duration = parseFloat(req.body.duration) || 0;
  } catch (e) {
    if (file) fs.unlink(file.path, () => {});
    return res.status(400).json({ ok: false, error: '参数无效' });
  }
  if (!file || !Array.isArray(segments) || segments.length === 0 || duration <= 0) {
    if (file) fs.unlink(file.path, () => {});
    return res.status(400).json({ ok: false, error: '缺少视频或片段信息' });
  }
  if (!testMode && (!apiKey || !personOssUrl)) {
    fs.unlink(file.path, () => {});
    return res.status(400).json({ ok: false, error: '请先上传人物图并设置 API Key' });
  }

  const mergedDuration = getMergedDuration(segments);
  if (mergedDuration < 2 || mergedDuration > 30) {
    fs.unlink(file.path, () => {});
    return res.status(400).json({
      ok: false,
      error: '合并片段总时长需大于 2 秒且小于 30 秒，当前为 ' + mergedDuration.toFixed(1) + ' 秒',
    });
  }

  const ts = Date.now();
  const mergedPath = path.join(outputDir, `merged-${ts}.mp4`);
  const resultPath = path.join(outputDir, `result-${ts}.mp4`);
  const finalPath = path.join(outputDir, `replaced-${ts}.mp4`);
  const replDir = path.join(outputDir, `repl-${ts}`);
  if (!fs.existsSync(replDir)) fs.mkdirSync(replDir, { recursive: true });

  const cleanup = () => {
    [mergedPath, resultPath, finalPath].forEach((p) => { if (fs.existsSync(p)) fs.unlinkSync(p); });
    if (fs.existsSync(replDir)) {
      fs.readdirSync(replDir).forEach((f) => fs.unlinkSync(path.join(replDir, f)));
      fs.rmdirSync(replDir);
    }
  };

  try {
    let mergeResult = await runFfmpegMerge(file.path, mergedPath, segments, duration);
    if (!mergeResult.ok) {
      fs.unlink(file.path, () => {});
      cleanup();
      return res.status(500).json({ ok: false, error: mergeResult.error || '合并片段失败' });
    }

    if (testMode) {
      console.log('[process] 测试模式：跳过调用 API，使用合并后的视频作为结果进行切分与替换');
    } else {
      console.log('[process] 合并视频上传至临时存储...');
      const videoOssUrl = await uploadFileToOss(apiKey, mergedPath, `merged-${ts}.mp4`);
      console.log('[process] 合并视频临时地址 videoOssUrl=', videoOssUrl, '人物图 personOssUrl=', personOssUrl);
      const taskId = await createVideoSynthesisTask(apiKey, personOssUrl, videoOssUrl);
      const resultVideoUrl = await pollTaskResult(apiKey, taskId);
      console.log('[process] 下载合成结果视频...');
      await downloadToFile(resultVideoUrl, resultPath);
    }

    let pathToSplit = testMode ? mergedPath : resultPath;
    if (!testMode) {
      const normalizedPath = path.join(outputDir, `normalized-${ts}.mp4`);
      const okNorm = await normalizeResultVideo(resultPath, normalizedPath);
      if (okNorm) {
        pathToSplit = normalizedPath;
      } else {
        console.log('[process] 规范化失败，回退使用原始合成结果视频进行切分');
      }
    }
    console.log('[process] 检查合成结果是否含视频流 path=', pathToSplit);
    const resultHasVideo = await probeHasVideo(pathToSplit, '合成结果');
    if (!resultHasVideo) {
      cleanup();
      return res.status(500).json({ ok: false, error: '下载的合成结果无视频流，请重试或检查任务返回的 video_url' });
    }
    const mergedDur = getMergedDuration(segments);
    const resultDuration = await getVideoDuration(pathToSplit);
    if (resultDuration != null && resultDuration < mergedDur - 0.1) {
      cleanup();
      return res.status(500).json({
        ok: false,
        error: `合成结果视频时长(${resultDuration.toFixed(1)}秒)小于所选片段总时长(${mergedDur.toFixed(1)}秒)，请缩短所选片段或重新合成`,
      });
    }
    if (resultDuration != null) console.log('[process] 合成结果时长', resultDuration.toFixed(1), '秒，片段总时长', mergedDur.toFixed(1), '秒');
    console.log('[process] 合成结果有视频流，开始切分片段...');
    const replPaths = await splitResultBySegmentDurations(pathToSplit, segments, replDir, resultDuration);
    console.log('[process] 检查原视频是否有视频流 path=', file.path);
    const origHasVideo = await probeHasVideo(file.path, '原视频');
    if (!origHasVideo) {
      cleanup();
      return res.status(500).json({ ok: false, error: '原视频无视频流，无法进行替换' });
    }
    for (let i = 0; i < replPaths.length; i++) {
      console.log('[process] 检查切分片段 i=', i, 'path=', replPaths[i]);
      const hasVideo = await probeHasVideo(replPaths[i], '切分片段#' + i);
      if (!hasVideo) {
        cleanup();
        return res.status(500).json({ ok: false, error: '切分后的片段无视频流，请重试' });
      }
    }
    console.log('[process] 所有切分片段均有视频流，开始替换合并...');
    let replaceResult = await runFfmpegReplace(file.path, replPaths, segments, duration, finalPath);
    if (!replaceResult.ok && replaceResult.error && /Stream.*0:a|Invalid stream specifier|does not contain/.test(replaceResult.error)) {
      replaceResult = await runFfmpegReplaceNoAudio(file.path, replPaths, segments, duration, finalPath);
    }
    if (!replaceResult.ok) {
      fs.unlink(file.path, () => {});
      cleanup();
      return res.status(500).json({ ok: false, error: replaceResult.error || '替换合并失败' });
    }

    fs.unlink(file.path, () => {});
    const ext = path.extname(file.originalname) || '.mp4';
    const outName = 'replaced-' + Date.now() + ext;

    res.download(finalPath, outName, (err) => {
      cleanup();
      if (err && !res.headersSent) res.status(500).json({ ok: false, error: '下载失败' });
    });
  } catch (err) {
    console.error('[process] 处理失败', err.message);
    console.error(err.stack);
    fs.unlink(file.path, () => {});
    cleanup();
    return res.status(500).json({ ok: false, error: err.message || '处理失败' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('人物替换工具已启动: http://localhost:' + PORT);
});
