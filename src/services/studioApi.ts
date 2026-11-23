import {
  AdminAuditLog,
  AdminStats,
  AdminUserSummary,
  AuthSnapshot,
  AuthUser,
  BufferChannel,
  BufferRateLimitInfo,
  CloudScheduledPost,
  KeyStatus,
  PlatformPostOptions,
  SessionInfo,
  UserPreferences,
} from '../types';

export type RuntimeMode = 'backend' | 'unconfigured';

const STORAGE_BACKEND_URL = 'autobuffer_backend_url';
const ENV_API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');

let currentRuntimeMode: RuntimeMode = 'unconfigured';
let currentApiBase = '';

export function scrubLegacyBrowserSecrets(): void {
  const keysToRemove = [
    'autobuffer_ghp_buffer_key',
    'autobuffer_ghp_gemini_key',
    'autobuffer_ghp_channels',
    'autobuffer_scheduled_posts',
    'buffer_api_key',
    'buffer_saved_channels',
    'autobuffer_api_usage',
    'autobuffer_settings',
  ];
  for (const key of keysToRemove) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore storage access issues
    }
  }
}

export function getSavedBackendUrl(): string {
  try {
    return (localStorage.getItem(STORAGE_BACKEND_URL) || '').trim().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function getRuntimeInfo(): { mode: RuntimeMode; backendUrl: string; hasEnvBackend: boolean } {
  return {
    mode: currentRuntimeMode,
    backendUrl: currentApiBase || getSavedBackendUrl() || ENV_API_BASE,
    hasEnvBackend: Boolean(ENV_API_BASE),
  };
}

function apiUrl(path: string): string {
  return `${currentApiBase}${path}`;
}

async function probeHealth(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 3000);
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

export async function resolveStudioBackend(): Promise<{
  connected: boolean;
  mode: RuntimeMode;
  backendUrl: string;
}> {
  // 1. Same-origin API (local dev server or unified full-stack deployment)
  if (await probeHealth('')) {
    currentRuntimeMode = 'backend';
    currentApiBase = '';
    return { connected: true, mode: 'backend', backendUrl: '' };
  }

  // 2. Build-time configured backend (GitHub Pages VITE_API_BASE_URL)
  if (ENV_API_BASE && (await probeHealth(ENV_API_BASE))) {
    currentRuntimeMode = 'backend';
    currentApiBase = ENV_API_BASE;
    return { connected: true, mode: 'backend', backendUrl: ENV_API_BASE };
  }

  // 3. Optional user-specified HTTPS backend URL
  const saved = getSavedBackendUrl();
  if (saved && (await probeHealth(saved))) {
    currentRuntimeMode = 'backend';
    currentApiBase = saved;
    return { connected: true, mode: 'backend', backendUrl: saved };
  }

  currentRuntimeMode = 'unconfigured';
  currentApiBase = saved || ENV_API_BASE || '';
  return { connected: false, mode: 'unconfigured', backendUrl: currentApiBase };
}

export async function testAndSaveBackendUrl(
  rawUrl: string
): Promise<{ success: boolean; mode: RuntimeMode; error?: string }> {
  const cleaned = rawUrl.trim().replace(/\/$/, '');
  if (!cleaned) {
    try {
      localStorage.removeItem(STORAGE_BACKEND_URL);
    } catch {
      // ignore
    }
    const probe = await resolveStudioBackend();
    return { success: probe.connected, mode: probe.mode };
  }

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        success: false,
        mode: currentRuntimeMode,
        error: 'Backend URL must start with https:// or http://',
      };
    }
  } catch {
    return { success: false, mode: currentRuntimeMode, error: 'Enter a valid server URL.' };
  }

  const normalized = parsed.toString().replace(/\/$/, '');
  const ok = await probeHealth(normalized);
  if (!ok) {
    return {
      success: false,
      mode: currentRuntimeMode,
      error:
        'Could not reach /api/health at that URL. Verify the backend is running and allows this origin in ALLOWED_CORS_ORIGINS.',
    };
  }

  try {
    localStorage.setItem(STORAGE_BACKEND_URL, normalized);
  } catch {
    // ignore
  }
  currentRuntimeMode = 'backend';
  currentApiBase = normalized;
  return { success: true, mode: 'backend' };
}

async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T & { success?: boolean; error?: string; errorCode?: string; status?: number }> {
  const method = (options.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-Requested-With'] = 'AutoBuffer';
    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const res = await fetch(apiUrl(path), {
    ...options,
    method,
    credentials: 'include',
    headers,
  });

  const data = await res.json().catch(() => ({}));
  return {
    ...data,
    status: res.status,
    success: typeof data.success === 'boolean' ? data.success : res.ok,
  };
}

// ==========================================
// Authentication & Session APIs
// ==========================================

export async function fetchCurrentSession(): Promise<AuthSnapshot & { backendReachable: boolean }> {
  const backend = await resolveStudioBackend();
  if (!backend.connected) {
    return { backendReachable: false, authenticated: false };
  }

  try {
    const data = await apiFetch<AuthSnapshot>('/api/auth/me');
    return {
      backendReachable: true,
      authenticated: Boolean(data.authenticated),
      needsAdminBootstrap: Boolean(data.needsAdminBootstrap),
      isNewUser: Boolean(data.isNewUser),
      user: data.user,
      preferences: data.preferences,
      keyStatus: data.keyStatus,
      channels: data.channels,
      scheduledPosts: data.scheduledPosts,
    };
  } catch {
    return { backendReachable: false, authenticated: false };
  }
}

export async function loginWithEmail(
  email: string,
  password: string
): Promise<AuthSnapshot & { success: boolean; error?: string; errorCode?: string }> {
  const data = await apiFetch<AuthSnapshot>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return {
    ...data,
    success: Boolean(data.success),
    authenticated: Boolean(data.success && data.user),
  };
}

export async function registerAccount(
  displayName: string,
  email: string,
  password: string
): Promise<AuthSnapshot & { success: boolean; error?: string }> {
  const data = await apiFetch<AuthSnapshot>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ displayName, email, password }),
  });
  return {
    ...data,
    success: Boolean(data.success),
    authenticated: Boolean(data.success && data.user),
  };
}

export async function bootstrapFirstAdmin(
  displayName: string,
  email: string,
  password: string
): Promise<AuthSnapshot & { success: boolean; error?: string }> {
  const data = await apiFetch<AuthSnapshot>('/api/auth/bootstrap-admin', {
    method: 'POST',
    body: JSON.stringify({ displayName, email, password }),
  });
  return {
    ...data,
    success: Boolean(data.success),
    authenticated: Boolean(data.success && data.user),
  };
}

export async function logoutSession(): Promise<void> {
  await apiFetch('/api/auth/logout', { method: 'POST', body: '{}' });
}

export async function markWelcomeAnimationSeen(): Promise<void> {
  await apiFetch('/api/auth/welcome-seen', { method: 'POST', body: '{}' }).catch(() => {});
}

export async function requestPasswordReset(email: string): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  const data = await apiFetch<{ message?: string }>('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  return {
    success: Boolean(data.success),
    message: data.message,
    error: data.error,
  };
}

export async function completePasswordReset(
  token: string,
  newPassword: string
): Promise<AuthSnapshot & { success: boolean; error?: string }> {
  const data = await apiFetch<AuthSnapshot>('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
  return {
    ...data,
    success: Boolean(data.success),
    authenticated: Boolean(data.success && data.user),
  };
}

// ==========================================
// Account Settings, Sessions & Cloud Sync
// ==========================================

export async function updateAccountProfile(payload: {
  displayName?: string;
  email?: string;
  currentPassword?: string;
}): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  const data = await apiFetch<{ user?: AuthUser }>('/api/account/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return { success: Boolean(data.success), user: data.user, error: data.error };
}

export async function changeAccountPassword(
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const data = await apiFetch('/api/account/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  return { success: Boolean(data.success), error: data.error };
}

export async function listActiveSessions(): Promise<{
  success: boolean;
  sessions: SessionInfo[];
  error?: string;
}> {
  const data = await apiFetch<{ sessions?: SessionInfo[] }>('/api/account/sessions');
  return {
    success: Boolean(data.success),
    sessions: data.sessions || [],
    error: data.error,
  };
}

export async function revokeActiveSession(sessionId: string): Promise<{ success: boolean }> {
  const data = await apiFetch(`/api/account/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
  return { success: Boolean(data.success) };
}

export async function saveCloudPreferences(
  prefs: Partial<UserPreferences>
): Promise<{ success: boolean; preferences?: UserPreferences }> {
  const data = await apiFetch<{ preferences?: UserPreferences }>('/api/account/preferences', {
    method: 'PUT',
    body: JSON.stringify(prefs),
  });
  return { success: Boolean(data.success), preferences: data.preferences };
}

export async function removeSavedChannel(channelId: string): Promise<{
  success: boolean;
  channels?: BufferChannel[];
  error?: string;
}> {
  const data = await apiFetch<{ channels?: BufferChannel[] }>(
    `/api/account/channels/${encodeURIComponent(channelId)}`,
    { method: 'DELETE' }
  );
  return {
    success: Boolean(data.success),
    channels: data.channels,
    error: data.error,
  };
}

export async function createCloudPost(
  post: CloudScheduledPost
): Promise<{ success: boolean; post?: CloudScheduledPost; error?: string }> {
  const data = await apiFetch<{ post?: CloudScheduledPost }>('/api/posts', {
    method: 'POST',
    body: JSON.stringify(post),
  });
  return { success: Boolean(data.success), post: data.post, error: data.error };
}

export async function updateCloudPost(
  postId: string,
  updates: Partial<CloudScheduledPost>
): Promise<{ success: boolean; post?: CloudScheduledPost; error?: string }> {
  const data = await apiFetch<{ post?: CloudScheduledPost }>(
    `/api/posts/${encodeURIComponent(postId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }
  );
  return { success: Boolean(data.success), post: data.post, error: data.error };
}

export async function deleteCloudPost(postId: string): Promise<{ success: boolean }> {
  const data = await apiFetch(`/api/posts/${encodeURIComponent(postId)}`, {
    method: 'DELETE',
  });
  return { success: Boolean(data.success) };
}

// ==========================================
// Per-User Encrypted Buffer & Gemini Keys
// ==========================================

export async function connectBufferKey(token: string): Promise<{
  success: boolean;
  channels?: BufferChannel[];
  rateLimit?: BufferRateLimitInfo;
  error?: string;
}> {
  const cleaned = token.trim().replace(/^bearer\s+/i, '');
  const data = await apiFetch<{
    channels?: BufferChannel[];
    rateLimit?: BufferRateLimitInfo;
  }>('/api/keys/buffer', {
    method: 'POST',
    body: JSON.stringify({ token: cleaned }),
  });
  if (!data.success) {
    return { success: false, error: data.error || 'Buffer key could not be verified.' };
  }
  return {
    success: true,
    channels: data.channels || [],
    rateLimit: data.rateLimit,
  };
}

export async function loadBufferBootstrap(forceRefresh = false): Promise<{
  success: boolean;
  unauthorized?: boolean;
  channels: BufferChannel[];
  rateLimit?: BufferRateLimitInfo;
  error?: string;
}> {
  const path = forceRefresh ? '/api/buffer/channels?refresh=true' : '/api/buffer/bootstrap';
  const data = await apiFetch<{
    channels?: BufferChannel[];
    rateLimit?: BufferRateLimitInfo;
  }>(path);
  if (data.status === 401) {
    return { success: false, unauthorized: true, channels: [] };
  }
  if (!data.success) {
    return { success: false, channels: [], error: data.error };
  }
  return {
    success: true,
    channels: data.channels || [],
    rateLimit: data.rateLimit,
  };
}

export async function connectGeminiKey(apiKey: string): Promise<{
  success: boolean;
  model?: string;
  error?: string;
}> {
  const data = await apiFetch<{ model?: string }>('/api/keys/gemini', {
    method: 'POST',
    body: JSON.stringify({ apiKey: apiKey.trim() }),
  });
  if (!data.success) {
    return { success: false, error: data.error || 'Gemini key could not be verified.' };
  }
  return { success: true, model: data.model };
}

export async function clearIntegrationKey(
  target: 'buffer' | 'gemini' | 'all'
): Promise<KeyStatus> {
  const data = await apiFetch<KeyStatus>('/api/keys/clear', {
    method: 'POST',
    body: JSON.stringify({ target }),
  });
  return {
    hasBufferKey: Boolean(data.hasBufferKey),
    hasGeminiKey: Boolean(data.hasGeminiKey),
  };
}

// ==========================================
// Video Upload & Gemini Files API Analysis
// ==========================================

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

export async function analyzeExistingVideo(params: {
  uploadId: string;
  regenerate: boolean;
  onPhaseChange: (phase: 'processing' | 'analyzing' | 'generating') => void;
}): Promise<VideoAnalysisResponse> {
  const { uploadId, regenerate, onPhaseChange } = params;

  onPhaseChange('processing');
  const t1 = window.setTimeout(() => onPhaseChange('analyzing'), 2000);
  const t2 = window.setTimeout(() => onPhaseChange('generating'), 6000);
  try {
    return await apiFetch<VideoAnalysisResponse>('/api/gemini/analyze-video', {
      method: 'POST',
      body: JSON.stringify({ uploadId, regenerate }),
    });
  } finally {
    window.clearTimeout(t1);
    window.clearTimeout(t2);
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
  return await apiFetch('/api/buffer/posts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateBufferPostRemote(
  postId: string,
  updates: { text: string; dueAt: string }
): Promise<{ success: boolean; error?: string; rateLimit?: BufferRateLimitInfo }> {
  return await apiFetch(`/api/buffer/posts/${encodeURIComponent(postId)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteBufferPostRemote(
  postId: string
): Promise<{ success: boolean; rateLimit?: BufferRateLimitInfo }> {
  return await apiFetch(`/api/buffer/posts/${encodeURIComponent(postId)}`, {
    method: 'DELETE',
  });
}

// ==========================================
// Admin Console APIs (Strictly Verified Server-Side)
// ==========================================

export async function fetchAdminOverview(): Promise<{
  success: boolean;
  stats?: AdminStats;
  auditLogs?: AdminAuditLog[];
  error?: string;
  status?: number;
}> {
  return await apiFetch('/api/admin/overview');
}

export async function fetchAdminUsers(params?: {
  q?: string;
  status?: 'all' | 'active' | 'suspended' | 'admin';
}): Promise<{
  success: boolean;
  users?: AdminUserSummary[];
  error?: string;
  status?: number;
}> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.status) qs.set('status', params.status);
  const query = qs.toString();
  return await apiFetch(`/api/admin/users${query ? `?${query}` : ''}`);
}

export async function adminSuspendUser(
  userId: string
): Promise<{ success: boolean; revokedSessions?: number; error?: string }> {
  return await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/suspend`, {
    method: 'POST',
    body: '{}',
  });
}

export async function adminReactivateUser(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  return await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/reactivate`, {
    method: 'POST',
    body: '{}',
  });
}

export async function adminUpdateUserRole(
  userId: string,
  role: 'admin' | 'user'
): Promise<{ success: boolean; role?: 'admin' | 'user'; error?: string }> {
  return await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: 'POST',
    body: JSON.stringify({ role }),
  });
}

export async function adminRevokeUserSessions(
  userId: string
): Promise<{ success: boolean; revokedCount?: number; error?: string }> {
  return await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, {
    method: 'POST',
    body: '{}',
  });
}

export async function adminIssueResetLink(
  userId: string
): Promise<{ success: boolean; resetUrl?: string; token?: string; error?: string }> {
  return await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/reset-link`, {
    method: 'POST',
    body: '{}',
  });
}

export async function adminDeleteUser(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  return await apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}
