import { hashCredential, redactSecrets } from './cookies.js';

const BUFFER_GRAPHQL_URL = 'https://api.buffer.com';
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes per-session cache
const SCHEMA_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours schema introspection cache

export const GET_ACCOUNT_ORGANIZATIONS_QUERY = `
  query GetAccountOrganizations {
    account {
      organizations {
        id
        name
      }
    }
  }
`;

export const GET_ORGANIZATION_CHANNELS_QUERY = `
  query GetChannelPostingSlots($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id
      name
      displayName
      descriptor
      avatar
      service
      timezone
      isQueuePaused
      postingGoal {
        goal
      }
      postingSchedule {
        day
        paused
        times
      }
    }
  }
`;

export interface NormalizedPostingScheduleDay {
  day: string; // mon..sun
  rawDay: string;
  paused: boolean;
  times: string[];
}

export interface NormalizedBufferChannel {
  id: string;
  name: string;
  displayName?: string;
  handle: string;
  avatar?: string;
  service: string;
  timezone: string;
  isQueuePaused: boolean;
  organizationId: string;
  organizationName: string;
  postingSchedule: NormalizedPostingScheduleDay[];
  schedules: Array<{ days: string[]; times: string[]; paused: boolean }>;
  postingGoal: number;
}

export interface BufferRateLimitSnapshot {
  limit15m?: number;
  remaining15m?: number;
  limitDaily?: number;
  remainingDaily?: number;
  limitMonthly?: number;
  remainingMonthly?: number;
  resetSeconds?: number;
  retryAfterSeconds?: number;
  rawPolicy?: string;
  rawRateLimit?: string;
}

interface SessionCacheEntry {
  fetchedAt: number;
  organizations: Array<{ id: string; name: string }>;
  channels: NormalizedBufferChannel[];
  rateLimit: BufferRateLimitSnapshot;
}

interface SchemaCacheEntry {
  fetchedAt: number;
  createPostInputFields: Set<string>;
  mutationFields: Set<string>;
}

const sessionCache = new Map<string, SessionCacheEntry>();
const inFlightBootstrap = new Map<string, Promise<SessionCacheEntry>>();
const rateLimitedUntil = new Map<string, number>();
const schemaCache = new Map<string, SchemaCacheEntry>();
const inFlightMutations = new Set<string>();
const lastRateLimits = new Map<string, BufferRateLimitSnapshot>();

function normalizeDay(day: string): string {
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

function deriveCleanHandle(ch: any): string {
  const raw = String(ch.descriptor || ch.displayName || '').trim();
  if (raw.startsWith('@') && raw.length > 1) return raw;
  if (raw && !raw.includes(' ')) return `@${raw.replace(/^@+/, '')}`;
  const slug = String(ch.name || ch.service || 'channel')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '') || 'channel';
  return `@${slug}`;
}

function parseRateLimitHeaders(headers: Headers, prev?: BufferRateLimitSnapshot): BufferRateLimitSnapshot {
  const snapshot: BufferRateLimitSnapshot = { ...(prev || {}) };

  const policy = headers.get('ratelimit-policy') || headers.get('x-ratelimit-policy');
  const rateLimit = headers.get('ratelimit') || headers.get('x-ratelimit');
  const retryAfter = headers.get('retry-after');
  const rem = headers.get('x-ratelimit-remaining');
  const lim = headers.get('x-ratelimit-limit');

  if (policy) snapshot.rawPolicy = policy;
  if (rateLimit) snapshot.rawRateLimit = rateLimit;

  if (rem && !isNaN(Number(rem))) {
    snapshot.remaining15m = Number(rem);
  }
  if (lim && !isNaN(Number(lim))) {
    snapshot.limit15m = Number(lim);
  }

  if (rateLimit) {
    const remMatch = rateLimit.match(/r(?:emaining)?=(\d+)/i);
    const resetMatch = rateLimit.match(/(?:t|reset)=(\d+)/i);
    if (remMatch) snapshot.remaining15m = Number(remMatch[1]);
    if (resetMatch) snapshot.resetSeconds = Number(resetMatch[1]);
  }
  if (policy) {
    const qMatches = Array.from(policy.matchAll(/q=(\d+)[^;]*;\s*w=(\d+)/gi));
    for (const m of qMatches) {
      const quota = Number(m[1]);
      const windowSec = Number(m[2]);
      if (windowSec <= 1200) snapshot.limit15m = quota;
      else if (windowSec <= 90000) snapshot.limitDaily = quota;
      else snapshot.limitMonthly = quota;
    }
  }

  if (retryAfter) {
    const secs = Number(retryAfter);
    snapshot.retryAfterSeconds = isNaN(secs) ? 60 : Math.max(1, secs);
  }

  return snapshot;
}

async function executeBufferGraphQL(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<{ data: any; rateLimit: BufferRateLimitSnapshot }> {
  const tokenHash = hashCredential(token);
  const blockedUntil = rateLimitedUntil.get(tokenHash);
  if (blockedUntil && Date.now() < blockedUntil) {
    const waitSec = Math.ceil((blockedUntil - Date.now()) / 1000);
    const err = new Error(
      `Buffer is temporarily rate-limiting requests. Try again in ${waitSec} seconds.`
    ) as Error & { statusCode?: number; retryAfterSeconds?: number };
    err.statusCode = 429;
    err.retryAfterSeconds = waitSec;
    throw err;
  }

  const response = await fetch(BUFFER_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });

  const parsedLimits = parseRateLimitHeaders(response.headers, lastRateLimits.get(tokenHash));
  lastRateLimits.set(tokenHash, parsedLimits);

  if (response.status === 429) {
    const waitSec = parsedLimits.retryAfterSeconds || 60;
    rateLimitedUntil.set(tokenHash, Date.now() + waitSec * 1000);
    const err = new Error(
      `Buffer is temporarily rate-limiting requests. Try again in ${waitSec} seconds.`
    ) as Error & { statusCode?: number; retryAfterSeconds?: number };
    err.statusCode = 429;
    err.retryAfterSeconds = waitSec;
    throw err;
  }

  let json: any = null;
  try {
    json = await response.json();
  } catch {
    const err = new Error('Buffer API returned an unreadable response.') as Error & {
      statusCode?: number;
    };
    err.statusCode = response.status >= 400 ? response.status : 502;
    throw err;
  }

  if (!response.ok || (Array.isArray(json?.errors) && json.errors.length > 0)) {
    const firstErr = json?.errors?.[0];
    const extCode = String(firstErr?.extensions?.code || '').toUpperCase();
    const rawMsg =
      firstErr?.message ||
      json?.message ||
      `Buffer request failed (HTTP ${response.status}).`;
    const safeMsg = redactSecrets(String(rawMsg), [token]);
    const isAuthError =
      response.status === 401 ||
      response.status === 403 ||
      extCode === 'UNAUTHENTICATED' ||
      extCode === 'FORBIDDEN' ||
      /access token|unauthorized|unauthenticated/i.test(safeMsg);

    const err = new Error(safeMsg) as Error & { statusCode?: number };
    err.statusCode = isAuthError ? 401 : response.status >= 400 ? response.status : 400;
    throw err;
  }

  return { data: json.data, rateLimit: parsedLimits };
}

export function invalidateBufferSessionCache(token?: string) {
  if (!token) {
    sessionCache.clear();
    return;
  }
  const tokenHash = hashCredential(token);
  sessionCache.delete(tokenHash);
}

export function getStoredRateLimit(token: string): BufferRateLimitSnapshot {
  return lastRateLimits.get(hashCredential(token)) || {};
}

export async function fetchBufferBootstrap(
  token: string,
  options: { forceRefresh?: boolean } = {}
): Promise<SessionCacheEntry> {
  const tokenHash = hashCredential(token);

  if (!options.forceRefresh) {
    const cached = sessionCache.get(tokenHash);
    if (cached && Date.now() - cached.fetchedAt < SESSION_CACHE_TTL_MS) {
      return cached;
    }
  }

  const existingFlight = inFlightBootstrap.get(tokenHash);
  if (existingFlight) {
    return existingFlight;
  }

  const requestPromise = (async () => {
    try {
      const orgResp = await executeBufferGraphQL(token, GET_ACCOUNT_ORGANIZATIONS_QUERY);
      let latestRateLimit = orgResp.rateLimit;

      const rawOrgs = Array.isArray(orgResp.data?.account?.organizations)
        ? orgResp.data.account.organizations
        : [];

      const organizations: Array<{ id: string; name: string }> = [];
      const channels: NormalizedBufferChannel[] = [];

      for (const org of rawOrgs) {
        if (!org?.id) continue;
        organizations.push({ id: org.id, name: org.name || 'Workspace' });

        const chResp = await executeBufferGraphQL(token, GET_ORGANIZATION_CHANNELS_QUERY, {
          organizationId: org.id,
        });
        latestRateLimit = chResp.rateLimit;

        const rawChannels = Array.isArray(chResp.data?.channels) ? chResp.data.channels : [];
        for (const ch of rawChannels) {
          const isQueuePaused = Boolean(ch.isQueuePaused);
          const rawSchedule = Array.isArray(ch.postingSchedule) ? ch.postingSchedule : [];
          const normalizedDays: NormalizedPostingScheduleDay[] = rawSchedule.map((entry: any) => ({
            day: normalizeDay(entry.day || ''),
            rawDay: String(entry.day || ''),
            paused: Boolean(entry.paused),
            times: Array.isArray(entry.times) ? entry.times.filter(Boolean) : [],
          }));

          const legacySchedules = normalizedDays
            .filter((d) => d.times.length > 0)
            .map((d) => ({
              days: [d.day],
              times: d.times,
              paused: d.paused || isQueuePaused,
            }));

          const activeWeeklyGoal = normalizedDays.reduce((sum, d) => {
            if (d.paused || isQueuePaused) return sum;
            return sum + d.times.length;
          }, 0);
          const totalSlotCount = normalizedDays.reduce((sum, d) => sum + d.times.length, 0);
          const goalNumber =
            typeof ch.postingGoal?.goal === 'number' && ch.postingGoal.goal > 0
              ? ch.postingGoal.goal
              : activeWeeklyGoal > 0
              ? activeWeeklyGoal
              : totalSlotCount || 5;

          channels.push({
            id: ch.id,
            name: ch.name || ch.displayName || 'Channel',
            displayName: ch.displayName || ch.name,
            handle: deriveCleanHandle(ch),
            avatar: ch.avatar || undefined,
            service: String(ch.service || 'social').toLowerCase(),
            timezone: ch.timezone || 'UTC',
            isQueuePaused,
            organizationId: org.id,
            organizationName: org.name || 'Workspace',
            postingSchedule: normalizedDays,
            schedules: legacySchedules,
            postingGoal: goalNumber,
          });
        }
      }

      const entry: SessionCacheEntry = {
        fetchedAt: Date.now(),
        organizations,
        channels,
        rateLimit: latestRateLimit,
      };
      sessionCache.set(tokenHash, entry);
      return entry;
    } finally {
      inFlightBootstrap.delete(tokenHash);
    }
  })();

  inFlightBootstrap.set(tokenHash, requestPromise);
  return requestPromise;
}

async function getSchemaCapabilities(token: string): Promise<SchemaCacheEntry> {
  const tokenHash = hashCredential(token);
  const existing = schemaCache.get(tokenHash);
  if (existing && Date.now() - existing.fetchedAt < SCHEMA_CACHE_TTL_MS) {
    return existing;
  }

  const createPostInputFields = new Set<string>([
    'channelId',
    'text',
    'schedulingType',
    'mode',
    'dueAt',
    'assets',
    'needsApproval',
    'metadata',
  ]);
  const mutationFields = new Set<string>(['createPost', 'deletePost', 'editPost']);

  try {
    const query = `
      query InspectBufferMutations {
        postInput: __type(name: "CreatePostInput") {
          inputFields { name }
        }
        mutationType: __schema {
          mutationType {
            fields { name }
          }
        }
      }
    `;
    const { data } = await executeBufferGraphQL(token, query);
    if (Array.isArray(data?.postInput?.inputFields)) {
      createPostInputFields.clear();
      for (const f of data.postInput.inputFields) {
        createPostInputFields.add(f.name);
      }
    }
    if (Array.isArray(data?.mutationType?.fields)) {
      mutationFields.clear();
      for (const f of data.mutationType.fields) {
        mutationFields.add(f.name);
      }
    }
  } catch {
    // Use safe schema-verified defaults if introspection fails
  }

  const entry: SchemaCacheEntry = {
    fetchedAt: Date.now(),
    createPostInputFields,
    mutationFields,
  };
  schemaCache.set(tokenHash, entry);
  return entry;
}

export interface CreateBufferPostParams {
  token: string;
  channelIds: string[];
  channelServices: Record<string, string>;
  text: string;
  videoUrl: string;
  thumbnailOffset?: number;
  schedulingType?: 'automatic' | 'custom';
  dueAt?: string;
  platformOptions?: any;
}

export async function createBufferGraphQLPosts(params: CreateBufferPostParams) {
  const {
    token,
    channelIds,
    channelServices,
    text,
    videoUrl,
    thumbnailOffset = 1500,
    schedulingType = 'automatic',
    dueAt,
    platformOptions = {},
  } = params;

  const tokenHash = hashCredential(token);
  const lockKey = `${tokenHash}:${channelIds.join(',')}:${text.trim().slice(0, 48)}:${dueAt || schedulingType}`;

  if (inFlightMutations.has(lockKey)) {
    const err = new Error(
      'This post is already being submitted to Buffer. Please wait a moment.'
    ) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  inFlightMutations.add(lockKey);
  try {
    const { createPostInputFields } = await getSchemaCapabilities(token);
    const isCustom = schedulingType === 'custom' && Boolean(dueAt);

    const createPostMutation = `
      mutation CreateQueueVideoPost($input: CreatePostInput!) {
        createPost(input: $input) {
          ... on PostActionSuccess {
            post {
              id
              text
              dueAt
              status
            }
          }
          ... on MutationError {
            message
          }
        }
      }
    `;

    const results: Array<{
      channelId: string;
      success: boolean;
      post?: { id: string; text: string; dueAt?: string; status?: string };
      error?: string;
    }> = [];

    for (const channelId of channelIds) {
      const service = (channelServices[channelId] || '').toLowerCase();
      const postInput: Record<string, any> = {
        channelId,
        text: text.trim(),
        schedulingType: 'automatic',
        mode: isCustom ? 'customScheduled' : 'addToQueue',
        needsApproval: false,
        assets: [
          {
            video: {
              url: videoUrl.trim(),
              metadata: {
                title: text.trim().slice(0, 100),
                thumbnailOffset: Math.max(0, Math.round(Number(thumbnailOffset) || 1500)),
              },
            },
          },
        ],
      };

      if (isCustom && dueAt) {
        postInput.dueAt = dueAt;
      }

      if (createPostInputFields.has('metadata') && platformOptions) {
        const meta: Record<string, any> = {};
        if (service.includes('youtube') && platformOptions.youtube) {
          const ytPrivacy = platformOptions.youtube.visibility;
          meta.youtube = {
            title: text.trim().slice(0, 100),
            ...(ytPrivacy === 'public' || ytPrivacy === 'unlisted' || ytPrivacy === 'private'
              ? { privacy: ytPrivacy }
              : {}),
            ...(typeof platformOptions.youtube.madeForKids === 'boolean'
              ? { madeForKids: platformOptions.youtube.madeForKids }
              : {}),
          };
        }
        if (service.includes('instagram') && platformOptions.instagram) {
          const igType = platformOptions.instagram.postType || 'reel';
          meta.instagram = {
            type: igType === 'story' || igType === 'post' || igType === 'reel' ? igType : 'reel',
            shouldShareToFeed: Boolean(
              platformOptions.instagram.shareToFeed !== undefined
                ? platformOptions.instagram.shareToFeed
                : true
            ),
            ...(platformOptions.instagram.firstComment
              ? { firstComment: String(platformOptions.instagram.firstComment) }
              : {}),
          };
        }
        if (service.includes('tiktok')) {
          meta.tiktok = {
            title: text.trim().slice(0, 100),
          };
        }
        if (Object.keys(meta).length > 0) {
          postInput.metadata = meta;
        }
      }

      try {
        const { data } = await executeBufferGraphQL(token, createPostMutation, { input: postInput });
        const resultPayload = data?.createPost;

        if (resultPayload?.message) {
          results.push({
            channelId,
            success: false,
            error: redactSecrets(String(resultPayload.message), [token]),
          });
        } else if (resultPayload?.post?.id) {
          results.push({
            channelId,
            success: true,
            post: resultPayload.post,
          });
        } else {
          results.push({
            channelId,
            success: false,
            error: 'Buffer did not confirm post creation.',
          });
        }
      } catch (err: any) {
        results.push({
          channelId,
          success: false,
          error: redactSecrets(err?.message || 'Failed to schedule post in Buffer.', [token]),
        });
      }
    }

    const anySuccessful = results.some((r) => r.success);
    if (anySuccessful) {
      invalidateBufferSessionCache(token);
    }

    return {
      success: anySuccessful,
      allSuccessful: results.every((r) => r.success),
      results,
      error: !anySuccessful ? results[0]?.error || 'Buffer rejected the scheduled post.' : undefined,
      rateLimit: getStoredRateLimit(token),
    };
  } finally {
    inFlightMutations.delete(lockKey);
  }
}

export async function deleteBufferGraphQLPost(token: string, postId: string) {
  const deleteMutation = `
    mutation DeleteBufferPost($input: DeletePostInput!) {
      deletePost(input: $input) {
        ... on DeletePostSuccess {
          id
        }
        ... on MutationError {
          message
        }
      }
    }
  `;

  const { data, rateLimit } = await executeBufferGraphQL(token, deleteMutation, {
    input: { id: postId },
  });
  const payload = data?.deletePost;
  if (payload?.message) {
    throw new Error(redactSecrets(String(payload.message), [token]));
  }
  invalidateBufferSessionCache(token);
  return { success: true, id: payload?.id || postId, rateLimit };
}

export async function updateBufferGraphQLPost(
  token: string,
  postId: string,
  updates: { text?: string; dueAt?: string }
) {
  const { mutationFields } = await getSchemaCapabilities(token);
  if (!mutationFields.has('editPost')) {
    const err = new Error(
      'Direct post rescheduling is not exposed by the current Buffer GraphQL schema for this account.'
    ) as Error & { statusCode?: number };
    err.statusCode = 501;
    throw err;
  }

  const editMutation = `
    mutation EditBufferPost($input: EditPostInput!) {
      editPost(input: $input) {
        ... on PostActionSuccess {
          post {
            id
            text
            dueAt
            status
          }
        }
        ... on MutationError {
          message
        }
      }
    }
  `;

  const input: Record<string, any> = { id: postId };
  if (updates.text) input.text = updates.text.trim();
  if (updates.dueAt) {
    input.dueAt = updates.dueAt;
    input.mode = 'customScheduled';
  }

  const { data, rateLimit } = await executeBufferGraphQL(token, editMutation, { input });
  const payload = data?.editPost;
  if (payload?.message) {
    throw new Error(redactSecrets(String(payload.message), [token]));
  }
  invalidateBufferSessionCache(token);
  return { success: true, post: payload?.post, rateLimit };
}
