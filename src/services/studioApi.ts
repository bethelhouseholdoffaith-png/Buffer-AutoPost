import {
  BufferChannel,
  BufferRateLimitInfo,
  KeyStatus,
  PlatformPostOptions,
} from '../types';

export type RuntimeMode = 'backend' | 'static';

const STORAGE_BACKEND_URL = 'autobuffer_backend_url';
const STORAGE_STATIC_BUFFER_KEY = 'autobuffer_ghp_buffer_key';
const STORAGE_STATIC_GEMINI_KEY = 'autobuffer_ghp_gemini_key';
const STORAGE_STATIC_CHANNELS = 'autobuffer_ghp_channels';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com';
const BUFFER_GRAPHQL_URL = 'https://api.buffer.com';

const CANDIDATE_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-4-neon',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
];

const NON_VIDEO_MODEL_PATTERNS = [
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

const ALLOWED_VIDEO_MIMES = new Set([
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

interface StaticMediaSession {
  uploadId: string;
  file: File;
  objectUrl: string;
  mimeType: string;
  contentHash: string;
  geminiFileName?: string;
  geminiFileUri?: string;
  expiresAt?: number;
}

interface StaticTitleResult {
  title: string;
  alternatives: string[];
  content_summary: string;
  model: string;
  cached?: boolean;
}

const staticMediaSessions = new Map<string, StaticMediaSession>();
const staticTitleCache = new Map<string, StaticTitleResult>();
let staticResolvedModelCache: { apiKey: string; model: string; ts: number } | null = null;

let currentRuntimeMode: RuntimeMode = 'static';
let currentApiBase = '';

export function getSavedBackendUrl(): string {
  try {
    return (localStorage.getItem(STORAGE_BACKEND_URL) || '').trim().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function getRuntimeInfo(): { mode: RuntimeMode; backendUrl: string } {
  return {
    mode: currentRuntimeMode,
    backendUrl: currentApiBase || getSavedBackendUrl(),
  };
}

function apiUrl(path: string): string {
  const base = currentApiBase || '';
  return `${base}${path}`;
}

export function createDefaultStaticChannels(): BufferChannel[] {
  const defaultSchedule = [
    { day: 'mon', rawDay: 'monday', paused: false, times: ['09:00', '17:00'] },
    { day: 'tue', rawDay: 'tuesday', paused: false, times: ['10:00'] },
    { day: 'wed', rawDay: 'wednesday', paused: false, times: ['09:00', '17:00'] },
    { day: 'thu', rawDay: 'thursday', paused: false, times: ['10:00'] },
    { day: 'fri', rawDay: 'friday', paused: false, times: ['09:00', '17:00'] },
    { day: 'sat', rawDay: 'saturday', paused: true, times: ['11:00'] },
    { day: 'sun', rawDay: 'sunday', paused: true, times: ['11:00'] },
  ];

  return [
    {
      id: 'local-yt',
      name: 'YouTube Shorts',
      handle: '@channel',
      service: 'youtube',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      isQueuePaused: false,
      postingSchedule: defaultSchedule,
      schedules: defaultSchedule.map((d) => ({ days: [d.day], times: d.times, paused: d.paused })),
      postingGoal: 7,
    },
    {
      id: 'local-ig',
      name: 'Instagram Reels',
      handle: '@channel',
      service: 'instagram',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      isQueuePaused: false,
      postingSchedule: defaultSchedule,
      schedules: defaultSchedule.map((d) => ({ days: [d.day], times: d.times, paused: d.paused })),
      postingGoal: 7,
    },
  ];
}

function normalizeStaticMimeType(file: File): string | null {
  const raw = (file.type || '').split(';')[0].trim().toLowerCase();
  if (raw === 'video/x-m4v') return 'video/mp4';
  if (raw && ALLOWED_VIDEO_MIMES.has(raw)) return raw;
  const extMatch = file.name.toLowerCase().match(/\.[^.]+$/);
  const ext = extMatch ? extMatch[0] : '';
  if ((!raw || raw === 'application/octet-stream' || raw.startsWith('video/')) && EXT_TO_VIDEO_MIME[ext]) {
    return EXT_TO_VIDEO_MIME[ext];
  }
  return null;
}

async function computeBrowserFileHash(file: File): Promise<string> {
  try {
    const sampleSize = Math.min(file.size, 2 * 1024 * 1024);
    const slice = file.slice(0, sampleSize);
    const buf = await slice.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `${hex}-${file.size}`;
  } catch {
    return `${file.name}-${file.size}-${file.lastModified}`;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function probeHealth(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      credentials: baseUrl ? 'include' : 'same-origin',
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return false;
    const data = await res.json();
    return data?.status === 'ok';
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function initRuntimeAndKeyStatus(): Promise<{
  mode: RuntimeMode;
  backendUrl: string;
  keyStatus: KeyStatus;
}> {
  const savedCustomBackend = getSavedBackendUrl();

  // 1. Check same-origin backend first (works on localhost, Cloud Run, Render, etc.)
  if (await probeHealth('')) {
    currentRuntimeMode = 'backend';
    currentApiBase = '';
    const res = await fetch(apiUrl('/api/keys/status'), { credentials: 'include' });
    const data = await res.json();
    return {
      mode: 'backend',
      backendUrl: '',
      keyStatus: {
        hasBufferKey: Boolean(data.hasBufferKey),
        hasGeminiKey: Boolean(data.hasGeminiKey),
      },
    };
  }

  // 2. Check optional user-configured Backend Server URL (for GitHub Pages + remote backend proxy)
  if (savedCustomBackend && (await probeHealth(savedCustomBackend))) {
    currentRuntimeMode = 'backend';
    currentApiBase = savedCustomBackend;
    const res = await fetch(apiUrl('/api/keys/status'), { credentials: 'include' });
    const data = await res.json();
    return {
      mode: 'backend',
      backendUrl: savedCustomBackend,
      keyStatus: {
        hasBufferKey: Boolean(data.hasBufferKey),
        hasGeminiKey: Boolean(data.hasGeminiKey),
      },
    };
  }

  // 3. Pure static browser mode (GitHub Pages tab with zero backend server)
  currentRuntimeMode = 'static';
  currentApiBase = '';
  const hasBufferKey = Boolean(localStorage.getItem(STORAGE_STATIC_BUFFER_KEY));
  const hasGeminiKey = Boolean(localStorage.getItem(STORAGE_STATIC_GEMINI_KEY));
  return {
    mode: 'static',
    backendUrl: savedCustomBackend,
    keyStatus: { hasBufferKey, hasGeminiKey },
  };
}

export async function testAndSaveBackendUrl(
  rawUrl: string
): Promise<{ success: boolean; mode: RuntimeMode; error?: string }> {
  const cleaned = rawUrl.trim().replace(/\/$/, '');
  if (!cleaned) {
    localStorage.removeItem(STORAGE_BACKEND_URL);
    const recheck = await initRuntimeAndKeyStatus();
    return { success: true, mode: recheck.mode };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(cleaned);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { success: false, mode: currentRuntimeMode, error: 'URL must start with https:// or http://' };
    }
  } catch {
    return { success: false, mode: currentRuntimeMode, error: 'Enter a valid server URL.' };
  }

  const normalized = parsedUrl.toString().replace(/\/$/, '');
  const ok = await probeHealth(normalized);
  if (!ok) {
    return {
      success: false,
      mode: currentRuntimeMode,
      error: 'Could not reach /api/health at that URL. Ensure the server is running and allows this GitHub Pages origin.',
    };
  }

  localStorage.setItem(STORAGE_BACKEND_URL, normalized);
  currentRuntimeMode = 'backend';
  currentApiBase = normalized;
  return { success: true, mode: 'backend' };
}

// ==========================================
// Buffer API Adapter (Backend Proxy OR Static Browser)
// ==========================================

function normalizeDayName(day: string): string {
  const clean = (day || '').trim().toLowerCase();
  if (clean.startsWith('sun')) return 'sun';
  if (clean.startsWith('mon')) return 'mon';
  if (clean.startsWith('tue')) return 'tue';
  if (clean.startsWith('wed')) return 'wed';
  if (clean.startsWith('thu')) return 'thu';
  if (clean.startsWith('fri')) return 'fri';
  if (clean.startsWith('sat')) return 'sat';
  return clean.slice(0, 3);
}

async function fetchBufferGraphQLDirect(token: string): Promise<BufferChannel[]> {
  const orgRes = await fetch(BUFFER_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: `query GetAccountOrganizations { account { organizations { id name } } }`,
    }),
  });

  const orgJson = await orgRes.json();
  if (!orgRes.ok || orgJson?.errors?.length) {
    const msg = orgJson?.errors?.[0]?.message || `HTTP ${orgRes.status}`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = orgRes.status;
    throw err;
  }

  const orgs = Array.isArray(orgJson?.data?.account?.organizations)
    ? orgJson.data.account.organizations
    : [];

  const channels: BufferChannel[] = [];
  for (const org of orgs) {
    const chRes = await fetch(BUFFER_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `query GetChannelPostingSlots($organizationId: OrganizationId!) {
          channels(input: { organizationId: $organizationId }) {
            id name displayName descriptor avatar service timezone isQueuePaused
            postingGoal { goal }
            postingSchedule { day paused times }
          }
        }`,
        variables: { organizationId: org.id },
      }),
    });
    const chJson = await chRes.json();
    for (const ch of chJson?.data?.channels || []) {
      const isQueuePaused = Boolean(ch.isQueuePaused);
      const days = (ch.postingSchedule || []).map((entry: any) => ({
        day: normalizeDayName(entry.day || ''),
        rawDay: String(entry.day || ''),
        paused: Boolean(entry.paused),
        times: Array.isArray(entry.times) ? entry.times.filter(Boolean) : [],
      }));
      const rawHandle = String(ch.descriptor || ch.displayName || ch.name || 'channel').trim();
      const handle = rawHandle.startsWith('@')
        ? rawHandle
        : `@${rawHandle.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'channel'}`;

      channels.push({
        id: ch.id,
        name: ch.name || ch.displayName || 'Channel',
        displayName: ch.displayName,
        handle,
        avatar: ch.avatar,
        service: String(ch.service || 'social').toLowerCase(),
        timezone: ch.timezone || 'UTC',
        isQueuePaused,
        organizationId: org.id,
        organizationName: org.name,
        postingSchedule: days,
        schedules: days
          .filter((d: any) => d.times.length > 0)
          .map((d: any) => ({ days: [d.day], times: d.times, paused: d.paused || isQueuePaused })),
        postingGoal:
          typeof ch.postingGoal?.goal === 'number' && ch.postingGoal.goal > 0
            ? ch.postingGoal.goal
            : days.reduce((s: number, d: any) => s + (d.paused ? 0 : d.times.length), 0) || 5,
      });
    }
  }
  return channels;
}

export async function connectBufferKey(token: string): Promise<{
  success: boolean;
  channels?: BufferChannel[];
  rateLimit?: BufferRateLimitInfo;
  corsBlocked?: boolean;
  error?: string;
}> {
  const cleaned = token.trim().replace(/^bearer\s+/i, '');

  if (currentRuntimeMode === 'backend') {
    const res = await fetch(apiUrl('/api/keys/buffer'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'AutoBuffer',
      },
      body: JSON.stringify({ token: cleaned }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Buffer key could not be verified.' };
    }
    return {
      success: true,
      channels: data.channels || [],
      rateLimit: data.rateLimit,
    };
  }

  // Static GitHub Pages mode: try direct GraphQL; detect CORS gracefully
  try {
    const channels = await fetchBufferGraphQLDirect(cleaned);
    localStorage.setItem(STORAGE_STATIC_BUFFER_KEY, cleaned);
    localStorage.setItem(STORAGE_STATIC_CHANNELS, JSON.stringify(channels));
    return { success: true, channels };
  } catch (err: any) {
    const msg = String(err?.message || '');
    const isCorsOrNetwork =
      err instanceof TypeError || /failed to fetch|network|cors/i.test(msg);

    if (isCorsOrNetwork) {
      return {
        success: false,
        corsBlocked: true,
        error:
          'Buffer’s API blocks direct browser requests from static GitHub Pages tabs (CORS). Connect a Studio Backend URL or continue with local GitHub Pages channel slots.',
      };
    }
    return {
      success: false,
      error: 'Buffer key could not be verified. Check the key and try again.',
    };
  }
}

export function acceptStaticBufferMode(token?: string): BufferChannel[] {
  const cleaned = (token || '').trim().replace(/^bearer\s+/i, '') || 'static-pages-mode';
  localStorage.setItem(STORAGE_STATIC_BUFFER_KEY, cleaned);
  let channels: BufferChannel[] = [];
  try {
    const saved = localStorage.getItem(STORAGE_STATIC_CHANNELS);
    if (saved) channels = JSON.parse(saved);
  } catch {
    // ignore
  }
  if (!Array.isArray(channels) || channels.length === 0) {
    channels = createDefaultStaticChannels();
    localStorage.setItem(STORAGE_STATIC_CHANNELS, JSON.stringify(channels));
  }
  return channels;
}

export async function loadBufferBootstrap(forceRefresh = false): Promise<{
  success: boolean;
  unauthorized?: boolean;
  channels: BufferChannel[];
  rateLimit?: BufferRateLimitInfo;
  error?: string;
}> {
  if (currentRuntimeMode === 'backend') {
    const path = forceRefresh ? '/api/buffer/channels?refresh=true' : '/api/buffer/bootstrap';
    const res = await fetch(apiUrl(path), { credentials: 'include' });
    const data = await res.json();
    if (res.status === 401) {
      return { success: false, unauthorized: true, channels: [] };
    }
    if (!res.ok || !data.success) {
      return { success: false, channels: [], error: data.error };
    }
    return {
      success: true,
      channels: data.channels || [],
      rateLimit: data.rateLimit,
    };
  }

  // Static GitHub Pages mode
  const token = localStorage.getItem(STORAGE_STATIC_BUFFER_KEY) || '';
  if (!token) return { success: false, unauthorized: true, channels: [] };

  if (token !== 'static-pages-mode') {
    try {
      const channels = await fetchBufferGraphQLDirect(token);
      localStorage.setItem(STORAGE_STATIC_CHANNELS, JSON.stringify(channels));
      return { success: true, channels };
    } catch {
      // Fall back cleanly to saved static channels
    }
  }

  try {
    const saved = localStorage.getItem(STORAGE_STATIC_CHANNELS);
    const parsed = saved ? JSON.parse(saved) : [];
    if (Array.isArray(parsed) && parsed.length > 0) {
      return { success: true, channels: parsed };
    }
  } catch {
    // ignore
  }
  const defaults = createDefaultStaticChannels();
  localStorage.setItem(STORAGE_STATIC_CHANNELS, JSON.stringify(defaults));
  return { success: true, channels: defaults };
}

// ==========================================
// Gemini API Adapter (Backend Proxy OR Direct Static Browser REST + Resumable Files API)
// ==========================================

async function resolveStaticGeminiModel(apiKey: string, exclude: string[] = []): Promise<string> {
  const excludeSet = new Set(exclude.map((m) => m.toLowerCase()));
  if (
    staticResolvedModelCache &&
    staticResolvedModelCache.apiKey === apiKey &&
    Date.now() - staticResolvedModelCache.ts < 60 * 60 * 1000 &&
    !excludeSet.has(staticResolvedModelCache.model.toLowerCase())
  ) {
    return staticResolvedModelCache.model;
  }

  const res = await fetch(`${GEMINI_API_BASE}/v1beta/models?pageSize=50`, {
    headers: { 'x-goog-api-key': apiKey },
  });

  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw Object.assign(new Error('Invalid API key. Check your Gemini API key and try again.'), {
      status: 401,
      errorCode: 'INVALID_API_KEY',
      retryable: false,
    });
  }

  const discovered: string[] = [];
  if (res.ok) {
    const json = await res.json();
    for (const m of json?.models || []) {
      const name = String(m?.name || '').replace(/^models\//, '').trim();
      const lower = name.toLowerCase();
      if (!lower.includes('gemini')) continue;
      if (NON_VIDEO_MODEL_PATTERNS.some((p) => lower.includes(p))) continue;
      const methods: string[] = m?.supportedGenerationMethods || [];
      if (methods.length > 0 && !methods.some((x) => x.toLowerCase() === 'generatecontent')) {
        continue;
      }
      discovered.push(name);
    }
  }

  let selected = '';
  for (const cand of CANDIDATE_MODELS) {
    if (excludeSet.has(cand.toLowerCase())) continue;
    const hit = discovered.find((d) => d.toLowerCase() === cand.toLowerCase());
    if (hit) {
      selected = hit;
      break;
    }
  }
  if (!selected) {
    selected =
      discovered.find((d) => !excludeSet.has(d.toLowerCase())) ||
      CANDIDATE_MODELS.find((c) => !excludeSet.has(c.toLowerCase())) ||
      'gemini-4-hydrogen';
  }

  staticResolvedModelCache = { apiKey, model: selected, ts: Date.now() };
  return selected;
}

export async function connectGeminiKey(apiKey: string): Promise<{
  success: boolean;
  model?: string;
  error?: string;
}> {
  const cleaned = apiKey.trim();

  if (currentRuntimeMode === 'backend') {
    const res = await fetch(apiUrl('/api/keys/gemini'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'AutoBuffer',
      },
      body: JSON.stringify({ apiKey: cleaned }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Gemini key could not be verified.' };
    }
    return { success: true, model: data.model };
  }

  // Static GitHub Pages mode: verify directly with Google Gemini API (CORS allowed!)
  try {
    const model = await resolveStaticGeminiModel(cleaned);
    const body: any = {
      contents: [{ role: 'user', parts: [{ text: 'Respond with OK.' }] }],
    };
    if (/^gemini-(3|4)/i.test(model)) {
      body.generationConfig = { thinkingConfig: { thinkingLevel: 'LOW' } };
    }

    const res = await fetch(
      `${GEMINI_API_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cleaned,
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData?.error?.message || `HTTP ${res.status}`;
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { success: false, error: 'Invalid API key. Check your Gemini API key and try again.' };
      }
      return { success: false, error: `Gemini validation error: ${msg}` };
    }

    localStorage.setItem(STORAGE_STATIC_GEMINI_KEY, cleaned);
    return { success: true, model };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Could not reach Gemini API. Check your network and try again.',
    };
  }
}

export async function clearIntegrationKey(
  target: 'buffer' | 'gemini' | 'all'
): Promise<KeyStatus> {
  if (currentRuntimeMode === 'backend') {
    const res = await fetch(apiUrl('/api/keys/clear'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'AutoBuffer',
      },
      body: JSON.stringify({ target }),
    });
    const data = await res.json();
    return {
      hasBufferKey: Boolean(data.hasBufferKey),
      hasGeminiKey: Boolean(data.hasGeminiKey),
    };
  }

  if (target === 'buffer' || target === 'all') {
    localStorage.removeItem(STORAGE_STATIC_BUFFER_KEY);
    localStorage.removeItem(STORAGE_STATIC_CHANNELS);
  }
  if (target === 'gemini' || target === 'all') {
    localStorage.removeItem(STORAGE_STATIC_GEMINI_KEY);
    staticResolvedModelCache = null;
  }

  return {
    hasBufferKey: Boolean(localStorage.getItem(STORAGE_STATIC_BUFFER_KEY)),
    hasGeminiKey: Boolean(localStorage.getItem(STORAGE_STATIC_GEMINI_KEY)),
  };
}

// ==========================================
// Static Browser Video Upload & Gemini Files API Analysis
// ==========================================

async function uploadFileToGeminiResumable(
  file: File,
  mimeType: string,
  apiKey: string,
  onProgress: (pct: number) => void
): Promise<{ name: string; uri: string; mimeType: string; state: string }> {
  // Step 1: Start resumable session
  const startRes = await fetch(`${GEMINI_API_BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(file.size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: file.name } }),
  });

  if (!startRes.ok) {
    const errJson = await startRes.json().catch(() => ({}));
    const msg = errJson?.error?.message || `Upload start failed (HTTP ${startRes.status})`;
    if (startRes.status === 401 || startRes.status === 403 || startRes.status === 400) {
      throw Object.assign(new Error(msg), { status: startRes.status });
    }
    throw new Error(msg);
  }

  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new Error('Gemini Files API did not return a resumable upload URL.');
  }

  // Step 2: Stream file bytes with XHR for smooth live progress
  const uploadedFile: any = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl, true);
    xhr.setRequestHeader('X-Goog-Upload-Offset', '0');
    xhr.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize');

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText || '{}');
          resolve(parsed.file || parsed);
        } catch {
          reject(new Error('Unreadable upload response from Gemini Files API.'));
        }
      } else {
        reject(new Error(`Gemini file upload failed (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error uploading video to Gemini.'));
    xhr.send(file);
  });

  return uploadedFile;
}

async function waitStaticFileActive(
  fileName: string,
  apiKey: string
): Promise<{ name: string; uri: string; mimeType: string }> {
  for (let i = 0; i < 45; i++) {
    const res = await fetch(`${GEMINI_API_BASE}/v1beta/${fileName}`, {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (res.ok) {
      const info = await res.json();
      const state = String(info?.state || '').toUpperCase();
      if (state === 'ACTIVE' && info?.uri) {
        return { name: info.name, uri: info.uri, mimeType: info.mimeType || 'video/mp4' };
      }
      if (state === 'FAILED') {
        throw Object.assign(
          new Error(
            `Video processing failed: ${info?.error?.message || 'Gemini could not decode this clip.'}`
          ),
          { errorCode: 'VIDEO_PROCESSING_FAILED', status: 422, retryable: false }
        );
      }
    }
    await sleep(i < 5 ? 2000 : 4000);
  }
  throw Object.assign(
    new Error('Request timed out waiting for Gemini to process the video. Retry without re-uploading.'),
    { errorCode: 'TIMEOUT', status: 504, retryable: true }
  );
}

async function runStaticGeminiGenerate(
  session: StaticMediaSession,
  apiKey: string,
  regenerate: boolean,
  onPhaseChange: (phase: 'processing' | 'analyzing' | 'generating') => void,
  onProgress?: (pct: number) => void
): Promise<StaticTitleResult & { uploadId: string; publicVideoUrl: string }> {
  let model = await resolveStaticGeminiModel(apiKey);
  const cacheKey = `${session.contentHash}:${model}`;

  if (!regenerate) {
    const cached = staticTitleCache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        cached: true,
        uploadId: session.uploadId,
        publicVideoUrl: session.objectUrl,
      };
    }
  }

  if (!session.geminiFileUri || !session.expiresAt || Date.now() >= session.expiresAt) {
    const uploaded = await uploadFileToGeminiResumable(
      session.file,
      session.mimeType,
      apiKey,
      onProgress || (() => {})
    );
    onPhaseChange('processing');
    const active =
      String(uploaded.state || '').toUpperCase() === 'ACTIVE' && uploaded.uri
        ? uploaded
        : await waitStaticFileActive(uploaded.name, apiKey);

    session.geminiFileName = active.name;
    session.geminiFileUri = active.uri;
    session.mimeType = active.mimeType || session.mimeType;
    session.expiresAt = Date.now() + 15 * 60 * 1000;
  }

  onPhaseChange('analyzing');
  const promptText = regenerate
    ? `${FIXED_TITLE_PROMPT}\n\nProvide a fresh primary title angle while staying strictly accurate to the video.`
    : FIXED_TITLE_PROMPT;

  const triedModels = new Set<string>([model.toLowerCase()]);

  for (let attempt = 0; attempt < 3; attempt++) {
    onPhaseChange(attempt === 0 ? 'analyzing' : 'generating');

    const generationConfig: any = {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          alternatives: { type: 'ARRAY', items: { type: 'STRING' } },
          content_summary: { type: 'STRING' },
        },
        required: ['title', 'alternatives', 'content_summary'],
      },
    };
    if (/^gemini-(3|4)/i.test(model)) {
      generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
    }

    const res = await fetch(
      `${GEMINI_API_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: 'Respond strictly with concise valid JSON matching the requested schema.',
              },
            ],
          },
          contents: [
            {
              role: 'user',
              parts: [
                { file_data: { mime_type: session.mimeType, file_uri: session.geminiFileUri } },
                { text: promptText },
              ],
            },
          ],
          generationConfig,
        }),
      }
    );

    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error('Invalid API key. Check your Gemini API key in Settings.'), {
        errorCode: 'INVALID_API_KEY',
        status: 401,
        retryable: false,
      });
    }

    if (res.status === 404) {
      const nextModel = await resolveStaticGeminiModel(apiKey, Array.from(triedModels));
      if (!triedModels.has(nextModel.toLowerCase())) {
        triedModels.add(nextModel.toLowerCase());
        model = nextModel;
        continue;
      }
      throw Object.assign(
        new Error(`Model unavailable: "${model}" is not available for this API key.`),
        { errorCode: 'MODEL_UNAVAILABLE', status: 404, retryable: false }
      );
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt < 2) {
        await sleep(1200 * Math.pow(2, attempt));
        continue;
      }
      throw Object.assign(
        new Error(
          res.status === 429
            ? 'API quota exceeded: Gemini rate limit reached. Wait a moment and retry.'
            : 'Gemini service is temporarily busy. Retry analysis without re-uploading.'
        ),
        {
          errorCode: res.status === 429 ? 'QUOTA_EXCEEDED' : 'TRANSIENT_ERROR',
          status: res.status,
          retryable: true,
        }
      );
    }

    const json = await res.json();
    const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!rawText.trim()) {
      if (attempt < 2) {
        await sleep(1200 * Math.pow(2, attempt));
        continue;
      }
      throw Object.assign(
        new Error('Gemini returned an empty response. Retry analysis without re-uploading.'),
        { errorCode: 'EMPTY_RESPONSE', status: 502, retryable: true }
      );
    }

    onPhaseChange('generating');
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    const title = String(parsed?.title || '').trim();
    const alternatives = Array.isArray(parsed?.alternatives)
      ? parsed.alternatives.map((a: any) => String(a || '').trim()).filter((a: string) => a && a !== title).slice(0, 2)
      : [];
    const content_summary =
      String(parsed?.content_summary || '').trim() || 'Summary grounded in uploaded video content.';

    if (!title) {
      throw Object.assign(new Error('Gemini did not return a title. Retry analysis.'), {
        errorCode: 'EMPTY_RESPONSE',
        status: 502,
        retryable: true,
      });
    }

    const result: StaticTitleResult = { title, alternatives, content_summary, model, cached: false };
    staticTitleCache.set(`${session.contentHash}:${model}`, result);
    return { ...result, uploadId: session.uploadId, publicVideoUrl: session.objectUrl };
  }

  throw Object.assign(new Error('Gemini analysis failed after retries.'), {
    errorCode: 'TRANSIENT_ERROR',
    status: 503,
    retryable: true,
  });
}

export interface VideoAnalysisResponse {
  success: boolean;
  uploadId?: string;
  publicVideoUrl?: string;
  title?: string;
  alternatives?: string[];
  content_summary?: string;
  model?: string;
  requiresGeminiKey?: boolean;
  errorCode?: string;
  error?: string;
}

export function uploadAndAnalyzeVideo(params: {
  file: File;
  hasGeminiKey: boolean;
  onUploadProgress: (pct: number) => void;
  onPhaseChange: (phase: 'uploading' | 'processing' | 'analyzing' | 'generating') => void;
  registerXhr?: (xhr: XMLHttpRequest | null) => void;
}): Promise<VideoAnalysisResponse> {
  const { file, hasGeminiKey, onUploadProgress, onPhaseChange, registerXhr } = params;

  if (currentRuntimeMode === 'backend') {
    return new Promise((resolve) => {
      const formData = new FormData();
      formData.append('video', file);
      const endpoint = hasGeminiKey
        ? apiUrl('/api/gemini/analyze-video')
        : apiUrl('/api/videos/upload');

      const xhr = new XMLHttpRequest();
      registerXhr?.(xhr);
      xhr.open('POST', endpoint, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-Requested-With', 'AutoBuffer');

      let t1: number | undefined;
      let t2: number | undefined;

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && evt.total > 0) {
          const pct = Math.round((evt.loaded / evt.total) * 100);
          onUploadProgress(pct);
          if (pct >= 100 && hasGeminiKey) {
            onPhaseChange('processing');
          }
        }
      };

      xhr.upload.onload = () => {
        onUploadProgress(100);
        if (hasGeminiKey) {
          onPhaseChange('processing');
          t1 = window.setTimeout(() => onPhaseChange('analyzing'), 2200);
          t2 = window.setTimeout(() => onPhaseChange('generating'), 6500);
        }
      };

      xhr.onload = () => {
        if (t1) window.clearTimeout(t1);
        if (t2) window.clearTimeout(t2);
        registerXhr?.(null);
        try {
          const data = JSON.parse(xhr.responseText || '{}');
          resolve(data);
        } catch {
          resolve({
            success: false,
            errorCode: 'TRANSIENT_ERROR',
            error: `Server returned an unexpected response (HTTP ${xhr.status}). Please retry.`,
          });
        }
      };

      xhr.onerror = () => {
        if (t1) window.clearTimeout(t1);
        if (t2) window.clearTimeout(t2);
        registerXhr?.(null);
        resolve({
          success: false,
          errorCode: 'TRANSIENT_ERROR',
          error: 'Network connection interrupted while uploading the video. Please try again.',
        });
      };

      xhr.send(formData);
    });
  }

  // Static GitHub Pages mode: direct browser -> Gemini Files API
  return (async () => {
    const normalizedMime = normalizeStaticMimeType(file);
    if (!normalizedMime || file.size <= 0) {
      return {
        success: false,
        errorCode: 'UNSUPPORTED_VIDEO_FORMAT',
        error:
          'Video format unsupported. Upload a valid MP4, MOV, WebM, MPEG, AVI, or 3GP video.',
      };
    }

    const uploadId = `ghp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const objectUrl = URL.createObjectURL(file);
    const contentHash = await computeBrowserFileHash(file);
    const session: StaticMediaSession = {
      uploadId,
      file,
      objectUrl,
      mimeType: normalizedMime,
      contentHash,
    };
    staticMediaSessions.set(uploadId, session);

    const apiKey = localStorage.getItem(STORAGE_STATIC_GEMINI_KEY) || '';
    if (!apiKey) {
      onUploadProgress(100);
      return {
        success: true,
        uploadId,
        publicVideoUrl: objectUrl,
        requiresGeminiKey: true,
      };
    }

    try {
      const result = await runStaticGeminiGenerate(
        session,
        apiKey,
        false,
        onPhaseChange,
        onUploadProgress
      );
      return { success: true, ...result };
    } catch (err: any) {
      return {
        success: false,
        uploadId,
        publicVideoUrl: objectUrl,
        requiresGeminiKey: err?.errorCode === 'INVALID_API_KEY',
        errorCode: err?.errorCode || 'UNKNOWN_ERROR',
        error: err?.message || 'Gemini failed to analyze this video. Please retry.',
      };
    }
  })();
}

export async function analyzeExistingVideo(params: {
  uploadId: string;
  regenerate: boolean;
  onPhaseChange: (phase: 'processing' | 'analyzing' | 'generating') => void;
}): Promise<VideoAnalysisResponse> {
  const { uploadId, regenerate, onPhaseChange } = params;

  if (currentRuntimeMode === 'backend') {
    onPhaseChange('processing');
    const t1 = window.setTimeout(() => onPhaseChange('analyzing'), 2000);
    const t2 = window.setTimeout(() => onPhaseChange('generating'), 6000);
    try {
      const res = await fetch(apiUrl('/api/gemini/analyze-video'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'AutoBuffer',
        },
        body: JSON.stringify({ uploadId, regenerate }),
      });
      return await res.json();
    } finally {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    }
  }

  const session = staticMediaSessions.get(uploadId);
  if (!session) {
    return {
      success: false,
      errorCode: 'VIDEO_EXPIRED',
      error: 'Video session expired. Please re-select the video file.',
    };
  }
  const apiKey = localStorage.getItem(STORAGE_STATIC_GEMINI_KEY) || '';
  if (!apiKey) {
    return {
      success: false,
      requiresGeminiKey: true,
      errorCode: 'INVALID_API_KEY',
      error: 'Gemini API key is not connected.',
    };
  }

  try {
    const result = await runStaticGeminiGenerate(session, apiKey, regenerate, onPhaseChange);
    return { success: true, ...result };
  } catch (err: any) {
    return {
      success: false,
      uploadId,
      publicVideoUrl: session.objectUrl,
      requiresGeminiKey: err?.errorCode === 'INVALID_API_KEY',
      errorCode: err?.errorCode || 'UNKNOWN_ERROR',
      error: err?.message || 'Gemini failed to analyze this video. Please retry.',
    };
  }
}

// ==========================================
// Buffer Scheduling, Editing, Deleting
// ==========================================

export async function scheduleBufferPosts(payload: {
  channelIds: string[];
  channelServices: Record<string, string>;
  text: string;
  uploadId: string;
  thumbnailOffset: number;
  schedulingType: 'automatic' | 'custom';
  dueAt?: string;
  platformOptions: PlatformPostOptions;
}): Promise<{
  success: boolean;
  results?: Array<{ channelId: string; success: boolean; post?: { id: string } }>;
  rateLimit?: BufferRateLimitInfo;
  localOnlyStatic?: boolean;
  error?: string;
}> {
  if (currentRuntimeMode === 'backend') {
    const res = await fetch(apiUrl('/api/buffer/posts'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'AutoBuffer',
      },
      body: JSON.stringify(payload),
    });
    return await res.json();
  }

  // Static GitHub Pages mode: schedules smoothly to local calendar (remote Buffer ingestion requires a hosted backend URL for public media hosting + CORS)
  return {
    success: true,
    localOnlyStatic: true,
    results: payload.channelIds.map((channelId) => ({
      channelId,
      success: true,
      post: { id: `local-${channelId}-${Date.now()}` },
    })),
  };
}

export async function updateBufferPostRemote(
  postId: string,
  updates: { text: string; dueAt: string }
): Promise<{ success: boolean; error?: string; rateLimit?: BufferRateLimitInfo }> {
  if (currentRuntimeMode === 'backend') {
    const res = await fetch(apiUrl(`/api/buffer/posts/${encodeURIComponent(postId)}`), {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'AutoBuffer',
      },
      body: JSON.stringify(updates),
    });
    return await res.json();
  }
  return { success: true };
}

export async function deleteBufferPostRemote(
  postId: string
): Promise<{ success: boolean; rateLimit?: BufferRateLimitInfo }> {
  if (currentRuntimeMode === 'backend') {
    const res = await fetch(apiUrl(`/api/buffer/posts/${encodeURIComponent(postId)}`), {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'X-Requested-With': 'AutoBuffer' },
    });
    return await res.json();
  }
  return { success: true };
}
