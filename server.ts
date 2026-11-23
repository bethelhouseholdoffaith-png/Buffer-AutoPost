import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import multer from 'multer';
import dotenv from 'dotenv';
import {
  BUFFER_COOKIE_NAME,
  GEMINI_COOKIE_NAME,
  setKeyCookie,
  clearKeyCookie,
  getBufferKeyFromReq,
  getGeminiKeyFromReq,
  verifySameOriginCsrf,
  getAllowedCorsOrigins,
  redactSecrets,
} from './server/cookies.js';
import {
  fetchBufferBootstrap,
  invalidateBufferSessionCache,
  createBufferGraphQLPosts,
  deleteBufferGraphQLPost,
  updateBufferGraphQLPost,
  getStoredRateLimit,
} from './server/bufferService.js';
import {
  validateGeminiApiKey,
  analyzeVideoWithGemini,
  computeFileSha256,
  deleteRemoteGeminiFile,
  normalizeVideoMimeType,
  GeminiServiceError,
  PREFERRED_GEMINI_VIDEO_MODEL,
} from './server/geminiService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// Trust reverse proxy headers for accurate HTTPS cookie flags & Host validation
app.set('trust proxy', 1);

// Isolated temp upload directory outside any public/static directory
const tempMediaDir = path.resolve(__dirname, 'tmp_analysis');
if (!fs.existsSync(tempMediaDir)) {
  fs.mkdirSync(tempMediaDir, { recursive: true });
}

const ALLOWED_VIDEO_EXTS = new Set([
  '.mp4',
  '.mov',
  '.webm',
  '.m4v',
  '.mpeg',
  '.mpg',
  '.avi',
  '.wmv',
  '.flv',
  '.3gp',
  '.ogv',
]);

interface MediaUploadRecord {
  uploadId: string;
  mediaToken: string;
  filePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  contentHash: string;
  createdAt: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

const mediaRegistry = new Map<string, MediaUploadRecord>();

function scheduleTempFileCleanup(uploadId: string, delayMs: number) {
  const rec = mediaRegistry.get(uploadId);
  if (!rec) return;
  if (rec.cleanupTimer) clearTimeout(rec.cleanupTimer);
  rec.cleanupTimer = setTimeout(() => {
    mediaRegistry.delete(uploadId);
    try {
      if (fs.existsSync(rec.filePath)) fs.unlinkSync(rec.filePath);
    } catch {
      // ignore unlink errors
    }
  }, delayMs);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tempMediaDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.mp4').toLowerCase();
    const safeExt = ALLOWED_VIDEO_EXTS.has(ext) ? ext : '.mp4';
    const randomId = crypto.randomBytes(12).toString('hex');
    cb(null, `vid-${Date.now()}-${randomId}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB max
  },
  fileFilter: (_req, file, cb) => {
    const normalized = normalizeVideoMimeType(file.mimetype, file.originalname);
    if (normalized) {
      cb(null, true);
    } else {
      const err = new Error(
        'Video format unsupported. Upload a valid MP4, MOV, WebM, MPEG, AVI, or 3GP video.'
      ) as Error & { statusCode?: number; errorCode?: string };
      err.statusCode = 415;
      err.errorCode = 'UNSUPPORTED_VIDEO_FORMAT';
      cb(err);
    }
  },
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Optional explicit allowlisted CORS for pairing a GitHub Pages UI with a hosted Studio backend
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const normalized = origin.toLowerCase().replace(/\/$/, '');
    if (getAllowedCorsOrigins().has(normalized)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Requested-With');
    }
  }
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
});

// Protect all state-changing API routes against CSRF
app.use('/api', verifySameOriginCsrf);

function buildPublicMediaUrl(req: express.Request, uploadId: string, mediaToken: string): string {
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3000';
  const protoHeader = String(req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const proto = protoHeader.split(',')[0].trim();
  const baseUrl = process.env.APP_URL
    ? process.env.APP_URL.replace(/\/$/, '')
    : `${proto}://${host}`;
  return `${baseUrl}/api/media/${encodeURIComponent(uploadId)}/${encodeURIComponent(mediaToken)}`;
}

// Controlled media delivery route for Buffer ingestion (no directory traversal or static exposure)
app.get('/api/media/:uploadId/:token', (req, res) => {
  const { uploadId, token } = req.params;
  const record = mediaRegistry.get(uploadId);
  if (!record || record.mediaToken !== token) {
    return res.status(404).json({ error: 'Media asset not found or expired.' });
  }

  const resolvedPath = path.resolve(record.filePath);
  if (!resolvedPath.startsWith(tempMediaDir + path.sep) || !fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'Media file no longer available.' });
  }

  res.setHeader('Content-Type', record.mimeType || 'video/mp4');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.sendFile(resolvedPath);
});

// ==========================================
// 1. Key Status & HttpOnly Cookie Vault Routes
// ==========================================

app.get('/api/keys/status', (req, res) => {
  const hasBufferKey = Boolean(getBufferKeyFromReq(req));
  const hasGeminiKey = Boolean(getGeminiKeyFromReq(req));
  return res.json({ hasBufferKey, hasGeminiKey });
});

app.post('/api/keys/buffer', async (req, res) => {
  const rawToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const cleanedToken = rawToken.toLowerCase().startsWith('bearer ')
    ? rawToken.slice(7).trim()
    : rawToken;

  if (!cleanedToken) {
    return res.status(400).json({
      success: false,
      error: 'Please enter your Buffer Personal Access Token.',
    });
  }

  try {
    const bootstrap = await fetchBufferBootstrap(cleanedToken, { forceRefresh: true });
    setKeyCookie(req, res, BUFFER_COOKIE_NAME, cleanedToken);
    return res.json({
      success: true,
      organizations: bootstrap.organizations,
      channels: bootstrap.channels,
      rateLimit: bootstrap.rateLimit,
    });
  } catch (err: any) {
    const status = err?.statusCode === 429 ? 429 : err?.statusCode === 401 ? 401 : 400;
    const msg = redactSecrets(
      err?.message || 'Buffer key could not be verified. Check the key and try again.',
      [cleanedToken]
    );
    return res.status(status).json({
      success: false,
      error:
        status === 401
          ? 'Buffer key could not be verified. Check the key and try again.'
          : msg,
    });
  }
});

app.post('/api/keys/gemini', async (req, res) => {
  const rawKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
  if (!rawKey) {
    return res.status(400).json({
      success: false,
      error: 'Please enter your Gemini API key.',
    });
  }

  try {
    const verified = await validateGeminiApiKey(rawKey);
    setKeyCookie(req, res, GEMINI_COOKIE_NAME, rawKey);
    return res.json({ success: true, model: verified.model });
  } catch (err: any) {
    const status = err instanceof GeminiServiceError ? err.httpStatus : 401;
    const errorCode = err instanceof GeminiServiceError ? err.errorCode : 'INVALID_API_KEY';
    const safeMsg = redactSecrets(
      err?.message || 'Invalid API key. Check your Gemini API key and try again.',
      [rawKey]
    );
    return res.status(status).json({
      success: false,
      errorCode,
      retryable: err instanceof GeminiServiceError ? err.retryable : false,
      error: safeMsg,
    });
  }
});

app.post('/api/keys/clear', (req, res) => {
  const target = req.body?.target || 'all';
  if (target === 'buffer' || target === 'all') {
    const prevBuffer = getBufferKeyFromReq(req);
    if (prevBuffer) invalidateBufferSessionCache(prevBuffer);
    clearKeyCookie(req, res, BUFFER_COOKIE_NAME);
  }
  if (target === 'gemini' || target === 'all') {
    clearKeyCookie(req, res, GEMINI_COOKIE_NAME);
  }
  return res.json({
    success: true,
    hasBufferKey: target === 'gemini' ? Boolean(getBufferKeyFromReq(req)) : false,
    hasGeminiKey: target === 'buffer' ? Boolean(getGeminiKeyFromReq(req)) : false,
  });
});

// ==========================================
// 2. Buffer GraphQL Proxy Routes (No REST v1)
// ==========================================

app.get('/api/buffer/bootstrap', async (req, res) => {
  const token = getBufferKeyFromReq(req);
  if (!token) {
    return res.status(401).json({ success: false, error: 'Buffer API key is not connected.' });
  }

  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await fetchBufferBootstrap(token, { forceRefresh });
    return res.json({
      success: true,
      organizations: data.organizations,
      channels: data.channels,
      rateLimit: data.rateLimit,
    });
  } catch (err: any) {
    const status = err?.statusCode || 400;
    return res.status(status).json({
      success: false,
      error: redactSecrets(err?.message || 'Failed to load Buffer account data.', [token]),
      retryAfterSeconds: err?.retryAfterSeconds,
      rateLimit: getStoredRateLimit(token),
    });
  }
});

app.get('/api/buffer/channels', async (req, res) => {
  const token = getBufferKeyFromReq(req);
  if (!token) {
    return res.status(401).json({ success: false, error: 'Buffer API key is not connected.' });
  }

  try {
    const forceRefresh = req.query.refresh === '1';
    const data = await fetchBufferBootstrap(token, { forceRefresh });
    return res.json({
      success: true,
      channels: data.channels,
      rateLimit: data.rateLimit,
    });
  } catch (err: any) {
    return res.status(err?.statusCode || 400).json({
      success: false,
      error: redactSecrets(err?.message || 'Failed to load channels.', [token]),
    });
  }
});

app.get('/api/buffer/schedule', async (req, res) => {
  const token = getBufferKeyFromReq(req);
  if (!token) {
    return res.status(401).json({ success: false, error: 'Buffer API key is not connected.' });
  }

  try {
    const data = await fetchBufferBootstrap(token);
    return res.json({
      success: true,
      schedules: data.channels.map((ch) => ({
        channelId: ch.id,
        channelName: ch.name,
        service: ch.service,
        timezone: ch.timezone,
        isQueuePaused: ch.isQueuePaused,
        postingSchedule: ch.postingSchedule,
      })),
      rateLimit: data.rateLimit,
    });
  } catch (err: any) {
    return res.status(err?.statusCode || 400).json({
      success: false,
      error: redactSecrets(err?.message || 'Failed to load Buffer schedules.', [token]),
    });
  }
});

app.post('/api/buffer/posts', async (req, res) => {
  const token = getBufferKeyFromReq(req);
  if (!token) {
    return res.status(401).json({ success: false, error: 'Buffer API key is not connected.' });
  }

  const {
    channelIds,
    channelServices = {},
    text,
    uploadId,
    thumbnailOffset = 1500,
    schedulingType = 'automatic',
    dueAt,
    platformOptions = {},
  } = req.body || {};

  if (!Array.isArray(channelIds) || channelIds.length === 0) {
    return res.status(400).json({ success: false, error: 'Select at least one channel.' });
  }
  if (!text || !String(text).trim()) {
    return res.status(400).json({ success: false, error: 'Post title is required.' });
  }

  const mediaRec = uploadId ? mediaRegistry.get(String(uploadId)) : undefined;
  if (!mediaRec) {
    return res.status(400).json({
      success: false,
      error: 'Uploaded video session expired. Re-upload the video and try again.',
    });
  }

  const publicVideoUrl = buildPublicMediaUrl(req, mediaRec.uploadId, mediaRec.mediaToken);

  try {
    const result = await createBufferGraphQLPosts({
      token,
      channelIds,
      channelServices,
      text: String(text),
      videoUrl: publicVideoUrl,
      thumbnailOffset,
      schedulingType,
      dueAt,
      platformOptions,
    });

    if (result.success) {
      // Keep temp media available long enough for Buffer servers to download, then delete automatically
      scheduleTempFileCleanup(mediaRec.uploadId, 6 * 60 * 60 * 1000);
      const geminiKey = getGeminiKeyFromReq(req);
      if (geminiKey) {
        deleteRemoteGeminiFile(mediaRec.uploadId, geminiKey);
      }
    }

    return res.status(result.success ? 200 : 400).json(result);
  } catch (err: any) {
    return res.status(err?.statusCode || 400).json({
      success: false,
      error: redactSecrets(err?.message || 'The post was not scheduled.', [token]),
    });
  }
});

app.patch('/api/buffer/posts/:id', async (req, res) => {
  const token = getBufferKeyFromReq(req);
  if (!token) {
    return res.status(401).json({ success: false, error: 'Buffer API key is not connected.' });
  }

  try {
    const result = await updateBufferGraphQLPost(token, req.params.id, {
      text: req.body?.text,
      dueAt: req.body?.dueAt,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(err?.statusCode || 400).json({
      success: false,
      error: redactSecrets(err?.message || 'Could not update post in Buffer.', [token]),
    });
  }
});

app.delete('/api/buffer/posts/:id', async (req, res) => {
  const token = getBufferKeyFromReq(req);
  if (!token) {
    return res.status(401).json({ success: false, error: 'Buffer API key is not connected.' });
  }

  try {
    const result = await deleteBufferGraphQLPost(token, req.params.id);
    return res.json(result);
  } catch (err: any) {
    return res.status(err?.statusCode || 400).json({
      success: false,
      error: redactSecrets(err?.message || 'Could not delete post in Buffer.', [token]),
    });
  }
});

// ==========================================
// 3. Video Upload & Gemini Real Video Analysis
// ==========================================

// Single-upload helper when user wants to upload a video for scheduling (e.g. manual title mode)
app.post('/api/videos/upload', (req, res) => {
  upload.single('video')(req, res, async (uploadErr: any) => {
    if (uploadErr) {
      return res.status(uploadErr?.statusCode || 415).json({
        success: false,
        errorCode: uploadErr?.errorCode || 'UNSUPPORTED_VIDEO_FORMAT',
        retryable: false,
        error:
          uploadErr?.message ||
          'Video format unsupported. Upload a valid MP4, MOV, WebM, MPEG, AVI, or 3GP video.',
      });
    }

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          errorCode: 'UNSUPPORTED_VIDEO_FORMAT',
          retryable: false,
          error: 'No video file provided.',
        });
      }
      if (req.file.size <= 0) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          // ignore
        }
        return res.status(415).json({
          success: false,
          errorCode: 'UNSUPPORTED_VIDEO_FORMAT',
          retryable: false,
          error: 'Video format unsupported: Uploaded file is empty (0 bytes).',
        });
      }

      const normalizedMime =
        normalizeVideoMimeType(req.file.mimetype, req.file.originalname) || 'video/mp4';
      const uploadId = crypto.randomBytes(10).toString('hex');
      const mediaToken = crypto.randomBytes(18).toString('hex');
      const contentHash = await computeFileSha256(req.file.path);

      mediaRegistry.set(uploadId, {
        uploadId,
        mediaToken,
        filePath: req.file.path,
        originalName: req.file.originalname,
        mimeType: normalizedMime,
        size: req.file.size,
        contentHash,
        createdAt: Date.now(),
      });
      scheduleTempFileCleanup(uploadId, 30 * 60 * 1000);

      return res.json({
        success: true,
        uploadId,
        publicVideoUrl: buildPublicMediaUrl(req, uploadId, mediaToken),
      });
    } catch (err: any) {
      return res.status(400).json({
        success: false,
        errorCode: 'VIDEO_PROCESSING_FAILED',
        retryable: false,
        error: err?.message || 'This video could not be processed. Try a supported video file.',
      });
    }
  });
});

// Upload + Real Gemini Files API Video Understanding (also supports { uploadId, regenerate })
app.post('/api/gemini/analyze-video', (req, res) => {
  req.setTimeout(240000);
  res.setTimeout(240000);

  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    upload.single('video')(req, res, async (uploadErr: any) => {
      if (uploadErr) {
        return res.status(uploadErr?.statusCode || 415).json({
          success: false,
          errorCode: uploadErr?.errorCode || 'UNSUPPORTED_VIDEO_FORMAT',
          retryable: false,
          error:
            uploadErr?.message ||
            'Video format unsupported. Upload a valid MP4, MOV, WebM, MPEG, AVI, or 3GP video.',
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          errorCode: 'UNSUPPORTED_VIDEO_FORMAT',
          retryable: false,
          error: 'No video file provided.',
        });
      }

      if (req.file.size <= 0) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          // ignore
        }
        return res.status(415).json({
          success: false,
          errorCode: 'UNSUPPORTED_VIDEO_FORMAT',
          retryable: false,
          error: 'Video format unsupported: Uploaded file is empty (0 bytes).',
        });
      }

      const normalizedMime = normalizeVideoMimeType(req.file.mimetype, req.file.originalname);
      if (!normalizedMime) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          // ignore
        }
        return res.status(415).json({
          success: false,
          errorCode: 'UNSUPPORTED_VIDEO_FORMAT',
          retryable: false,
          error:
            'Video format unsupported. Upload a valid MP4, MOV, WebM, MPEG, AVI, or 3GP video.',
        });
      }

      const uploadId = crypto.randomBytes(10).toString('hex');
      const mediaToken = crypto.randomBytes(18).toString('hex');
      const contentHash = await computeFileSha256(req.file.path);

      mediaRegistry.set(uploadId, {
        uploadId,
        mediaToken,
        filePath: req.file.path,
        originalName: req.file.originalname,
        mimeType: normalizedMime,
        size: req.file.size,
        contentHash,
        createdAt: Date.now(),
      });
      scheduleTempFileCleanup(uploadId, 30 * 60 * 1000);

      const publicVideoUrl = buildPublicMediaUrl(req, uploadId, mediaToken);
      const geminiKey = getGeminiKeyFromReq(req);

      if (!geminiKey) {
        return res.status(401).json({
          success: false,
          errorCode: 'INVALID_API_KEY',
          retryable: false,
          requiresGeminiKey: true,
          uploadId,
          publicVideoUrl,
          error: 'Gemini API key is not connected.',
        });
      }

      try {
        const analysis = await analyzeVideoWithGemini({
          apiKey: geminiKey,
          uploadId,
          filePath: req.file.path,
          mimeType: normalizedMime,
          originalName: req.file.originalname,
          contentHash,
          regenerate: false,
        });

        return res.json({
          success: true,
          uploadId,
          publicVideoUrl,
          ...analysis,
        });
      } catch (err: any) {
        const isServiceErr = err instanceof GeminiServiceError;
        const status = isServiceErr ? err.httpStatus : 500;
        const errorCode = isServiceErr ? err.errorCode : 'UNKNOWN_ERROR';
        return res.status(status).json({
          success: false,
          errorCode,
          retryable: isServiceErr ? err.retryable : true,
          requiresGeminiKey: errorCode === 'INVALID_API_KEY',
          model: isServiceErr ? err.model : undefined,
          uploadId,
          publicVideoUrl,
          error: redactSecrets(
            err?.message || 'Gemini failed to analyze this video. Please retry.',
            [geminiKey]
          ),
        });
      }
    });
    return;
  }

  // JSON retry or regeneration using existing uploadId (never requires browser re-upload)
  (async () => {
    const geminiKey = getGeminiKeyFromReq(req);
    const { uploadId, regenerate = true } = req.body || {};

    if (!geminiKey) {
      return res.status(401).json({
        success: false,
        errorCode: 'INVALID_API_KEY',
        retryable: false,
        requiresGeminiKey: true,
        error: 'Gemini API key is not connected.',
      });
    }

    const mediaRec = uploadId ? mediaRegistry.get(String(uploadId)) : undefined;
    if (!mediaRec) {
      return res.status(404).json({
        success: false,
        errorCode: 'VIDEO_EXPIRED',
        retryable: false,
        error: 'Video session expired. Please re-select the video file.',
      });
    }

    try {
      const analysis = await analyzeVideoWithGemini({
        apiKey: geminiKey,
        uploadId: mediaRec.uploadId,
        filePath: mediaRec.filePath,
        mimeType: mediaRec.mimeType,
        originalName: mediaRec.originalName,
        contentHash: mediaRec.contentHash,
        regenerate: Boolean(regenerate),
      });

      return res.json({
        success: true,
        uploadId: mediaRec.uploadId,
        publicVideoUrl: buildPublicMediaUrl(req, mediaRec.uploadId, mediaRec.mediaToken),
        ...analysis,
      });
    } catch (err: any) {
      const isServiceErr = err instanceof GeminiServiceError;
      const status = isServiceErr ? err.httpStatus : 500;
      const errorCode = isServiceErr ? err.errorCode : 'UNKNOWN_ERROR';
      return res.status(status).json({
        success: false,
        errorCode,
        retryable: isServiceErr ? err.retryable : true,
        requiresGeminiKey: errorCode === 'INVALID_API_KEY',
        model: isServiceErr ? err.model : undefined,
        uploadId: mediaRec.uploadId,
        publicVideoUrl: buildPublicMediaUrl(req, mediaRec.uploadId, mediaRec.mediaToken),
        error: redactSecrets(
          err?.message || 'Gemini failed to analyze this video. Please retry.',
          [geminiKey]
        ),
      });
    }
  })();
});

// Health Check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    model: PREFERRED_GEMINI_VIDEO_MODEL,
  });
});

// Setup Vite middleware in dev or static serving in prod
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const distPath = path.join(__dirname, 'dist');

  if (!isProd && !fs.existsSync(distPath)) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`AutoBuffer Video Studio server running at http://0.0.0.0:${port}`);
  });
}

startServer();
