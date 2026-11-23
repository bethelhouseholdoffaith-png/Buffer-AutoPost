export interface BufferScheduleSlot {
  days: string[]; // normalized ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
  times: string[]; // ["09:00", "13:00", "17:00"]
  paused?: boolean;
}

export interface BufferPostingScheduleDay {
  day: string; // e.g. "monday" -> normalized "mon"
  paused: boolean;
  times: string[];
}

export type BufferPlanTier = 'free' | 'essentials' | 'team';

export interface BufferChannel {
  id: string;
  name: string;
  displayName?: string;
  handle?: string;
  service: 'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'twitter' | 'facebook' | 'pinterest' | 'threads' | string;
  avatar?: string;
  isQueuePaused?: boolean;
  organizationId?: string;
  organizationName?: string;
  postingSchedule?: BufferPostingScheduleDay[];
  schedules?: BufferScheduleSlot[];
  timezone?: string;
  postingGoal?: number;
}

export interface BufferAccount {
  id: string;
  email?: string;
  name?: string;
  plan?: BufferPlanTier;
}

export interface BufferRateLimitInfo {
  limit15m?: number;
  remaining15m?: number;
  limitDaily?: number;
  remainingDaily?: number;
  limitMonthly?: number;
  remainingMonthly?: number;
  resetSeconds?: number;
  retryAfterSeconds?: number;
  rawPolicy?: string;
  rawRateLimit?: string;
}

export interface KeyStatus {
  hasBufferKey: boolean;
  hasGeminiKey: boolean;
}

export interface PlatformPostOptions {
  youtube?: {
    playlist?: string;
    visibility?: 'public' | 'unlisted' | 'private';
    isPremiere?: boolean;
    madeForKids?: boolean;
    notifySubscribers?: boolean;
    category?: string;
  };
  instagram?: {
    postType?: 'reel' | 'story' | 'post';
    shareToFeed?: boolean;
    firstComment?: string;
    location?: string;
  };
  tiktok?: {
    privacy?: 'public' | 'friends' | 'private';
    allowComments?: boolean;
    allowDuet?: boolean;
    allowStitch?: boolean;
  };
  facebook?: {
    postType?: 'reel' | 'video' | 'story';
  };
  linkedin?: {
    visibility?: 'anyone' | 'connections';
  };
  pinterest?: {
    board?: string;
    destinationLink?: string;
  };
  twitter?: {
    replySettings?: 'everyone' | 'mentioned' | 'verified';
  };
}

export interface VideoMetadata {
  file?: File;
  filename: string;
  duration: number;
  width: number;
  height: number;
  size: number;
  mimeType: string;
  localPreviewUrl: string;
  uploadId?: string;
  publicVideoUrl?: string;
}

export interface GeminiTitleAnalysisResult {
  title: string;
  alternatives: string[];
  content_summary: string;
  uploadId?: string;
  publicVideoUrl?: string;
  model?: string;
  cached?: boolean;
  fileRetentionMinutes?: number;
}

export interface TitleVariation {
  style: string;
  title: string;
}

export interface TitleGenerationResult {
  primaryTitle: string;
  alternativeTitles: TitleVariation[];
  fullCaption: string;
  hashtags: string[];
  callToAction: string;
  hookAngle?: string;
}
