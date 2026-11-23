import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Menu, Upload, AlertCircle, X } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { CalendarGrid, ScheduledPostItem } from './components/CalendarGrid';
import { UploadWizardModal } from './components/UploadWizardModal';
import { SettingsModal, AppSettings } from './components/SettingsModal';
import { EditPostModal } from './components/EditPostModal';
import { OnboardingModal } from './features/onboarding/OnboardingModal';
import {
  BufferChannel,
  BufferPlanTier,
  BufferRateLimitInfo,
  KeyStatus,
} from './types';
import { findNextBufferSpot, getLocalDateKey } from './utils/bufferSchedule';
import {
  clearIntegrationKey,
  deleteBufferPostRemote,
  initRuntimeAndKeyStatus,
  loadBufferBootstrap as fetchBufferBootstrap,
  updateBufferPostRemote,
} from './services/studioApi';

const DEFAULT_SETTINGS: AppSettings = {
  appName: 'AutoBuffer',
  appSubtitle: 'Video Schedule Studio',
  avatarUrl: '',
  theme: 'black',
  liquidGlass: false,
};

function readInitialSettings(): AppSettings {
  try {
    const saved = localStorage.getItem('autobuffer_settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        appName: parsed.appName || DEFAULT_SETTINGS.appName,
        appSubtitle: parsed.appSubtitle || DEFAULT_SETTINGS.appSubtitle,
        avatarUrl: parsed.avatarUrl || '',
        theme:
          parsed.theme === 'light' || parsed.theme === 'charcoal' || parsed.theme === 'black'
            ? parsed.theme
            : 'black',
        liquidGlass: Boolean(parsed.liquidGlass),
      };
    }
  } catch {
    // ignore malformed storage
  }
  return DEFAULT_SETTINGS;
}

export default function App() {
  const prefersReducedMotion = useReducedMotion();

  // Studio Settings (non-secret UI preferences only)
  const [settings, setSettings] = useState<AppSettings>(readInitialSettings);

  // Sync Tailwind dark class immediately & on theme toggle
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme !== 'light');
    try {
      localStorage.setItem('autobuffer_settings', JSON.stringify(settings));
    } catch {
      // ignore storage errors
    }
  }, [settings]);

  // Scrub any legacy pre-migration plaintext keys from browser storage
  useEffect(() => {
    try {
      localStorage.removeItem('buffer_api_key');
      localStorage.removeItem('buffer_saved_channels');
      localStorage.removeItem('autobuffer_api_usage');
    } catch {
      // ignore
    }
  }, []);

  // HttpOnly Cookie Integration Key Status (boolean flags only, never raw keys)
  const [keyStatus, setKeyStatus] = useState<KeyStatus>({
    hasBufferKey: false,
    hasGeminiKey: false,
  });
  const [keyStatusLoaded, setKeyStatusLoaded] = useState(false);

  // Buffer GraphQL Channels, Plan & Live Rate-Limit Telemetry
  const [channels, setChannels] = useState<BufferChannel[]>([]);
  const [bufferPlan, setBufferPlan] = useState<BufferPlanTier>('free');
  const [rateLimit, setRateLimit] = useState<BufferRateLimitInfo>({});
  const [isRefreshingChannels, setIsRefreshingChannels] = useState(false);
  const [appBanner, setAppBanner] = useState<string | null>(null);

  // Default posting platform set to 'all'
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>('all');

  // Onboarding / Key Update Modal State
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [keyModalInitialStep, setKeyModalInitialStep] = useState<1 | 2>(1);

  // Other Modals, Sidebar Collapse & Mobile Drawer State
  const [isUploadWizardOpen, setIsUploadWizardOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('autobuffer_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  // Right-click edit post state
  const [editingPost, setEditingPost] = useState<ScheduledPostItem | null>(null);

  // Calendar State: Current Local Month
  const [currentCalendarDate, setCurrentCalendarDate] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPostItem[]>(() => {
    try {
      const saved = localStorage.getItem('autobuffer_scheduled_posts');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Target date & time for opening upload wizard
  const [targetDateKey, setTargetDateKey] = useState<string>(() => getLocalDateKey(new Date()));
  const [targetTime, setTargetTime] = useState<string | undefined>(undefined);

  useEffect(() => {
    try {
      localStorage.setItem('autobuffer_sidebar_collapsed', String(isSidebarCollapsed));
    } catch {
      // ignore
    }
  }, [isSidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem('autobuffer_scheduled_posts', JSON.stringify(scheduledPosts));
    } catch {
      // ignore
    }
  }, [scheduledPosts]);

  // Fetch Buffer GraphQL bootstrap (channels + recurring weekly postingSchedule + live rateLimit)
  const loadBufferBootstrap = useCallback(async (forceRefresh = false) => {
    setIsRefreshingChannels(true);
    try {
      const data = await fetchBufferBootstrap(forceRefresh);
      if (data.success) {
        setChannels(data.channels);
        if (data.rateLimit) {
          setRateLimit(data.rateLimit);
        }
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

  // Re-detect runtime mode (backend vs static GitHub Pages) and refresh keys + channels
  const refreshStudioSession = useCallback(async () => {
    try {
      const init = await initRuntimeAndKeyStatus();
      setKeyStatus(init.keyStatus);
      setKeyStatusLoaded(true);

      if (init.keyStatus.hasBufferKey) {
        await loadBufferBootstrap(false);
      } else {
        setChannels([]);
        setRateLimit({});
      }
    } catch {
      setKeyStatusLoaded(true);
    }
  }, [loadBufferBootstrap]);

  // Boot sequence: detect backend vs static mode and load key status before showing onboarding or dashboard
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const init = await initRuntimeAndKeyStatus();
        if (!active) return;

        setKeyStatus(init.keyStatus);
        setKeyStatusLoaded(true);

        if (init.keyStatus.hasBufferKey) {
          await loadBufferBootstrap(false);
        }
      } catch {
        if (active) {
          setKeyStatusLoaded(true);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [loadBufferBootstrap]);

  // First-visit sequential onboarding is blocking until BOTH Buffer and Gemini HttpOnly cookies are set
  const isFirstVisitBlocking =
    keyStatusLoaded && (!keyStatus.hasBufferKey || !keyStatus.hasGeminiKey);

  // Dynamically calculate next available active Buffer spot (skips paused schedules/channels)
  const nextOpenSpot = useMemo(() => {
    return findNextBufferSpot(channels, selectedChannelId, scheduledPosts);
  }, [channels, selectedChannelId, scheduledPosts]);

  // Compute weekly post counts per channel for sidebar posting goals
  const weeklyPostCounts = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - now.getDay()
    );
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    const startKey = getLocalDateKey(startOfWeek);
    const endKey = getLocalDateKey(endOfWeek);

    const counts: Record<string, number> = {};
    for (const ch of channels) counts[ch.id] = 0;

    for (const post of scheduledPosts) {
      if (post.dateKey >= startKey && post.dateKey <= endKey) {
        if (post.channelId === 'all') {
          for (const ch of channels) {
            counts[ch.id] = (counts[ch.id] || 0) + 1;
          }
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

  const handlePostQueued = (
    newPost: ScheduledPostItem,
    updatedRateLimit?: BufferRateLimitInfo
  ) => {
    setScheduledPosts((prev) => [newPost, ...prev]);
    if (updatedRateLimit) {
      setRateLimit(updatedRateLimit);
    }
  };

  // Right-click Delete Post via studioApi
  const handleDeletePost = async (post: ScheduledPostItem) => {
    const bufferIds = post.bufferPostIds ? Object.values(post.bufferPostIds) : [];
    setScheduledPosts((prev) => prev.filter((p) => p.id !== post.id));

    if (keyStatus.hasBufferKey && bufferIds.length > 0) {
      try {
        const results = await Promise.all(bufferIds.map((id) => deleteBufferPostRemote(id)));
        const latestRate = results.find((r) => r?.rateLimit)?.rateLimit;
        if (latestRate) setRateLimit(latestRate);
      } catch {
        setAppBanner('Removed locally; could not reach Buffer GraphQL API to delete remote post.');
      }
    }
  };

  // Right-click Edit Post Save via studioApi
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
        setAppBanner(
          data.error ||
            'Buffer GraphQL API could not update this post remotely.'
        );
        return;
      }
    }

    setScheduledPosts((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );
  };

  // Theme styles based on Settings
  const themeClasses =
    settings.theme === 'light'
      ? 'bg-[#ffffff] text-[#111111]'
      : settings.theme === 'charcoal'
      ? 'bg-[#0f1015] text-[#e5e5e5]'
      : 'bg-[#000000] text-[#e5e5e5]';

  const isLight = settings.theme === 'light';

  // Wait cleanly for initial HttpOnly key status check before showing onboarding or dashboard
  if (!keyStatusLoaded) {
    return (
      <div
        className={`h-screen w-screen flex items-center justify-center font-sans ${themeClasses}`}
      >
        <div className="flex items-center gap-2.5 text-xs font-medium opacity-70">
          <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
          <span>Initializing studio...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`h-screen w-screen flex flex-col md:flex-row font-sans overflow-hidden select-none transition-colors duration-200 ${themeClasses}`}
    >
      {/* First-Visit Sequential Onboarding (01/02 Buffer -> 02/02 Gemini) OR Re-triggered Key Modal */}
      <AnimatePresence>
        {(isFirstVisitBlocking || isKeyModalOpen) && (
          <OnboardingModal
            isOpen={true}
            isFirstVisitBlocking={isFirstVisitBlocking}
            initialStep={
              isFirstVisitBlocking
                ? !keyStatus.hasBufferKey
                  ? 1
                  : 2
                : keyModalInitialStep
            }
            keyStatus={keyStatus}
            theme={settings.theme}
            liquidGlass={settings.liquidGlass}
            onClose={
              isFirstVisitBlocking ? undefined : () => setIsKeyModalOpen(false)
            }
            onBufferConnected={handleBufferConnected}
            onGeminiConnected={handleGeminiConnected}
            onKeyCleared={handleKeyCleared}
          />
        )}
      </AnimatePresence>

      {/* Main Studio Shell (rendered gently once initial onboarding is complete) */}
      {!isFirstVisitBlocking && (
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
          </header>

          {/* Collapsible Left Sidebar */}
          <Sidebar
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
            onRefreshChannels={() => loadBufferBootstrap(true)}
            isRefreshingChannels={isRefreshingChannels}
            keyStatus={keyStatus}
            isMobileOpen={isMobileSidebarOpen}
            onCloseMobile={() => setIsMobileSidebarOpen(false)}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed((c) => !c)}
            appName={settings.appName}
            appSubtitle={settings.appSubtitle}
            avatarUrl={settings.avatarUrl}
            bufferPlan={bufferPlan}
            weeklyPostCounts={weeklyPostCounts}
            rateLimit={rateLimit}
            theme={settings.theme}
          />

          {/* Middle Window-Resizing Calendar */}
          <main className="flex-1 flex flex-col h-full overflow-hidden relative">
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
                setCurrentCalendarDate(
                  new Date(now.getFullYear(), now.getMonth(), 1)
                );
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

          {/* Settings Modal */}
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            settings={settings}
            onSaveSettings={(newSettings) => setSettings(newSettings)}
            keyStatus={keyStatus}
            rateLimit={rateLimit}
            onOpenKeyOnboarding={handleOpenKeyModal}
            onClearIntegrationKey={handleClearIntegrationKey}
            onRuntimeChanged={refreshStudioSession}
          />
        </motion.div>
      )}
    </div>
  );
}
