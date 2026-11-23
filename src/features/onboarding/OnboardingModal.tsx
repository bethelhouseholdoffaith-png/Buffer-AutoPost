import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { BufferChannel, BufferRateLimitInfo, KeyStatus } from '../../types';
import { LiquidGlassSurface } from '../../components/LiquidGlassSurface';
import {
  acceptStaticBufferMode,
  clearIntegrationKey,
  connectBufferKey,
  connectGeminiKey,
  getRuntimeInfo,
  testAndSaveBackendUrl,
} from '../../services/studioApi';

interface OnboardingModalProps {
  isOpen: boolean;
  isFirstVisitBlocking: boolean;
  initialStep?: 1 | 2;
  keyStatus: KeyStatus;
  theme?: 'black' | 'charcoal' | 'light';
  liquidGlass?: boolean;
  onClose?: () => void;
  onBufferConnected: (payload: {
    channels: BufferChannel[];
    rateLimit?: BufferRateLimitInfo;
  }) => void;
  onGeminiConnected: () => void;
  onKeyCleared: (target: 'buffer' | 'gemini', updatedStatus: KeyStatus) => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  isFirstVisitBlocking,
  initialStep,
  keyStatus,
  theme = 'black',
  liquidGlass = false,
  onClose,
  onBufferConnected,
  onGeminiConnected,
  onKeyCleared,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const isLight = theme === 'light';

  const resolvedDefaultStep: 1 | 2 =
    initialStep || (!keyStatus.hasBufferKey ? 1 : !keyStatus.hasGeminiKey ? 2 : 1);

  const [step, setStep] = useState<1 | 2>(resolvedDefaultStep);
  const [direction, setDirection] = useState<'left' | 'right'>('left');

  // Transient form inputs ONLY (cleared immediately after each submission)
  const [bufferInput, setBufferInput] = useState('');
  const [geminiInput, setGeminiInput] = useState('');
  const [showBufferKey, setShowBufferKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  const [isValidating, setIsValidating] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [bufferCorsBlocked, setBufferCorsBlocked] = useState(false);
  const [backendUrlInput, setBackendUrlInput] = useState(() => getRuntimeInfo().backendUrl);

  const runtimeMode = getRuntimeInfo().mode;

  useEffect(() => {
    if (isOpen) {
      setStep(initialStep || (!keyStatus.hasBufferKey ? 1 : !keyStatus.hasGeminiKey ? 2 : 1));
      setDirection('left');
      setBufferInput('');
      setGeminiInput('');
      setShowBufferKey(false);
      setShowGeminiKey(false);
      setErrorMsg(null);
      setSuccessMsg(null);
      setBufferCorsBlocked(false);
      setBackendUrlInput(getRuntimeInfo().backendUrl);
    }
  }, [isOpen, initialStep, keyStatus.hasBufferKey, keyStatus.hasGeminiKey]);

  // Allow Escape only when dismissal is safe (not first-visit blocking)
  useEffect(() => {
    if (!isOpen || isFirstVisitBlocking || !onClose) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isValidating) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isFirstVisitBlocking, isValidating, onClose]);

  if (!isOpen) return null;

  const handleSubmitBuffer = async (e: React.FormEvent) => {
    e.preventDefault();
    const submitted = bufferInput.trim();
    if (!submitted) {
      setErrorMsg('Please enter your Buffer API key.');
      return;
    }

    setIsValidating(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setBufferCorsBlocked(false);

    try {
      const result = await connectBufferKey(submitted);

      if (!result.success) {
        if (result.corsBlocked) {
          setBufferCorsBlocked(true);
        } else {
          setBufferInput('');
          setShowBufferKey(false);
        }
        setErrorMsg(result.error || 'Buffer key could not be verified. Check the key and try again.');
        setIsValidating(false);
        return;
      }

      setBufferInput('');
      setShowBufferKey(false);
      onBufferConnected({
        channels: result.channels || [],
        rateLimit: result.rateLimit,
      });

      setIsValidating(false);
      if (!keyStatus.hasGeminiKey) {
        setDirection('left');
        setStep(2);
      } else {
        setSuccessMsg('Buffer key updated.');
        setTimeout(() => {
          onClose?.();
        }, 450);
      }
    } catch {
      setBufferInput('');
      setShowBufferKey(false);
      setIsValidating(false);
      setErrorMsg('Buffer key could not be verified. Check the key and try again.');
    }
  };

  const handleContinueStaticBuffer = () => {
    const channels = acceptStaticBufferMode(bufferInput);
    setBufferInput('');
    setShowBufferKey(false);
    setBufferCorsBlocked(false);
    setErrorMsg(null);
    onBufferConnected({ channels });
    if (!keyStatus.hasGeminiKey) {
      setDirection('left');
      setStep(2);
    } else {
      onClose?.();
    }
  };

  const handleConnectBackendThenBuffer = async () => {
    setIsValidating(true);
    setErrorMsg(null);
    const check = await testAndSaveBackendUrl(backendUrlInput);
    if (!check.success) {
      setIsValidating(false);
      setErrorMsg(check.error || 'Could not reach Studio backend URL.');
      return;
    }
    if (bufferInput.trim()) {
      const result = await connectBufferKey(bufferInput.trim());
      setBufferInput('');
      setShowBufferKey(false);
      setIsValidating(false);
      if (!result.success) {
        setErrorMsg(result.error || 'Buffer key could not be verified.');
        return;
      }
      setBufferCorsBlocked(false);
      onBufferConnected({
        channels: result.channels || [],
        rateLimit: result.rateLimit,
      });
      if (!keyStatus.hasGeminiKey) {
        setDirection('left');
        setStep(2);
      } else {
        onClose?.();
      }
    } else {
      setIsValidating(false);
      setBufferCorsBlocked(false);
      setSuccessMsg('Backend server connected. Now submit your Buffer key.');
    }
  };

  const handleSubmitGemini = async (e: React.FormEvent) => {
    e.preventDefault();
    const submitted = geminiInput.trim();
    if (!submitted) {
      setErrorMsg('Please enter your Gemini API key.');
      return;
    }

    setIsValidating(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const result = await connectGeminiKey(submitted);
      setGeminiInput('');
      setShowGeminiKey(false);

      if (!result.success) {
        setErrorMsg(result.error || 'Gemini key could not be verified. Check the key and try again.');
        setIsValidating(false);
        return;
      }

      setIsValidating(false);
      setSuccessMsg('Gemini connected.');
      setTimeout(() => {
        onGeminiConnected();
        onClose?.();
      }, 280);
    } catch {
      setGeminiInput('');
      setShowGeminiKey(false);
      setIsValidating(false);
      setErrorMsg('Gemini key could not be verified. Check the key and try again.');
    }
  };

  const handleClearKey = async (target: 'buffer' | 'gemini') => {
    setIsClearing(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const updated = await clearIntegrationKey(target);
      onKeyCleared(target, updated);
      setSuccessMsg(target === 'buffer' ? 'Buffer key cleared.' : 'Gemini key cleared.');
    } catch {
      setErrorMsg('Could not clear key. Please try again.');
    } finally {
      setIsClearing(false);
    }
  };

  const handleBackToBuffer = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setDirection('right');
    setStep(1);
  };

  const slideVariants = {
    enter: (dir: 'left' | 'right') =>
      prefersReducedMotion
        ? { opacity: 0 }
        : { x: dir === 'left' ? 38 : -38, opacity: 0 },
    center: {
      x: 0,
      opacity: 1,
      transition: {
        duration: prefersReducedMotion ? 0.12 : 0.28,
        ease: [0.16, 1, 0.3, 1] as const,
      },
    },
    exit: (dir: 'left' | 'right') =>
      prefersReducedMotion
        ? { opacity: 0 }
        : {
            x: dir === 'left' ? -38 : 38,
            opacity: 0,
            transition: {
              duration: 0.2,
              ease: [0.16, 1, 0.3, 1] as const,
            },
          },
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-heading"
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 ${
        isFirstVisitBlocking
          ? isLight
            ? 'bg-[#f6f6f7]'
            : 'bg-[#07080a]'
          : 'bg-black/75 backdrop-blur-md'
      }`}
    >
      <motion.div
        initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.985 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md"
      >
        <LiquidGlassSurface
          enabled={liquidGlass}
          isLight={isLight}
          className="rounded-2xl overflow-hidden"
        >
          {/* Top Progress Bar & Header */}
          <div
            className={`px-6 py-4 border-b flex items-center justify-between ${
              isLight ? 'border-neutral-200' : 'border-[#1d1f26]'
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`text-xs font-semibold tabular-nums tracking-wide ${
                  isLight ? 'text-neutral-500' : 'text-[#8e929c]'
                }`}
              >
                {step === 1 ? '01 / 02' : '02 / 02'}
              </span>
              <span
                aria-hidden="true"
                className={isLight ? 'text-neutral-300' : 'text-[#2b2e38]'}
              >
                ·
              </span>
              <span
                className={`text-xs font-medium ${
                  isLight ? 'text-neutral-700' : 'text-[#c9ccd4]'
                }`}
              >
                {step === 1 ? 'Buffer Integration' : 'Gemini Video AI'}
              </span>
            </div>

            {!isFirstVisitBlocking && onClose && (
              <button
                type="button"
                onClick={onClose}
                disabled={isValidating}
                aria-label="Close setup"
                className={`p-1.5 rounded-lg transition cursor-pointer ${
                  isLight
                    ? 'text-neutral-500 hover:text-black hover:bg-neutral-100'
                    : 'text-[#8e929c] hover:text-white hover:bg-white/5'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Stable-Height Sliding Panel Container */}
          <div className="p-6 min-h-[340px] flex flex-col justify-between overflow-hidden">
            <AnimatePresence mode="wait" custom={direction}>
              {step === 1 ? (
                <motion.form
                  key="step-buffer"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  onSubmit={handleSubmitBuffer}
                  className="flex-1 flex flex-col justify-between space-y-6"
                >
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <h2
                        id="onboarding-heading"
                        className={`text-xl font-bold tracking-tight ${
                          isLight ? 'text-neutral-950' : 'text-white'
                        }`}
                      >
                        Connect Buffer
                      </h2>
                      <p
                        className={`text-xs leading-relaxed ${
                          isLight ? 'text-neutral-600' : 'text-[#9ea3ae]'
                        }`}
                      >
                        Your Buffer API key lets the studio load connected channels, weekly posting
                        schedules, and schedule video posts into your queue.
                      </p>
                    </div>

                    {keyStatus.hasBufferKey && (
                      <div
                        className={`px-3.5 py-2.5 rounded-xl border flex items-center justify-between text-xs ${
                          isLight
                            ? 'border-neutral-200 bg-neutral-50 text-neutral-800'
                            : 'border-[#252832] bg-[#12141a] text-[#e5e5e5]'
                        }`}
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          {runtimeMode === 'backend'
                            ? 'Buffer key saved in HttpOnly cookie'
                            : 'Buffer session saved locally for GitHub Pages'}
                        </span>
                        <button
                          type="button"
                          disabled={isClearing}
                          onClick={() => handleClearKey('buffer')}
                          className="text-rose-500 hover:underline font-medium flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Clear key</span>
                        </button>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="buffer-api-key-input"
                          className={`text-xs font-semibold ${
                            isLight ? 'text-neutral-800' : 'text-[#d4d4d8]'
                          }`}
                        >
                          Buffer API Key
                        </label>
                        <a
                          href="https://publish.buffer.com/settings/api"
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`text-[11px] font-medium flex items-center gap-1 hover:underline ${
                            isLight ? 'text-neutral-600 hover:text-black' : 'text-[#9ea3ae] hover:text-white'
                          }`}
                        >
                          <span>Get Buffer key</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>

                      <div className="relative">
                        <input
                          id="buffer-api-key-input"
                          type={showBufferKey ? 'text' : 'password'}
                          autoComplete="off"
                          spellCheck={false}
                          value={bufferInput}
                          onChange={(e) => {
                            setBufferInput(e.target.value);
                            setErrorMsg(null);
                          }}
                          placeholder={
                            keyStatus.hasBufferKey
                              ? 'Enter a new Buffer key to replace existing'
                              : 'Paste your Buffer Personal Access Token'
                          }
                          className={`w-full px-3.5 py-2.5 pr-11 text-xs font-mono rounded-xl border transition focus:outline-none ${
                            isLight
                              ? 'border-neutral-300 bg-white text-neutral-900 focus:border-black placeholder:text-neutral-400'
                              : 'border-[#282b34] bg-[#121318] text-white focus:border-white placeholder:text-[#555966]'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowBufferKey((s) => !s)}
                          aria-label={showBufferKey ? 'Hide key' : 'Show key'}
                          className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md cursor-pointer ${
                            isLight
                              ? 'text-neutral-500 hover:text-black'
                              : 'text-[#8e929c] hover:text-white'
                          }`}
                        >
                          {showBufferKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>

                      <p
                        className={`text-[11px] flex items-center gap-1.5 ${
                          isLight ? 'text-neutral-500' : 'text-[#7b808c]'
                        }`}
                      >
                        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {runtimeMode === 'backend'
                            ? 'Stored in an HttpOnly browser cookie. Never committed to GitHub.'
                            : 'Static GitHub Pages mode: stored locally in your browser only.'}
                        </span>
                      </p>
                    </div>

                    {errorMsg && (
                      <div
                        role="alert"
                        className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3.5 py-2.5 space-y-2.5"
                      >
                        <p>{errorMsg}</p>

                        {bufferCorsBlocked && (
                          <div className="space-y-2 pt-1 border-t border-rose-500/20">
                            <div className="flex gap-1.5">
                              <input
                                type="url"
                                value={backendUrlInput}
                                onChange={(e) => setBackendUrlInput(e.target.value)}
                                placeholder="Optional Backend Proxy URL (e.g. https://...)"
                                className={`flex-1 px-2.5 py-1.5 rounded-lg border text-[11px] ${
                                  isLight
                                    ? 'border-neutral-300 bg-white text-neutral-900'
                                    : 'border-[#2c303a] bg-[#0e1015] text-white'
                                }`}
                              />
                              <button
                                type="button"
                                onClick={handleConnectBackendThenBuffer}
                                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer ${
                                  isLight ? 'bg-black text-white' : 'bg-white text-black'
                                }`}
                              >
                                Use Proxy
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={handleContinueStaticBuffer}
                              className={`w-full py-1.5 px-3 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                                isLight
                                  ? 'border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50'
                                  : 'border-[#2e323d] bg-[#14171f] text-white hover:border-white/50'
                              }`}
                            >
                              Continue in Static GitHub Pages Mode (Local Schedule + Live Gemini)
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {successMsg && (
                      <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3.5 py-2.5">
                        {successMsg}
                      </p>
                    )}
                  </div>

                  <div className="pt-2 flex items-center justify-between gap-3">
                    {!isFirstVisitBlocking && keyStatus.hasBufferKey ? (
                      <button
                        type="button"
                        onClick={() => {
                          setErrorMsg(null);
                          setDirection('left');
                          setStep(2);
                        }}
                        className={`text-xs font-semibold flex items-center gap-1 cursor-pointer ${
                          isLight ? 'text-neutral-600 hover:text-black' : 'text-[#9ea3ae] hover:text-white'
                        }`}
                      >
                        <span>Gemini Step</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <span />
                    )}

                    <button
                      type="submit"
                      disabled={isValidating}
                      className={`px-5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer disabled:opacity-50 active:scale-[0.98] ${
                        isLight
                          ? 'bg-black text-white hover:bg-neutral-800'
                          : 'bg-white text-black hover:bg-neutral-200'
                      }`}
                    >
                      {isValidating ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Verifying...</span>
                        </>
                      ) : (
                        <>
                          <span>Connect Buffer</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                </motion.form>
              ) : (
                <motion.form
                  key="step-gemini"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  onSubmit={handleSubmitGemini}
                  className="flex-1 flex flex-col justify-between space-y-6"
                >
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <h2
                        id="onboarding-heading"
                        className={`text-xl font-bold tracking-tight ${
                          isLight ? 'text-neutral-950' : 'text-white'
                        }`}
                      >
                        Connect Gemini
                      </h2>
                      <p
                        className={`text-xs leading-relaxed ${
                          isLight ? 'text-neutral-600' : 'text-[#9ea3ae]'
                        }`}
                      >
                        Gemini watches your uploaded video directly—dialogue, visuals, and key
                        moments—to generate an accurate, editable title.
                      </p>
                    </div>

                    {keyStatus.hasGeminiKey && (
                      <div
                        className={`px-3.5 py-2.5 rounded-xl border flex items-center justify-between text-xs ${
                          isLight
                            ? 'border-neutral-200 bg-neutral-50 text-neutral-800'
                            : 'border-[#252832] bg-[#12141a] text-[#e5e5e5]'
                        }`}
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          {runtimeMode === 'backend'
                            ? 'Gemini key saved in HttpOnly cookie'
                            : 'Gemini key saved locally for GitHub Pages'}
                        </span>
                        <button
                          type="button"
                          disabled={isClearing}
                          onClick={() => handleClearKey('gemini')}
                          className="text-rose-500 hover:underline font-medium flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Clear key</span>
                        </button>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="gemini-api-key-input"
                          className={`text-xs font-semibold ${
                            isLight ? 'text-neutral-800' : 'text-[#d4d4d8]'
                          }`}
                        >
                          Gemini API Key
                        </label>
                        <a
                          href="https://aistudio.google.com/app/apikey"
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`text-[11px] font-medium flex items-center gap-1 hover:underline ${
                            isLight ? 'text-neutral-600 hover:text-black' : 'text-[#9ea3ae] hover:text-white'
                          }`}
                        >
                          <span>Get Gemini key</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>

                      <div className="relative">
                        <input
                          id="gemini-api-key-input"
                          type={showGeminiKey ? 'text' : 'password'}
                          autoComplete="off"
                          spellCheck={false}
                          value={geminiInput}
                          onChange={(e) => {
                            setGeminiInput(e.target.value);
                            setErrorMsg(null);
                          }}
                          placeholder={
                            keyStatus.hasGeminiKey
                              ? 'Enter a new Gemini key to replace existing'
                              : 'Paste your Google AI Studio API key'
                          }
                          className={`w-full px-3.5 py-2.5 pr-11 text-xs font-mono rounded-xl border transition focus:outline-none ${
                            isLight
                              ? 'border-neutral-300 bg-white text-neutral-900 focus:border-black placeholder:text-neutral-400'
                              : 'border-[#282b34] bg-[#121318] text-white focus:border-white placeholder:text-[#555966]'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowGeminiKey((s) => !s)}
                          aria-label={showGeminiKey ? 'Hide key' : 'Show key'}
                          className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md cursor-pointer ${
                            isLight
                              ? 'text-neutral-500 hover:text-black'
                              : 'text-[#8e929c] hover:text-white'
                          }`}
                        >
                          {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>

                      <p
                        className={`text-[11px] flex items-center gap-1.5 ${
                          isLight ? 'text-neutral-500' : 'text-[#7b808c]'
                        }`}
                      >
                        <KeyRound className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {runtimeMode === 'backend'
                            ? 'Validated server-side and kept solely in your HttpOnly cookie.'
                            : 'Static GitHub Pages mode: sent directly to Google Gemini from your browser and saved only in local browser storage.'}
                        </span>
                      </p>
                    </div>

                    {errorMsg && (
                      <p
                        role="alert"
                        className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3.5 py-2.5"
                      >
                        {errorMsg}
                      </p>
                    )}

                    {successMsg && (
                      <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3.5 py-2.5">
                        {successMsg}
                      </p>
                    )}
                  </div>

                  <div className="pt-2 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      disabled={isValidating}
                      onClick={handleBackToBuffer}
                      className={`text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                        isLight ? 'text-neutral-600 hover:text-black' : 'text-[#9ea3ae] hover:text-white'
                      }`}
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back</span>
                    </button>

                    <button
                      type="submit"
                      disabled={isValidating}
                      className={`px-5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer disabled:opacity-50 active:scale-[0.98] ${
                        isLight
                          ? 'bg-black text-white hover:bg-neutral-800'
                          : 'bg-white text-black hover:bg-neutral-200'
                      }`}
                    >
                      {isValidating ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Verifying...</span>
                        </>
                      ) : (
                        <>
                          <span>Connect Gemini</span>
                          <Check className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </LiquidGlassSurface>
      </motion.div>
    </div>
  );
};
