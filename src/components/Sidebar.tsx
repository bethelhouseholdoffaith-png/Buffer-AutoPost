import React from 'react';
import {
  AuthUser,
  BufferChannel,
  BufferPlanTier,
  BufferRateLimitInfo,
  KeyStatus,
} from '../types';
import { PlatformIcon } from './PlatformIcon';
import {
  Upload,
  KeyRound,
  ChevronRight,
  Check,
  X,
  Globe,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  ExternalLink,
  ArrowUpRight,
  RefreshCw,
  Shield,
  LogOut,
} from 'lucide-react';

interface SidebarProps {
  currentUser: AuthUser;
  channels: BufferChannel[];
  selectedChannelId: string | null;
  onSelectChannel: (id: string | null) => void;
  onOpenUpload: () => void;
  onOpenKeyModal: (step?: 1 | 2) => void;
  onOpenSettings: () => void;
  onOpenAdmin?: () => void;
  onLogout: () => Promise<void>;
  onRefreshChannels?: () => void;
  isRefreshingChannels?: boolean;
  keyStatus: KeyStatus;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  appName?: string;
  appSubtitle?: string;
  avatarUrl?: string;
  bufferPlan?: BufferPlanTier;
  weeklyPostCounts?: Record<string, number>;
  rateLimit?: BufferRateLimitInfo;
  theme?: 'black' | 'charcoal' | 'light';
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentUser,
  channels,
  selectedChannelId,
  onSelectChannel,
  onOpenUpload,
  onOpenKeyModal,
  onOpenSettings,
  onOpenAdmin,
  onLogout,
  onRefreshChannels,
  isRefreshingChannels = false,
  keyStatus,
  isMobileOpen,
  onCloseMobile,
  isCollapsed,
  onToggleCollapse,
  appName = 'AutoBuffer',
  appSubtitle = 'Video Schedule Studio',
  avatarUrl = '',
  bufferPlan = 'free',
  weeklyPostCounts = {},
  rateLimit = {},
  theme = 'black',
}) => {
  const isAllSelected = selectedChannelId === null || selectedChannelId === 'all';
  const isLight = theme === 'light';
  const bothConnected = keyStatus.hasBufferKey && keyStatus.hasGeminiKey;

  const planLabels: Record<BufferPlanTier, { label: string; badgeClass: string }> = {
    free: {
      label: 'Free Plan',
      badgeClass: isLight ? 'text-neutral-600' : 'text-[#8e929c]',
    },
    essentials: {
      label: 'Essentials Plan',
      badgeClass: isLight ? 'text-neutral-800' : 'text-[#c9ccd4]',
    },
    team: {
      label: 'Team Plan',
      badgeClass: isLight ? 'text-black font-bold' : 'text-white font-bold',
    },
  };

  const activePlan = planLabels[bufferPlan] || planLabels.free;

  const rateLimitSummary =
    typeof rateLimit.remaining15m === 'number'
      ? `${rateLimit.remaining15m}${rateLimit.limit15m ? `/${rateLimit.limit15m}` : ''} req left`
      : keyStatus.hasBufferKey
      ? 'GraphQL active'
      : 'Connect keys to start';

  const renderSidebarContent = (collapsed: boolean) => (
    <div
      className={`flex flex-col h-full justify-between border-r font-sans transition-all duration-200 ${
        collapsed ? 'p-2.5 items-center' : 'p-4'
      } ${
        isLight
          ? 'bg-[#f7f7f8] text-[#111111] border-neutral-200'
          : theme === 'charcoal'
          ? 'bg-[#0f1015] text-[#e5e5e5] border-[#1c1e24]'
          : 'bg-[#0a0a0c] text-[#e5e5e5] border-[#1c1e24]'
      }`}
    >
      <div className={`space-y-3.5 ${collapsed ? 'w-full flex flex-col items-center' : 'w-full'}`}>
        {/* App Profile, Name & Collapse Toggle */}
        <div
          className={`flex items-center pb-3 border-b w-full ${
            isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
          } ${collapsed ? 'justify-center flex-col gap-2' : 'justify-between'}`}
        >
          <div className={`flex items-center gap-2.5 min-w-0 ${collapsed ? 'justify-center' : ''}`}>
            <div
              className={`w-9 h-9 rounded-xl font-black flex items-center justify-center text-sm shadow-sm overflow-hidden shrink-0 border ${
                isLight
                  ? 'bg-black text-white border-black/10'
                  : 'bg-white text-black border-white/20'
              }`}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={appName} className="w-full h-full object-cover" />
              ) : (
                <span>{appName.charAt(0) || 'B'}</span>
              )}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <h1
                  className={`text-sm font-bold tracking-tight leading-none truncate ${
                    isLight ? 'text-neutral-900' : 'text-white'
                  }`}
                >
                  {appName}
                </h1>
                <p className="text-[11px] text-[#737373] mt-1 font-medium truncate">
                  {appSubtitle}
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            {!collapsed && (
              <button
                onClick={onOpenSettings}
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  isLight
                    ? 'text-neutral-500 hover:text-black hover:bg-neutral-200'
                    : 'text-[#737373] hover:text-white hover:bg-[#161820]'
                }`}
                title="Account & Studio Settings"
                aria-label="Open Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={onToggleCollapse}
              className={`hidden md:inline-flex p-1.5 rounded-lg transition cursor-pointer ${
                isLight
                  ? 'text-neutral-500 hover:text-black hover:bg-neutral-200'
                  : 'text-[#737373] hover:text-white hover:bg-[#161820]'
              }`}
              title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
              aria-label={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {collapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={onCloseMobile}
              aria-label="Close menu"
              className={`md:hidden p-1.5 rounded-lg cursor-pointer ${
                isLight ? 'text-neutral-600 hover:text-black' : 'text-[#737373] hover:text-white'
              }`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Buffer Plan & Upgrade Row */}
        {!collapsed && (
          <div className="flex items-center justify-between gap-2 px-0.5 text-[11px]">
            <span className={`font-semibold ${activePlan.badgeClass}`}>{activePlan.label}</span>
            <a
              href="https://buffer.com/pricing"
              target="_blank"
              rel="noopener noreferrer"
              className={`font-medium flex items-center gap-0.5 hover:underline ${
                isLight ? 'text-neutral-600 hover:text-black' : 'text-[#9ea3ae] hover:text-white'
              }`}
            >
              <span>{bufferPlan === 'team' ? 'Manage' : 'Upgrade'}</span>
              <ArrowUpRight className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* Primary Upload Action */}
        <div className={collapsed ? 'w-full flex justify-center' : 'w-full'}>
          <button
            onClick={() => {
              onOpenUpload();
              onCloseMobile();
            }}
            title="Upload Video"
            className={`rounded-xl font-bold text-xs transition shadow-sm flex items-center justify-center gap-2 group cursor-pointer active:scale-[0.98] ${
              collapsed ? 'w-10 h-10 p-0' : 'w-full py-2.5 px-4'
            } ${
              isLight
                ? 'bg-black text-white hover:bg-neutral-800'
                : 'bg-white text-black hover:bg-neutral-200'
            }`}
          >
            <Upload className="w-4 h-4 stroke-[2.2] shrink-0" />
            {!collapsed && <span>Upload Video</span>}
          </button>
        </div>

        {/* Platforms List */}
        <div className={`space-y-1 ${collapsed ? 'w-full flex flex-col items-center' : 'w-full'}`}>
          {!collapsed && (
            <div className="flex items-center justify-between px-2 pt-1 pb-1 text-[11px] font-semibold text-[#7b808c]">
              <span className="tabular-nums">Channels ({channels.length})</span>
              <div className="flex items-center gap-2">
                {keyStatus.hasBufferKey && onRefreshChannels && (
                  <button
                    type="button"
                    onClick={onRefreshChannels}
                    disabled={isRefreshingChannels}
                    title="Refresh Buffer channels and schedule"
                    aria-label="Refresh channels"
                    className={`p-0.5 rounded transition cursor-pointer ${
                      isLight ? 'hover:text-black' : 'hover:text-white'
                    }`}
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${isRefreshingChannels ? 'animate-spin' : ''}`}
                    />
                  </button>
                )}
                {!isAllSelected && (
                  <button
                    onClick={() => onSelectChannel('all')}
                    className={`hover:underline text-[11px] cursor-pointer ${
                      isLight ? 'text-black' : 'text-white'
                    }`}
                  >
                    All
                  </button>
                )}
              </div>
            </div>
          )}

          <div
            className={`space-y-1 overflow-y-auto ${
              collapsed
                ? 'max-h-[calc(100vh-300px)] flex flex-col items-center w-full'
                : 'max-h-[calc(100vh-430px)] pr-0.5 w-full'
            }`}
          >
            <button
              onClick={() => {
                onSelectChannel('all');
                onCloseMobile();
              }}
              title="All Channels"
              className={`flex items-center rounded-xl text-xs font-semibold transition cursor-pointer ${
                collapsed ? 'w-10 h-10 justify-center p-0' : 'w-full justify-between px-3 py-2'
              } ${
                isAllSelected
                  ? isLight
                    ? 'bg-black text-white shadow-sm'
                    : 'bg-white text-black shadow-sm'
                  : isLight
                  ? 'text-neutral-600 hover:bg-neutral-200 hover:text-black'
                  : 'text-[#a3a3a3] hover:bg-[#14161c] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Globe
                  className={`w-4 h-4 shrink-0 ${
                    isAllSelected
                      ? isLight
                        ? 'text-white'
                        : 'text-black'
                      : isLight
                      ? 'text-neutral-800'
                      : 'text-white'
                  }`}
                />
                {!collapsed && <span className="truncate">All Channels</span>}
              </div>
              {!collapsed && isAllSelected && <Check className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />}
            </button>

            {channels.map((ch) => {
              const isSelected = selectedChannelId === ch.id;
              const channelTitle = ch.name || 'Channel';
              const rawHandle =
                ch.handle ||
                (ch.displayName
                  ? `@${ch.displayName}`
                  : `@${channelTitle.toLowerCase().replace(/[^a-z0-9_]/g, '')}`);
              const channelHandle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;

              const weeklyGoal = ch.postingGoal || 5;
              const currentWeekPosts = weeklyPostCounts[ch.id] || 0;

              return (
                <button
                  key={ch.id}
                  onClick={() => {
                    onSelectChannel(isSelected ? 'all' : ch.id);
                    onCloseMobile();
                  }}
                  title={`${channelTitle} (${channelHandle})${ch.isQueuePaused ? ' · Queue Paused' : ''} · ${currentWeekPosts}/${weeklyGoal}/wk`}
                  className={`flex items-center rounded-xl text-xs transition text-left group cursor-pointer ${
                    collapsed
                      ? 'w-10 h-10 justify-center p-0 relative'
                      : 'w-full justify-between px-2.5 py-2 gap-2'
                  } ${
                    isSelected
                      ? isLight
                        ? 'bg-neutral-200 text-black font-semibold border border-neutral-300'
                        : 'bg-[#181a20] text-white font-semibold border border-[#323642]'
                      : isLight
                      ? 'text-neutral-600 hover:bg-neutral-200/70 hover:text-black border border-transparent'
                      : 'text-[#a3a3a3] hover:bg-[#121419] hover:text-white border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <PlatformIcon service={ch.service} size={18} />

                    {!collapsed && (
                      <div className="min-w-0 flex-1">
                        <p
                          className={`truncate text-xs font-semibold leading-tight ${
                            isLight ? 'text-neutral-900' : 'text-white'
                          }`}
                        >
                          {channelTitle}
                        </p>
                        <p className="text-[10px] text-[#7b808c] truncate font-medium">
                          {ch.isQueuePaused ? `${channelHandle} · Paused` : channelHandle}
                        </p>
                      </div>
                    )}
                  </div>

                  {!collapsed && (
                    <span
                      className={`text-[10px] font-medium tabular-nums shrink-0 ${
                        currentWeekPosts >= weeklyGoal
                          ? isLight
                            ? 'text-black font-bold'
                            : 'text-white font-bold'
                          : 'text-[#7b808c]'
                      }`}
                      title={`Weekly Posting Goal: ${currentWeekPosts} of ${weeklyGoal} posts`}
                    >
                      {currentWeekPosts}/{weeklyGoal}
                    </span>
                  )}
                </button>
              );
            })}

            {!collapsed && channels.length === 0 && (
              <p className="px-2.5 py-3 text-[11px] text-[#7b808c]">
                {keyStatus.hasBufferKey
                  ? 'No channels found in this Buffer account.'
                  : 'Connect Buffer to load your channels and weekly slots.'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Connection Status, Admin Link & Account Bar */}
      <div
        className={`pt-3 border-t space-y-2 ${
          isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
        } ${collapsed ? 'w-full flex flex-col items-center' : 'w-full'}`}
      >
        {currentUser.role === 'admin' && onOpenAdmin && (
          <button
            type="button"
            onClick={() => {
              onOpenAdmin();
              onCloseMobile();
            }}
            title="Admin Console (/admin)"
            className={`flex items-center rounded-xl text-xs font-semibold border transition cursor-pointer ${
              collapsed ? 'w-10 h-10 justify-center p-0' : 'w-full justify-between px-3 py-2'
            } ${
              isLight
                ? 'border-neutral-300 bg-white text-neutral-900 hover:border-black'
                : 'border-[#252832] bg-[#12141a] text-white hover:border-white/40'
            }`}
          >
            <span className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 shrink-0" />
              {!collapsed && <span>Admin Console</span>}
            </span>
            {!collapsed && <ChevronRight className="w-3.5 h-3.5 text-[#737373]" />}
          </button>
        )}

        {collapsed && (
          <button
            onClick={onOpenSettings}
            className={`p-2 rounded-xl transition cursor-pointer ${
              isLight
                ? 'text-neutral-500 hover:text-black hover:bg-neutral-200'
                : 'text-[#737373] hover:text-white hover:bg-[#161820]'
            }`}
            title="Account & Studio Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        )}

        {!collapsed && (
          <a
            href="https://publish.buffer.com/settings/api"
            target="_blank"
            rel="noopener noreferrer"
            className={`w-full flex items-center justify-between px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
              isLight
                ? 'text-neutral-600 hover:text-black hover:bg-neutral-200'
                : 'text-[#9ea3ae] hover:text-white hover:bg-[#121419]'
            }`}
          >
            <span>Manage Buffer API Key</span>
            <ExternalLink className="w-3 h-3 shrink-0" />
          </a>
        )}

        {/* API Connection Status */}
        <button
          onClick={() => {
            onOpenKeyModal(!keyStatus.hasBufferKey ? 1 : !keyStatus.hasGeminiKey ? 2 : 1);
            onCloseMobile();
          }}
          title={
            bothConnected
              ? `Buffer & Gemini Connected · ${rateLimitSummary}`
              : 'Configure Buffer & Gemini API Keys'
          }
          className={`flex items-center rounded-xl text-xs font-semibold border transition cursor-pointer ${
            collapsed ? 'w-10 h-10 justify-center p-0' : 'w-full justify-between p-2.5'
          } ${
            isLight
              ? 'bg-white border-neutral-300 text-neutral-900 hover:border-neutral-500'
              : 'bg-[#111318] border-[#252832] text-white hover:border-white/30'
          }`}
        >
          <div className={`flex items-center min-w-0 ${collapsed ? 'justify-center' : 'gap-2.5'}`}>
            <KeyRound
              className={`w-3.5 h-3.5 shrink-0 ${
                bothConnected ? 'text-emerald-400' : 'text-[#8e929c]'
              }`}
            />

            {!collapsed && (
              <div className="min-w-0 text-left">
                <span
                  className={`font-semibold block text-xs leading-none ${
                    isLight ? 'text-neutral-900' : 'text-white'
                  }`}
                >
                  API Connections
                </span>
                <p className="text-[10px] text-[#7b808c] mt-1 truncate tabular-nums">
                  Buffer: {keyStatus.hasBufferKey ? 'Connected' : 'Missing'} · Gemini:{' '}
                  {keyStatus.hasGeminiKey ? 'Connected' : 'Missing'}
                </p>
              </div>
            )}
          </div>
          {!collapsed && <ChevronRight className="w-3.5 h-3.5 text-[#737373] shrink-0" />}
        </button>

        {/* Signed-in User Summary & Logout */}
        {!collapsed ? (
          <div
            className={`pt-2 border-t flex items-center justify-between gap-2 ${
              isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
            }`}
          >
            <button
              type="button"
              onClick={onOpenSettings}
              className="min-w-0 text-left flex-1 cursor-pointer group"
              title="Open account settings"
            >
              <p className="text-xs font-semibold truncate group-hover:underline">
                {currentUser.displayName}
              </p>
              <p className="text-[10px] text-[#7b808c] truncate">{currentUser.email}</p>
            </button>
            <button
              type="button"
              onClick={onLogout}
              title="Sign out"
              aria-label="Sign out"
              className={`p-1.5 rounded-lg transition cursor-pointer shrink-0 ${
                isLight
                  ? 'text-neutral-500 hover:text-rose-600 hover:bg-rose-50'
                  : 'text-[#8e929c] hover:text-rose-400 hover:bg-rose-500/10'
              }`}
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onLogout}
            title="Sign out"
            className={`p-2 rounded-xl transition cursor-pointer ${
              isLight
                ? 'text-neutral-500 hover:text-rose-600'
                : 'text-[#8e929c] hover:text-rose-400'
            }`}
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <aside
        className={`hidden md:flex flex-col shrink-0 h-screen sticky top-0 transition-all duration-200 ${
          isCollapsed ? 'w-[72px]' : 'w-68'
        }`}
      >
        {renderSidebarContent(isCollapsed)}
      </aside>

      {isMobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={onCloseMobile}
          />
          <div className="relative w-72 max-w-[82vw] h-full shadow-2xl z-10">
            {renderSidebarContent(false)}
          </div>
        </div>
      )}
    </>
  );
};
