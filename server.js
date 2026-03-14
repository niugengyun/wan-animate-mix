const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

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

function buildFilterComplex(segments, duration) {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const parts = [];
  let t = 0;
  for (const seg of sorted) {
    const start = Math.max(0, seg.start);
    const end = Math.min(duration, seg.end);
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

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/process', upload.single('video'), async (req, res) => {
  const file = req.file;
  let segments = [];
  let duration = 0;
  try {
    segments = JSON.parse(req.body.segments || '[]');
    duration = parseFloat(req.body.duration) || 0;
  } catch (e) {
    return res.status(400).json({ ok: false, error: '参数无效' });
  }
  if (!file || !Array.isArray(segments) || segments.length === 0 || duration <= 0) {
    if (file) fs.unlink(file.path, () => {});
    return res.status(400).json({ ok: false, error: '缺少视频或片段信息' });
  }

  const ext = path.extname(file.originalname) || '.mp4';
  const outName = 'mirrored-' + Date.now() + ext;
  const outPath = path.join(outputDir, outName);

  const { withAudio: filterWithAudio, videoOnly: filterVideoOnly } =
    buildFilterComplex(segments, duration);

  let result = await runFfmpeg(
    file.path,
    outPath,
    filterWithAudio,
    duration,
    true
  );
  if (
    !result.ok &&
    result.stderr &&
    /Stream.*0:a|Invalid stream specifier|does not contain/.test(result.stderr)
  ) {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    result = await runFfmpeg(
      file.path,
      outPath,
      filterVideoOnly,
      duration,
      false
    );
  }

  fs.unlink(file.path, () => {});

  if (!result.ok) {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    return res.status(500).json({ ok: false, error: result.error || '处理失败' });
  }

  res.download(outPath, outName, (err) => {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    if (err && !res.headersSent) res.status(500).json({ ok: false, error: '下载失败' });
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('视频镜像工具已启动: http://localhost:' + PORT);
});
