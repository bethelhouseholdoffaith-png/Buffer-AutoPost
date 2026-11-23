import type { Express } from 'express';
import { getClientIp, requireAdmin, requireAuth } from './authRoutes.js';
import {
  countAdmins,
  createPasswordResetToken,
  getDb,
  getUserById,
  initDatabase,
  listAuditLogs,
  recordAuditLog,
  revokeAllUserSessions,
} from './db.js';

export function registerAdminRoutes(app: Express) {
  // Overview statistics + recent audit logs
  app.get('/api/admin/overview', requireAuth, requireAdmin, async (_req, res) => {
    try {
      await initDatabase();
      const db = getDb();
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();

      const [usersStats, sessionsRes, postsRes, auditLogs] = await Promise.all([
        db.execute({
          sql: `SELECT
                  COUNT(*) AS total_users,
                  SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_users,
                  SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended_users,
                  SUM(CASE WHEN role = 'admin' AND status = 'active' THEN 1 ELSE 0 END) AS active_admins,
                  SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_registrations_7d
                FROM users`,
          args: [sevenDaysAgo],
        }),
        db.execute({
          sql: `SELECT COUNT(*) AS active_sessions FROM sessions WHERE revoked_at IS NULL AND expires_at > ?`,
          args: [now],
        }),
        db.execute({
          sql: `SELECT COUNT(*) AS total_posts FROM scheduled_posts`,
          args: [],
        }),
        listAuditLogs(40),
      ]);

      const row = usersStats.rows[0] || {};
      return res.json({
        success: true,
        stats: {
          totalUsers: Number(row.total_users || 0),
          activeUsers: Number(row.active_users || 0),
          suspendedUsers: Number(row.suspended_users || 0),
          activeAdmins: Number(row.active_admins || 0),
          newRegistrations7d: Number(row.new_registrations_7d || 0),
          activeSessions: Number(sessionsRes.rows[0]?.active_sessions || 0),
          totalScheduledPosts: Number(postsRes.rows[0]?.total_posts || 0),
        },
        auditLogs,
      });
    } catch {
      return res.status(500).json({ success: false, error: 'Could not load admin overview.' });
    }
  });

  // List & search registered users (sanitized: never exposes password hashes or API secrets)
  app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
    try {
      await initDatabase();
      const db = getDb();
      const q = String(req.query.q || '').trim().toLowerCase();
      const statusFilter = String(req.query.status || 'all').trim().toLowerCase();
      const now = Date.now();

      const whereClauses: string[] = [];
      const args: any[] = [now];

      if (q) {
        whereClauses.push(`(LOWER(u.email) LIKE ? OR LOWER(u.display_name) LIKE ?)`);
        args.push(`%${q}%`, `%${q}%`);
      }
      if (statusFilter === 'active' || statusFilter === 'suspended') {
        whereClauses.push(`u.status = ?`);
        args.push(statusFilter);
      } else if (statusFilter === 'admin') {
        whereClauses.push(`u.role = 'admin'`);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const result = await db.execute({
        sql: `SELECT
                u.id, u.email, u.display_name, u.role, u.status,
                u.created_at, u.last_login_at,
                CASE WHEN uc.buffer_token_enc IS NOT NULL AND uc.buffer_token_enc != '' THEN 1 ELSE 0 END AS has_buffer_key,
                CASE WHEN uc.gemini_key_enc IS NOT NULL AND uc.gemini_key_enc != '' THEN 1 ELSE 0 END AS has_gemini_key,
                (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS active_sessions,
                (SELECT COUNT(*) FROM scheduled_posts p WHERE p.user_id = u.id) AS post_count
              FROM users u
              LEFT JOIN user_credentials uc ON uc.user_id = u.id
              ${whereSql}
              ORDER BY u.created_at DESC
              LIMIT 200`,
        args,
      });

      const users = result.rows.map((r) => ({
        id: String(r.id),
        email: String(r.email),
        displayName: String(r.display_name),
        role: r.role === 'admin' ? 'admin' : 'user',
        status: r.status === 'suspended' ? 'suspended' : 'active',
        createdAt: Number(r.created_at),
        lastLoginAt: r.last_login_at != null ? Number(r.last_login_at) : null,
        hasBufferKey: Boolean(r.has_buffer_key),
        hasGeminiKey: Boolean(r.has_gemini_key),
        activeSessions: Number(r.active_sessions || 0),
        postCount: Number(r.post_count || 0),
      }));

      return res.json({ success: true, users });
    } catch {
      return res.status(500).json({ success: false, error: 'Failed to load users.' });
    }
  });

  // Suspend user (revokes active sessions immediately, prevents self-suspension or suspending last admin)
  app.post('/api/admin/users/:id/suspend', requireAuth, requireAdmin, async (req, res) => {
    const targetId = String(req.params.id || '');
    if (targetId === req.authUser!.id) {
      return res.status(400).json({ success: false, error: 'You cannot suspend your own account.' });
    }

    const target = await getUserById(targetId);
    if (!target) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (target.role === 'admin' && target.status === 'active') {
      const admins = await countAdmins();
      if (admins <= 1) {
        return res.status(409).json({
          success: false,
          error: 'Cannot suspend the last active administrator.',
        });
      }
    }

    const db = getDb();
    await db.execute({
      sql: `UPDATE users SET status = 'suspended', updated_at = ? WHERE id = ?`,
      args: [Date.now(), targetId],
    });
    const revokedSessions = await revokeAllUserSessions(targetId);

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'admin.user_suspended',
      targetUserId: target.id,
      targetEmail: target.email,
      details: { revokedSessions },
      ipAddress: getClientIp(req),
    });

    return res.json({ success: true, revokedSessions });
  });

  // Reactivate user
  app.post('/api/admin/users/:id/reactivate', requireAuth, requireAdmin, async (req, res) => {
    const targetId = String(req.params.id || '');
    const target = await getUserById(targetId);
    if (!target) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const db = getDb();
    await db.execute({
      sql: `UPDATE users SET status = 'active', updated_at = ? WHERE id = ?`,
      args: [Date.now(), targetId],
    });

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'admin.user_reactivated',
      targetUserId: target.id,
      targetEmail: target.email,
      ipAddress: getClientIp(req),
    });

    return res.json({ success: true });
  });

  // Promote / Demote administrator privileges (prevents demoting last admin)
  app.post('/api/admin/users/:id/role', requireAuth, requireAdmin, async (req, res) => {
    const targetId = String(req.params.id || '');
    const nextRole = req.body?.role === 'admin' ? 'admin' : req.body?.role === 'user' ? 'user' : null;
    if (!nextRole) {
      return res.status(400).json({ success: false, error: 'Role must be "admin" or "user".' });
    }

    const target = await getUserById(targetId);
    if (!target) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (target.role === 'admin' && nextRole === 'user') {
      const admins = await countAdmins();
      if (admins <= 1) {
        return res.status(409).json({
          success: false,
          error: 'Cannot remove privileges from the last active administrator.',
        });
      }
      if (target.id === req.authUser!.id) {
        return res.status(400).json({
          success: false,
          error: 'Use another administrator account to remove your own admin privileges.',
        });
      }
    }

    const db = getDb();
    await db.execute({
      sql: `UPDATE users SET role = ?, updated_at = ? WHERE id = ?`,
      args: [nextRole, Date.now(), targetId],
    });

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: nextRole === 'admin' ? 'admin.user_promoted' : 'admin.user_demoted',
      targetUserId: target.id,
      targetEmail: target.email,
      details: { previousRole: target.role, nextRole },
      ipAddress: getClientIp(req),
    });

    return res.json({ success: true, role: nextRole });
  });

  // Revoke all active sessions for a user
  app.post('/api/admin/users/:id/revoke-sessions', requireAuth, requireAdmin, async (req, res) => {
    const targetId = String(req.params.id || '');
    const target = await getUserById(targetId);
    if (!target) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const exceptSessionId = targetId === req.authUser!.id ? req.authSessionId : undefined;
    const count = await revokeAllUserSessions(targetId, exceptSessionId);

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'admin.sessions_revoked',
      targetUserId: target.id,
      targetEmail: target.email,
      details: { revokedCount: count },
      ipAddress: getClientIp(req),
    });

    return res.json({ success: true, revokedCount: count });
  });

  // Issue a single-use password reset link for a user (useful when SMTP/Resend isn't configured)
  app.post('/api/admin/users/:id/reset-link', requireAuth, requireAdmin, async (req, res) => {
    const targetId = String(req.params.id || '');
    const target = await getUserById(targetId);
    if (!target) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const rawToken = await createPasswordResetToken(target.id);
    const origin = String(req.headers.origin || process.env.APP_URL || 'http://localhost:3000').replace(
      /\/$/,
      ''
    );
    const resetUrl = `${origin}/?resetToken=${encodeURIComponent(rawToken)}`;

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'admin.reset_link_issued',
      targetUserId: target.id,
      targetEmail: target.email,
      ipAddress: getClientIp(req),
    });

    return res.json({ success: true, resetUrl, token: rawToken });
  });

  // Permanently delete user account (blocked for self & last active admin)
  app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const targetId = String(req.params.id || '');
    if (targetId === req.authUser!.id) {
      return res.status(400).json({
        success: false,
        error: 'You cannot delete your own active administrator account.',
      });
    }

    const target = await getUserById(targetId);
    if (!target) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (target.role === 'admin' && target.status === 'active') {
      const admins = await countAdmins();
      if (admins <= 1) {
        return res.status(409).json({
          success: false,
          error: 'Cannot delete the last active administrator.',
        });
      }
    }

    const db = getDb();
    await db.execute({
      sql: `DELETE FROM users WHERE id = ?`,
      args: [targetId],
    });

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'admin.user_deleted',
      targetUserId: target.id,
      targetEmail: target.email,
      details: { deletedRole: target.role, deletedStatus: target.status },
      ipAddress: getClientIp(req),
    });

    return res.json({ success: true });
  });

  // Audit logs viewer
  app.get('/api/admin/audit-logs', requireAuth, requireAdmin, async (req, res) => {
    const limit = Math.min(200, Math.max(10, Number(req.query.limit || 80)));
    const logs = await listAuditLogs(limit);
    return res.json({ success: true, logs });
  });
}
