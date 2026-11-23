import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Menu, Upload, AlertCircle, X, Shield } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { CalendarGrid, ScheduledPostItem } from './components/CalendarGrid';
import { UploadWizardModal } from './components/UploadWizardModal';
import { SettingsModal, AppSettings } from './components/SettingsModal';
import { EditPostModal } from './components/EditPostModal';
import { OnboardingModal } from './features/onboarding/OnboardingModal';
import { WelcomeAnimation } from './components/WelcomeAnimation';
import { AuthScreen } from './features/auth/AuthScreen';
import { AdminDashboard } from './features/admin/AdminDashboard';
import {
  AuthSnapshot,
  AuthUser,
  BufferChannel,
  BufferPlanTier,
  BufferRateLimitInfo,
  KeyStatus,
} from './types';
import { findNextBufferSpot, getLocalDateKey } from './utils/bufferSchedule';
import {
  clearIntegrationKey,
  createCloudPost,
  deleteBufferPostRemote,
  deleteCloudPost,
  fetchCurrentSession,
  loadBufferBootstrap as fetchBufferBootstrap,
  logoutSession,
  markWelcomeAnimationSeen,
  saveCloudPreferences,
  scrubLegacyBrowserSecrets,
  updateBufferPostRemote,
  updateCloudPost,
} from './services/studioApi';

const DEFAULT_SETTINGS: AppSettings = {
  appName: 'AutoBuffer',
  appSubtitle: 'Video Schedule Studio',
  avatarUrl: '',
  theme: 'black',
  liquidGlass: false,
};

function isAdminRoutePath(): boolean {
  if (typeof window === 'undefined') return false;
  const p = window.location.pathname.replace(/\/+$/, '');
  return p.endsWith('/admin') || window.location.hash === '#/admin';
}

function getBasePathPrefix(): string {
  if (typeof window === 'undefined') return '/';
  let p = window.location.pathname;
  if (p.endsWith('/admin/')) p = p.slice(0, -'/admin/'.length) + '/';
  else if (p.endsWith('/admin')) p = p.slice(0, -'/admin'.length) || '/';
  else if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
  if (!p.endsWith('/')) p += '/';
  return p;
}

function readResetTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('resetToken');
}

export default function App() {
  const prefersReducedMotion = useReducedMotion();

  // Authentication & Routing State
  const [authLoaded, setAuthLoaded] = useState(false);
  const [backendReachable, setBackendReachable] = useState(true);
  const [needsAdminBootstrap, setNeedsAdminBootstrap] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [initialResetToken, setInitialResetToken] = useState<string | null>(() =>
    readResetTokenFromUrl()
  );
  const [currentView, setCurrentView] = useState<'studio' | 'admin'>(() =>
    isAdminRoutePath() ? 'admin' : 'studio'
  );

  // Welcome Animation State (shown on every authenticated app open / refresh / sign-in)
  const [welcomeState, setWelcomeState] = useState<{
    active: boolean;
    isNewUser: boolean;
  }>({ active: false, isNewUser: false });

  // Cloud-Synced Studio Settings
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);

  // Per-User Encrypted Integration Key Status
  const [keyStatus, setKeyStatus] = useState<KeyStatus>({
    hasBufferKey: false,
    hasGeminiKey: false,
  });

  // Channels, Scheduled Posts & Rate Limits
  const [channels, setChannels] = useState<BufferChannel[]>([]);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPostItem[]>([]);
  const [bufferPlan] = useState<BufferPlanTier>('free');
  const [rateLimit, setRateLimit] = useState<BufferRateLimitInfo>({});
  const [isRefreshingChannels, setIsRefreshingChannels] = useState(false);
  const [appBanner, setAppBanner] = useState<string | null>(null);

  // Selected Channel Filter
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>('all');

  // Modals & Drawers
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [keyModalInitialStep, setKeyModalInitialStep] = useState<1 | 2>(1);
  const [isUploadWizardOpen, setIsUploadWizardOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<ScheduledPostItem | null>(null);

  // Calendar Month & Target Date
  const [currentCalendarDate, setCurrentCalendarDate] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [targetDateKey, setTargetDateKey] = useState<string>(() => getLocalDateKey(new Date()));
  const [targetTime, setTargetTime] = useState<string | undefined>(undefined);

  // Scrub legacy plaintext localStorage keys immediately
  useEffect(() => {
    scrubLegacyBrowserSecrets();
  }, []);

  // Sync Tailwind dark class with theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme !== 'light');
  }, [settings.theme]);

  // Listen for browser back/forward navigation between Studio and /admin
  useEffect(() => {
    const handlePop = () => {
      setCurrentView(isAdminRoutePath() ? 'admin' : 'studio');
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  const navigateToAdmin = useCallback(() => {
    const base = getBasePathPrefix();
    window.history.pushState(null, '', `${base}admin`);
    setCurrentView('admin');
  }, []);

  const navigateToStudio = useCallback(() => {
    const base = getBasePathPrefix();
    window.history.pushState(null, '', base);
    setCurrentView('studio');
  }, []);

  const loadBufferBootstrap = useCallback(async (forceRefresh = false) => {
    setIsRefreshingChannels(true);
    try {
      const data = await fetchBufferBootstrap(forceRefresh);
      if (data.success) {
        setChannels(data.channels);
        if (data.rateLimit) setRateLimit(data.rateLimit);
      } else if (data.unauthorized) {
        setKeyStatus((prev) => ({ ...prev, hasBufferKey: false }));
        setChannels([]);
      } else if (data.error) {
        setAppBanner(data.error);
      }
    } catch {
      setAppBanner('Could not reach Buffer GraphQL proxy.');
    } finally {
      setIsRefreshingChannels(false);
    }
  }, []);

  const hydrateAuthenticatedSnapshot = useCallback(
    (snapshot: AuthSnapshot, options?: { triggerWelcome?: boolean }) => {
      if (!snapshot.user) return;
      setAuthUser(snapshot.user);

      if (snapshot.preferences) {
        setSettings({
          appName: snapshot.preferences.appName || DEFAULT_SETTINGS.appName,
          appSubtitle: snapshot.preferences.appSubtitle || DEFAULT_SETTINGS.appSubtitle,
          avatarUrl: snapshot.preferences.avatarUrl || '',
          theme: snapshot.preferences.theme || 'black',
          liquidGlass: Boolean(snapshot.preferences.liquidGlass),
        });
        setIsSidebarCollapsed(Boolean(snapshot.preferences.sidebarCollapsed));
      } else {
        setSettings(DEFAULT_SETTINGS);
        setIsSidebarCollapsed(false);
      }

      const nextKeyStatus = snapshot.keyStatus || { hasBufferKey: false, hasGeminiKey: false };
      setKeyStatus(nextKeyStatus);
      setChannels(Array.isArray(snapshot.channels) ? snapshot.channels : []);
      setScheduledPosts(
        Array.isArray(snapshot.scheduledPosts) ? snapshot.scheduledPosts : []
      );
      setSelectedChannelId('all');
      setAppBanner(null);

      // Clear ?resetToken from URL cleanly after login/reset
      if (window.location.search.includes('resetToken=')) {
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState(null, '', cleanUrl);
        setInitialResetToken(null);
      }

      if (options?.triggerWelcome !== false) {
        setWelcomeState({
          active: true,
          isNewUser: Boolean(snapshot.isNewUser || !snapshot.user.hasSeenWelcome),
        });
      }

      if (nextKeyStatus.hasBufferKey) {
        loadBufferBootstrap(false);
      }
    },
    [loadBufferBootstrap]
  );

  const bootSession = useCallback(async () => {
    const snap = await fetchCurrentSession();
    setBackendReachable(snap.backendReachable);
    setNeedsAdminBootstrap(Boolean(snap.needsAdminBootstrap));

    if (snap.authenticated && snap.user) {
      hydrateAuthenticatedSnapshot(snap, { triggerWelcome: true });
    } else {
      setAuthUser(null);
    }
    setAuthLoaded(true);
  }, [hydrateAuthenticatedSnapshot]);

  useEffect(() => {
    bootSession();
  }, [bootSession]);

  const handleLogout = async () => {
    await logoutSession();
    setAuthUser(null);
    setChannels([]);
    setScheduledPosts([]);
    setKeyStatus({ hasBufferKey: false, hasGeminiKey: false });
    setRateLimit({});
    setWelcomeState({ active: false, isNewUser: false });
    setSettings(DEFAULT_SETTINGS);
    navigateToStudio();
  };

  const handleWelcomeComplete = useCallback(() => {
    setWelcomeState((prev) => ({ ...prev, active: false }));
    if (authUser && !authUser.hasSeenWelcome) {
      markWelcomeAnimationSeen();
      setAuthUser((prev) => (prev ? { ...prev, hasSeenWelcome: true } : prev));
    }
  }, [authUser]);

  const handleSaveSettings = async (newSettings: AppSettings) => {
    setSettings(newSettings);
    await saveCloudPreferences(newSettings);
  };

  const handleToggleSidebarCollapse = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      saveCloudPreferences({ sidebarCollapsed: next });
      return next;
    });
  };

  const nextOpenSpot = useMemo(() => {
    return findNextBufferSpot(channels, selectedChannelId, scheduledPosts);
  }, [channels, selectedChannelId, scheduledPosts]);

  const weeklyPostCounts = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    const startKey = getLocalDateKey(startOfWeek);
    const endKey = getLocalDateKey(endOfWeek);

    const counts: Record<string, number> = {};
    for (const ch of channels) counts[ch.id] = 0;

    for (const post of scheduledPosts) {
      if (post.dateKey >= startKey && post.dateKey <= endKey) {
        if (post.channelId === 'all') {
          for (const ch of channels) counts[ch.id] = (counts[ch.id] || 0) + 1;
        } else {
          counts[post.channelId] = (counts[post.channelId] || 0) + 1;
        }
      }
    }
    return counts;
  }, [channels, scheduledPosts]);

  const handleOpenKeyModal = (step: 1 | 2 = 1) => {
    setKeyModalInitialStep(step);
    setIsKeyModalOpen(true);
  };

  const handleBufferConnected = (payload: {
    channels: BufferChannel[];
    rateLimit?: BufferRateLimitInfo;
  }) => {
    setChannels(payload.channels);
    if (payload.rateLimit) setRateLimit(payload.rateLimit);
    setKeyStatus((prev) => ({ ...prev, hasBufferKey: true }));
    setAppBanner(null);
  };

  const handleGeminiConnected = () => {
    setKeyStatus((prev) => ({ ...prev, hasGeminiKey: true }));
    setAppBanner(null);
  };

  const handleKeyCleared = (target: 'buffer' | 'gemini', updatedStatus: KeyStatus) => {
    setKeyStatus(updatedStatus);
    if (target === 'buffer') {
      setChannels([]);
      setRateLimit({});
      setSelectedChannelId('all');
    }
  };

  const handleClearIntegrationKey = async (target: 'buffer' | 'gemini') => {
    const updatedStatus = await clearIntegrationKey(target);
    handleKeyCleared(target, updatedStatus);
  };

  const handleOpenUploadForDate = (dateKey: string, time?: string) => {
    setTargetDateKey(dateKey);
    setTargetTime(time);
    setIsUploadWizardOpen(true);
  };

  const handlePostQueued = async (
    newPost: ScheduledPostItem,
    updatedRateLimit?: BufferRateLimitInfo
  ) => {
    setScheduledPosts((prev) => [newPost, ...prev]);
    if (updatedRateLimit) {
      setRateLimit(updatedRateLimit);
    }
    await createCloudPost(newPost);
  };

  const handleDeletePost = async (post: ScheduledPostItem) => {
    const bufferIds = post.bufferPostIds ? Object.values(post.bufferPostIds) : [];
    setScheduledPosts((prev) => prev.filter((p) => p.id !== post.id));
    await deleteCloudPost(post.id);

    if (keyStatus.hasBufferKey && bufferIds.length > 0) {
      try {
        const results = await Promise.all(bufferIds.map((id) => deleteBufferPostRemote(id)));
        const latestRate = results.find((r) => r?.rateLimit)?.rateLimit;
        if (latestRate) setRateLimit(latestRate);
      } catch {
        setAppBanner('Removed from your studio; could not reach Buffer API to delete remote post.');
      }
    }
  };

  const handleSaveEditedPost = async (updated: ScheduledPostItem) => {
    const bufferIds = updated.bufferPostIds ? Object.values(updated.bufferPostIds) : [];

    if (keyStatus.hasBufferKey && bufferIds.length > 0) {
      const [y, m, d] = updated.dateKey.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      const match = updated.time.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (match) {
        let h = parseInt(match[1], 10);
        const min = parseInt(match[2], 10);
        const isPM = match[3].toUpperCase() === 'PM';
        if (isPM && h < 12) h += 12;
        if (!isPM && h === 12) h = 0;
        dt.setHours(h, min, 0, 0);
      }

      const data = await updateBufferPostRemote(bufferIds[0], {
        text: updated.title,
        dueAt: dt.toISOString(),
      });
      if (data.rateLimit) setRateLimit(data.rateLimit);

      if (!data.success) {
        setAppBanner(data.error || 'Buffer GraphQL API could not update this post remotely.');
        return;
      }
    }

    setScheduledPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    await updateCloudPost(updated.id, updated);
  };

  const themeClasses =
    settings.theme === 'light'
      ? 'bg-[#ffffff] text-[#111111]'
      : settings.theme === 'charcoal'
      ? 'bg-[#0f1015] text-[#e5e5e5]'
      : 'bg-[#000000] text-[#e5e5e5]';

  const isLight = settings.theme === 'light';

  if (!authLoaded) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#000000] text-[#e5e5e5] font-sans">
        <span className="text-xs font-medium opacity-70">Loading studio...</span>
      </div>
    );
  }

  // Unauthenticated or password reset link view
  if (!authUser || initialResetToken) {
    return (
      <AuthScreen
        backendReachable={backendReachable}
        needsAdminBootstrap={needsAdminBootstrap}
        initialResetToken={initialResetToken}
        onBackendConnected={bootSession}
        onAuthenticated={(snapshot) => hydrateAuthenticatedSnapshot(snapshot, { triggerWelcome: true })}
      />
    );
  }

  return (
    <div className={`min-h-screen w-screen relative ${themeClasses}`}>
      {/* Full-Screen Monochrome Welcome Animation on Every Open / Refresh / Login */}
      {welcomeState.active && (
        <WelcomeAnimation
          displayName={authUser.displayName}
          isNewUser={welcomeState.isNewUser}
          onComplete={handleWelcomeComplete}
        />
      )}

      {/* /admin Dedicated Administrator Console */}
      {currentView === 'admin' ? (
        <AdminDashboard
          currentUser={authUser}
          onBackToStudio={navigateToStudio}
          onLogout={handleLogout}
        />
      ) : (
        <div
          className={`h-screen w-screen flex flex-col md:flex-row font-sans overflow-hidden select-none transition-colors duration-200 ${themeClasses}`}
        >
          {/* Integration Key Modal (Buffer / Gemini) */}
          <OnboardingModal
            isOpen={isKeyModalOpen}
            isFirstVisitBlocking={false}
            initialStep={keyModalInitialStep}
            keyStatus={keyStatus}
            theme={settings.theme}
            liquidGlass={settings.liquidGlass}
            onClose={() => setIsKeyModalOpen(false)}
            onBufferConnected={handleBufferConnected}
            onGeminiConnected={handleGeminiConnected}
            onKeyCleared={handleKeyCleared}
          />

          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 flex flex-col md:flex-row h-full w-full overflow-hidden"
          >
            {/* Mobile Top Navigation Bar */}
            <header
              className={`md:hidden flex items-center justify-between px-4 py-3 border-b shrink-0 z-30 ${
                isLight
                  ? 'bg-[#f7f7f8] border-neutral-200 text-neutral-900'
                  : 'bg-[#0d0e12] border-[#1c1e24] text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsMobileSidebarOpen(true)}
                  className={`p-1.5 rounded-lg border cursor-pointer ${
                    isLight
                      ? 'border-neutral-300 text-neutral-900 hover:bg-neutral-200'
                      : 'border-[#282b33] text-white hover:bg-[#161820]'
                  }`}
                  aria-label="Open Platforms Menu"
                >
                  <Menu className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-xl font-black flex items-center justify-center text-xs overflow-hidden ${
                      isLight ? 'bg-black text-white' : 'bg-white text-black'
                    }`}
                  >
                    {settings.avatarUrl ? (
                      <img
                        src={settings.avatarUrl}
                        alt="Logo"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span>{settings.appName.charAt(0) || 'B'}</span>
                    )}
                  </div>
                  <span
                    className={`font-extrabold text-sm ${
                      isLight ? 'text-neutral-900' : 'text-white'
                    }`}
                  >
                    {settings.appName}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {authUser.role === 'admin' && (
                  <button
                    type="button"
                    onClick={navigateToAdmin}
                    aria-label="Open Admin Console"
                    className={`p-2 rounded-lg border cursor-pointer ${
                      isLight
                        ? 'border-neutral-300 text-neutral-900'
                        : 'border-[#282b33] text-white'
                    }`}
                  >
                    <Shield className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setTargetDateKey(nextOpenSpot.dateKey);
                    setTargetTime(undefined);
                    setIsUploadWizardOpen(true);
                  }}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold transition shadow-sm flex items-center gap-1.5 cursor-pointer ${
                    isLight
                      ? 'bg-black text-white hover:bg-neutral-800'
                      : 'bg-white text-black hover:bg-neutral-200'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload</span>
                </button>
              </div>
            </header>

            {/* Collapsible Left Sidebar */}
            <Sidebar
              currentUser={authUser}
              channels={channels}
              selectedChannelId={selectedChannelId}
              onSelectChannel={(id) => setSelectedChannelId(id || 'all')}
              onOpenUpload={() => {
                setTargetDateKey(nextOpenSpot.dateKey);
                setTargetTime(undefined);
                setIsUploadWizardOpen(true);
              }}
              onOpenKeyModal={handleOpenKeyModal}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onOpenAdmin={authUser.role === 'admin' ? navigateToAdmin : undefined}
              onLogout={handleLogout}
              onRefreshChannels={() => loadBufferBootstrap(true)}
              isRefreshingChannels={isRefreshingChannels}
              keyStatus={keyStatus}
              isMobileOpen={isMobileSidebarOpen}
              onCloseMobile={() => setIsMobileSidebarOpen(false)}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={handleToggleSidebarCollapse}
              appName={settings.appName}
              appSubtitle={settings.appSubtitle}
              avatarUrl={settings.avatarUrl}
              bufferPlan={bufferPlan}
              weeklyPostCounts={weeklyPostCounts}
              rateLimit={rateLimit}
              theme={settings.theme}
            />

            {/* Middle Calendar */}
            <main className="flex-1 flex flex-col h-full overflow-hidden relative">
              {!keyStatus.hasBufferKey || !keyStatus.hasGeminiKey ? (
                <div
                  className={`px-4 py-2 text-xs border-b flex items-center justify-between gap-3 shrink-0 ${
                    isLight
                      ? 'bg-neutral-100 border-neutral-200 text-neutral-900'
                      : 'bg-[#0e1015] border-[#1c1e24] text-[#d4d4d8]'
                  }`}
                >
                  <span>
                    {!keyStatus.hasBufferKey && !keyStatus.hasGeminiKey
                      ? 'Connect your Buffer and Gemini API keys to sync channels and analyze videos.'
                      : !keyStatus.hasBufferKey
                      ? 'Connect your Buffer API key to load your channels and schedule.'
                      : 'Connect your Gemini API key to generate grounded video titles automatically.'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleOpenKeyModal(!keyStatus.hasBufferKey ? 1 : 2)}
                    className={`px-3 py-1 rounded-lg text-[11px] font-bold cursor-pointer shrink-0 ${
                      isLight ? 'bg-black text-white' : 'bg-white text-black'
                    }`}
                  >
                    Connect Keys
                  </button>
                </div>
              ) : null}

              {appBanner && (
                <div
                  role="status"
                  className={`px-4 py-2 text-xs border-b flex items-center justify-between gap-3 shrink-0 ${
                    isLight
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : 'bg-amber-950/35 border-amber-500/25 text-amber-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{appBanner}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAppBanner(null)}
                    aria-label="Dismiss notice"
                    className="p-0.5 rounded hover:bg-black/10 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <CalendarGrid
                currentDate={currentCalendarDate}
                onPrevMonth={() =>
                  setCurrentCalendarDate(
                    (d) => new Date(d.getFullYear(), d.getMonth() - 1, 1)
                  )
                }
                onNextMonth={() =>
                  setCurrentCalendarDate(
                    (d) => new Date(d.getFullYear(), d.getMonth() + 1, 1)
                  )
                }
                onToday={() => {
                  const now = new Date();
                  setCurrentCalendarDate(new Date(now.getFullYear(), now.getMonth(), 1));
                }}
                scheduledPosts={
                  selectedChannelId && selectedChannelId !== 'all'
                    ? scheduledPosts.filter(
                        (p) => p.channelId === selectedChannelId || p.channelId === 'all'
                      )
                    : scheduledPosts
                }
                nextOpenDateKey={nextOpenSpot.dateKey}
                nextOpenTime={nextOpenSpot.time}
                nextOpenTimeLabel={nextOpenSpot.label}
                onOpenUploadForDate={handleOpenUploadForDate}
                onEditPost={(post) => setEditingPost(post)}
                onDeletePost={handleDeletePost}
                channels={channels}
                selectedChannelId={selectedChannelId}
                theme={settings.theme}
              />
            </main>

            {/* 4-Step Upload Wizard Modal */}
            <UploadWizardModal
              isOpen={isUploadWizardOpen}
              onClose={() => setIsUploadWizardOpen(false)}
              channels={channels}
              selectedChannelId={selectedChannelId}
              nextBufferSpotLabel={nextOpenSpot.label}
              defaultDateKey={targetDateKey || nextOpenSpot.dateKey}
              defaultTime={targetTime || nextOpenSpot.time}
              keyStatus={keyStatus}
              theme={settings.theme}
              liquidGlass={settings.liquidGlass}
              onPostQueued={handlePostQueued}
              onOpenKeyModal={handleOpenKeyModal}
            />

            {/* Right-Click Edit Post Modal */}
            <EditPostModal
              post={editingPost}
              theme={settings.theme}
              liquidGlass={settings.liquidGlass}
              onClose={() => setEditingPost(null)}
              onSave={handleSaveEditedPost}
            />

            {/* Account & Studio Settings Modal */}
            <SettingsModal
              isOpen={isSettingsOpen}
              onClose={() => setIsSettingsOpen(false)}
              currentUser={authUser}
              onUserUpdated={(updated) => setAuthUser(updated)}
              onLogout={handleLogout}
              settings={settings}
              onSaveSettings={handleSaveSettings}
              keyStatus={keyStatus}
              channels={channels}
              onChannelsUpdated={(next) => setChannels(next)}
              rateLimit={rateLimit}
              onOpenKeyOnboarding={handleOpenKeyModal}
              onClearIntegrationKey={handleClearIntegrationKey}
              onRuntimeChanged={bootSession}
            />
          </motion.div>
        </div>
      )}
    </div>
  );
}
