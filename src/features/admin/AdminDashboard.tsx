import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  LogOut,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldOff,
  Trash2,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import {
  AdminAuditLog,
  AdminStats,
  AdminUserSummary,
  AuthUser,
} from '../../types';
import {
  adminDeleteUser,
  adminIssueResetLink,
  adminReactivateUser,
  adminRevokeUserSessions,
  adminSuspendUser,
  adminUpdateUserRole,
  fetchAdminOverview,
  fetchAdminUsers,
} from '../../services/studioApi';

interface AdminDashboardProps {
  currentUser: AuthUser;
  onBackToStudio: () => void;
  onLogout: () => Promise<void>;
}

function formatShortDate(ms: number | null | undefined): string {
  if (!ms) return 'Never';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(ms));
  } catch {
    return '—';
  }
}

function formatDateTime(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return '—';
  }
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUser,
  onBackToStudio,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<'users' | 'audit'>('users');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended' | 'admin'>('all');

  const [isLoading, setIsLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [forbiddenError, setForbiddenError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<AdminUserSummary | null>(null);
  const [resetModalData, setResetModalData] = useState<{
    email: string;
    resetUrl: string;
    token: string;
  } | null>(null);
  const [copiedReset, setCopiedReset] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorBanner(null);
    try {
      const [overviewRes, usersRes] = await Promise.all([
        fetchAdminOverview(),
        fetchAdminUsers({ q: searchQuery.trim(), status: statusFilter }),
      ]);

      if (overviewRes.status === 403 || usersRes.status === 403) {
        setForbiddenError(
          overviewRes.error || usersRes.error || 'Administrator privileges are required.'
        );
        setIsLoading(false);
        return;
      }

      if (overviewRes.success && overviewRes.stats) {
        setStats(overviewRes.stats);
        setAuditLogs(overviewRes.auditLogs || []);
      } else if (overviewRes.error) {
        setErrorBanner(overviewRes.error);
      }

      if (usersRes.success && usersRes.users) {
        setUsers(usersRes.users);
      } else if (usersRes.error) {
        setErrorBanner(usersRes.error);
      }
    } catch {
      setErrorBanner('Could not reach admin API.');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSuspendToggle = async (u: AdminUserSummary) => {
    setBusyUserId(u.id);
    setErrorBanner(null);
    setActionNotice(null);
    const res =
      u.status === 'suspended' ? await adminReactivateUser(u.id) : await adminSuspendUser(u.id);
    setBusyUserId(null);

    if (!res.success) {
      setErrorBanner(res.error || 'Could not update user status.');
      return;
    }

    setActionNotice(
      u.status === 'suspended'
        ? `Reactivated ${u.email}.`
        : `Suspended ${u.email} and revoked active sessions.`
    );
    await loadData();
  };

  const handleRoleToggle = async (u: AdminUserSummary) => {
    const nextRole = u.role === 'admin' ? 'user' : 'admin';
    setBusyUserId(u.id);
    setErrorBanner(null);
    setActionNotice(null);
    const res = await adminUpdateUserRole(u.id, nextRole);
    setBusyUserId(null);

    if (!res.success) {
      setErrorBanner(res.error || 'Could not update role.');
      return;
    }

    setActionNotice(
      nextRole === 'admin'
        ? `Promoted ${u.email} to Administrator.`
        : `Removed administrator privileges from ${u.email}.`
    );
    await loadData();
  };

  const handleRevokeSessions = async (u: AdminUserSummary) => {
    setBusyUserId(u.id);
    setErrorBanner(null);
    setActionNotice(null);
    const res = await adminRevokeUserSessions(u.id);
    setBusyUserId(null);

    if (!res.success) {
      setErrorBanner(res.error || 'Could not revoke sessions.');
      return;
    }

    setActionNotice(`Revoked ${res.revokedCount ?? 0} active session(s) for ${u.email}.`);
    await loadData();
  };

  const handleIssueReset = async (u: AdminUserSummary) => {
    setBusyUserId(u.id);
    setErrorBanner(null);
    const res = await adminIssueResetLink(u.id);
    setBusyUserId(null);

    if (!res.success || !res.resetUrl || !res.token) {
      setErrorBanner(res.error || 'Could not issue password reset link.');
      return;
    }

    setCopiedReset(false);
    setResetModalData({
      email: u.email,
      resetUrl: res.resetUrl,
      token: res.token,
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setBusyUserId(target.id);
    setErrorBanner(null);
    const res = await adminDeleteUser(target.id);
    setBusyUserId(null);
    setDeleteTarget(null);

    if (!res.success) {
      setErrorBanner(res.error || 'Could not delete user account.');
      return;
    }

    setActionNotice(`Deleted account ${target.email}.`);
    await loadData();
  };

  if (forbiddenError || currentUser.role !== 'admin') {
    return (
      <div className="min-h-screen w-screen bg-[#07080a] text-[#ededef] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-[#22252e] bg-[#0c0d11] p-7 text-center space-y-4">
          <ShieldAlert className="w-8 h-8 text-rose-400 mx-auto" />
          <div className="space-y-1.5">
            <h1 className="text-lg font-bold text-white">Administrator Access Required</h1>
            <p className="text-xs text-[#8e929c] leading-relaxed">
              {forbiddenError ||
                'Your account does not have administrator permissions to view this console.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onBackToStudio}
            className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 transition cursor-pointer"
          >
            Return to Studio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-screen bg-[#060709] text-[#ededef] flex flex-col select-none">
      {/* Top Bar */}
      <header className="border-b border-[#1c1e26] bg-[#090a0d] px-5 sm:px-8 py-3.5 shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBackToStudio}
              className="px-3 py-1.5 rounded-lg border border-[#252833] bg-[#101218] hover:border-white/40 text-xs font-semibold text-white flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Studio</span>
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-[#7b808c]">
                <span className="truncate">AutoBuffer Studio</span>
                <span aria-hidden="true">/</span>
                <span className="text-white font-semibold truncate">Admin Console</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <span className="hidden sm:inline text-xs text-[#8e929c] truncate max-w-[220px]">
              {currentUser.email}
            </span>
            <button
              type="button"
              onClick={() => loadData()}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-lg border border-[#252833] bg-[#101218] hover:border-white/40 text-xs font-medium text-[#d4d4d8] flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="px-3 py-1.5 rounded-lg border border-[#252833] bg-[#101218] hover:border-rose-500/50 text-xs font-medium text-[#d4d4d8] hover:text-rose-300 flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-5 sm:px-8 py-6 space-y-6">
        {/* Title & Segmented Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              Platform Administration
            </h1>
            <p className="text-xs text-[#8e929c] mt-0.5">
              Manage registered accounts, active sessions, administrator access, and security logs.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0e1015] border border-[#1d2028] self-start">
            <button
              type="button"
              onClick={() => setActiveTab('users')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'users' ? 'bg-white text-black' : 'text-[#8e929c] hover:text-white'
              }`}
            >
              Users ({stats?.totalUsers ?? users.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'audit' ? 'bg-white text-black' : 'text-[#8e929c] hover:text-white'
              }`}
            >
              Audit Log ({auditLogs.length})
            </button>
          </div>
        </div>

        {/* Statistics Grid (1px hairline border, tabular figures, no nested card clutter) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Total Users', value: stats?.totalUsers ?? 0 },
            { label: 'Active Users', value: stats?.activeUsers ?? 0 },
            { label: 'Suspended', value: stats?.suspendedUsers ?? 0 },
            { label: 'New (7 Days)', value: stats?.newRegistrations7d ?? 0 },
            { label: 'Active Sessions', value: stats?.activeSessions ?? 0 },
            { label: 'Scheduled Posts', value: stats?.totalScheduledPosts ?? 0 },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-[#1d2028] bg-[#0b0c10] px-4 py-3.5"
            >
              <p className="text-[11px] font-medium text-[#7b808c]">{stat.label}</p>
              <p className="text-2xl font-bold text-white tabular-nums mt-1">
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {errorBanner && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300 flex items-center justify-between gap-3"
          >
            <span>{errorBanner}</span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="p-0.5 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {actionNotice && (
          <div
            role="status"
            className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-300 flex items-center justify-between gap-3"
          >
            <span>{actionNotice}</span>
            <button
              type="button"
              onClick={() => setActionNotice(null)}
              className="p-0.5 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {activeTab === 'users' ? (
          <section className="rounded-2xl border border-[#1d2028] bg-[#0b0c10] overflow-hidden">
            {/* Search & Filter Toolbar */}
            <div className="p-4 border-b border-[#191b22] flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-[#6d717d] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search users by email or display name..."
                  className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-[#242731] bg-[#07080b] text-xs text-white focus:outline-none focus:border-white placeholder:text-[#4e525f]"
                />
              </div>

              <div className="flex items-center gap-1 p-1 rounded-xl bg-[#07080b] border border-[#191b22] self-start">
                {(
                  [
                    ['all', 'All'],
                    ['active', 'Active'],
                    ['suspended', 'Suspended'],
                    ['admin', 'Admins'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStatusFilter(key)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap shrink-0 ${
                      statusFilter === key
                        ? 'bg-white text-black font-semibold'
                        : 'text-[#8e929c] hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Users Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#191b22] text-[11px] font-semibold text-[#7b808c]">
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-3">Role / Status</th>
                    <th className="py-3 px-3">Registered</th>
                    <th className="py-3 px-3">Last Login</th>
                    <th className="py-3 px-3 text-right">Sessions</th>
                    <th className="py-3 px-3 text-right">Posts</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#15171e] text-xs">
                  {users.map((u) => {
                    const isSelf = u.id === currentUser.id;
                    const isLastAdmin =
                      u.role === 'admin' &&
                      u.status === 'active' &&
                      (stats?.activeAdmins ?? 1) <= 1;
                    const isBusy = busyUserId === u.id;

                    return (
                      <tr
                        key={u.id}
                        className="hover:bg-[#11131a] transition-colors"
                      >
                        <td className="py-3 px-4 min-w-[210px]">
                          <p className="font-semibold text-white truncate">
                            {u.displayName}
                            {isSelf ? ' (You)' : ''}
                          </p>
                          <p className="text-[11px] text-[#7b808c] truncate">{u.email}</p>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <span
                              className={
                                u.role === 'admin' ? 'font-semibold text-white' : 'text-[#9ea3ae]'
                              }
                            >
                              {u.role === 'admin' ? 'Admin' : 'Member'}
                            </span>
                            <span aria-hidden="true" className="text-[#4e525f]">
                              ·
                            </span>
                            <span
                              className={
                                u.status === 'suspended'
                                  ? 'text-rose-400 font-semibold'
                                  : 'text-emerald-400 font-medium'
                              }
                            >
                              {u.status === 'suspended' ? 'Suspended' : 'Active'}
                            </span>
                          </div>
                          <p className="text-[10px] text-[#6d717d] mt-0.5">
                            Buffer: {u.hasBufferKey ? 'Connected' : 'None'} · Gemini:{' '}
                            {u.hasGeminiKey ? 'Connected' : 'None'}
                          </p>
                        </td>

                        <td className="py-3 px-3 text-[11px] text-[#9ea3ae] tabular-nums whitespace-nowrap">
                          {formatShortDate(u.createdAt)}
                        </td>

                        <td className="py-3 px-3 text-[11px] text-[#9ea3ae] tabular-nums whitespace-nowrap">
                          {formatShortDate(u.lastLoginAt)}
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[#d4d4d8]">
                          {u.activeSessions}
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[#d4d4d8]">
                          {u.postCount}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {/* Suspend / Reactivate */}
                            <button
                              type="button"
                              disabled={isBusy || isSelf || (u.status === 'active' && isLastAdmin)}
                              onClick={() => handleSuspendToggle(u)}
                              title={
                                isSelf
                                  ? 'Cannot suspend your own account'
                                  : isLastAdmin
                                  ? 'Cannot suspend last active admin'
                                  : u.status === 'suspended'
                                  ? 'Reactivate account'
                                  : 'Suspend account'
                              }
                              className="px-2.5 py-1 rounded-lg border border-[#252833] bg-[#0f1117] hover:border-white/40 text-[11px] font-medium text-[#d4d4d8] disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1"
                            >
                              {u.status === 'suspended' ? (
                                <>
                                  <UserCheck className="w-3 h-3 text-emerald-400" />
                                  <span>Reactivate</span>
                                </>
                              ) : (
                                <>
                                  <UserX className="w-3 h-3 text-amber-400" />
                                  <span>Suspend</span>
                                </>
                              )}
                            </button>

                            {/* Promote / Demote */}
                            <button
                              type="button"
                              disabled={isBusy || (u.role === 'admin' && (isSelf || isLastAdmin))}
                              onClick={() => handleRoleToggle(u)}
                              title={
                                u.role === 'admin'
                                  ? isSelf || isLastAdmin
                                    ? 'Protected administrator'
                                    : 'Remove admin role'
                                  : 'Promote to admin'
                              }
                              className="p-1.5 rounded-lg border border-[#252833] bg-[#0f1117] hover:border-white/40 text-[#c9ccd4] disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                            >
                              {u.role === 'admin' ? (
                                <ShieldOff className="w-3.5 h-3.5" />
                              ) : (
                                <Shield className="w-3.5 h-3.5" />
                              )}
                            </button>

                            {/* Revoke Active Sessions */}
                            <button
                              type="button"
                              disabled={isBusy || u.activeSessions === 0}
                              onClick={() => handleRevokeSessions(u)}
                              title="Revoke active sessions"
                              className="px-2 py-1 rounded-lg border border-[#252833] bg-[#0f1117] hover:border-white/40 text-[11px] font-medium text-[#c9ccd4] disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                            >
                              Revoke
                            </button>

                            {/* Issue One-Time Reset Link */}
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleIssueReset(u)}
                              title="Issue password reset link"
                              className="p-1.5 rounded-lg border border-[#252833] bg-[#0f1117] hover:border-white/40 text-[#c9ccd4] disabled:opacity-35 cursor-pointer"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </button>

                            {/* Delete Account */}
                            <button
                              type="button"
                              disabled={isBusy || isSelf || isLastAdmin}
                              onClick={() => setDeleteTarget(u)}
                              title={
                                isSelf
                                  ? 'Cannot delete your own account'
                                  : isLastAdmin
                                  ? 'Cannot delete last active admin'
                                  : 'Delete user account'
                              }
                              className="p-1.5 rounded-lg border border-[#252833] bg-[#0f1117] hover:border-rose-500/50 text-rose-400 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {!isLoading && users.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-xs text-[#7b808c]">
                        No users match your current search or filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="rounded-2xl border border-[#1d2028] bg-[#0b0c10] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#191b22] text-[11px] font-semibold text-[#7b808c]">
                    <th className="py-3 px-4">Time</th>
                    <th className="py-3 px-3">Action</th>
                    <th className="py-3 px-3">Actor</th>
                    <th className="py-3 px-3">Target</th>
                    <th className="py-3 px-4 text-right">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#15171e] text-xs">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#11131a]">
                      <td className="py-2.5 px-4 text-[11px] text-[#8e929c] tabular-nums whitespace-nowrap">
                        {formatDateTime(log.createdAt)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-white whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="py-2.5 px-3 text-[#c9ccd4]">{log.actorEmail || 'System'}</td>
                      <td className="py-2.5 px-3 text-[#9ea3ae]">{log.targetEmail || '—'}</td>
                      <td className="py-2.5 px-4 text-right font-mono text-[11px] text-[#7b808c] tabular-nums">
                        {log.ipAddress || '—'}
                      </td>
                    </tr>
                  ))}
                  {auditLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-xs text-[#7b808c]">
                        No administrative actions recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="max-w-md w-full rounded-2xl border border-[#262933] bg-[#0e1015] p-6 space-y-4">
            <h2 className="text-base font-bold text-white">Delete User Account</h2>
            <p className="text-xs text-[#9ea3ae] leading-relaxed">
              Permanently delete <strong className="text-white">{deleteTarget.email}</strong>? All
              active sessions, encrypted API credentials, saved channels, and scheduled post records
              belonging to this user will be removed.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl border border-[#262933] text-xs font-semibold text-[#c9ccd4] hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-500 cursor-pointer"
              >
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Issued Reset Link Modal */}
      {resetModalData && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="max-w-lg w-full rounded-2xl border border-[#262933] bg-[#0e1015] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">One-Time Password Reset Link</h2>
              <button
                type="button"
                onClick={() => setResetModalData(null)}
                className="p-1 text-[#7b808c] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#9ea3ae] leading-relaxed">
              Share this single-use link privately with{' '}
              <strong className="text-white">{resetModalData.email}</strong>. It expires in 30
              minutes and revokes existing sessions upon completion.
            </p>
            <div className="p-3 rounded-xl border border-[#22252e] bg-[#07080b] text-[11px] font-mono text-white break-all">
              {resetModalData.resetUrl}
            </div>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(resetModalData.resetUrl);
                  setCopiedReset(true);
                }}
                className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 flex items-center gap-1.5 cursor-pointer"
              >
                {copiedReset ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedReset ? 'Copied Link' : 'Copy Reset Link'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
