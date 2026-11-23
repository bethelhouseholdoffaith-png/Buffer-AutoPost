import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  X,
  Upload,
  Play,
  Pause,
  Clock,
  ArrowRight,
  ArrowLeft,
  Calendar as CalendarIcon,
  AlertCircle,
  RefreshCw,
  KeyRound,
  FileVideo,
} from 'lucide-react';
import {
  VideoMetadata,
  BufferChannel,
  PlatformPostOptions,
  KeyStatus,
  BufferRateLimitInfo,
} from '../types';
import { GreenCheckAnimation } from './GreenCheckAnimation';
import { PlatformIcon, getPlatformDisplayName } from './PlatformIcon';
import { LiquidGlassSurface } from './LiquidGlassSurface';

interface UploadWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  channels: BufferChannel[];
  selectedChannelId: string | null;
  nextBufferSpotLabel: string;
  defaultDateKey: string;
  defaultTime?: string;
  keyStatus: KeyStatus;
  theme?: 'black' | 'charcoal' | 'light';
  liquidGlass?: boolean;
  onPostQueued: (
    post: {
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
      platformOptions?: PlatformPostOptions;
    },
    rateLimit?: BufferRateLimitInfo
  ) => void;
  onOpenKeyModal: (step: 1 | 2) => void;
}

const TIME_OPTIONS = [
  '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
  '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM',
  '6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM', '10:00 PM',
];

type AnalysisPhase =
  | 'idle'
  | 'uploading'
  | 'processing'
  | 'analyzing'
  | 'generating'
  | 'ready'
  | 'manual'
  | 'error';

export const UploadWizardModal: React.FC<UploadWizardModalProps> = ({
  isOpen,
  onClose,
  channels,
  selectedChannelId,
  nextBufferSpotLabel,
  defaultDateKey,
  defaultTime,
  keyStatus,
  theme = 'black',
  liquidGlass = false,
  onPostQueued,
  onOpenKeyModal,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const isLight = theme === 'light';

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 'uploading' | 'success'>(1);
  const [direction, setDirection] = useState<'left' | 'right'>('left');

  // Video & Analysis Lifecycle
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
  const [uploadId, setUploadId] = useState<string>('');
  const [publicVideoUrl, setPublicVideoUrl] = useState<string>('');
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>('idle');
  const [uploadByteProgress, setUploadByteProgress] = useState<number>(0);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisErrorCode, setAnalysisErrorCode] = useState<string | null>(null);
  const [requiresGeminiConnect, setRequiresGeminiConnect] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeXhrRef = useRef<XMLHttpRequest | null>(null);
  const stageTimersRef = useRef<number[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);

  // Title State (Editable & Preserved)
  const [activeTitle, setActiveTitle] = useState('');
  const [userEditedTitle, setUserEditedTitle] = useState(false);
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [contentSummary, setContentSummary] = useState<string>('');
  const [isManualTitleMode, setIsManualTitleMode] = useState(false);

  // Step 3 State
  const [targetChannelId, setTargetChannelId] = useState<string>('all');
  const [thumbnailOffsetMs, setThumbnailOffsetMs] = useState(1500);
  const [scheduleMode, setScheduleMode] = useState<'auto' | 'custom'>('auto');
  const [selectedDateKey, setSelectedDateKey] = useState<string>(defaultDateKey || '');
  const [selectedTime, setSelectedTime] = useState<string>(defaultTime || '9:00 AM');

  // Step 4 Platform Options
  const [platformOptions, setPlatformOptions] = useState<PlatformPostOptions>({
    youtube: {
      playlist: '',
      visibility: 'public',
      isPremiere: false,
      madeForKids: false,
      notifySubscribers: true,
    },
    instagram: {
      postType: 'reel',
      shareToFeed: true,
      firstComment: '',
    },
    tiktok: {
      privacy: 'public',
      allowComments: true,
      allowDuet: true,
      allowStitch: true,
    },
    facebook: { postType: 'reel' },
    linkedin: { visibility: 'anyone' },
    pinterest: { board: '', destinationLink: '' },
    twitter: { replySettings: 'everyone' },
  });

  // Final Buffer Queueing State
  const [isSubmittingToBuffer, setIsSubmittingToBuffer] = useState(false);
  const [scheduleProgress, setScheduleProgress] = useState(0);
  const [postingError, setPostingError] = useState<string | null>(null);
  const [createdBufferIds, setCreatedBufferIds] = useState<Record<string, string>>({});
  const [latestRateLimit, setLatestRateLimit] = useState<BufferRateLimitInfo | undefined>(
    undefined
  );

  const clearStageTimers = () => {
    for (const id of stageTimersRef.current) {
      window.clearTimeout(id);
    }
    stageTimersRef.current = [];
  };

  const startPostUploadStages = () => {
    clearStageTimers();
    setAnalysisPhase('processing');
    stageTimersRef.current.push(
      window.setTimeout(() => {
        setAnalysisPhase((curr) => (curr === 'processing' ? 'analyzing' : curr));
      }, 2200),
      window.setTimeout(() => {
        setAnalysisPhase((curr) => (curr === 'analyzing' ? 'generating' : curr));
      }, 6500)
    );
  };

  useEffect(() => {
    if (isOpen) {
      clearStageTimers();
      setStep(1);
      setDirection('left');
      setVideoMetadata(null);
      setUploadId('');
      setPublicVideoUrl('');
      setAnalysisPhase('idle');
      setUploadByteProgress(0);
      setAnalysisError(null);
      setAnalysisErrorCode(null);
      setRequiresGeminiConnect(false);
      setActiveTitle('');
      setUserEditedTitle(false);
      setAlternatives([]);
      setContentSummary('');
      setIsManualTitleMode(false);
      setIsPlaying(false);
      setIsSubmittingToBuffer(false);
      setScheduleProgress(0);
      setPostingError(null);
      setCreatedBufferIds({});
      setTargetChannelId(
        selectedChannelId && selectedChannelId !== 'all' ? selectedChannelId : 'all'
      );
      setSelectedDateKey(defaultDateKey || '');
      const normalizedTime = (defaultTime || '9:00 AM').replace(/^0(\d:)/, '$1');
      setSelectedTime(normalizedTime);
      setScheduleMode(defaultTime ? 'custom' : 'auto');
    } else {
      clearStageTimers();
      if (activeXhrRef.current) {
        activeXhrRef.current.abort();
        activeXhrRef.current = null;
      }
    }
  }, [isOpen, selectedChannelId, defaultDateKey, defaultTime]);

  if (!isOpen) return null;

  const activeChannels =
    targetChannelId === 'all'
      ? channels
      : channels.filter((c) => c.id === targetChannelId);

  const hasService = (keyword: string) =>
    activeChannels.some((c) => c.service.toLowerCase().includes(keyword));

  // Single multipart upload using XMLHttpRequest for accurate upload byte progress
  const handleFileSelect = (file: File) => {
    const localUrl = URL.createObjectURL(file);
    setVideoMetadata({
      file,
      filename: file.name,
      duration: 0,
      width: 1080,
      height: 1920,
      size: file.size,
      mimeType: file.type || 'video/mp4',
      localPreviewUrl: localUrl,
    });

    clearStageTimers();
    setAnalysisError(null);
    setAnalysisErrorCode(null);
    setRequiresGeminiConnect(false);
    setAlternatives([]);
    setContentSummary('');
    setActiveTitle('');
    setUserEditedTitle(false);
    setIsManualTitleMode(false);
    setUploadByteProgress(0);
    setAnalysisPhase('uploading');

    const formData = new FormData();
    formData.append('video', file);

    const endpoint = keyStatus.hasGeminiKey
      ? '/api/gemini/analyze-video'
      : '/api/videos/upload';

    const xhr = new XMLHttpRequest();
    activeXhrRef.current = xhr;
    xhr.open('POST', endpoint, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Requested-With', 'AutoBuffer');

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const pct = Math.round((evt.loaded / evt.total) * 100);
        setUploadByteProgress(pct);
        if (pct >= 100 && keyStatus.hasGeminiKey) {
          startPostUploadStages();
        }
      }
    };

    xhr.upload.onload = () => {
      setUploadByteProgress(100);
      if (keyStatus.hasGeminiKey) {
        startPostUploadStages();
      }
    };

    xhr.onload = () => {
      clearStageTimers();
      activeXhrRef.current = null;
      let data: any = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        setAnalysisPhase('error');
        setAnalysisErrorCode('TRANSIENT_ERROR');
        setAnalysisError(
          `Server returned an unexpected response (HTTP ${xhr.status}). Please retry.`
        );
        return;
      }

      if (data.uploadId) setUploadId(data.uploadId);
      if (data.publicVideoUrl) setPublicVideoUrl(data.publicVideoUrl);

      if (xhr.status >= 200 && xhr.status < 300 && data.success) {
        if (keyStatus.hasGeminiKey && data.title) {
          setActiveTitle(data.title);
          setAlternatives(Array.isArray(data.alternatives) ? data.alternatives : []);
          setContentSummary(data.content_summary || '');
          setAnalysisPhase('ready');
          setDirection('left');
          setStep(2);
        } else {
          // Video uploaded cleanly without Gemini connected yet -> Step 2 with Connect Gemini prompt
          setRequiresGeminiConnect(true);
          setAnalysisErrorCode('INVALID_API_KEY');
          setAnalysisPhase('error');
          setAnalysisError(
            'Gemini API key is not connected. Connect Gemini to analyze the video, or enter a manual title below.'
          );
          setDirection('left');
          setStep(2);
        }
      } else {
        const errCode = data.errorCode || 'UNKNOWN_ERROR';
        setRequiresGeminiConnect(Boolean(data.requiresGeminiKey || !keyStatus.hasGeminiKey));
        setAnalysisErrorCode(errCode);
        setAnalysisPhase('error');
        setAnalysisError(
          data.error || `Gemini analysis failed (HTTP ${xhr.status}). Please retry.`
        );
        if (data.uploadId) {
          setDirection('left');
          setStep(2);
        }
      }
    };

    xhr.onerror = () => {
      clearStageTimers();
      activeXhrRef.current = null;
      setAnalysisPhase('error');
      setAnalysisErrorCode('TRANSIENT_ERROR');
      setAnalysisError('Network connection interrupted while uploading the video. Please try again.');
    };

    xhr.send(formData);
  };

  // Run or retry Gemini analysis using the already-uploaded video session (no browser re-upload)
  const runExistingVideoAnalysis = async (regenerate: boolean) => {
    if (!uploadId) {
      setAnalysisErrorCode('VIDEO_EXPIRED');
      setAnalysisError('Video session expired. Please re-select the video file.');
      setAnalysisPhase('error');
      return;
    }
    if (!keyStatus.hasGeminiKey) {
      setRequiresGeminiConnect(true);
      setAnalysisErrorCode('INVALID_API_KEY');
      setAnalysisPhase('error');
      setAnalysisError('Connect your Gemini API key to analyze this video.');
      return;
    }

    setAnalysisError(null);
    setAnalysisErrorCode(null);
    setRequiresGeminiConnect(false);
    startPostUploadStages();

    try {
      const res = await fetch('/api/gemini/analyze-video', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'AutoBuffer',
        },
        body: JSON.stringify({ uploadId, regenerate }),
      });

      clearStageTimers();
      const data = await res.json();
      if (!res.ok || !data.success || !data.title) {
        setRequiresGeminiConnect(Boolean(data.requiresGeminiKey));
        setAnalysisErrorCode(data.errorCode || 'UNKNOWN_ERROR');
        setAnalysisPhase('error');
        setAnalysisError(
          data.error || `Gemini analysis failed (HTTP ${res.status}). Please retry.`
        );
        return;
      }

      setActiveTitle(data.title);
      setUserEditedTitle(false);
      setIsManualTitleMode(false);
      setAlternatives(Array.isArray(data.alternatives) ? data.alternatives : []);
      setContentSummary(data.content_summary || '');
      setAnalysisPhase('ready');
    } catch {
      clearStageTimers();
      setAnalysisErrorCode('TRANSIENT_ERROR');
      setAnalysisPhase('error');
      setAnalysisError('Network error communicating with Gemini service. Please retry.');
    }
  };

  const handleRetryAnalysis = () => runExistingVideoAnalysis(false);
  const handleRegenerateTitle = () => runExistingVideoAnalysis(true);

  const handleStep2Next = () => {
    if (!activeTitle.trim()) return;
    setDirection('left');
    setStep(3);
  };

  const handleStep3Next = () => {
    setDirection('left');
    setStep(4);
  };

  // Schedule post via Buffer GraphQL Proxy
  const handleStartScheduling = async () => {
    if (isSubmittingToBuffer) return;

    setPostingError(null);

    if (!keyStatus.hasBufferKey) {
      setPostingError('Buffer key is not connected. Connect Buffer before scheduling.');
      setStep('uploading');
      return;
    }

    if (!uploadId) {
      setPostingError('Uploaded video session expired. Go back to Step 1 and re-select your video.');
      setStep('uploading');
      return;
    }

    if (activeChannels.length === 0) {
      setPostingError('No Buffer channels selected. Connect Buffer or select a channel.');
      setStep('uploading');
      return;
    }

    setIsSubmittingToBuffer(true);
    setStep('uploading');
    setScheduleProgress(0);

    const targetIds = activeChannels.map((c) => c.id);
    const channelServices: Record<string, string> = {};
    for (const ch of activeChannels) {
      channelServices[ch.id] = ch.service;
    }

    let dueAtIso: string | undefined = undefined;
    if (scheduleMode === 'custom') {
      try {
        const [y, m, d] = selectedDateKey.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        const match = selectedTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (match) {
          let h = parseInt(match[1], 10);
          const min = parseInt(match[2], 10);
          const isPM = match[3].toUpperCase() === 'PM';
          if (isPM && h < 12) h += 12;
          if (!isPM && h === 12) h = 0;
          dt.setHours(h, min, 0, 0);
        }
        dueAtIso = dt.toISOString();
      } catch {
        // ignore
      }
    }

    const bufferRequestPromise = fetch('/api/buffer/posts', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'AutoBuffer',
      },
      body: JSON.stringify({
        channelIds: targetIds,
        channelServices,
        text: activeTitle.trim(),
        uploadId,
        thumbnailOffset: thumbnailOffsetMs,
        schedulingType: scheduleMode === 'custom' ? 'custom' : 'automatic',
        dueAt: dueAtIso,
        platformOptions,
      }),
    }).then((r) => r.json());

    // Exact 0.25s delay before progress advances
    setTimeout(() => {
      const startTime = performance.now();
      const duration = 1400;

      const tick = async (nowTime: number) => {
        const ratio = Math.min((nowTime - startTime) / duration, 1);
        const eased = Math.round((1 - Math.pow(1 - ratio, 3)) * 100);
        setScheduleProgress(eased);

        if (ratio < 1) {
          requestAnimationFrame(tick);
        } else {
          try {
            const bufferData = await bufferRequestPromise;
            setIsSubmittingToBuffer(false);

            if (!bufferData || !bufferData.success) {
              setPostingError(
                bufferData?.error ||
                  'The post was not scheduled. Review the channel and time, then try again.'
              );
              return;
            }

            const idsMap: Record<string, string> = {};
            for (const r of bufferData.results || []) {
              if (r.success && r.post?.id) {
                idsMap[r.channelId] = r.post.id;
              }
            }
            setCreatedBufferIds(idsMap);
            setLatestRateLimit(bufferData.rateLimit);

            setTimeout(() => {
              setStep('success');
            }, 140);
          } catch {
            setIsSubmittingToBuffer(false);
            setPostingError(
              'The post was not scheduled. Review the channel and time, then try again.'
            );
          }
        }
      };

      requestAnimationFrame(tick);
    }, 250);
  };

  const handleAnimationComplete = () => {
    let postChannelId = 'all';
    let postChannelName = 'All Channels';
    let postService = 'all';
    let postAvatar: string | undefined = undefined;

    if (targetChannelId !== 'all') {
      const ch = channels.find((c) => c.id === targetChannelId);
      if (ch) {
        postChannelId = ch.id;
        postChannelName = ch.name || getPlatformDisplayName(ch.service);
        postService = ch.service;
        postAvatar = ch.avatar;
      }
    }

    const finalDateKey = scheduleMode === 'custom' ? selectedDateKey : defaultDateKey;
    const finalTime = scheduleMode === 'custom' ? selectedTime : defaultTime || '9:00 AM';

    setTimeout(() => {
      onPostQueued(
        {
          id: `post-${Date.now()}`,
          bufferPostIds: createdBufferIds,
          channelId: postChannelId,
          channelName: postChannelName,
          service: postService,
          avatar: postAvatar,
          time: finalTime,
          title: activeTitle.trim(),
          dateKey: finalDateKey,
          videoUrl: publicVideoUrl || videoMetadata?.localPreviewUrl || '',
          platformOptions,
        },
        latestRateLimit
      );
      onClose();
    }, 850);
  };

  const slideVariants = {
    initial: (dir: 'left' | 'right') =>
      prefersReducedMotion ? { opacity: 0 } : { x: dir === 'left' ? 40 : -40, opacity: 0 },
    animate: {
      x: 0,
      opacity: 1,
      transition: { duration: prefersReducedMotion ? 0.12 : 0.26, ease: [0.16, 1, 0.3, 1] as const },
    },
    exit: (dir: 'left' | 'right') =>
      prefersReducedMotion
        ? { opacity: 0 }
        : { x: dir === 'left' ? -40 : 40, opacity: 0, transition: { duration: 0.2 } },
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
            className={`px-6 py-4 border-b flex items-center justify-between ${
              isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
            }`}
          >
            <div className="flex items-center gap-2.5 text-xs font-semibold tabular-nums">
              <span>
                {step === 'uploading'
                  ? 'Scheduling in Buffer'
                  : step === 'success'
                  ? 'Scheduled'
                  : `0${step} / 04`}
              </span>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              <span className="opacity-70">
                {step === 1
                  ? 'Upload Video'
                  : step === 2
                  ? 'Video Title'
                  : step === 3
                  ? 'Posting Time'
                  : step === 4
                  ? 'Account Options'
                  : step === 'uploading'
                  ? 'Buffer GraphQL'
                  : 'Complete'}
              </span>
            </div>

            {step !== 'uploading' && step !== 'success' && (
              <button
                onClick={onClose}
                aria-label="Close upload wizard"
                className={`p-1 rounded-lg transition cursor-pointer ${
                  isLight
                    ? 'text-neutral-500 hover:text-black'
                    : 'text-[#737373] hover:text-white'
                }`}
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Modal Body */}
          <div className="p-6 min-h-[390px] flex flex-col justify-between overflow-hidden">
            <AnimatePresence mode="wait" custom={direction}>
              {/* STEP 1: Upload Video File */}
              {step === 1 && (
                <motion.div
                  key="wizard-step-1"
                  custom={direction}
                  variants={slideVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="space-y-5 flex-1 flex flex-col justify-between"
                >
                  <div>
                    <h2 className="text-xl font-bold tracking-tight mb-1">Upload Video</h2>
                    <p className="text-xs text-[#8e929c]">
                      MP4, MOV, WebM, or M4V up to 200MB. Gemini inspects the full video directly.
                    </p>
                  </div>

                  {analysisPhase === 'uploading' ||
                  analysisPhase === 'processing' ||
                  analysisPhase === 'analyzing' ||
                  analysisPhase === 'generating' ? (
                    <div
                      className={`rounded-2xl border p-8 flex flex-col items-center justify-center space-y-5 text-center ${
                        isLight
                          ? 'border-neutral-200 bg-neutral-50'
                          : 'border-[#252832] bg-[#111318]'
                      }`}
                    >
                      <FileVideo className="w-8 h-8 opacity-80" />
                      <div className="space-y-1">
                        <p className="text-sm font-bold">
                          {analysisPhase === 'uploading'
                            ? 'Uploading video...'
                            : analysisPhase === 'processing'
                            ? 'Processing video...'
                            : analysisPhase === 'analyzing'
                            ? 'Analyzing video content...'
                            : 'Generating title...'}
                        </p>
                        <p className="text-xs text-[#8e929c]">
                          {analysisPhase === 'uploading'
                            ? 'Transferring your video file to the studio backend.'
                            : analysisPhase === 'processing'
                            ? 'Waiting for Gemini Files API to mark the video ACTIVE.'
                            : analysisPhase === 'analyzing'
                            ? 'Watching visuals, spoken dialogue, and on-screen text.'
                            : 'Drafting a grounded title, alternatives, and summary.'}
                        </p>
                      </div>

                      {/* 4-Stage Pipeline Bar */}
                      <div className="w-full max-w-sm space-y-2.5">
                        <div className="grid grid-cols-4 gap-1.5 text-[10px] font-semibold">
                          {(
                            [
                              ['uploading', 'Upload'],
                              ['processing', 'Process'],
                              ['analyzing', 'Analyze'],
                              ['generating', 'Title'],
                            ] as const
                          ).map(([key, label], idx) => {
                            const stageOrder = ['uploading', 'processing', 'analyzing', 'generating'];
                            const currentIdx = stageOrder.indexOf(analysisPhase);
                            const isDone = idx < currentIdx;
                            const isCurrent = idx === currentIdx;
                            return (
                              <div
                                key={key}
                                className={`py-1 px-1.5 rounded-md border text-center transition ${
                                  isCurrent
                                    ? isLight
                                      ? 'border-black bg-black text-white'
                                      : 'border-white bg-white text-black'
                                    : isDone
                                    ? isLight
                                      ? 'border-neutral-300 bg-neutral-200 text-neutral-800'
                                      : 'border-[#2e323d] bg-[#1b1e26] text-neutral-200'
                                    : isLight
                                    ? 'border-neutral-200 text-neutral-400'
                                    : 'border-[#1e212a] text-[#616572]'
                                }`}
                              >
                                {label}
                              </div>
                            );
                          })}
                        </div>

                        <div
                          className={`h-1.5 w-full rounded-full overflow-hidden ${
                            isLight ? 'bg-neutral-200' : 'bg-[#1f222b]'
                          }`}
                        >
                          {analysisPhase === 'uploading' ? (
                            <div
                              className={`h-full transition-all duration-150 ${
                                isLight ? 'bg-black' : 'bg-white'
                              }`}
                              style={{ width: `${uploadByteProgress}%` }}
                            />
                          ) : (
                            <div
                              className={`h-full transition-all duration-500 ${
                                isLight ? 'bg-black' : 'bg-white'
                              } ${
                                analysisPhase === 'processing'
                                  ? 'w-1/2 animate-pulse'
                                  : analysisPhase === 'analyzing'
                                  ? 'w-3/4 animate-pulse'
                                  : 'w-11/12 animate-pulse'
                              }`}
                            />
                          )}
                        </div>
                        {analysisPhase === 'uploading' && (
                          <p className="text-[11px] font-mono tabular-nums text-[#8e929c]">
                            {uploadByteProgress}%
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition flex flex-col items-center justify-center space-y-3 group ${
                        isLight
                          ? 'border-neutral-300 bg-neutral-50 hover:border-black'
                          : 'border-[#282b33] bg-[#111317] hover:border-white'
                      }`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/*"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files && e.target.files.length > 0) {
                            handleFileSelect(e.target.files[0]);
                          }
                        }}
                      />

                      <div
                        className={`w-12 h-12 rounded-xl flex items-center justify-center transition ${
                          isLight
                            ? 'bg-neutral-200 text-black group-hover:bg-black group-hover:text-white'
                            : 'bg-[#1c1e24] text-white group-hover:bg-white group-hover:text-black'
                        }`}
                      >
                        <Upload className="w-5 h-5" />
                      </div>

                      <div className="space-y-1">
                        <p className="text-sm font-bold">Select video file</p>
                        <p className="text-xs text-[#8e929c]">
                          Uploaded once and shared cleanly between Gemini and Buffer.
                        </p>
                      </div>
                    </div>
                  )}

                  {analysisPhase === 'error' && analysisError && (
                    <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs text-rose-400 flex items-center justify-between gap-2">
                      <span>{analysisError}</span>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="underline font-semibold shrink-0 cursor-pointer"
                      >
                        Try another
                      </button>
                    </div>
                  )}

                  <div className="text-[11px] text-[#7b808c] text-center">
                    {keyStatus.hasGeminiKey
                      ? 'Gemini API connected · Full video analysis ready'
                      : 'Gemini API not connected yet · You can connect in Step 2 or enter a manual title'}
                  </div>
                </motion.div>
              )}

              {/* STEP 2: Video Preview & Grounded Title */}
              {step === 2 && (
                <motion.div
                  key="wizard-step-2"
                  custom={direction}
                  variants={slideVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="space-y-4 flex-1 flex flex-col justify-between"
                >
                    <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-xl font-bold tracking-tight">
                        {isManualTitleMode
                          ? 'Manual Title'
                          : analysisPhase === 'processing'
                          ? 'Processing Video...'
                          : analysisPhase === 'analyzing'
                          ? 'Analyzing Video...'
                          : analysisPhase === 'generating'
                          ? 'Generating Title...'
                          : 'Video Title'}
                      </h2>
                      <p className="text-xs text-[#8e929c] mt-0.5">
                        {isManualTitleMode
                          ? 'User-entered title (not AI-generated).'
                          : analysisPhase === 'processing' ||
                            analysisPhase === 'analyzing' ||
                            analysisPhase === 'generating'
                          ? 'Working with your already-uploaded video file.'
                          : contentSummary || 'Edit the suggested title or generate another angle.'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleRegenerateTitle}
                      disabled={
                        analysisPhase === 'processing' ||
                        analysisPhase === 'analyzing' ||
                        analysisPhase === 'generating'
                      }
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 shrink-0 transition cursor-pointer disabled:opacity-50 ${
                        isLight
                          ? 'border-neutral-300 bg-white hover:border-black'
                          : 'border-[#2c303a] bg-[#14161c] hover:border-white'
                      }`}
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          analysisPhase === 'processing' ||
                          analysisPhase === 'analyzing' ||
                          analysisPhase === 'generating'
                            ? 'animate-spin'
                            : ''
                        }`}
                      />
                      <span>Generate another title</span>
                    </button>
                  </div>

                  <div className="space-y-3">
                    {videoMetadata && (
                      <div className="h-36 rounded-xl bg-black border border-[#22242a] overflow-hidden relative flex items-center justify-center">
                        <video
                          ref={videoRef}
                          src={videoMetadata.localPreviewUrl}
                          className="h-full w-auto max-w-full object-contain"
                          muted
                          playsInline
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (videoRef.current) {
                              if (isPlaying) videoRef.current.pause();
                              else videoRef.current.play();
                              setIsPlaying(!isPlaying);
                            }
                          }}
                          aria-label={isPlaying ? 'Pause video preview' : 'Play video preview'}
                          className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-black/55 backdrop-blur border border-white/25 flex items-center justify-center text-white hover:scale-105 transition cursor-pointer"
                        >
                          {isPlaying ? (
                            <Pause className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4 ml-0.5 fill-white" />
                          )}
                        </button>
                      </div>
                    )}

                    {/* Error / Retry / Connect Gemini state */}
                    {analysisPhase === 'error' && analysisError && (
                      <div
                        role="alert"
                        className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 space-y-2.5 text-xs"
                      >
                        <div className="flex items-start gap-2 text-rose-400">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <p className="leading-relaxed">{analysisError}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {uploadId &&
                            !requiresGeminiConnect &&
                            analysisErrorCode !== 'INVALID_API_KEY' &&
                            analysisErrorCode !== 'UNSUPPORTED_VIDEO_FORMAT' &&
                            analysisErrorCode !== 'VIDEO_EXPIRED' && (
                              <button
                                type="button"
                                onClick={handleRetryAnalysis}
                                className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 cursor-pointer ${
                                  isLight ? 'bg-black text-white' : 'bg-white text-black'
                                }`}
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>Retry analysis</span>
                              </button>
                            )}

                          {(requiresGeminiConnect || analysisErrorCode === 'INVALID_API_KEY') && (
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onOpenKeyModal(2);
                              }}
                              className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 cursor-pointer ${
                                isLight ? 'bg-black text-white' : 'bg-white text-black'
                              }`}
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                              <span>Connect Gemini</span>
                            </button>
                          )}

                          {(analysisErrorCode === 'UNSUPPORTED_VIDEO_FORMAT' ||
                            analysisErrorCode === 'VIDEO_PROCESSING_FAILED' ||
                            analysisErrorCode === 'VIDEO_EXPIRED') && (
                            <button
                              type="button"
                              onClick={() => {
                                setDirection('right');
                                setStep(1);
                                setAnalysisPhase('idle');
                              }}
                              className={`px-3 py-1.5 rounded-lg border font-semibold cursor-pointer ${
                                isLight
                                  ? 'border-neutral-300 bg-white text-neutral-900'
                                  : 'border-[#2c303a] bg-[#14161c] text-white'
                              }`}
                            >
                              Change video
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setIsManualTitleMode(true);
                              setAnalysisPhase('manual');
                              setAnalysisError(null);
                            }}
                            className={`px-3 py-1.5 rounded-lg border font-semibold cursor-pointer ${
                              isLight
                                ? 'border-neutral-300 bg-white text-neutral-900'
                                : 'border-[#2c303a] bg-[#14161c] text-white'
                            }`}
                          >
                            Enter title manually
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Editable Title Input */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-medium text-[#8e929c]">
                        <label htmlFor="wizard-video-title">
                          {isManualTitleMode || userEditedTitle
                            ? 'Title (User-entered)'
                            : 'Generated Title (Editable)'}
                        </label>
                        <span className="tabular-nums">{activeTitle.length} chars</span>
                      </div>
                      <input
                        id="wizard-video-title"
                        type="text"
                        value={activeTitle}
                        onChange={(e) => {
                          setActiveTitle(e.target.value);
                          setUserEditedTitle(true);
                        }}
                        placeholder="Enter video title..."
                        className={`w-full px-3.5 py-2.5 text-sm font-semibold rounded-xl border focus:outline-none transition ${
                          isLight
                            ? 'border-neutral-300 bg-white text-neutral-900 focus:border-black'
                            : 'border-[#2c3038] bg-[#121318] text-white focus:border-white'
                        }`}
                      />
                    </div>

                    {/* 2 Grounded Alternatives */}
                    {alternatives.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-medium text-[#8e929c]">Alternatives</p>
                        <div className="flex flex-col gap-1.5">
                          {alternatives.map((alt, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setActiveTitle(alt);
                                setIsManualTitleMode(false);
                                setUserEditedTitle(false);
                              }}
                              className={`text-xs px-3 py-2 rounded-xl border text-left transition cursor-pointer ${
                                activeTitle === alt
                                  ? isLight
                                    ? 'border-black bg-black text-white font-semibold'
                                    : 'border-white bg-white text-black font-semibold'
                                  : isLight
                                  ? 'border-neutral-200 bg-neutral-50 text-neutral-800 hover:border-black'
                                  : 'border-[#252830] bg-[#121419] text-[#d4d4d8] hover:border-neutral-500'
                              }`}
                            >
                              {alt}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div
                    className={`pt-3 flex items-center justify-between border-t ${
                      isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDirection('right');
                        setStep(1);
                      }}
                      className="text-xs font-semibold text-[#8e929c] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back</span>
                    </button>

                    <button
                      type="button"
                      disabled={!activeTitle.trim()}
                      onClick={handleStep2Next}
                      className={`px-5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer disabled:opacity-40 active:scale-[0.98] ${
                        isLight
                          ? 'bg-black text-white hover:bg-neutral-800'
                          : 'bg-white text-black hover:bg-neutral-200'
                      }`}
                    >
                      <span>Continue</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              )}

              {/* STEP 3: Posting Time & Platform */}
              {step === 3 && (
                <motion.div
                  key="wizard-step-3"
                  custom={direction}
                  variants={slideVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="space-y-4 flex-1 flex flex-col justify-between"
                >
                  <div>
                    <h2 className="text-xl font-bold tracking-tight mb-1">Confirm Posting Time</h2>
                    <p className="text-xs text-[#8e929c]">
                      Schedule into the next open Buffer slot or pick a custom time.
                    </p>
                  </div>

                  <div
                    className={`grid grid-cols-2 gap-1.5 p-1 rounded-xl border ${
                      isLight
                        ? 'bg-neutral-100 border-neutral-200'
                        : 'bg-[#111317] border-[#22242a]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setScheduleMode('auto')}
                      className={`py-2 px-3 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                        scheduleMode === 'auto'
                          ? isLight
                            ? 'bg-black text-white'
                            : 'bg-white text-black'
                          : 'text-[#8e929c]'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Next Buffer Spot</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScheduleMode('custom')}
                      className={`py-2 px-3 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                        scheduleMode === 'custom'
                          ? isLight
                            ? 'bg-black text-white'
                            : 'bg-white text-black'
                          : 'text-[#8e929c]'
                      }`}
                    >
                      <CalendarIcon className="w-3.5 h-3.5" />
                      <span>Custom Date & Time</span>
                    </button>
                  </div>

                  {scheduleMode === 'auto' ? (
                    <div
                      className={`p-4 rounded-xl border space-y-1.5 ${
                        isLight
                          ? 'border-neutral-200 bg-neutral-50'
                          : 'border-[#252832] bg-[#121419]'
                      }`}
                    >
                      <span className="text-[11px] font-semibold text-[#8e929c]">
                        Next Open Buffer Spot (Paused slots skipped)
                      </span>
                      <p className="text-base font-bold tabular-nums">{nextBufferSpotLabel}</p>
                    </div>
                  ) : (
                    <div
                      className={`p-4 rounded-xl border grid grid-cols-2 gap-3 ${
                        isLight
                          ? 'border-neutral-200 bg-neutral-50'
                          : 'border-[#252832] bg-[#121419]'
                      }`}
                    >
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-[#8e929c] block">
                          Posting Date
                        </label>
                        <input
                          type="date"
                          value={selectedDateKey}
                          onChange={(e) => setSelectedDateKey(e.target.value)}
                          className={`w-full px-3 py-2 rounded-lg border text-xs font-semibold focus:outline-none ${
                            isLight
                              ? 'border-neutral-300 bg-white text-neutral-900'
                              : 'border-[#2c3038] bg-[#0c0d10] text-white'
                          }`}
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-[#8e929c] block">
                          Posting Time
                        </label>
                        <select
                          value={TIME_OPTIONS.includes(selectedTime) ? selectedTime : '9:00 AM'}
                          onChange={(e) => setSelectedTime(e.target.value)}
                          className={`w-full px-3 py-2 rounded-lg border text-xs font-semibold focus:outline-none ${
                            isLight
                              ? 'border-neutral-300 bg-white text-neutral-900'
                              : 'border-[#2c3038] bg-[#0c0d10] text-white'
                          }`}
                        >
                          {TIME_OPTIONS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[#8e929c] mb-1">
                        Destination Channel
                      </label>
                      <select
                        value={targetChannelId}
                        onChange={(e) => setTargetChannelId(e.target.value)}
                        className={`w-full text-xs font-semibold px-3.5 py-2.5 rounded-xl border focus:outline-none cursor-pointer ${
                          isLight
                            ? 'border-neutral-300 bg-white text-neutral-900'
                            : 'border-[#2c3038] bg-[#121419] text-white'
                        }`}
                      >
                        <option value="all">
                          All Connected Channels ({channels.length})
                        </option>
                        {channels.map((ch) => (
                          <option key={ch.id} value={ch.id}>
                            {ch.name} ({ch.service})
                            {ch.isQueuePaused ? ' — Queue Paused' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[11px] font-medium text-[#8e929c]">
                          Cover Thumbnail Offset
                        </span>
                        <span className="font-mono tabular-nums font-semibold">
                          {(thumbnailOffsetMs / 1000).toFixed(1)}s
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="10000"
                        step="250"
                        value={thumbnailOffsetMs}
                        onChange={(e) => setThumbnailOffsetMs(Number(e.target.value))}
                        className="w-full accent-current h-1.5 rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>

                  <div
                    className={`pt-3 flex items-center justify-between border-t ${
                      isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDirection('right');
                        setStep(2);
                      }}
                      className="text-xs font-semibold text-[#8e929c] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleStep3Next}
                      className={`px-5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer active:scale-[0.98] ${
                        isLight
                          ? 'bg-black text-white hover:bg-neutral-800'
                          : 'bg-white text-black hover:bg-neutral-200'
                      }`}
                    >
                      <span>Account Options</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              )}

              {/* STEP 4: Account Requirements */}
              {step === 4 && (
                <motion.div
                  key="wizard-step-4"
                  custom={direction}
                  variants={slideVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="space-y-4 flex-1 flex flex-col justify-between"
                >
                  <div>
                    <h2 className="text-xl font-bold tracking-tight mb-1">Account Options</h2>
                    <p className="text-xs text-[#8e929c]">
                      Platform metadata included with your Buffer GraphQL post mutation.
                    </p>
                  </div>

                  <div className="space-y-3 max-h-[290px] overflow-y-auto pr-1">
                    {hasService('youtube') && (
                      <div
                        className={`p-3.5 rounded-xl border space-y-2.5 ${
                          isLight
                            ? 'border-neutral-200 bg-neutral-50'
                            : 'border-[#242730] bg-[#12141a]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <PlatformIcon service="youtube" size={16} />
                          <span className="text-xs font-bold">YouTube</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                          <input
                            type="text"
                            placeholder="Playlist (optional)"
                            value={platformOptions.youtube?.playlist || ''}
                            onChange={(e) =>
                              setPlatformOptions((p) => ({
                                ...p,
                                youtube: { ...p.youtube, playlist: e.target.value },
                              }))
                            }
                            className={`px-2.5 py-1.5 rounded-lg border text-xs ${
                              isLight
                                ? 'border-neutral-300 bg-white'
                                : 'border-[#2c3038] bg-[#0a0b0e] text-white'
                            }`}
                          />
                          <select
                            value={platformOptions.youtube?.visibility || 'public'}
                            onChange={(e) =>
                              setPlatformOptions((p) => ({
                                ...p,
                                youtube: {
                                  ...p.youtube,
                                  visibility: e.target.value as 'public' | 'unlisted' | 'private',
                                },
                              }))
                            }
                            className={`px-2.5 py-1.5 rounded-lg border text-xs ${
                              isLight
                                ? 'border-neutral-300 bg-white'
                                : 'border-[#2c3038] bg-[#0a0b0e] text-white'
                            }`}
                          >
                            <option value="public">Public</option>
                            <option value="unlisted">Unlisted</option>
                            <option value="private">Private</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {hasService('instagram') && (
                      <div
                        className={`p-3.5 rounded-xl border space-y-2.5 ${
                          isLight
                            ? 'border-neutral-200 bg-neutral-50'
                            : 'border-[#242730] bg-[#12141a]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <PlatformIcon service="instagram" size={16} />
                          <span className="text-xs font-bold">Instagram</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {(['reel', 'story', 'post'] as const).map((type) => (
                            <button
                              key={type}
                              type="button"
                              onClick={() =>
                                setPlatformOptions((p) => ({
                                  ...p,
                                  instagram: { ...p.instagram, postType: type },
                                }))
                              }
                              className={`py-1.5 rounded-lg text-xs font-semibold capitalize border transition cursor-pointer ${
                                platformOptions.instagram?.postType === type
                                  ? isLight
                                    ? 'bg-black text-white border-black'
                                    : 'bg-white text-black border-white'
                                  : isLight
                                  ? 'bg-white text-neutral-600 border-neutral-300'
                                  : 'bg-[#0a0b0e] text-[#9ea3ae] border-[#282b33]'
                              }`}
                            >
                              {type}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {!hasService('youtube') && !hasService('instagram') && (
                      <div
                        className={`p-4 rounded-xl border text-center text-xs ${
                          isLight
                            ? 'border-neutral-200 bg-neutral-50 text-neutral-700'
                            : 'border-[#242730] bg-[#12141a] text-[#9ea3ae]'
                        }`}
                      >
                        Ready to schedule to{' '}
                        <strong className={isLight ? 'text-black' : 'text-white'}>
                          {activeChannels.length}
                        </strong>{' '}
                        connected channel{activeChannels.length === 1 ? '' : 's'}.
                      </div>
                    )}
                  </div>

                  <div
                    className={`pt-3 flex items-center justify-between border-t ${
                      isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDirection('right');
                        setStep(3);
                      }}
                      className="text-xs font-semibold text-[#8e929c] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back</span>
                    </button>

                    <button
                      type="button"
                      disabled={isSubmittingToBuffer}
                      onClick={handleStartScheduling}
                      className={`px-5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer disabled:opacity-50 active:scale-[0.98] ${
                        isLight
                          ? 'bg-black text-white hover:bg-neutral-800'
                          : 'bg-white text-black hover:bg-neutral-200'
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Schedule in Buffer</span>
                    </button>
                  </div>
                </motion.div>
              )}

              {/* UPLOADING / BUFFER SUBMISSION */}
              {step === 'uploading' && (
                <motion.div
                  key="wizard-uploading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 flex flex-col items-center justify-center space-y-5 py-8 text-center"
                >
                  {postingError ? (
                    <div className="space-y-4 max-w-md">
                      <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
                      <div className="space-y-1">
                        <h3 className="text-base font-bold">Scheduling Failed</h3>
                        <p className="text-xs text-[#8e929c] leading-relaxed">{postingError}</p>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => setStep(4)}
                          className={`px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                            isLight ? 'border-neutral-300' : 'border-[#333]'
                          }`}
                        >
                          Back
                        </button>
                        {!keyStatus.hasBufferKey && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenKeyModal(1);
                            }}
                            className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer ${
                              isLight ? 'bg-black text-white' : 'bg-white text-black'
                            }`}
                          >
                            Connect Buffer
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <h2 className="text-xl font-bold tracking-tight">Scheduling in Buffer...</h2>
                        <p className="text-xs text-[#8e929c]">
                          Confirming GraphQL mutation with Buffer.
                        </p>
                      </div>
                      <div className="w-full max-w-sm space-y-1.5">
                        <div
                          className={`h-1.5 w-full rounded-full overflow-hidden ${
                            isLight ? 'bg-neutral-200' : 'bg-[#1c1f26]'
                          }`}
                        >
                          <div
                            className={`h-full transition-all duration-75 ${
                              isLight ? 'bg-black' : 'bg-white'
                            }`}
                            style={{ width: `${scheduleProgress}%` }}
                          />
                        </div>
                        <p className="text-xs font-mono tabular-nums text-[#8e929c]">
                          {scheduleProgress}%
                        </p>
                      </div>
                    </>
                  )}
                </motion.div>
              )}

              {/* SUCCESS SCREEN */}
              {step === 'success' && (
                <motion.div
                  key="wizard-success"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 flex flex-col items-center justify-center space-y-4 py-6 text-center"
                >
                  <GreenCheckAnimation size={92} onComplete={handleAnimationComplete} />
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold tracking-tight">Scheduled in Buffer</h3>
                    <p className="text-xs text-[#8e929c] max-w-xs mx-auto">"{activeTitle}"</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </LiquidGlassSurface>
      </div>
    </div>
  );
};
