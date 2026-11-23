import { createClient, type Client } from '@libsql/client';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  decryptSecret,
  encryptSecret,
  generateOpaqueToken,
  hashPassword,
  hashToken,
} from './crypto.js';

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended';

export interface DbUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  hasSeenWelcome: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

export interface DbPreferences {
  appName: string;
  appSubtitle: string;
  avatarUrl: string;
  theme: 'black' | 'charcoal' | 'light';
  liquidGlass: boolean;
  sidebarCollapsed: boolean;
}

export interface DbSessionInfo {
  id: string;
  userAgent: string;
  ipAddress: string;
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
  isCurrent: boolean;
}

export interface DbScheduledPost {
  id: string;
  bufferPostIds?: Record<string, string>;
  channelId: string;
  channelName: string;
  service: string;
  avatar?: string;
  time: string;
  title: string;
  dateKey: string;
  videoUrl: string;
  platformOptions?: Record<string, unknown>;
}

const DEFAULT_PREFS: DbPreferences = {
  appName: 'AutoBuffer',
  appSubtitle: 'Video Schedule Studio',
  avatarUrl: '',
  theme: 'black',
  liquidGlass: false,
  sidebarCollapsed: false,
};

let dbClient: Client | null = null;
let initPromise: Promise<void> | null = null;

function resolveDatabaseUrl(): string {
  const configured = (process.env.DATABASE_URL || '').trim();
  if (configured) return configured;

  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return `file:${path.join(dataDir, 'autobuffer.db')}`;
}

export function getDb(): Client {
  if (!dbClient) {
    const url = resolveDatabaseUrl();
    const authToken = (process.env.DATABASE_AUTH_TOKEN || '').trim() || undefined;
    dbClient = createClient({ url, authToken });
  }
  return dbClient;
}

export async function initDatabase(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = getDb();
    await db.executeMultiple(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        has_seen_welcome INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_agent TEXT,
        ip_address TEXT,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);

      CREATE TABLE IF NOT EXISTS password_resets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_credentials (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        buffer_token_enc TEXT,
        gemini_key_enc TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        app_name TEXT NOT NULL DEFAULT 'AutoBuffer',
        app_subtitle TEXT NOT NULL DEFAULT 'Video Schedule Studio',
        avatar_url TEXT NOT NULL DEFAULT '',
        theme TEXT NOT NULL DEFAULT 'black',
        liquid_glass INTEGER NOT NULL DEFAULT 0,
        sidebar_collapsed INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_channels (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        data_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, id)
      );

      CREATE TABLE IF NOT EXISTS scheduled_posts (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        service TEXT NOT NULL,
        avatar TEXT,
        time_label TEXT NOT NULL,
        title TEXT NOT NULL,
        date_key TEXT NOT NULL,
        video_url TEXT,
        buffer_post_ids_json TEXT,
        platform_options_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, id)
      );

      CREATE INDEX IF NOT EXISTS idx_posts_user_date ON scheduled_posts(user_id, date_key);

      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT,
        actor_email TEXT,
        action TEXT NOT NULL,
        target_user_id TEXT,
        target_email TEXT,
        details_json TEXT,
        ip_address TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at DESC);
    `);

    await bootstrapAdminFromEnv();
  })();

  return initPromise;
}

async function bootstrapAdminFromEnv(): Promise<void> {
  const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
  const password = (process.env.ADMIN_BOOTSTRAP_PASSWORD || '').trim();
  if (!email) return;

  const db = getDb();
  const now = Date.now();
  const existing = await db.execute({
    sql: 'SELECT id, role FROM users WHERE email = ?',
    args: [email],
  });

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.role !== 'admin') {
      await db.execute({
        sql: `UPDATE users SET role = 'admin', status = 'active', updated_at = ? WHERE id = ?`,
        args: [now, String(row.id)],
      });
    }
    return;
  }

  if (!password || password.length < 8) {
    console.warn(
      '[AutoBuffer Admin] ADMIN_BOOTSTRAP_EMAIL is set, but ADMIN_BOOTSTRAP_PASSWORD is missing or under 8 characters.'
    );
    return;
  }

  const userId = crypto.randomUUID();
  const displayName = email.split('@')[0] || 'Administrator';
  await db.execute({
    sql: `INSERT INTO users (id, email, display_name, password_hash, role, status, has_seen_welcome, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'admin', 'active', 0, ?, ?)`,
    args: [userId, email, displayName, hashPassword(password), now, now],
  });

  await ensureUserDefaults(userId);
  await recordAuditLog({
    actorUserId: userId,
    actorEmail: email,
    action: 'admin.bootstrap_env',
    targetUserId: userId,
    targetEmail: email,
    details: { method: 'env' },
  });
}

function mapUserRow(row: any): DbUser {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    role: row.role === 'admin' ? 'admin' : 'user',
    status: row.status === 'suspended' ? 'suspended' : 'active',
    hasSeenWelcome: Boolean(row.has_seen_welcome),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastLoginAt: row.last_login_at != null ? Number(row.last_login_at) : null,
  };
}

export async function ensureUserDefaults(userId: string): Promise<void> {
  const db = getDb();
  const now = Date.now();
  await db.execute({
    sql: `INSERT OR IGNORE INTO user_preferences
          (user_id, app_name, app_subtitle, avatar_url, theme, liquid_glass, sidebar_collapsed, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      userId,
      DEFAULT_PREFS.appName,
      DEFAULT_PREFS.appSubtitle,
      DEFAULT_PREFS.avatarUrl,
      DEFAULT_PREFS.theme,
      0,
      0,
      now,
    ],
  });
  await db.execute({
    sql: `INSERT OR IGNORE INTO user_credentials (user_id, buffer_token_enc, gemini_key_enc, updated_at)
          VALUES (?, NULL, NULL, ?)`,
    args: [userId, now],
  });
}

export async function countAdmins(): Promise<number> {
  await initDatabase();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND status = 'active'`,
    args: [],
  });
  return Number(res.rows[0]?.cnt || 0);
}

export async function createUser(params: {
  email: string;
  displayName: string;
  password: string;
  role?: UserRole;
}): Promise<DbUser> {
  await initDatabase();
  const db = getDb();
  const now = Date.now();
  const id = crypto.randomUUID();
  const normalizedEmail = params.email.trim().toLowerCase();
  const role: UserRole = params.role === 'admin' ? 'admin' : 'user';

  await db.execute({
    sql: `INSERT INTO users (id, email, display_name, password_hash, role, status, has_seen_welcome, created_at, updated_at, last_login_at)
          VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)`,
    args: [
      id,
      normalizedEmail,
      params.displayName.trim(),
      hashPassword(params.password),
      role,
      now,
      now,
      now,
    ],
  });

  await ensureUserDefaults(id);

  const created = await getUserById(id);
  if (!created) throw new Error('Failed to create user.');
  return created;
}

export async function getUserByEmail(
  email: string
): Promise<(DbUser & { passwordHash: string }) | null> {
  await initDatabase();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM users WHERE email = ? LIMIT 1`,
    args: [email.trim().toLowerCase()],
  });
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    ...mapUserRow(row),
    passwordHash: String(row.password_hash),
  };
}

export async function getUserById(id: string): Promise<DbUser | null> {
  await initDatabase();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM users WHERE id = ? LIMIT 1`,
    args: [id],
  });
  if (res.rows.length === 0) return null;
  return mapUserRow(res.rows[0]);
}

export async function getUserWithPasswordById(
  id: string
): Promise<(DbUser & { passwordHash: string }) | null> {
  await initDatabase();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM users WHERE id = ? LIMIT 1`,
    args: [id],
  });
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    ...mapUserRow(row),
    passwordHash: String(row.password_hash),
  };
}

export async function markWelcomeSeen(userId: string): Promise<void> {
  await initDatabase();
  const db = getDb();
  await db.execute({
    sql: `UPDATE users SET has_seen_welcome = 1, updated_at = ? WHERE id = ?`,
    args: [Date.now(), userId],
  });
}

export async function updateLastLogin(userId: string): Promise<void> {
  const db = getDb();
  const now = Date.now();
  await db.execute({
    sql: `UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`,
    args: [now, now, userId],
  });
}

export async function createSession(params: {
  userId: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<{ rawToken: string; sessionId: string; expiresAt: number }> {
  await initDatabase();
  const db = getDb();
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000;
  const rawToken = generateOpaqueToken(32);
  const tokenHash = hashToken(rawToken);
  const sessionId = crypto.randomUUID();

  await db.execute({
    sql: `INSERT INTO sessions (id, token_hash, user_id, user_agent, ip_address, created_at, last_active_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      sessionId,
      tokenHash,
      params.userId,
      (params.userAgent || '').slice(0, 240),
      (params.ipAddress || '').slice(0, 64),
      now,
      now,
      expiresAt,
    ],
  });

  return { rawToken, sessionId, expiresAt };
}

export async function resolveSession(
  rawToken: string
): Promise<{ sessionId: string; user: DbUser } | null> {
  if (!rawToken) return null;
  await initDatabase();
  const db = getDb();
  const tokenHash = hashToken(rawToken);
  const now = Date.now();

  const res = await db.execute({
    sql: `SELECT s.id AS session_id, s.expires_at, s.revoked_at, s.last_active_at, u.*
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ?
          LIMIT 1`,
    args: [tokenHash],
  });

  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  if (row.revoked_at != null || Number(row.expires_at) <= now) {
    return null;
  }

  const sessionId = String(row.session_id);
  const lastActive = Number(row.last_active_at || 0);
  if (now - lastActive > 60 * 1000) {
    db.execute({
      sql: `UPDATE sessions SET last_active_at = ? WHERE id = ?`,
      args: [now, sessionId],
    }).catch(() => {});
  }

  return {
    sessionId,
    user: mapUserRow(row),
  };
}

export async function revokeSessionById(sessionId: string, userId?: string): Promise<boolean> {
  await initDatabase();
  const db = getDb();
  const now = Date.now();
  const res = userId
    ? await db.execute({
        sql: `UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
        args: [now, sessionId, userId],
      })
    : await db.execute({
        sql: `UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
        args: [now, sessionId],
      });
  return res.rowsAffected > 0;
}

export async function revokeAllUserSessions(
  userId: string,
  exceptSessionId?: string
): Promise<number> {
  await initDatabase();
  const db = getDb();
  const now = Date.now();
  const res = exceptSessionId
    ? await db.execute({
        sql: `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL`,
        args: [now, userId, exceptSessionId],
      })
    : await db.execute({
        sql: `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
        args: [now, userId],
      });
  return res.rowsAffected;
}

export async function listUserSessions(
  userId: string,
  currentSessionId: string
): Promise<DbSessionInfo[]> {
  await initDatabase();
  const db = getDb();
  const now = Date.now();
  const res = await db.execute({
    sql: `SELECT id, user_agent, ip_address, created_at, last_active_at, expires_at
          FROM sessions
          WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
          ORDER BY last_active_at DESC`,
    args: [userId, now],
  });

  return res.rows.map((r) => ({
    id: String(r.id),
    userAgent: String(r.user_agent || 'Browser session'),
    ipAddress: String(r.ip_address || 'Unknown'),
    createdAt: Number(r.created_at),
    lastActiveAt: Number(r.last_active_at),
    expiresAt: Number(r.expires_at),
    isCurrent: String(r.id) === currentSessionId,
  }));
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  await initDatabase();
  const db = getDb();
  const now = Date.now();
  const expiresAt = now + 30 * 60 * 1000;
  const rawToken = generateOpaqueToken(24);
  const id = crypto.randomUUID();

  await db.execute({
    sql: `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, userId, hashToken(rawToken), expiresAt, now],
  });

  return rawToken;
}

export async function consumePasswordResetToken(
  rawToken: string,
  newPassword: string
): Promise<DbUser | null> {
  await initDatabase();
  const db = getDb();
  const now = Date.now();
  const res = await db.execute({
    sql: `SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ? LIMIT 1`,
    args: [hashToken(rawToken)],
  });

  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  if (row.used_at != null || Number(row.expires_at) <= now) {
    return null;
  }

  const userId = String(row.user_id);
  const resetId = String(row.id);

  await db.execute({
    sql: `UPDATE password_resets SET used_at = ? WHERE id = ?`,
    args: [now, resetId],
  });
  await db.execute({
    sql: `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
    args: [hashPassword(newPassword), now, userId],
  });
  await revokeAllUserSessions(userId);

  return await getUserById(userId);
}

export async function updateUserProfile(params: {
  userId: string;
  displayName?: string;
  email?: string;
}): Promise<DbUser> {
  await initDatabase();
  const db = getDb();
  const existing = await getUserById(params.userId);
  if (!existing) throw new Error('User not found.');

  const nextName =
    params.displayName !== undefined ? params.displayName.trim() : existing.displayName;
  const nextEmail =
    params.email !== undefined ? params.email.trim().toLowerCase() : existing.email;

  await db.execute({
    sql: `UPDATE users SET display_name = ?, email = ?, updated_at = ? WHERE id = ?`,
    args: [nextName, nextEmail, Date.now(), params.userId],
  });

  const updated = await getUserById(params.userId);
  if (!updated) throw new Error('User not found.');
  return updated;
}

export async function updateUserPassword(userId: string, newPassword: string): Promise<void> {
  await initDatabase();
  const db = getDb();
  await db.execute({
    sql: `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
    args: [hashPassword(newPassword), Date.now(), userId],
  });
}

// ==========================================
// Encrypted User API Credentials
// ==========================================

export async function getUserCredentials(userId: string): Promise<{
  bufferToken: string;
  geminiKey: string;
}> {
  await initDatabase();
  await ensureUserDefaults(userId);
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT buffer_token_enc, gemini_key_enc FROM user_credentials WHERE user_id = ? LIMIT 1`,
    args: [userId],
  });
  if (res.rows.length === 0) return { bufferToken: '', geminiKey: '' };
  const row = res.rows[0];
  return {
    bufferToken: decryptSecret(row.buffer_token_enc as string | null),
    geminiKey: decryptSecret(row.gemini_key_enc as string | null),
  };
}

export async function setUserBufferToken(userId: string, token: string | null): Promise<void> {
  await initDatabase();
  await ensureUserDefaults(userId);
  const db = getDb();
  const enc = token ? encryptSecret(token) : null;
  await db.execute({
    sql: `UPDATE user_credentials SET buffer_token_enc = ?, updated_at = ? WHERE user_id = ?`,
    args: [enc, Date.now(), userId],
  });
}

export async function setUserGeminiKey(userId: string, apiKey: string | null): Promise<void> {
  await initDatabase();
  await ensureUserDefaults(userId);
  const db = getDb();
  const enc = apiKey ? encryptSecret(apiKey) : null;
  await db.execute({
    sql: `UPDATE user_credentials SET gemini_key_enc = ?, updated_at = ? WHERE user_id = ?`,
    args: [enc, Date.now(), userId],
  });
}

// ==========================================
// User Preferences, Channels & Scheduled Posts
// ==========================================

export async function getUserPreferences(userId: string): Promise<DbPreferences> {
  await initDatabase();
  await ensureUserDefaults(userId);
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM user_preferences WHERE user_id = ? LIMIT 1`,
    args: [userId],
  });
  if (res.rows.length === 0) return DEFAULT_PREFS;
  const row = res.rows[0];
  const theme =
    row.theme === 'light' || row.theme === 'charcoal' || row.theme === 'black'
      ? row.theme
      : 'black';
  return {
    appName: String(row.app_name || DEFAULT_PREFS.appName),
    appSubtitle: String(row.app_subtitle || DEFAULT_PREFS.appSubtitle),
    avatarUrl: String(row.avatar_url || ''),
    theme,
    liquidGlass: Boolean(row.liquid_glass),
    sidebarCollapsed: Boolean(row.sidebar_collapsed),
  };
}

export async function saveUserPreferences(
  userId: string,
  prefs: Partial<DbPreferences>
): Promise<DbPreferences> {
  const current = await getUserPreferences(userId);
  const next: DbPreferences = {
    appName: (prefs.appName ?? current.appName).trim() || DEFAULT_PREFS.appName,
    appSubtitle: (prefs.appSubtitle ?? current.appSubtitle).trim() || DEFAULT_PREFS.appSubtitle,
    avatarUrl: prefs.avatarUrl !== undefined ? String(prefs.avatarUrl) : current.avatarUrl,
    theme:
      prefs.theme === 'light' || prefs.theme === 'charcoal' || prefs.theme === 'black'
        ? prefs.theme
        : current.theme,
    liquidGlass:
      prefs.liquidGlass !== undefined ? Boolean(prefs.liquidGlass) : current.liquidGlass,
    sidebarCollapsed:
      prefs.sidebarCollapsed !== undefined
        ? Boolean(prefs.sidebarCollapsed)
        : current.sidebarCollapsed,
  };

  const db = getDb();
  await db.execute({
    sql: `UPDATE user_preferences
          SET app_name = ?, app_subtitle = ?, avatar_url = ?, theme = ?, liquid_glass = ?, sidebar_collapsed = ?, updated_at = ?
          WHERE user_id = ?`,
    args: [
      next.appName,
      next.appSubtitle,
      next.avatarUrl,
      next.theme,
      next.liquidGlass ? 1 : 0,
      next.sidebarCollapsed ? 1 : 0,
      Date.now(),
      userId,
    ],
  });

  return next;
}

export async function getUserChannels(userId: string): Promise<any[]> {
  await initDatabase();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT data_json FROM user_channels WHERE user_id = ? ORDER BY updated_at DESC`,
    args: [userId],
  });
  return res.rows
    .map((r) => {
      try {
        return JSON.parse(String(r.data_json));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function replaceUserChannels(userId: string, channels: any[]): Promise<void> {
  await initDatabase();
  const db = getDb();
  const now = Date.now();
  await db.execute({
    sql: `DELETE FROM user_channels WHERE user_id = ?`,
    args: [userId],
  });
  for (const ch of channels) {
    if (!ch?.id) continue;
    await db.execute({
      sql: `INSERT INTO user_channels (id, user_id, data_json, updated_at) VALUES (?, ?, ?, ?)`,
      args: [String(ch.id), userId, JSON.stringify(ch), now],
    });
  }
}

export async function removeUserChannel(userId: string, channelId: string): Promise<void> {
  await initDatabase();
  const db = getDb();
  await db.execute({
    sql: `DELETE FROM user_channels WHERE user_id = ? AND id = ?`,
    args: [userId, channelId],
  });
}

export async function getUserScheduledPosts(userId: string): Promise<DbScheduledPost[]> {
  await initDatabase();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM scheduled_posts WHERE user_id = ? ORDER BY created_at DESC`,
    args: [userId],
  });
  return res.rows.map((r) => ({
    id: String(r.id),
    bufferPostIds: r.buffer_post_ids_json ? JSON.parse(String(r.buffer_post_ids_json)) : undefined,
    channelId: String(r.channel_id),
    channelName: String(r.channel_name),
    service: String(r.service),
    avatar: r.avatar ? String(r.avatar) : undefined,
    time: String(r.time_label),
    title: String(r.title),
    dateKey: String(r.date_key),
    videoUrl: String(r.video_url || ''),
    platformOptions: r.platform_options_json
      ? JSON.parse(String(r.platform_options_json))
      : undefined,
  }));
}

export async function upsertUserScheduledPost(
  userId: string,
  post: DbScheduledPost
): Promise<DbScheduledPost> {
  await initDatabase();
  const db = getDb();
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO scheduled_posts
          (id, user_id, channel_id, channel_name, service, avatar, time_label, title, date_key, video_url, buffer_post_ids_json, platform_options_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, id) DO UPDATE SET
            channel_id = excluded.channel_id,
            channel_name = excluded.channel_name,
            service = excluded.service,
            avatar = excluded.avatar,
            time_label = excluded.time_label,
            title = excluded.title,
            date_key = excluded.date_key,
            video_url = excluded.video_url,
            buffer_post_ids_json = excluded.buffer_post_ids_json,
            platform_options_json = excluded.platform_options_json,
            updated_at = excluded.updated_at`,
    args: [
      post.id,
      userId,
      post.channelId,
      post.channelName,
      post.service,
      post.avatar || null,
      post.time,
      post.title,
      post.dateKey,
      post.videoUrl || '',
      post.bufferPostIds ? JSON.stringify(post.bufferPostIds) : null,
      post.platformOptions ? JSON.stringify(post.platformOptions) : null,
      now,
      now,
    ],
  });
  return post;
}

export async function deleteUserScheduledPost(userId: string, postId: string): Promise<void> {
  await initDatabase();
  const db = getDb();
  await db.execute({
    sql: `DELETE FROM scheduled_posts WHERE user_id = ? AND id = ?`,
    args: [userId, postId],
  });
}

// ==========================================
// Admin Queries & Audit Log
// ==========================================

export async function recordAuditLog(params: {
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetUserId?: string | null;
  targetEmail?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> {
  await initDatabase();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO admin_audit_logs
          (id, actor_user_id, actor_email, action, target_user_id, target_email, details_json, ip_address, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      params.actorUserId,
      params.actorEmail,
      params.action,
      params.targetUserId || null,
      params.targetEmail || null,
      params.details ? JSON.stringify(params.details) : null,
      (params.ipAddress || '').slice(0, 64),
      Date.now(),
    ],
  });
}

export async function listAuditLogs(limit = 50): Promise<any[]> {
  await initDatabase();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return res.rows.map((r) => ({
    id: String(r.id),
    actorUserId: r.actor_user_id ? String(r.actor_user_id) : null,
    actorEmail: r.actor_email ? String(r.actor_email) : null,
    action: String(r.action),
    targetUserId: r.target_user_id ? String(r.target_user_id) : null,
    targetEmail: r.target_email ? String(r.target_email) : null,
    details: r.details_json ? JSON.parse(String(r.details_json)) : undefined,
    ipAddress: r.ip_address ? String(r.ip_address) : null,
    createdAt: Number(r.created_at),
  }));
}
