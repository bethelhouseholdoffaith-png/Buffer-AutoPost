import type { Express, NextFunction, Request, Response } from 'express';
import {
  clearSessionCookie,
  getSessionTokenFromReq,
  setSessionCookie,
  clearKeyCookie,
  BUFFER_COOKIE_NAME,
  GEMINI_COOKIE_NAME,
} from './cookies.js';
import { verifyPassword } from './crypto.js';
import {
  consumePasswordResetToken,
  countAdmins,
  createPasswordResetToken,
  createSession,
  createUser,
  deleteUserScheduledPost,
  getUserByEmail,
  getUserById,
  getUserChannels,
  getUserCredentials,
  getUserPreferences,
  getUserScheduledPosts,
  getUserWithPasswordById,
  initDatabase,
  listUserSessions,
  markWelcomeSeen,
  recordAuditLog,
  removeUserChannel,
  replaceUserChannels,
  resolveSession,
  revokeAllUserSessions,
  revokeSessionById,
  saveUserPreferences,
  updateLastLogin,
  updateUserPassword,
  updateUserProfile,
  upsertUserScheduledPost,
  type DbUser,
} from './db.js';

declare global {
  namespace Express {
    interface Request {
      authUser?: DbUser;
      authSessionId?: string;
    }
  }
}

export function getClientIp(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || 'unknown';
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

async function sendResetEmailIfConfigured(email: string, resetUrl: string): Promise<boolean> {
  const resendKey = (process.env.RESEND_API_KEY || '').trim();
  const mailFrom = (process.env.MAIL_FROM || 'AutoBuffer Studio <onboarding@resend.dev>').trim();
  if (!resendKey) return false;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: mailFrom,
        to: [email],
        subject: 'Reset your AutoBuffer Video Studio password',
        text: `You requested a password reset for AutoBuffer Video Studio.\n\nOpen this link within 30 minutes to set a new password:\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email.`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function attachAuthContext(req: Request, _res: Response, next: NextFunction) {
  try {
    const rawToken = getSessionTokenFromReq(req);
    if (!rawToken) return next();

    const resolved = await resolveSession(rawToken);
    if (resolved) {
      req.authUser = resolved.user;
      req.authSessionId = resolved.sessionId;
    }
  } catch (err) {
    console.error('[AutoBuffer Auth] Session resolution failed:', err);
  }
  return next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser || !req.authSessionId) {
    return res.status(401).json({
      success: false,
      errorCode: 'UNAUTHENTICATED',
      error: 'Please sign in to continue.',
    });
  }
  if (req.authUser.status === 'suspended') {
    return res.status(403).json({
      success: false,
      errorCode: 'ACCOUNT_SUSPENDED',
      error: 'This account has been suspended. Contact an administrator.',
    });
  }
  return next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.authUser) {
    return res.status(401).json({
      success: false,
      errorCode: 'UNAUTHENTICATED',
      error: 'Authentication required.',
    });
  }
  if (req.authUser.status === 'suspended') {
    return res.status(403).json({
      success: false,
      errorCode: 'ACCOUNT_SUSPENDED',
      error: 'This account is suspended.',
    });
  }
  if (req.authUser.role !== 'admin') {
    return res.status(403).json({
      success: false,
      errorCode: 'FORBIDDEN',
      error: 'Administrator privileges required.',
    });
  }
  return next();
}

async function buildAccountSnapshot(user: DbUser) {
  const [preferences, creds, channels, scheduledPosts] = await Promise.all([
    getUserPreferences(user.id),
    getUserCredentials(user.id),
    getUserChannels(user.id),
    getUserScheduledPosts(user.id),
  ]);

  return {
    user,
    preferences,
    keyStatus: {
      hasBufferKey: Boolean(creds.bufferToken),
      hasGeminiKey: Boolean(creds.geminiKey),
    },
    channels,
    scheduledPosts,
  };
}

export function registerAuthRoutes(app: Express) {
  // Check whether first-admin bootstrap is still available (only when 0 admins exist & env admin not set)
  app.get('/api/auth/bootstrap-status', async (_req, res) => {
    try {
      await initDatabase();
      const adminCount = await countAdmins();
      const envAdminConfigured = Boolean((process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim());
      return res.json({
        success: true,
        needsAdminBootstrap: adminCount === 0 && !envAdminConfigured,
        hasAdmin: adminCount > 0,
      });
    } catch {
      return res.status(500).json({ success: false, error: 'Database initialization failed.' });
    }
  });

  // One-time first administrator setup (atomically locked as soon as an admin exists)
  app.post('/api/auth/bootstrap-admin', async (req, res) => {
    try {
      await initDatabase();
      const envAdminConfigured = Boolean((process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim());
      if (envAdminConfigured) {
        return res.status(403).json({
          success: false,
          error: 'Administrator bootstrap is managed via server environment variables.',
        });
      }

      const adminCount = await countAdmins();
      if (adminCount > 0) {
        return res.status(403).json({
          success: false,
          error: 'An administrator already exists.',
        });
      }

      const email = String(req.body?.email || '').trim().toLowerCase();
      const displayName = String(req.body?.displayName || '').trim() || 'Administrator';
      const password = String(req.body?.password || '');

      if (!isValidEmail(email)) {
        return res.status(400).json({ success: false, error: 'Enter a valid email address.' });
      }
      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 8 characters.',
        });
      }

      const existing = await getUserByEmail(email);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'An account with that email already exists.',
        });
      }

      const user = await createUser({
        email,
        displayName,
        password,
        role: 'admin',
      });

      const session = await createSession({
        userId: user.id,
        userAgent: req.headers['user-agent'],
        ipAddress: getClientIp(req),
      });
      setSessionCookie(req, res, session.rawToken);

      await recordAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'admin.bootstrap_claimed',
        targetUserId: user.id,
        targetEmail: user.email,
        ipAddress: getClientIp(req),
      });

      const snapshot = await buildAccountSnapshot(user);
      return res.status(201).json({
        success: true,
        isNewUser: true,
        ...snapshot,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: err?.message || 'Could not complete administrator setup.',
      });
    }
  });

  // Public user registration — ALWAYS creates standard role='user'
  app.post('/api/auth/register', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const displayName = String(req.body?.displayName || '').trim();
      const password = String(req.body?.password || '');

      if (!isValidEmail(email)) {
        return res.status(400).json({ success: false, error: 'Enter a valid email address.' });
      }
      if (!displayName || displayName.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'Display name must be at least 2 characters.',
        });
      }
      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 8 characters.',
        });
      }

      const existing = await getUserByEmail(email);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'An account with this email already exists.',
        });
      }

      // Explicitly force standard 'user' role regardless of any client payload
      const user = await createUser({
        email,
        displayName,
        password,
        role: 'user',
      });

      const session = await createSession({
        userId: user.id,
        userAgent: req.headers['user-agent'],
        ipAddress: getClientIp(req),
      });
      setSessionCookie(req, res, session.rawToken);

      const snapshot = await buildAccountSnapshot(user);
      return res.status(201).json({
        success: true,
        isNewUser: true,
        ...snapshot,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: err?.message || 'Registration failed. Please try again.',
      });
    }
  });

  // Email + Password login
  app.post('/api/auth/login', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required.',
        });
      }

      const found = await getUserByEmail(email);
      if (!found || !verifyPassword(password, found.passwordHash)) {
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password.',
        });
      }

      if (found.status === 'suspended') {
        return res.status(403).json({
          success: false,
          errorCode: 'ACCOUNT_SUSPENDED',
          error: 'This account is suspended. Contact an administrator to restore access.',
        });
      }

      await updateLastLogin(found.id);
      const session = await createSession({
        userId: found.id,
        userAgent: req.headers['user-agent'],
        ipAddress: getClientIp(req),
      });
      setSessionCookie(req, res, session.rawToken);

      const user = (await getUserById(found.id))!;
      const snapshot = await buildAccountSnapshot(user);
      return res.json({
        success: true,
        isNewUser: !user.hasSeenWelcome,
        ...snapshot,
      });
    } catch {
      return res.status(500).json({
        success: false,
        error: 'Login failed. Please try again.',
      });
    }
  });

  // Logout (revoke active session + clear HttpOnly cookies)
  app.post('/api/auth/logout', async (req, res) => {
    try {
      if (req.authSessionId && req.authUser) {
        await revokeSessionById(req.authSessionId, req.authUser.id);
      }
    } catch {
      // always clear cookies cleanly
    }
    clearSessionCookie(req, res);
    clearKeyCookie(req, res, BUFFER_COOKIE_NAME);
    clearKeyCookie(req, res, GEMINI_COOKIE_NAME);
    return res.json({ success: true });
  });

  // Current authenticated session + cross-device cloud snapshot
  app.get('/api/auth/me', async (req, res) => {
    try {
      await initDatabase();
      const adminCount = await countAdmins();
      const envAdminConfigured = Boolean((process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim());

      if (!req.authUser) {
        return res.json({
          success: true,
          authenticated: false,
          needsAdminBootstrap: adminCount === 0 && !envAdminConfigured,
        });
      }

      if (req.authUser.status === 'suspended') {
        clearSessionCookie(req, res);
        return res.status(403).json({
          success: false,
          authenticated: false,
          errorCode: 'ACCOUNT_SUSPENDED',
          error: 'This account has been suspended.',
        });
      }

      const snapshot = await buildAccountSnapshot(req.authUser);
      return res.json({
        success: true,
        authenticated: true,
        isNewUser: !req.authUser.hasSeenWelcome,
        needsAdminBootstrap: adminCount === 0 && !envAdminConfigured,
        ...snapshot,
      });
    } catch {
      return res.status(500).json({ success: false, error: 'Could not verify session.' });
    }
  });

  // Mark initial onboarding welcome animation seen so subsequent opens say "Welcome back, {name}!"
  app.post('/api/auth/welcome-seen', requireAuth, async (req, res) => {
    await markWelcomeSeen(req.authUser!.id);
    return res.json({ success: true });
  });

  // Forgot Password (sends email when RESEND_API_KEY is set; never leaks tokens publicly)
  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!isValidEmail(email)) {
        return res.status(400).json({ success: false, error: 'Enter a valid email address.' });
      }

      const user = await getUserByEmail(email);
      let emailSent = false;
      if (user && user.status === 'active') {
        const rawToken = await createPasswordResetToken(user.id);
        const origin = String(req.headers.origin || process.env.APP_URL || 'http://localhost:3000').replace(
          /\/$/,
          ''
        );
        const resetUrl = `${origin}/?resetToken=${encodeURIComponent(rawToken)}`;
        emailSent = await sendResetEmailIfConfigured(email, resetUrl);
        if (!emailSent) {
          console.info(`[AutoBuffer Password Reset] Reset requested for ${email}.`);
        }
      }

      return res.json({
        success: true,
        emailConfigured: Boolean((process.env.RESEND_API_KEY || '').trim()),
        message: Boolean((process.env.RESEND_API_KEY || '').trim())
          ? 'If an account exists for that email, a password reset link has been sent.'
          : 'Password reset recorded. Ask your administrator to issue a one-time reset link if email delivery is not configured.',
      });
    } catch {
      return res.status(500).json({ success: false, error: 'Could not process password reset.' });
    }
  });

  // Complete Password Reset with single-use token
  app.post('/api/auth/reset-password', async (req, res) => {
    try {
      const token = String(req.body?.token || '').trim();
      const newPassword = String(req.body?.newPassword || '');
      if (!token) {
        return res.status(400).json({ success: false, error: 'Reset token is required.' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 8 characters.',
        });
      }

      const user = await consumePasswordResetToken(token, newPassword);
      if (!user) {
        return res.status(400).json({
          success: false,
          error: 'Invalid or expired password reset link.',
        });
      }
      if (user.status === 'suspended') {
        return res.status(403).json({
          success: false,
          error: 'Account is suspended.',
        });
      }

      const session = await createSession({
        userId: user.id,
        userAgent: req.headers['user-agent'],
        ipAddress: getClientIp(req),
      });
      setSessionCookie(req, res, session.rawToken);

      const snapshot = await buildAccountSnapshot(user);
      return res.json({
        success: true,
        isNewUser: false,
        ...snapshot,
      });
    } catch {
      return res.status(500).json({ success: false, error: 'Could not reset password.' });
    }
  });

  // ==========================================
  // Authenticated Account & Sync Endpoints
  // ==========================================

  app.patch('/api/account/profile', requireAuth, async (req, res) => {
    try {
      const displayName =
        req.body?.displayName !== undefined ? String(req.body.displayName).trim() : undefined;
      const email =
        req.body?.email !== undefined ? String(req.body.email).trim().toLowerCase() : undefined;
      const currentPassword = String(req.body?.currentPassword || '');

      if (displayName !== undefined && displayName.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'Display name must be at least 2 characters.',
        });
      }

      if (email !== undefined && email !== req.authUser!.email) {
        if (!isValidEmail(email)) {
          return res.status(400).json({ success: false, error: 'Enter a valid email address.' });
        }
        const withHash = await getUserWithPasswordById(req.authUser!.id);
        if (!withHash || !verifyPassword(currentPassword, withHash.passwordHash)) {
          return res.status(401).json({
            success: false,
            error: 'Current password is required to change your email address.',
          });
        }
        const conflict = await getUserByEmail(email);
        if (conflict && conflict.id !== req.authUser!.id) {
          return res.status(409).json({
            success: false,
            error: 'That email address is already in use.',
          });
        }
      }

      const updated = await updateUserProfile({
        userId: req.authUser!.id,
        displayName,
        email,
      });

      return res.json({ success: true, user: updated });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Profile update failed.' });
    }
  });

  app.post('/api/account/change-password', requireAuth, async (req, res) => {
    try {
      const currentPassword = String(req.body?.currentPassword || '');
      const newPassword = String(req.body?.newPassword || '');

      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 8 characters.',
        });
      }

      const withHash = await getUserWithPasswordById(req.authUser!.id);
      if (!withHash || !verifyPassword(currentPassword, withHash.passwordHash)) {
        return res.status(401).json({
          success: false,
          error: 'Current password is incorrect.',
        });
      }

      await updateUserPassword(req.authUser!.id, newPassword);
      await revokeAllUserSessions(req.authUser!.id, req.authSessionId);

      return res.json({ success: true });
    } catch {
      return res.status(500).json({ success: false, error: 'Could not update password.' });
    }
  });

  app.get('/api/account/sessions', requireAuth, async (req, res) => {
    const sessions = await listUserSessions(req.authUser!.id, req.authSessionId!);
    return res.json({ success: true, sessions });
  });

  app.delete('/api/account/sessions/:sessionId', requireAuth, async (req, res) => {
    const targetId = String(req.params.sessionId || '');
    const revoked = await revokeSessionById(targetId, req.authUser!.id);
    if (targetId === req.authSessionId) {
      clearSessionCookie(req, res);
    }
    return res.json({ success: revoked });
  });

  app.put('/api/account/preferences', requireAuth, async (req, res) => {
    try {
      const updated = await saveUserPreferences(req.authUser!.id, req.body || {});
      return res.json({ success: true, preferences: updated });
    } catch {
      return res.status(500).json({ success: false, error: 'Failed to save preferences.' });
    }
  });

  app.put('/api/account/channels', requireAuth, async (req, res) => {
    try {
      const channels = Array.isArray(req.body?.channels) ? req.body.channels : [];
      await replaceUserChannels(req.authUser!.id, channels);
      return res.json({ success: true, channels });
    } catch {
      return res.status(500).json({ success: false, error: 'Failed to save channels.' });
    }
  });

  app.delete('/api/account/channels/:id', requireAuth, async (req, res) => {
    try {
      await removeUserChannel(req.authUser!.id, String(req.params.id || ''));
      const channels = await getUserChannels(req.authUser!.id);
      return res.json({ success: true, channels });
    } catch {
      return res.status(500).json({ success: false, error: 'Failed to remove channel.' });
    }
  });

  app.get('/api/posts', requireAuth, async (req, res) => {
    const posts = await getUserScheduledPosts(req.authUser!.id);
    return res.json({ success: true, posts });
  });

  app.post('/api/posts', requireAuth, async (req, res) => {
    try {
      const post = req.body;
      if (!post?.id || !post?.title || !post?.dateKey) {
        return res.status(400).json({ success: false, error: 'Missing required post fields.' });
      }
      const saved = await upsertUserScheduledPost(req.authUser!.id, post);
      return res.status(201).json({ success: true, post: saved });
    } catch {
      return res.status(500).json({ success: false, error: 'Failed to save scheduled post.' });
    }
  });

  app.patch('/api/posts/:id', requireAuth, async (req, res) => {
    try {
      const postId = String(req.params.id || '');
      const existing = (await getUserScheduledPosts(req.authUser!.id)).find((p) => p.id === postId);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Scheduled post not found.' });
      }
      const updated = await upsertUserScheduledPost(req.authUser!.id, {
        ...existing,
        ...req.body,
        id: existing.id,
      });
      return res.json({ success: true, post: updated });
    } catch {
      return res.status(500).json({ success: false, error: 'Failed to update post.' });
    }
  });

  app.delete('/api/posts/:id', requireAuth, async (req, res) => {
    await deleteUserScheduledPost(req.authUser!.id, String(req.params.id || ''));
    return res.json({ success: true });
  });
}
