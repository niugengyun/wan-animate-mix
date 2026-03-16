const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  uploadFileToOss,
  createVideoSynthesisTask,
  pollTaskResult,
  downloadToFile,
} = require('./src/bailianService');
const {
  getMergedDuration,
  runFfmpegMerge,
  splitResultBySegmentDurations,
  normalizeResultVideo,
  probeHasVideo,
  getVideoDuration,
  runFfmpegReplace,
  runFfmpegReplaceNoAudio,
} = require('./src/ffmpegService');

const app = express();
const PORT = process.env.PORT || 3000;

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
  if (!apiKey || !personOssUrl) {
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

    console.log('[process] 合并视频上传至临时存储...');
    const videoOssUrl = await uploadFileToOss(apiKey, mergedPath, `merged-${ts}.mp4`);
    console.log('[process] 合并视频临时地址 videoOssUrl=', videoOssUrl, '人物图 personOssUrl=', personOssUrl);
    const taskId = await createVideoSynthesisTask(apiKey, personOssUrl, videoOssUrl);
    const resultVideoUrl = await pollTaskResult(apiKey, taskId);
    console.log('[process] 下载合成结果视频...');
    await downloadToFile(resultVideoUrl, resultPath);

    let pathToSplit = resultPath;
    const normalizedPath = path.join(outputDir, `normalized-${ts}.mp4`);
    const okNorm = await normalizeResultVideo(resultPath, normalizedPath);
    if (okNorm) {
      pathToSplit = normalizedPath;
    } else {
      console.log('[process] 规范化失败，回退使用原始合成结果视频进行切分');
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
