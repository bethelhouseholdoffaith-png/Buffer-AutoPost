import React from 'react';

interface PlatformIconProps {
  service: string;
  className?: string;
  size?: number;
}

export const PlatformIcon: React.FC<PlatformIconProps> = ({
  service,
  className = '',
  size = 18,
}) => {
  const s = service?.toLowerCase() || '';

  if (s.includes('youtube')) {
    return (
      <div
        className={`rounded-md bg-[#ff0000] flex items-center justify-center shrink-0 text-white ${className}`}
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-3/5 h-3/5"
        >
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      </div>
    );
  }

  if (s.includes('tiktok')) {
    return (
      <div
        className={`rounded-md bg-black border border-[#262626] flex items-center justify-center shrink-0 text-white ${className}`}
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-3/5 h-3/5"
        >
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.29 0 .58.04.85.12V9.4a6.33 6.33 0 0 0-6.34 6.34 6.34 6.34 0 0 0 10.83 4.49 6.28 6.28 0 0 0 1.86-4.5V8.55a8.28 8.28 0 0 0 4.91 1.6V6.69z" />
        </svg>
      </div>
    );
  }

  if (s.includes('instagram')) {
    return (
      <div
        className={`rounded-md bg-gradient-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] flex items-center justify-center shrink-0 text-white ${className}`}
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3/5 h-3/5"
        >
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </svg>
      </div>
    );
  }

  if (s.includes('twitter') || s.includes('x')) {
    return (
      <div
        className={`rounded-md bg-black border border-[#2a2a2a] flex items-center justify-center shrink-0 text-white ${className}`}
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-3/5 h-3/5"
        >
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </div>
    );
  }

  if (s.includes('linkedin')) {
    return (
      <div
        className={`rounded-md bg-[#0077b5] flex items-center justify-center shrink-0 text-white ${className}`}
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-3/5 h-3/5"
        >
          <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
        </svg>
      </div>
    );
  }

  if (s.includes('facebook')) {
    return (
      <div
        className={`rounded-md bg-[#1877f2] flex items-center justify-center shrink-0 text-white ${className}`}
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-3/5 h-3/5"
        >
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      </div>
    );
  }

  if (s.includes('pinterest')) {
    return (
      <div
        className={`rounded-md bg-[#e60023] flex items-center justify-center shrink-0 text-white ${className}`}
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-3/5 h-3/5"
        >
          <path d="M12 0a12 12 0 0 0-4.37 23.17c-.05-.98-.1-2.49.02-3.56l.72-3.04s-.18-.37-.18-.91c0-.85.49-1.49 1.11-1.49.52 0 .78.39.78.86 0 .53-.33 1.32-.51 2.05-.15.61.3 1.11.9 1.11 1.08 0 1.91-1.14 1.91-2.78 0-1.45-1.04-2.47-2.53-2.47-1.73 0-2.74 1.3-2.74 2.64 0 .52.2 1.08.45 1.39.05.06.06.12.04.18l-.17.7c-.03.11-.09.13-.21.08-.78-.36-1.27-1.5-1.27-2.42 0-1.97 1.43-3.78 4.13-3.78 2.17 0 3.85 1.55 3.85 3.61 0 2.15-1.36 3.89-3.24 3.89-.63 0-1.23-.33-1.43-.72l-.39 1.49c-.14.55-.52 1.23-.78 1.65A12 12 0 1 0 12 0z" />
        </svg>
      </div>
    );
  }

  // Fallback: Globe / Buffer
  return (
    <div
      className={`rounded-md bg-neutral-800 border border-neutral-700 flex items-center justify-center shrink-0 text-white font-bold text-[10px] ${className}`}
      style={{ width: size, height: size }}
    >
      🌐
    </div>
  );
};

export function getPlatformDisplayName(service: string, fallbackName?: string): string {
  const s = service?.toLowerCase() || '';
  if (s.includes('youtube')) return 'YouTube Shorts';
  if (s.includes('tiktok')) return 'TikTok';
  if (s.includes('instagram')) return 'Instagram Reels';
  if (s.includes('twitter') || s.includes('x')) return 'X (Twitter)';
  if (s.includes('linkedin')) return 'LinkedIn';
  if (s.includes('facebook')) return 'Facebook Video';
  if (s.includes('pinterest')) return 'Pinterest';
  if (s.includes('threads')) return 'Threads';
  return fallbackName || 'Social Platform';
}
