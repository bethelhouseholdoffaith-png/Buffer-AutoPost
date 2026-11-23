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
} from 'lucide-react';
import { BufferRateLimitInfo, KeyStatus } from '../types';
import { LiquidGlassSurface } from './LiquidGlassSurface';

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
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  keyStatus: KeyStatus;
  rateLimit?: BufferRateLimitInfo;
  onOpenKeyOnboarding: (step: 1 | 2) => void;
  onClearIntegrationKey: (target: 'buffer' | 'gemini') => Promise<void>;
}

const AVATAR_PRESETS = [
  { id: 'b-logo', label: 'Monogram', url: '' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  keyStatus,
  rateLimit = {},
  onOpenKeyOnboarding,
  onClearIntegrationKey,
}) => {
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
  const [clearingTarget, setClearingTarget] = useState<'buffer' | 'gemini' | null>(null);

  useEffect(() => {
    if (isOpen) {
      setAppName(settings.appName || 'AutoBuffer');
      setAppSubtitle(settings.appSubtitle || 'Video Schedule Studio');
      setAvatarUrl(settings.avatarUrl || '');
      setTheme(settings.theme || 'black');
      setLiquidGlass(Boolean(settings.liquidGlass));
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const isLight = theme === 'light';

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

  const handleSave = () => {
    onSaveSettings({
      appName: appName.trim() || 'AutoBuffer',
      appSubtitle: appSubtitle.trim() || 'Video Schedule Studio',
      avatarUrl,
      theme,
      liquidGlass,
    });
    onClose();
  };

  const handleClear = async (target: 'buffer' | 'gemini') => {
    setClearingTarget(target);
    await onClearIntegrationKey(target);
    setClearingTarget(null);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-lg">
        <LiquidGlassSurface
          enabled={liquidGlass}
          isLight={isLight}
          className="rounded-2xl overflow-hidden"
        >
          {/* Header */}
          <div
            className={`px-6 py-4 border-b flex items-center justify-between ${
              isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Sliders className="w-4 h-4" />
              <h2 className="text-sm font-bold tracking-tight">Studio Settings</h2>
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

          {/* Body */}
          <div className="p-6 space-y-6 max-h-[78vh] overflow-y-auto">
            {/* Section 1: Studio Profile */}
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
                    <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
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
                      onClick={() => setAvatarUrl(AVATAR_PRESETS[0].url)}
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
                    placeholder="AutoBuffer"
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
                    placeholder="Video Schedule Studio"
                    className={`w-full px-3 py-2 rounded-xl border text-xs font-medium focus:outline-none transition ${
                      isLight
                        ? 'border-neutral-300 bg-white text-neutral-900 focus:border-black'
                        : 'border-[#2a2d36] bg-[#121419] text-white focus:border-white'
                    }`}
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Appearance & Opt-in Liquid Glass */}
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
                <button
                  type="button"
                  onClick={() => setTheme('black')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer relative ${
                    theme === 'black'
                      ? isLight
                        ? 'border-black ring-1 ring-black'
                        : 'border-white bg-[#050507]'
                      : isLight
                      ? 'border-neutral-200 hover:border-neutral-400'
                      : 'border-[#22242b] bg-[#0d0e12] hover:border-neutral-500'
                  }`}
                >
                  <div className="w-full h-7 rounded-md bg-black border border-white/20 mb-2 flex items-center px-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-white" />
                  </div>
                  <p className="text-xs font-bold leading-tight">Minimal Black</p>
                  {theme === 'black' && <Check className="w-3.5 h-3.5 absolute top-2.5 right-2.5" />}
                </button>

                <button
                  type="button"
                  onClick={() => setTheme('charcoal')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer relative ${
                    theme === 'charcoal'
                      ? isLight
                        ? 'border-black ring-1 ring-black'
                        : 'border-white bg-[#101217]'
                      : isLight
                      ? 'border-neutral-200 hover:border-neutral-400'
                      : 'border-[#22242b] bg-[#0d0e12] hover:border-neutral-500'
                  }`}
                >
                  <div className="w-full h-7 rounded-md bg-[#14171f] border border-[#2a2d36] mb-2 flex items-center px-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#9ea3ae]" />
                  </div>
                  <p className="text-xs font-bold leading-tight">Midnight</p>
                  {theme === 'charcoal' && (
                    <Check className="w-3.5 h-3.5 absolute top-2.5 right-2.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setTheme('light')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer relative ${
                    theme === 'light'
                      ? isLight
                        ? 'border-black ring-1 ring-black bg-neutral-50'
                        : 'border-white bg-[#181a20]'
                      : isLight
                      ? 'border-neutral-200 hover:border-neutral-400'
                      : 'border-[#22242b] bg-[#0d0e12] hover:border-neutral-500'
                  }`}
                >
                  <div className="w-full h-7 rounded-md bg-white border border-neutral-300 mb-2 flex items-center px-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-black" />
                  </div>
                  <p className="text-xs font-bold leading-tight">Light Monochrome</p>
                  {theme === 'light' && <Check className="w-3.5 h-3.5 absolute top-2.5 right-2.5" />}
                </button>
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

            {/* Section 3: API Connections (HttpOnly Cookie Managed) */}
            <div
              className={`space-y-3 pt-4 border-t ${
                isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#8e929c]">
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>API Connections</span>
                </div>
                <span className="text-[11px] text-[#7b808c] flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  HttpOnly cookies
                </span>
              </div>

              {/* Buffer Connection Row */}
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
                    <span className={keyStatus.hasBufferKey ? 'text-emerald-500' : 'text-[#7b808c]'}>
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
                      title="Disconnect & clear Buffer key"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Gemini Connection Row */}
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
                    <span className={keyStatus.hasGeminiKey ? 'text-emerald-500' : 'text-[#7b808c]'}>
                      {keyStatus.hasGeminiKey ? 'Connected' : 'Not connected'}
                    </span>
                  </p>
                  <p className="text-[11px] text-[#7b808c] mt-0.5">
                    Analyzes uploaded videos directly via Files API.
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
                      title="Disconnect & clear Gemini key"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            className={`px-6 py-4 border-t flex items-center justify-between ${
              isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
            }`}
          >
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2 text-xs font-semibold cursor-pointer ${
                isLight
                  ? 'text-neutral-600 hover:text-black'
                  : 'text-[#9ea3ae] hover:text-white'
              }`}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              className={`px-5 py-2 rounded-xl text-xs font-bold transition cursor-pointer active:scale-[0.98] ${
                isLight
                  ? 'bg-black text-white hover:bg-neutral-800'
                  : 'bg-white text-black hover:bg-neutral-200'
              }`}
            >
              Save Changes
            </button>
          </div>
        </LiquidGlassSurface>
      </div>
    </div>
  );
};
