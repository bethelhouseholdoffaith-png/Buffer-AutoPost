import React, { useState, useEffect } from 'react';
import {
  X,
  Check,
  Upload,
  Palette,
  Sliders,
  KeyRound,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  Lock,
  MonitorSmartphone,
  LogOut,
  RefreshCw,
} from 'lucide-react';
import { AuthUser, BufferChannel, BufferRateLimitInfo, KeyStatus, SessionInfo } from '../types';
import { LiquidGlassSurface } from './LiquidGlassSurface';
import { PlatformIcon } from './PlatformIcon';
import {
  changeAccountPassword,
  getRuntimeInfo,
  listActiveSessions,
  removeSavedChannel,
  revokeActiveSession,
  testAndSaveBackendUrl,
  updateAccountProfile,
} from '../services/studioApi';

export interface AppSettings {
  appName: string;
  appSubtitle: string;
  avatarUrl: string;
  theme: 'black' | 'charcoal' | 'light';
  liquidGlass: boolean;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser;
  onUserUpdated: (user: AuthUser) => void;
  onLogout: () => Promise<void>;
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  keyStatus: KeyStatus;
  channels: BufferChannel[];
  onChannelsUpdated: (channels: BufferChannel[]) => void;
  rateLimit?: BufferRateLimitInfo;
  onOpenKeyOnboarding: (step: 1 | 2) => void;
  onClearIntegrationKey: (target: 'buffer' | 'gemini') => Promise<void>;
  onRuntimeChanged?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUserUpdated,
  onLogout,
  settings,
  onSaveSettings,
  keyStatus,
  channels,
  onChannelsUpdated,
  rateLimit = {},
  onOpenKeyOnboarding,
  onClearIntegrationKey,
  onRuntimeChanged,
}) => {
  const [activeTab, setActiveTab] = useState<'account' | 'integrations' | 'studio'>('account');

  // Studio & Appearance
  const [appName, setAppName] = useState(settings.appName || 'AutoBuffer');
  const [appSubtitle, setAppSubtitle] = useState(
    settings.appSubtitle || 'Video Schedule Studio'
  );
  const [avatarUrl, setAvatarUrl] = useState(settings.avatarUrl || '');
  const [theme, setTheme] = useState<'black' | 'charcoal' | 'light'>(
    settings.theme || 'black'
  );
  const [liquidGlass, setLiquidGlass] = useState<boolean>(
    Boolean(settings.liquidGlass)
  );

  // Account profile
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [email, setEmail] = useState(currentUser.email);
  const [emailConfirmPassword, setEmailConfirmPassword] = useState('');
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [passwordErr, setPasswordErr] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  // Sessions
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Integrations & Backend URL
  const [clearingTarget, setClearingTarget] = useState<'buffer' | 'gemini' | null>(null);
  const [removingChannelId, setRemovingChannelId] = useState<string | null>(null);
  const [backendUrlInput, setBackendUrlInput] = useState('');
  const [backendStatusMsg, setBackendStatusMsg] = useState<string | null>(null);
  const [isTestingBackend, setIsTestingBackend] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAppName(settings.appName || 'AutoBuffer');
      setAppSubtitle(settings.appSubtitle || 'Video Schedule Studio');
      setAvatarUrl(settings.avatarUrl || '');
      setTheme(settings.theme || 'black');
      setLiquidGlass(Boolean(settings.liquidGlass));

      setDisplayName(currentUser.displayName);
      setEmail(currentUser.email);
      setEmailConfirmPassword('');
      setProfileMsg(null);
      setProfileErr(null);

      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordMsg(null);
      setPasswordErr(null);

      setBackendUrlInput(getRuntimeInfo().backendUrl);
      setBackendStatusMsg(null);

      setLoadingSessions(true);
      listActiveSessions()
        .then((res) => {
          if (res.success) setSessions(res.sessions);
        })
        .finally(() => setLoadingSessions(false));
    }
  }, [isOpen, settings, currentUser]);

  if (!isOpen) return null;

  const isLight = theme === 'light';
  const emailChanged = email.trim().toLowerCase() !== currentUser.email.toLowerCase();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveStudio = () => {
    onSaveSettings({
      appName: appName.trim() || 'AutoBuffer',
      appSubtitle: appSubtitle.trim() || 'Video Schedule Studio',
      avatarUrl,
      theme,
      liquidGlass,
    });
    onClose();
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setProfileErr(null);
    setSavingProfile(true);
    const res = await updateAccountProfile({
      displayName: displayName.trim(),
      email: email.trim(),
      currentPassword: emailChanged ? emailConfirmPassword : undefined,
    });
    setSavingProfile(false);
    if (!res.success || !res.user) {
      setProfileErr(res.error || 'Could not update profile.');
      return;
    }
    setEmailConfirmPassword('');
    setProfileMsg('Account profile saved to cloud.');
    onUserUpdated(res.user);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);
    setPasswordErr(null);
    if (newPassword !== confirmNewPassword) {
      setPasswordErr('New passwords do not match.');
      return;
    }
    setSavingPassword(true);
    const res = await changeAccountPassword(currentPassword, newPassword);
    setSavingPassword(false);
    if (!res.success) {
      setPasswordErr(res.error || 'Could not update password.');
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordMsg('Password updated. Other device sessions have been signed out.');
    const sessRes = await listActiveSessions();
    if (sessRes.success) setSessions(sessRes.sessions);
  };

  const handleRevokeSession = async (session: SessionInfo) => {
    const res = await revokeActiveSession(session.id);
    if (res.success) {
      if (session.isCurrent) {
        onClose();
        await onLogout();
      } else {
        setSessions((prev) => prev.filter((s) => s.id !== session.id));
      }
    }
  };

  const handleClear = async (target: 'buffer' | 'gemini') => {
    setClearingTarget(target);
    await onClearIntegrationKey(target);
    setClearingTarget(null);
  };

  const handleRemoveChannel = async (channelId: string) => {
    setRemovingChannelId(channelId);
    const res = await removeSavedChannel(channelId);
    setRemovingChannelId(null);
    if (res.success && res.channels) {
      onChannelsUpdated(res.channels);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-xl">
        <LiquidGlassSurface
          enabled={liquidGlass}
          isLight={isLight}
          className="rounded-2xl overflow-hidden"
        >
          {/* Header */}
          <div
            className={`px-6 py-4 border-b flex items-center justify-between gap-4 ${
              isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Sliders className="w-4 h-4" />
              <h2 className="text-sm font-bold tracking-tight">Account & Studio Settings</h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close settings"
              className={`p-1 rounded-lg transition cursor-pointer ${
                isLight
                  ? 'text-neutral-500 hover:text-black'
                  : 'text-[#737373] hover:text-white'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Section Tabs */}
          <div
            className={`px-6 py-2.5 border-b flex items-center gap-1.5 ${
              isLight ? 'border-neutral-200 bg-neutral-50' : 'border-[#1c1e24] bg-[#0b0c10]'
            }`}
          >
            {(
              [
                ['account', 'Account & Security'],
                ['integrations', 'API Keys & Channels'],
                ['studio', 'Studio & Theme'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                  activeTab === id
                    ? isLight
                      ? 'bg-black text-white'
                      : 'bg-white text-black'
                    : isLight
                    ? 'text-neutral-600 hover:text-black'
                    : 'text-[#8e929c] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
            {activeTab === 'account' && (
              <>
                {/* Profile & Email */}
                <form onSubmit={handleSaveProfile} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#8e929c]">
                      <User className="w-3.5 h-3.5" />
                      <span>Profile & Email</span>
                    </div>
                    <span className="text-[11px] text-[#7b808c]">
                      {currentUser.role === 'admin' ? 'Administrator' : 'Member Account'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-medium text-[#8e929c]">
                        Display Name
                      </label>
                      <input
                        type="text"
                        required
                        minLength={2}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className={`w-full px-3 py-2 rounded-xl border text-xs font-semibold focus:outline-none transition ${
                          isLight
                            ? 'border-neutral-300 bg-white text-neutral-900 focus:border-black'
                            : 'border-[#2a2d36] bg-[#121419] text-white focus:border-white'
                        }`}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-medium text-[#8e929c]">
                        Email Address
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={`w-full px-3 py-2 rounded-xl border text-xs font-medium focus:outline-none transition ${
                          isLight
                            ? 'border-neutral-300 bg-white text-neutral-900 focus:border-black'
                            : 'border-[#2a2d36] bg-[#121419] text-white focus:border-white'
                        }`}
                      />
                    </div>
                  </div>

                  {emailChanged && (
                    <div className="space-y-1">
                      <label className="block text-[11px] font-medium text-[#8e929c]">
                        Current Password (required to update email)
                      </label>
                      <input
                        type="password"
                        required
                        value={emailConfirmPassword}
                        onChange={(e) => setEmailConfirmPassword(e.target.value)}
                        placeholder="Enter current password"
                        className={`w-full px-3 py-2 rounded-xl border text-xs focus:outline-none transition ${
                          isLight
                            ? 'border-neutral-300 bg-white text-neutral-900 focus:border-black'
                            : 'border-[#2a2d36] bg-[#121419] text-white focus:border-white'
                        }`}
                      />
                    </div>
                  )}

                  {profileErr && <p className="text-xs text-rose-400">{profileErr}</p>}
                  {profileMsg && <p className="text-xs text-emerald-400">{profileMsg}</p>}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingProfile}
                      className={`px-4 py-1.5 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50 ${
                        isLight ? 'bg-black text-white' : 'bg-white text-black'
                      }`}
                    >
                      {savingProfile ? 'Saving...' : 'Save Profile'}
                    </button>
                  </div>
                </form>

                {/* Password Change */}
                <form
                  onSubmit={handleChangePassword}
                  className={`space-y-3 pt-4 border-t ${
                    isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#8e929c]">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Change Password</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Current password"
                      className={`px-3 py-2 rounded-xl border text-xs focus:outline-none ${
                        isLight
                          ? 'border-neutral-300 bg-white text-neutral-900'
                          : 'border-[#2a2d36] bg-[#121419] text-white'
                      }`}
                    />
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New (min 8 chars)"
                      className={`px-3 py-2 rounded-xl border text-xs focus:outline-none ${
                        isLight
                          ? 'border-neutral-300 bg-white text-neutral-900'
                          : 'border-[#2a2d36] bg-[#121419] text-white'
                      }`}
                    />
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      placeholder="Confirm new"
                      className={`px-3 py-2 rounded-xl border text-xs focus:outline-none ${
                        isLight
                          ? 'border-neutral-300 bg-white text-neutral-900'
                          : 'border-[#2a2d36] bg-[#121419] text-white'
                      }`}
                    />
                  </div>

                  {passwordErr && <p className="text-xs text-rose-400">{passwordErr}</p>}
                  {passwordMsg && <p className="text-xs text-emerald-400">{passwordMsg}</p>}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingPassword}
                      className={`px-4 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                        isLight
                          ? 'border-neutral-300 bg-white hover:border-black'
                          : 'border-[#2c303a] bg-[#161820] hover:border-white text-white'
                      }`}
                    >
                      {savingPassword ? 'Updating...' : 'Update Password'}
                    </button>
                  </div>
                </form>

                {/* Active Sessions */}
                <div
                  className={`space-y-3 pt-4 border-t ${
                    isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#8e929c]">
                      <MonitorSmartphone className="w-3.5 h-3.5" />
                      <span>Active Sessions ({sessions.length})</span>
                    </div>
                    {loadingSessions && <RefreshCw className="w-3.5 h-3.5 animate-spin opacity-60" />}
                  </div>

                  <div className="space-y-2">
                    {sessions.map((s) => (
                      <div
                        key={s.id}
                        className={`px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                          isLight
                            ? 'border-neutral-200 bg-neutral-50'
                            : 'border-[#22242b] bg-[#111318]'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="font-semibold truncate">
                            {s.isCurrent ? 'This Browser Session' : 'Signed-In Device'}
                          </p>
                          <p className="text-[11px] text-[#7b808c] truncate tabular-nums">
                            {s.ipAddress} · Last active{' '}
                            {new Date(s.lastActiveAt).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRevokeSession(s)}
                          className="px-2.5 py-1 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 text-[11px] font-semibold cursor-pointer shrink-0"
                        >
                          {s.isCurrent ? 'Sign Out' : 'Revoke'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {activeTab === 'integrations' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#8e929c]">
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Encrypted Credentials Vault</span>
                  </div>
                  <span className="text-[11px] text-[#7b808c] flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    AES-256-GCM on backend
                  </span>
                </div>

                {/* Buffer Key */}
                <div
                  className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                    isLight
                      ? 'border-neutral-200 bg-neutral-50'
                      : 'border-[#22242b] bg-[#111318]'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">
                      Buffer API ·{' '}
                      <span
                        className={keyStatus.hasBufferKey ? 'text-emerald-500' : 'text-[#7b808c]'}
                      >
                        {keyStatus.hasBufferKey ? 'Connected' : 'Not connected'}
                      </span>
                    </p>
                    {typeof rateLimit.remaining15m === 'number' && (
                      <p className="text-[11px] text-[#7b808c] tabular-nums mt-0.5">
                        Live window remaining: {rateLimit.remaining15m}
                        {rateLimit.limit15m ? ` / ${rateLimit.limit15m}` : ''}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenKeyOnboarding(1);
                      }}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                        isLight
                          ? 'border-neutral-300 bg-white hover:border-black'
                          : 'border-[#2c303a] bg-[#171920] hover:border-white'
                      }`}
                    >
                      {keyStatus.hasBufferKey ? 'Update' : 'Connect'}
                    </button>
                    {keyStatus.hasBufferKey && (
                      <button
                        type="button"
                        disabled={clearingTarget === 'buffer'}
                        onClick={() => handleClear('buffer')}
                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                        title="Disconnect Buffer key"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Gemini Key */}
                <div
                  className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                    isLight
                      ? 'border-neutral-200 bg-neutral-50'
                      : 'border-[#22242b] bg-[#111318]'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">
                      Gemini API ·{' '}
                      <span
                        className={keyStatus.hasGeminiKey ? 'text-emerald-500' : 'text-[#7b808c]'}
                      >
                        {keyStatus.hasGeminiKey ? 'Connected' : 'Not connected'}
                      </span>
                    </p>
                    <p className="text-[11px] text-[#7b808c] mt-0.5">
                      Encrypted per-user on backend for video inspection and title generation.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenKeyOnboarding(2);
                      }}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                        isLight
                          ? 'border-neutral-300 bg-white hover:border-black'
                          : 'border-[#2c303a] bg-[#171920] hover:border-white'
                      }`}
                    >
                      {keyStatus.hasGeminiKey ? 'Update' : 'Connect'}
                    </button>
                    {keyStatus.hasGeminiKey && (
                      <button
                        type="button"
                        disabled={clearingTarget === 'gemini'}
                        onClick={() => handleClear('gemini')}
                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                        title="Disconnect Gemini key"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Connected Channels List */}
                <div className="space-y-2 pt-2">
                  <p className="text-xs font-semibold text-[#8e929c]">
                    Saved Channels ({channels.length})
                  </p>
                  {channels.length === 0 ? (
                    <p className="text-xs text-[#7b808c]">
                      No channels synced yet. Connect Buffer above to sync your channels.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {channels.map((ch) => (
                        <div
                          key={ch.id}
                          className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-3 ${
                            isLight
                              ? 'border-neutral-200 bg-neutral-50'
                              : 'border-[#22242b] bg-[#111318]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <PlatformIcon service={ch.service} size={16} />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate">{ch.name}</p>
                              <p className="text-[10px] text-[#7b808c] truncate">
                                {ch.handle || ch.service}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={removingChannelId === ch.id}
                            onClick={() => handleRemoveChannel(ch.id)}
                            className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 cursor-pointer shrink-0"
                            title="Remove channel from studio"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Backend Server URL */}
                <div
                  className={`p-3.5 rounded-xl border space-y-2 ${
                    isLight
                      ? 'border-neutral-200 bg-neutral-50'
                      : 'border-[#22242b] bg-[#111318]'
                  }`}
                >
                  <p className="text-xs font-semibold">Studio Backend Server URL</p>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={backendUrlInput}
                      onChange={(e) => {
                        setBackendUrlInput(e.target.value);
                        setBackendStatusMsg(null);
                      }}
                      placeholder="https://your-autobuffer-api.onrender.com"
                      className={`flex-1 px-3 py-1.5 rounded-lg border text-xs ${
                        isLight
                          ? 'border-neutral-300 bg-white text-neutral-900'
                          : 'border-[#2c303a] bg-[#0c0d10] text-white'
                      }`}
                    />
                    <button
                      type="button"
                      disabled={isTestingBackend}
                      onClick={async () => {
                        setIsTestingBackend(true);
                        const res = await testAndSaveBackendUrl(backendUrlInput);
                        setIsTestingBackend(false);
                        setBackendStatusMsg(
                          res.success
                            ? 'Backend URL verified and active.'
                            : res.error || 'Could not reach backend URL.'
                        );
                        if (res.success) onRuntimeChanged?.();
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                        isLight ? 'bg-black text-white' : 'bg-white text-black'
                      }`}
                    >
                      {isTestingBackend ? 'Testing...' : 'Apply'}
                    </button>
                  </div>
                  {backendStatusMsg && (
                    <p className="text-[11px] text-[#9ea3ae]">{backendStatusMsg}</p>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'studio' && (
              <>
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-[#8e929c]">Studio Profile</h3>

                  <div className="flex items-center gap-4">
                    <div
                      className={`w-12 h-12 rounded-xl font-black flex items-center justify-center text-lg overflow-hidden shrink-0 border ${
                        isLight
                          ? 'bg-black text-white border-black/10'
                          : 'bg-white text-black border-white/20'
                      }`}
                    >
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt="Avatar"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span>{appName.charAt(0) || 'B'}</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <label
                        className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                          isLight
                            ? 'border-neutral-300 bg-white text-neutral-900 hover:border-black'
                            : 'border-[#2a2d36] bg-[#14161d] text-white hover:border-white'
                        }`}
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload Avatar</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleFileUpload}
                        />
                      </label>

                      {avatarUrl && (
                        <button
                          type="button"
                          onClick={() => setAvatarUrl('')}
                          className="text-xs text-[#8e929c] hover:underline px-2 py-1 cursor-pointer"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-medium text-[#8e929c]">
                        Studio Name
                      </label>
                      <input
                        type="text"
                        value={appName}
                        onChange={(e) => setAppName(e.target.value)}
                        className={`w-full px-3 py-2 rounded-xl border text-xs font-semibold focus:outline-none transition ${
                          isLight
                            ? 'border-neutral-300 bg-white text-neutral-900 focus:border-black'
                            : 'border-[#2a2d36] bg-[#121419] text-white focus:border-white'
                        }`}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-medium text-[#8e929c]">
                        Subtitle
                      </label>
                      <input
                        type="text"
                        value={appSubtitle}
                        onChange={(e) => setAppSubtitle(e.target.value)}
                        className={`w-full px-3 py-2 rounded-xl border text-xs font-medium focus:outline-none transition ${
                          isLight
                            ? 'border-neutral-300 bg-white text-neutral-900 focus:border-black'
                            : 'border-[#2a2d36] bg-[#121419] text-white focus:border-white'
                        }`}
                      />
                    </div>
                  </div>
                </div>

                {/* Appearance */}
                <div
                  className={`space-y-3 pt-4 border-t ${
                    isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#8e929c]">
                    <Palette className="w-3.5 h-3.5" />
                    <span>Appearance</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    {(
                      [
                        ['black', 'Minimal Black', 'bg-black border-white/20', 'bg-white'],
                        ['charcoal', 'Midnight', 'bg-[#14171f] border-[#2a2d36]', 'bg-[#9ea3ae]'],
                        ['light', 'Light Monochrome', 'bg-white border-neutral-300', 'bg-black'],
                      ] as const
                    ).map(([id, label, previewCls, dotCls]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setTheme(id)}
                        className={`p-3 rounded-xl border text-left transition cursor-pointer relative ${
                          theme === id
                            ? isLight
                              ? 'border-black ring-1 ring-black'
                              : 'border-white bg-[#101217]'
                            : isLight
                            ? 'border-neutral-200 hover:border-neutral-400'
                            : 'border-[#22242b] bg-[#0d0e12] hover:border-neutral-500'
                        }`}
                      >
                        <div
                          className={`w-full h-7 rounded-md border mb-2 flex items-center px-2 ${previewCls}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
                        </div>
                        <p className="text-xs font-bold leading-tight">{label}</p>
                        {theme === id && <Check className="w-3.5 h-3.5 absolute top-2.5 right-2.5" />}
                      </button>
                    ))}
                  </div>

                  {/* Opt-In Liquid Glass Toggle */}
                  <div
                    className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                      isLight
                        ? 'border-neutral-200 bg-neutral-50'
                        : 'border-[#22242b] bg-[#111318]'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 opacity-75" />
                        <span>Liquid Glass</span>
                      </p>
                      <p className="text-[11px] text-[#7b808c]">
                        Optional translucent refractive surface for dialogs and overlays.
                      </p>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={liquidGlass}
                      onClick={() => setLiquidGlass((v) => !v)}
                      className={`w-10 h-6 rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${
                        liquidGlass
                          ? isLight
                            ? 'bg-black'
                            : 'bg-white'
                          : isLight
                          ? 'bg-neutral-300'
                          : 'bg-[#2a2d36]'
                      }`}
                    >
                      <span
                        className={`block w-5 h-5 rounded-full transition-transform ${
                          liquidGlass
                            ? isLight
                              ? 'translate-x-4 bg-white'
                              : 'translate-x-4 bg-black'
                            : 'translate-x-0 bg-white'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div
            className={`px-6 py-4 border-t flex items-center justify-between gap-3 ${
              isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
            }`}
          >
            <button
              type="button"
              onClick={async () => {
                onClose();
                await onLogout();
              }}
              className="px-3 py-2 text-xs font-semibold text-rose-400 hover:text-rose-300 flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log Out</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className={`px-4 py-2 text-xs font-semibold cursor-pointer ${
                  isLight
                    ? 'text-neutral-600 hover:text-black'
                    : 'text-[#9ea3ae] hover:text-white'
                }`}
              >
                Close
              </button>

              {activeTab === 'studio' && (
                <button
                  type="button"
                  onClick={handleSaveStudio}
                  className={`px-5 py-2 rounded-xl text-xs font-bold transition cursor-pointer active:scale-[0.98] ${
                    isLight
                      ? 'bg-black text-white hover:bg-neutral-800'
                      : 'bg-white text-black hover:bg-neutral-200'
                  }`}
                >
                  Save Studio Settings
                </button>
              )}
            </div>
          </div>
        </LiquidGlassSurface>
      </div>
    </div>
  );
};
