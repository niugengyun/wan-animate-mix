const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

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

module.exports = {
  getMergedDuration,
  runFfmpegMerge,
  splitResultBySegmentDurations,
  normalizeResultVideo,
  probeHasVideo,
  getVideoDuration,
  runFfmpegReplace,
  runFfmpegReplaceNoAudio,
};

