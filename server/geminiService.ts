import {
  GoogleGenAI,
  Type,
  ThinkingLevel,
  createPartFromUri,
  createUserContent,
} from '@google/genai';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { hashCredential, redactSecrets } from './cookies.js';

export const PREFERRED_GEMINI_VIDEO_MODEL =
  process.env.GEMINI_VIDEO_MODEL?.trim() || 'gemini-4-hydrogen';

const CANDIDATE_VIDEO_MODELS = Array.from(
  new Set([
    PREFERRED_GEMINI_VIDEO_MODEL,
    'gemini-4-hydrogen',
    'gemini-3.1-flash-lite',
    'gemini-4-neon',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
  ])
);

const DEPRECATED_OR_NON_VIDEO_PATTERNS = [
  'embedding',
  '-tts',
  'transcribe',
  '-image',
  'nano-banana',
  'lyria',
  'genie',
  'decision',
  'live',
  'omni',
  'gemini-1.0',
  'gemini-1.5',
  'gemini-2.0',
  'gemini-pro',
  'aqa',
];

export const PROMPT_VERSION = 'v2-video-grounded-2026-11';
const FILE_RETENTION_MS = 15 * 60 * 1000;
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;
const ANALYSIS_TIMEOUT_MS = 90 * 1000;

export const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/mpeg',
  'video/mov',
  'video/quicktime',
  'video/avi',
  'video/x-msvideo',
  'video/x-flv',
  'video/mpg',
  'video/webm',
  'video/wmv',
  'video/x-ms-wmv',
  'video/3gpp',
  'video/ogg',
]);

const EXT_TO_VIDEO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.avi': 'video/avi',
  '.wmv': 'video/wmv',
  '.flv': 'video/x-flv',
  '.3gp': 'video/3gpp',
  '.ogv': 'video/ogg',
};

const FIXED_TITLE_PROMPT = `You are an expert social-video editor. Watch and analyze the entire uploaded video, including the spoken dialogue, narration, on-screen text, important visual actions, people or objects shown, and the overall point of the clip.

Your task is to write one clear, compelling title that accurately matches this specific video.

Rules:
- Base the title on the actual video content, not on its filename or assumptions.
- Identify the main subject and the most interesting genuine moment, insight, question, result, or takeaway.
- Be specific and natural. Make the title sound like a human creator wrote it.
- Create curiosity when the video supports it, but do not use misleading clickbait.
- Never invent people, facts, quotes, events, results, or claims that are not supported by the video.
- Do not imply that the video contains something it does not show or say.
- Avoid generic openings such as "You won't believe," "This is crazy," or "Watch until the end" unless those exact words are genuinely appropriate to the content.
- Keep the main title concise and easy to understand at a glance. Aim for roughly 5–12 words and stay comfortably below 100 characters when possible.
- Match the language of the video unless the user has selected another title language.
- Do not add hashtags, emojis, quotation marks, a preamble, or explanations to the main title.

Return valid JSON only, using this exact structure:
{
  "title": "One best title for this video",
  "alternatives": ["Alternative title 1", "Alternative title 2"],
  "content_summary": "One factual sentence describing what the video is about"
}

The alternatives must also be accurate and distinct. If the video is unclear, say so in content_summary and produce the most cautious accurate title possible. Never fabricate missing context.`;

export type GeminiErrorCode =
  | 'INVALID_API_KEY'
  | 'MODEL_UNAVAILABLE'
  | 'VIDEO_PROCESSING_FAILED'
  | 'UNSUPPORTED_VIDEO_FORMAT'
  | 'QUOTA_EXCEEDED'
  | 'TIMEOUT'
  | 'TRANSIENT_ERROR'
  | 'EMPTY_RESPONSE'
  | 'VIDEO_EXPIRED'
  | 'UNKNOWN_ERROR';

export class GeminiServiceError extends Error {
  httpStatus: number;
  errorCode: GeminiErrorCode;
  retryable: boolean;
  model?: string;
  apiErrorCode?: string;

  constructor(params: {
    message: string;
    httpStatus: number;
    errorCode: GeminiErrorCode;
    retryable: boolean;
    model?: string;
    apiErrorCode?: string;
  }) {
    super(params.message);
    this.name = 'GeminiServiceError';
    this.httpStatus = params.httpStatus;
    this.errorCode = params.errorCode;
    this.retryable = params.retryable;
    this.model = params.model;
    this.apiErrorCode = params.apiErrorCode;
  }
}

export interface VideoTitleResult {
  title: string;
  alternatives: string[];
  content_summary: string;
  model: string;
  cached?: boolean;
}

interface UploadedFileRecord {
  geminiFileName: string;
  geminiFileUri: string;
  mimeType: string;
  contentHash: string;
  apiKeyHash: string;
  expiresAt: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

interface VerifiedModelCacheEntry {
  resolvedModel: string;
  availableModels: string[];
  verifiedAt: number;
}

const titleResultCache = new Map<string, VideoTitleResult>();
const activeGeminiFiles = new Map<string, UploadedFileRecord>();
const verifiedModelCache = new Map<string, VerifiedModelCacheEntry>();

function createAiClient(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function supportsThinkingLevel(modelName: string): boolean {
  return /^gemini-(3|4)/i.test(modelName);
}

export function normalizeVideoMimeType(rawMime?: string, fileName?: string): string | null {
  const cleanMime = String(rawMime || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const ext = path.extname(fileName || '').toLowerCase();

  if (cleanMime === 'video/x-m4v') return 'video/mp4';
  if (cleanMime === 'video/quicktime') return 'video/quicktime';
  if (cleanMime && ALLOWED_VIDEO_MIMES.has(cleanMime)) {
    return cleanMime;
  }

  // Fallback to extension mapping only if MIME is generic/missing/unknown video subtype
  if (
    (!cleanMime || cleanMime === 'application/octet-stream' || cleanMime.startsWith('video/')) &&
    EXT_TO_VIDEO_MIME[ext]
  ) {
    return EXT_TO_VIDEO_MIME[ext];
  }

  return null;
}

function logGeminiError(params: {
  stage: string;
  model: string;
  httpStatus: number;
  apiErrorCode: string;
  errorCode: GeminiErrorCode;
  rawMessage: string;
  apiKey?: string;
}) {
  const safeMsg = redactSecrets(params.rawMessage, [params.apiKey]);
  console.error(
    '[GeminiService]',
    JSON.stringify({
      stage: params.stage,
      model: params.model,
      httpStatus: params.httpStatus,
      apiErrorCode: params.apiErrorCode,
      errorCode: params.errorCode,
      message: safeMsg,
    })
  );
}

export function classifyGeminiError(
  err: any,
  stage: string,
  model: string,
  apiKey?: string
): GeminiServiceError {
  if (err instanceof GeminiServiceError) {
    logGeminiError({
      stage,
      model: err.model || model,
      httpStatus: err.httpStatus,
      apiErrorCode: err.apiErrorCode || err.errorCode,
      errorCode: err.errorCode,
      rawMessage: err.message,
      apiKey,
    });
    return err;
  }

  const rawMsg = redactSecrets(String(err?.message || 'Unknown Gemini error'), [apiKey]);
  const rawStatus = Number(err?.status || err?.statusCode || err?.error?.code || 0);
  const apiErrorCode = String(
    err?.code || err?.error?.status || err?.statusText || rawStatus || 'UNKNOWN'
  );
  const lower = `${rawMsg} ${apiErrorCode}`.toLowerCase();

  let errorCode: GeminiErrorCode = 'UNKNOWN_ERROR';
  let httpStatus = rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
  let retryable = false;
  let userMessage = 'Gemini encountered an error analyzing this video. Please retry.';

  if (
    rawStatus === 401 ||
    rawStatus === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('permission_denied') ||
    lower.includes('invalid api key') ||
    lower.includes('unauthenticated')
  ) {
    errorCode = 'INVALID_API_KEY';
    httpStatus = 401;
    retryable = false;
    userMessage = 'Invalid API key. Check your Gemini API key in Settings and try again.';
  } else if (
    rawStatus === 404 ||
    lower.includes('not_found') ||
    lower.includes('is not found for api version') ||
    lower.includes('is not supported for generatecontent') ||
    lower.includes('model not found')
  ) {
    errorCode = 'MODEL_UNAVAILABLE';
    httpStatus = 404;
    retryable = false;
    userMessage = `Model unavailable: "${model}" is unavailable or does not support video analysis for this API key.`;
  } else if (
    rawStatus === 415 ||
    lower.includes('unsupported mime') ||
    lower.includes('mime type') ||
    lower.includes('unsupported media') ||
    lower.includes('invalid_argument') && lower.includes('video')
  ) {
    errorCode = 'UNSUPPORTED_VIDEO_FORMAT';
    httpStatus = 415;
    retryable = false;
    userMessage =
      'Video format unsupported. Please upload a valid MP4, MOV, WebM, MPEG, AVI, or 3GP video.';
  } else if (
    rawStatus === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit')
  ) {
    errorCode = 'QUOTA_EXCEEDED';
    httpStatus = 429;
    retryable = true;
    userMessage = 'API quota exceeded: Gemini rate limit or quota reached. Wait a moment and retry.';
  } else if (
    rawStatus === 504 ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('deadline_exceeded') ||
    lower.includes('etimedout') ||
    lower.includes('abort')
  ) {
    errorCode = 'TIMEOUT';
    httpStatus = 504;
    retryable = true;
    userMessage =
      'Request timed out while Gemini was analyzing the video. Retry without re-uploading.';
  } else if (
    rawStatus >= 500 ||
    lower.includes('unavailable') ||
    lower.includes('internal') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('fetch failed') ||
    lower.includes('network')
  ) {
    errorCode = 'TRANSIENT_ERROR';
    httpStatus = rawStatus >= 500 ? rawStatus : 503;
    retryable = true;
    userMessage =
      'Gemini service is temporarily busy or unreachable. Retry analysis without re-uploading.';
  } else if (lower.includes('failed_precondition') || lower.includes('file uri')) {
    errorCode = 'VIDEO_EXPIRED';
    httpStatus = 410;
    retryable = true;
    userMessage = 'Video reference expired on Gemini. Retrying with uploaded file...';
  } else if (rawStatus === 400) {
    errorCode = 'VIDEO_PROCESSING_FAILED';
    httpStatus = 400;
    retryable = false;
    userMessage = `Video processing failed: ${rawMsg}`;
  }

  logGeminiError({
    stage,
    model,
    httpStatus,
    apiErrorCode,
    errorCode,
    rawMessage: rawMsg,
    apiKey,
  });

  return new GeminiServiceError({
    message: userMessage,
    httpStatus,
    errorCode,
    retryable,
    model,
    apiErrorCode,
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, stage: string, model: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new GeminiServiceError({
              message: `Request timed out during ${stage}. Retry without re-uploading.`,
              httpStatus: 504,
              errorCode: 'TIMEOUT',
              retryable: true,
              model,
              apiErrorCode: 'CLIENT_TIMEOUT',
            })
          );
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function isVideoCapableModel(modelObj: any): string | null {
  const rawName = String(modelObj?.name || '').replace(/^models\//, '').trim();
  if (!rawName || !rawName.toLowerCase().includes('gemini')) return null;

  const lower = rawName.toLowerCase();
  if (DEPRECATED_OR_NON_VIDEO_PATTERNS.some((pat) => lower.includes(pat))) {
    return null;
  }

  const actions: string[] = Array.isArray(modelObj?.supportedActions)
    ? modelObj.supportedActions
    : Array.isArray(modelObj?.supportedGenerationMethods)
    ? modelObj.supportedGenerationMethods
    : [];

  if (actions.length > 0 && !actions.some((a) => String(a).toLowerCase() === 'generatecontent')) {
    return null;
  }

  return rawName;
}

export async function resolveVerifiedVideoModel(
  apiKey: string,
  options: { forceRefresh?: boolean; excludeModels?: string[] } = {}
): Promise<{ model: string; availableModels: string[] }> {
  const keyHash = hashCredential(apiKey);
  const exclude = new Set((options.excludeModels || []).map((m) => m.toLowerCase()));
  const cached = verifiedModelCache.get(keyHash);

  if (
    !options.forceRefresh &&
    cached &&
    Date.now() - cached.verifiedAt < MODEL_CACHE_TTL_MS &&
    !exclude.has(cached.resolvedModel.toLowerCase())
  ) {
    return { model: cached.resolvedModel, availableModels: cached.availableModels };
  }

  const ai = createAiClient(apiKey);
  const discovered: string[] = [];

  try {
    const listResp: any = await withTimeout(
      ai.models.list({ config: { pageSize: 50 } }),
      15000,
      'models.list',
      PREFERRED_GEMINI_VIDEO_MODEL
    );

    if (listResp && typeof listResp[Symbol.asyncIterator] === 'function') {
      for await (const item of listResp) {
        const clean = isVideoCapableModel(item);
        if (clean) discovered.push(clean);
      }
    } else if (Array.isArray(listResp?.models)) {
      for (const item of listResp.models) {
        const clean = isVideoCapableModel(item);
        if (clean) discovered.push(clean);
      }
    } else if (Array.isArray(listResp?.page)) {
      for (const item of listResp.page) {
        const clean = isVideoCapableModel(item);
        if (clean) discovered.push(clean);
      }
    }
  } catch (err: any) {
    const classified = classifyGeminiError(err, 'models.list', PREFERRED_GEMINI_VIDEO_MODEL, apiKey);
    if (classified.errorCode === 'INVALID_API_KEY') {
      throw classified;
    }
    // If models.list isn't permitted by a restricted proxy, fall back cleanly to preferred candidates
  }

  let selected = '';
  if (discovered.length > 0) {
    for (const candidate of CANDIDATE_VIDEO_MODELS) {
      if (exclude.has(candidate.toLowerCase())) continue;
      const match = discovered.find((d) => d.toLowerCase() === candidate.toLowerCase());
      if (match) {
        selected = match;
        break;
      }
    }
    if (!selected) {
      selected = discovered.find((d) => !exclude.has(d.toLowerCase())) || '';
    }
  }

  if (!selected) {
    selected =
      CANDIDATE_VIDEO_MODELS.find((c) => !exclude.has(c.toLowerCase())) ||
      PREFERRED_GEMINI_VIDEO_MODEL;
  }

  verifiedModelCache.set(keyHash, {
    resolvedModel: selected,
    availableModels: discovered,
    verifiedAt: Date.now(),
  });

  return { model: selected, availableModels: discovered };
}

export async function validateGeminiApiKey(apiKey: string): Promise<{ model: string }> {
  const { model } = await resolveVerifiedVideoModel(apiKey, { forceRefresh: true });
  const ai = createAiClient(apiKey);

  try {
    await withTimeout(
      ai.models.generateContent({
        model,
        contents: 'Respond with OK.',
        config: supportsThinkingLevel(model)
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : undefined,
      }),
      20000,
      'validateGeminiApiKey',
      model
    );
    return { model };
  } catch (err: any) {
    const classified = classifyGeminiError(err, 'validateGeminiApiKey', model, apiKey);
    if (classified.errorCode === 'MODEL_UNAVAILABLE') {
      // Retry validation with next discovered candidate if primary failed
      const fallback = await resolveVerifiedVideoModel(apiKey, {
        forceRefresh: true,
        excludeModels: [model],
      });
      if (fallback.model !== model) {
        try {
          await withTimeout(
            ai.models.generateContent({
              model: fallback.model,
              contents: 'Respond with OK.',
              config: supportsThinkingLevel(fallback.model)
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                : undefined,
            }),
            20000,
            'validateGeminiApiKeyFallback',
            fallback.model
          );
          return { model: fallback.model };
        } catch (fallbackErr: any) {
          throw classifyGeminiError(fallbackErr, 'validateGeminiApiKeyFallback', fallback.model, apiKey);
        }
      }
    }
    throw classified;
  }
}

export async function deleteRemoteGeminiFile(uploadId: string, apiKey: string) {
  const key = `${uploadId}:${hashCredential(apiKey)}`;
  const record = activeGeminiFiles.get(key);
  if (!record) return;
  if (record.cleanupTimer) clearTimeout(record.cleanupTimer);
  activeGeminiFiles.delete(key);

  try {
    const ai = createAiClient(apiKey);
    await ai.files.delete({ name: record.geminiFileName });
  } catch {
    // Ignore remote expiration/cleanup errors
  }
}

async function waitForGeminiFileActive(
  ai: GoogleGenAI,
  fileName: string,
  model: string,
  apiKey: string
) {
  const maxPolls = 45; // Up to ~3 minutes total
  for (let poll = 0; poll < maxPolls; poll++) {
    let fileInfo: any;
    try {
      fileInfo = await withTimeout(
        ai.files.get({ name: fileName }),
        15000,
        'files.get',
        model
      );
    } catch (err: any) {
      const classified = classifyGeminiError(err, 'files.get', model, apiKey);
      if (classified.retryable && poll < maxPolls - 1) {
        await sleep(3000);
        continue;
      }
      throw classified;
    }

    const state = String(fileInfo?.state || '').toUpperCase();
    if (state === 'ACTIVE') {
      if (!fileInfo?.uri) {
        throw new GeminiServiceError({
          message: 'Video processing failed: Gemini did not provide an active file URI.',
          httpStatus: 422,
          errorCode: 'VIDEO_PROCESSING_FAILED',
          retryable: false,
          model,
          apiErrorCode: 'MISSING_FILE_URI',
        });
      }
      return fileInfo;
    }

    if (state === 'FAILED') {
      const reason = redactSecrets(
        String(fileInfo?.error?.message || 'Gemini could not decode this video file.'),
        [apiKey]
      );
      logGeminiError({
        stage: 'files.get:FAILED',
        model,
        httpStatus: 422,
        apiErrorCode: String(fileInfo?.error?.code || 'FILE_STATE_FAILED'),
        errorCode: 'VIDEO_PROCESSING_FAILED',
        rawMessage: reason,
        apiKey,
      });
      throw new GeminiServiceError({
        message: `Video processing failed: ${reason}`,
        httpStatus: 422,
        errorCode: 'VIDEO_PROCESSING_FAILED',
        retryable: false,
        model,
        apiErrorCode: 'FILE_STATE_FAILED',
      });
    }

    await sleep(poll < 5 ? 2000 : 4000);
  }

  throw new GeminiServiceError({
    message: 'Request timed out waiting for Gemini to process the video. Retry without re-uploading.',
    httpStatus: 504,
    errorCode: 'TIMEOUT',
    retryable: true,
    model,
    apiErrorCode: 'FILE_POLL_TIMEOUT',
  });
}

function parseStrictTitleJson(rawText: string, model: string): {
  title: string;
  alternatives: string[];
  content_summary: string;
} {
  const cleaned = (rawText || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!cleaned) {
    throw new GeminiServiceError({
      message: 'Gemini returned an empty response for this video. Retry without re-uploading.',
      httpStatus: 502,
      errorCode: 'EMPTY_RESPONSE',
      retryable: true,
      model,
      apiErrorCode: 'EMPTY_TEXT',
    });
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new GeminiServiceError({
      message: 'Gemini returned an incomplete response. Retry analysis without re-uploading.',
      httpStatus: 502,
      errorCode: 'EMPTY_RESPONSE',
      retryable: true,
      model,
      apiErrorCode: 'INVALID_JSON',
    });
  }

  const title = typeof parsed?.title === 'string' ? parsed.title.trim() : '';
  const summary =
    typeof parsed?.content_summary === 'string' ? parsed.content_summary.trim() : '';
  const altsRaw = Array.isArray(parsed?.alternatives) ? parsed.alternatives : [];
  const alternatives = altsRaw
    .map((a: unknown) => (typeof a === 'string' ? a.trim() : ''))
    .filter((a: string) => a.length > 0 && a !== title)
    .slice(0, 2);

  if (!title) {
    throw new GeminiServiceError({
      message: 'Gemini did not return a title for this video. Retry analysis without re-uploading.',
      httpStatus: 502,
      errorCode: 'EMPTY_RESPONSE',
      retryable: true,
      model,
      apiErrorCode: 'MISSING_TITLE',
    });
  }

  return {
    title,
    alternatives,
    content_summary: summary || 'Summary grounded in uploaded video content.',
  };
}

async function uploadToGeminiFilesWithRetry(params: {
  ai: GoogleGenAI;
  apiKey: string;
  uploadId: string;
  filePath: string;
  mimeType: string;
  originalName: string;
  contentHash: string;
  model: string;
}): Promise<UploadedFileRecord> {
  const { ai, apiKey, uploadId, filePath, mimeType, originalName, contentHash, model } = params;

  if (!fs.existsSync(filePath)) {
    throw new GeminiServiceError({
      message: 'Video upload session expired. Please re-select the video file.',
      httpStatus: 404,
      errorCode: 'VIDEO_EXPIRED',
      retryable: false,
      model,
    });
  }

  const stats = fs.statSync(filePath);
  if (stats.size <= 0) {
    throw new GeminiServiceError({
      message: 'Video format unsupported: Uploaded file is empty (0 bytes).',
      httpStatus: 415,
      errorCode: 'UNSUPPORTED_VIDEO_FORMAT',
      retryable: false,
      model,
    });
  }

  let uploaded: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      uploaded = await withTimeout(
        ai.files.upload({
          file: filePath,
          config: {
            mimeType,
            displayName: originalName,
          },
        }),
        60000,
        'files.upload',
        model
      );
      break;
    } catch (err: any) {
      const classified = classifyGeminiError(err, 'files.upload', model, apiKey);
      if (!classified.retryable || attempt === 2) {
        throw classified;
      }
      const backoffMs = 1200 * Math.pow(2, attempt) + Math.round(Math.random() * 300);
      await sleep(backoffMs);
    }
  }

  if (!uploaded?.name) {
    throw new GeminiServiceError({
      message: 'Video processing failed: Gemini Files API did not return a file handle.',
      httpStatus: 502,
      errorCode: 'TRANSIENT_ERROR',
      retryable: true,
      model,
      apiErrorCode: 'NO_FILE_NAME',
    });
  }

  const activeFile = await waitForGeminiFileActive(ai, uploaded.name, model, apiKey);
  const cleanupTimer = setTimeout(() => {
    deleteRemoteGeminiFile(uploadId, apiKey);
  }, FILE_RETENTION_MS);

  const record: UploadedFileRecord = {
    geminiFileName: activeFile.name || uploaded.name,
    geminiFileUri: activeFile.uri || uploaded.uri || '',
    mimeType: activeFile.mimeType || mimeType,
    contentHash,
    apiKeyHash: hashCredential(apiKey),
    expiresAt: Date.now() + FILE_RETENTION_MS,
    cleanupTimer,
  };

  activeGeminiFiles.set(`${uploadId}:${record.apiKeyHash}`, record);
  return record;
}

export async function analyzeVideoWithGemini(params: {
  apiKey: string;
  uploadId: string;
  filePath?: string;
  mimeType: string;
  originalName: string;
  contentHash: string;
  regenerate?: boolean;
}): Promise<VideoTitleResult> {
  const { apiKey, uploadId, filePath, mimeType, originalName, contentHash, regenerate } = params;

  const validatedMime = normalizeVideoMimeType(mimeType, originalName);
  if (!validatedMime) {
    throw new GeminiServiceError({
      message: 'Video format unsupported. Upload a valid MP4, MOV, WebM, MPEG, AVI, or 3GP file.',
      httpStatus: 415,
      errorCode: 'UNSUPPORTED_VIDEO_FORMAT',
      retryable: false,
      model: PREFERRED_GEMINI_VIDEO_MODEL,
      apiErrorCode: 'INVALID_MIME',
    });
  }

  let { model } = await resolveVerifiedVideoModel(apiKey);
  const apiKeyHash = hashCredential(apiKey);
  const cacheKey = `${contentHash}:${PROMPT_VERSION}:${model}`;

  if (!regenerate) {
    const cached = titleResultCache.get(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  const ai = createAiClient(apiKey);
  const fileCacheKey = `${uploadId}:${apiKeyHash}`;
  let fileRecord = activeGeminiFiles.get(fileCacheKey);

  // Check if existing remote Gemini file record is still valid
  if (fileRecord && Date.now() < fileRecord.expiresAt) {
    try {
      const check = await withTimeout(
        ai.files.get({ name: fileRecord.geminiFileName }),
        10000,
        'files.get:verifyCached',
        model
      );
      if (String(check?.state || '').toUpperCase() !== 'ACTIVE' || !check?.uri) {
        activeGeminiFiles.delete(fileCacheKey);
        fileRecord = undefined;
      } else {
        fileRecord.geminiFileUri = check.uri;
      }
    } catch {
      activeGeminiFiles.delete(fileCacheKey);
      fileRecord = undefined;
    }
  } else {
    fileRecord = undefined;
  }

  if (!fileRecord) {
    if (!filePath) {
      throw new GeminiServiceError({
        message: 'Video session expired. Please re-select the video file.',
        httpStatus: 404,
        errorCode: 'VIDEO_EXPIRED',
        retryable: false,
        model,
      });
    }
    fileRecord = await uploadToGeminiFilesWithRetry({
      ai,
      apiKey,
      uploadId,
      filePath,
      mimeType: validatedMime,
      originalName,
      contentHash,
      model,
    });
  }

  const promptText = regenerate
    ? `${FIXED_TITLE_PROMPT}\n\nProvide a fresh primary title angle while staying strictly accurate to the video.`
    : FIXED_TITLE_PROMPT;

  const triedModels = new Set<string>([model.toLowerCase()]);

  // Exponential backoff ONLY for transient errors / quota / timeout / empty output
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const config: Record<string, any> = {
        systemInstruction:
          'Respond strictly with concise valid JSON matching the requested schema. Do not include markdown fences or commentary.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            alternatives: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            content_summary: { type: Type.STRING },
          },
          required: ['title', 'alternatives', 'content_summary'],
        },
      };

      if (supportsThinkingLevel(model)) {
        config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
      }

      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: createUserContent([
            createPartFromUri(fileRecord.geminiFileUri, fileRecord.mimeType),
            promptText,
          ]),
          config,
        }),
        ANALYSIS_TIMEOUT_MS,
        'models.generateContent',
        model
      );

      if (!response?.text || !response.text.trim()) {
        const finishReason = response?.candidates?.[0]?.finishReason || 'UNKNOWN';
        logGeminiError({
          stage: 'models.generateContent:empty',
          model,
          httpStatus: 502,
          apiErrorCode: String(finishReason),
          errorCode: 'EMPTY_RESPONSE',
          rawMessage: `Model returned empty text (finishReason=${finishReason})`,
          apiKey,
        });
        throw new GeminiServiceError({
          message: `Gemini returned an empty response (${finishReason}). Retry without re-uploading.`,
          httpStatus: 502,
          errorCode: 'EMPTY_RESPONSE',
          retryable: true,
          model,
          apiErrorCode: String(finishReason),
        });
      }

      const structured = parseStrictTitleJson(response.text, model);
      const result: VideoTitleResult = {
        ...structured,
        model,
        cached: false,
      };
      // Cache ONLY verified non-empty successes
      titleResultCache.set(`${contentHash}:${PROMPT_VERSION}:${model}`, result);
      return result;
    } catch (err: any) {
      const classified = classifyGeminiError(err, `generateContent:attempt_${attempt + 1}`, model, apiKey);

      // If the selected model is unavailable for this API key, dynamically fall back to another verified video model once
      if (classified.errorCode === 'MODEL_UNAVAILABLE') {
        const fallback = await resolveVerifiedVideoModel(apiKey, {
          forceRefresh: true,
          excludeModels: Array.from(triedModels),
        });
        if (!triedModels.has(fallback.model.toLowerCase())) {
          triedModels.add(fallback.model.toLowerCase());
          model = fallback.model;
          continue;
        }
      }

      // If remote Gemini file URI expired mid-request, re-upload from local disk once
      if (classified.errorCode === 'VIDEO_EXPIRED' && filePath && fs.existsSync(filePath) && attempt < 2) {
        activeGeminiFiles.delete(fileCacheKey);
        fileRecord = await uploadToGeminiFilesWithRetry({
          ai,
          apiKey,
          uploadId,
          filePath,
          mimeType: validatedMime,
          originalName,
          contentHash,
          model,
        });
        continue;
      }

      if (!classified.retryable || attempt === 2) {
        throw classified;
      }

      const backoffMs = 1200 * Math.pow(2, attempt) + Math.round(Math.random() * 350);
      await sleep(backoffMs);
    }
  }

  throw new GeminiServiceError({
    message: 'Gemini analysis failed after retries. Please retry.',
    httpStatus: 503,
    errorCode: 'TRANSIENT_ERROR',
    retryable: true,
    model,
  });
}
