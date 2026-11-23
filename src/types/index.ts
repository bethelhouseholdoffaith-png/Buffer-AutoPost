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

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  hasSeenWelcome: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

export interface UserPreferences {
  appName: string;
  appSubtitle: string;
  avatarUrl: string;
  theme: 'black' | 'charcoal' | 'light';
  liquidGlass: boolean;
  sidebarCollapsed: boolean;
}

export interface SessionInfo {
  id: string;
  userAgent: string;
  ipAddress: string;
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
  isCurrent: boolean;
}

export interface CloudScheduledPost {
  id: string;
  bufferPostIds?: Record<string, string>;
  channelId: string;
  channelName: string;
  service: string;
  avatar?: string;
  time: string;
  title: string;
  dateKey: string;
  videoUrl?: string;
  platformOptions?: PlatformPostOptions;
}

export interface AuthSnapshot {
  authenticated: boolean;
  needsAdminBootstrap?: boolean;
  isNewUser?: boolean;
  user?: AuthUser;
  preferences?: UserPreferences;
  keyStatus?: KeyStatus;
  channels?: BufferChannel[];
  scheduledPosts?: CloudScheduledPost[];
}

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  activeAdmins: number;
  newRegistrations7d: number;
  activeSessions: number;
  totalScheduledPosts: number;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: number;
  lastLoginAt: number | null;
  hasBufferKey: boolean;
  hasGeminiKey: boolean;
  activeSessions: number;
  postCount: number;
}

export interface AdminAuditLog {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetUserId: string | null;
  targetEmail: string | null;
  details?: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: number;
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
