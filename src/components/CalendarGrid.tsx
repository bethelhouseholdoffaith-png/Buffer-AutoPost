import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Plus, Globe, Edit3, Trash2, PauseCircle, X } from 'lucide-react';
import { BufferChannel, PlatformPostOptions } from '../types';
import { PlatformIcon } from './PlatformIcon';
import { getBufferScheduleSlotsForDate, getLocalDateKey } from '../utils/bufferSchedule';

export interface ScheduledPostItem {
  id: string;
  bufferPostIds?: Record<string, string>;
  channelId: string;
  channelName: string;
  service: string;
  avatar?: string;
  time: string;
  title: string;
  dateKey: string; // "YYYY-MM-DD" (Local Time)
  videoUrl?: string;
  platformOptions?: PlatformPostOptions;
}

interface CalendarGridProps {
  currentDate: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  scheduledPosts: ScheduledPostItem[];
  nextOpenDateKey: string;
  nextOpenTime: string;
  nextOpenTimeLabel: string;
  onOpenUploadForDate: (dateKey: string, time?: string) => void;
  onEditPost: (post: ScheduledPostItem) => void;
  onDeletePost: (post: ScheduledPostItem) => void;
  channels?: BufferChannel[];
  selectedChannelId?: string | null;
  theme?: 'black' | 'charcoal' | 'light';
}

export const CalendarGrid: React.FC<CalendarGridProps> = ({
  currentDate,
  onPrevMonth,
  onNextMonth,
  onToday,
  scheduledPosts,
  nextOpenDateKey,
  nextOpenTime,
  nextOpenTimeLabel,
  onOpenUploadForDate,
  onEditPost,
  onDeletePost,
  channels = [],
  selectedChannelId = 'all',
  theme = 'black',
}) => {
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const shortDaysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const isLight = theme === 'light';

  // Right-click (and touch long-press) context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    post: ScheduledPostItem;
  } | null>(null);
  const [pausedNotice, setPausedNotice] = useState<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setPausedNotice(null);
      }
    };
    window.addEventListener('click', closeMenu);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('keydown', handleKey);
    };
  }, []);

  const now = new Date();
  const todayLocalKey = getLocalDateKey(now);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthName = currentDate.toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });

  const isViewingCurrentMonth =
    year === now.getFullYear() && month === now.getMonth();

  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();

  type CalendarCell =
    | { isEmpty: true; key: string }
    | {
        isEmpty: false;
        key: string;
        date: Date;
        dateKey: string;
        dayNumber: number;
        isToday: boolean;
      };

  const cells: CalendarCell[] = [];

  for (let i = 0; i < firstDayOfWeek; i++) {
    cells.push({ isEmpty: true, key: `empty-start-${year}-${month}-${i}` });
  }

  for (let day = 1; day <= daysInCurrentMonth; day++) {
    const d = new Date(year, month, day);
    const dateKey = getLocalDateKey(d);
    cells.push({
      isEmpty: false,
      key: dateKey,
      date: d,
      dateKey,
      dayNumber: day,
      isToday: dateKey === todayLocalKey,
    });
  }

  const trailingCount = (7 - (cells.length % 7)) % 7;
  for (let i = 0; i < trailingCount; i++) {
    cells.push({ isEmpty: true, key: `empty-end-${year}-${month}-${i}` });
  }

  const weekRows = Math.ceil(cells.length / 7);

  return (
    <div
      className={`flex-1 flex flex-col h-full font-sans overflow-hidden relative ${
        isLight
          ? 'bg-white text-neutral-900'
          : theme === 'charcoal'
          ? 'bg-[#0f1015] text-[#e5e5e5]'
          : 'bg-[#0a0a0c] text-[#e5e5e5]'
      }`}
    >
      {/* Calendar Navigation Header */}
      <div
        className={`px-3 sm:px-5 py-2.5 border-b flex items-center justify-between flex-wrap gap-2 shrink-0 ${
          isLight
            ? 'bg-[#fafafa] border-neutral-200'
            : 'bg-[#0d0e12] border-[#1c1e24]'
        }`}
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={onPrevMonth}
              className={`p-1.5 rounded-lg border transition cursor-pointer ${
                isLight
                  ? 'border-neutral-300 hover:bg-neutral-200 text-neutral-700 hover:text-black'
                  : 'border-[#262830] hover:bg-[#161820] text-[#a3a3a3] hover:text-white'
              }`}
              title="Previous Month"
              aria-label="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <h2
              className={`text-sm sm:text-base font-bold tracking-tight px-2 tabular-nums ${
                isLight ? 'text-neutral-900' : 'text-white'
              }`}
            >
              {monthName}
            </h2>
            <button
              onClick={onNextMonth}
              className={`p-1.5 rounded-lg border transition cursor-pointer ${
                isLight
                  ? 'border-neutral-300 hover:bg-neutral-200 text-neutral-700 hover:text-black'
                  : 'border-[#262830] hover:bg-[#161820] text-[#a3a3a3] hover:text-white'
              }`}
              title="Next Month"
              aria-label="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={onToday}
            className={`px-3 py-1 text-xs font-semibold rounded-lg border transition cursor-pointer ${
              isViewingCurrentMonth
                ? isLight
                  ? 'bg-black text-white border-black shadow-[0_0_16px_rgba(0,0,0,0.28)]'
                  : 'bg-white text-black border-white shadow-[0_0_16px_rgba(255,255,255,0.5)]'
                : isLight
                ? 'border-neutral-300 bg-white text-neutral-700 hover:text-black hover:border-neutral-500'
                : 'border-[#262830] bg-[#121419] text-[#d4d4d4] hover:text-white hover:border-neutral-500'
            }`}
          >
            Today
          </button>
        </div>

        {/* Clean Unboxed Metadata: Next Open Spot */}
        <div
          className={`flex items-center gap-2 text-xs tabular-nums ${
            isLight ? 'text-neutral-600' : 'text-[#9ea3ae]'
          }`}
        >
          <span>Next Open Spot</span>
          <span aria-hidden="true">·</span>
          <strong className={`font-semibold ${isLight ? 'text-black' : 'text-white'}`}>
            {nextOpenTimeLabel}
          </strong>
        </div>
      </div>

      {/* Paused Queue Feedback Notice */}
      {pausedNotice && (
        <div
          role="status"
          className={`px-4 py-2 border-b flex items-center justify-between text-xs shrink-0 ${
            isLight
              ? 'bg-neutral-100 border-neutral-200 text-neutral-800'
              : 'bg-[#121419] border-[#1f222a] text-[#d4d4d8]'
          }`}
        >
          <span className="flex items-center gap-2">
            <PauseCircle className="w-3.5 h-3.5 shrink-0 opacity-70" />
            <span>{pausedNotice}</span>
          </span>
          <button
            type="button"
            onClick={() => setPausedNotice(null)}
            className="p-0.5 rounded hover:bg-white/10 cursor-pointer"
            aria-label="Dismiss notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Weekday Column Headers */}
      <div
        className={`grid grid-cols-7 border-b text-[11px] font-semibold tracking-wide shrink-0 ${
          isLight
            ? 'border-neutral-200 bg-[#f4f4f5]'
            : 'border-[#1c1e24] bg-[#0f1015]'
        }`}
      >
        {daysOfWeek.map((day, idx) => (
          <div
            key={day}
            className={`py-1.5 sm:py-2 text-center border-r last:border-r-0 ${
              isLight
                ? 'text-neutral-500 border-neutral-200'
                : 'text-[#7b808c] border-[#1c1e24]'
            }`}
          >
            <span className="hidden md:inline">{day}</span>
            <span className="md:hidden">{shortDaysOfWeek[idx]}</span>
          </div>
        ))}
      </div>

      {/* Dynamic Viewport Grid */}
      <div
        className={`flex-1 grid grid-cols-7 overflow-y-auto ${
          isLight ? 'bg-white' : theme === 'charcoal' ? 'bg-[#0f1015]' : 'bg-[#0a0a0c]'
        }`}
        style={{
          gridTemplateRows: `repeat(${weekRows}, minmax(max-content, 1fr))`,
        }}
      >
        {cells.map((cell) => {
          if (cell.isEmpty) {
            return (
              <div
                key={cell.key}
                className={`min-w-0 border-r border-b ${
                  isLight
                    ? 'border-neutral-200 bg-neutral-100/60'
                    : 'border-[#1c1e24] bg-[#060709]/60'
                }`}
              />
            );
          }

          const postsForDate = scheduledPosts.filter((p) => p.dateKey === cell.dateKey);
          const isNextSpotDay = cell.dateKey === nextOpenDateKey;
          const scheduleSlots = getBufferScheduleSlotsForDate(
            cell.date,
            channels,
            selectedChannelId
          );
          const occupiedTimes = new Set(
            postsForDate.map((p) => p.time.trim().replace(/^0/, '').toUpperCase())
          );

          const remainingSlots = scheduleSlots.filter(
            (slot) => !occupiedTimes.has(slot.formattedTime.replace(/^0/, '').toUpperCase())
          );

          return (
            <div
              key={cell.key}
              className={`min-w-0 p-1 sm:p-1.5 lg:p-2 border-r border-b flex flex-col justify-between gap-1 transition group/cell relative ${
                isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
              } ${
                cell.isToday
                  ? isLight
                    ? 'ring-2 ring-inset ring-black bg-neutral-100/70'
                    : 'ring-2 ring-inset ring-white bg-white/[0.03]'
                  : isNextSpotDay
                  ? isLight
                    ? 'ring-1 ring-inset ring-black/30 bg-neutral-50'
                    : 'ring-1 ring-inset ring-white/30 bg-white/[0.015]'
                  : isLight
                  ? 'bg-white hover:bg-neutral-50'
                  : 'bg-[#0a0a0c] hover:bg-[#0e1015]'
              }`}
            >
              {/* Day Header */}
              <div className="flex items-center justify-between gap-1 text-xs min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`font-semibold tabular-nums shrink-0 ${
                      cell.isToday
                        ? isLight
                          ? 'px-1.5 py-0.5 rounded bg-black text-white font-bold text-[11px] leading-none'
                          : 'px-1.5 py-0.5 rounded bg-white text-black font-bold text-[11px] leading-none'
                        : isLight
                        ? 'text-neutral-800 text-[11px] sm:text-xs'
                        : 'text-[#d4d4d4] text-[11px] sm:text-xs'
                    }`}
                  >
                    {cell.dayNumber}
                  </span>

                  {isNextSpotDay && (
                    <span
                      className={`hidden md:inline-block text-[10px] font-medium truncate ${
                        isLight ? 'text-neutral-600' : 'text-[#9ea3ae]'
                      }`}
                    >
                      Next
                    </span>
                  )}
                </div>

                <button
                  onClick={() => onOpenUploadForDate(cell.dateKey)}
                  title={`Schedule post for ${cell.dateKey}`}
                  aria-label={`Schedule post for ${cell.dateKey}`}
                  className={`opacity-0 group-hover/cell:opacity-100 focus:opacity-100 p-0.5 rounded transition cursor-pointer shrink-0 ${
                    isLight
                      ? 'bg-neutral-200 hover:bg-black hover:text-white text-neutral-700'
                      : 'bg-[#181a20] hover:bg-white hover:text-black text-[#a3a3a3]'
                  }`}
                >
                  <Plus className="w-3 h-3 stroke-[2.5]" />
                </button>
              </div>

              {/* Scheduled Posts */}
              <div className="space-y-1 flex-1 min-w-0">
                {postsForDate.map((post) => (
                  <div
                    key={post.id}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({ x: e.clientX, y: e.clientY, post });
                    }}
                    onTouchStart={(e) => {
                      const touch = e.touches[0];
                      const tx = touch.clientX;
                      const ty = touch.clientY;
                      longPressTimerRef.current = window.setTimeout(() => {
                        setContextMenu({ x: tx, y: ty, post });
                      }, 480);
                    }}
                    onTouchEnd={() => {
                      if (longPressTimerRef.current) {
                        clearTimeout(longPressTimerRef.current);
                        longPressTimerRef.current = null;
                      }
                    }}
                    onTouchMove={() => {
                      if (longPressTimerRef.current) {
                        clearTimeout(longPressTimerRef.current);
                        longPressTimerRef.current = null;
                      }
                    }}
                    title="Right-click to Edit or Delete"
                    className={`min-w-0 p-1 sm:p-1.5 rounded-lg border transition cursor-context-menu space-y-0.5 ${
                      isLight
                        ? 'border-neutral-300 bg-neutral-100 hover:border-black'
                        : 'border-[#252832] bg-[#13151b] hover:border-white/50'
                    }`}
                  >
                    <div
                      className={`flex items-center justify-between gap-1 text-[9px] sm:text-[10px] min-w-0 ${
                        isLight ? 'text-neutral-600' : 'text-[#a3a3a3]'
                      }`}
                    >
                      <div className="flex items-center gap-1 min-w-0">
                        {post.channelId === 'all' ? (
                          <Globe
                            className={`w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0 ${
                              isLight ? 'text-black' : 'text-white'
                            }`}
                          />
                        ) : (
                          <PlatformIcon service={post.service} size={12} />
                        )}
                        <span
                          className={`font-semibold truncate ${
                            isLight ? 'text-neutral-900' : 'text-white'
                          }`}
                        >
                          {post.channelName}
                        </span>
                      </div>
                      <span
                        className={`font-mono tabular-nums shrink-0 text-[8px] sm:text-[9px] ${
                          isLight ? 'text-neutral-600' : 'text-[#9ea3ae]'
                        }`}
                      >
                        {post.time}
                      </span>
                    </div>

                    <p
                      className={`text-[10px] sm:text-[11px] font-medium whitespace-normal break-words leading-snug ${
                        isLight ? 'text-neutral-900' : 'text-white'
                      }`}
                    >
                      {post.title}
                    </p>
                  </div>
                ))}
              </div>

              {/* Active & Paused Buffer Posting Schedule Slots */}
              {remainingSlots.length > 0 && (
                <div className="pt-0.5 flex flex-wrap gap-1 min-w-0">
                  {remainingSlots.map((slot) => {
                    const isExactNextSlot =
                      !slot.paused &&
                      isNextSpotDay &&
                      slot.formattedTime.replace(/^0/, '').toUpperCase() ===
                        nextOpenTime.trim().replace(/^0/, '').toUpperCase();

                    if (slot.paused) {
                      return (
                        <button
                          key={`${slot.rawTime}-paused`}
                          type="button"
                          onClick={() =>
                            setPausedNotice(
                              `${cell.dateKey} at ${slot.formattedTime} is paused in Buffer. Unpause this day or channel queue in Buffer to schedule into it.`
                            )
                          }
                          title={`Paused in Buffer (${slot.formattedTime})`}
                          aria-label={`${slot.formattedTime} Paused`}
                          className={`text-[8px] sm:text-[10px] font-medium tabular-nums px-1.5 py-0.5 rounded-md border border-dashed opacity-50 transition cursor-not-allowed flex items-center gap-1 ${
                            isLight
                              ? 'border-neutral-300 bg-neutral-100 text-neutral-500'
                              : 'border-[#252832] bg-[#0e1015] text-[#7b808c]'
                          }`}
                        >
                          <span>{slot.formattedTime}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold">Paused</span>
                        </button>
                      );
                    }

                    return (
                      <button
                        key={slot.rawTime}
                        type="button"
                        onClick={() => onOpenUploadForDate(cell.dateKey, slot.formattedTime)}
                        title={`Queue into Buffer ${slot.formattedTime} schedule slot`}
                        className={`text-[8px] sm:text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md border transition cursor-pointer ${
                          isExactNextSlot
                            ? isLight
                              ? 'border-black/45 bg-neutral-200 text-black hover:bg-black hover:text-white'
                              : 'border-white/45 bg-white/10 text-white hover:bg-white hover:text-black'
                            : isLight
                            ? 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:border-black hover:text-black'
                            : 'border-[#20232b] bg-[#101217] text-[#9ea3ae] hover:border-white/40 hover:text-white'
                        }`}
                      >
                        {slot.formattedTime}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            top: Math.min(contextMenu.y, window.innerHeight - 110),
            left: Math.min(contextMenu.x, window.innerWidth - 170),
          }}
          className={`fixed z-50 w-40 rounded-xl border shadow-2xl py-1.5 text-xs font-semibold overflow-hidden ${
            isLight
              ? 'border-neutral-300 bg-white text-neutral-900'
              : 'border-[#2c303a] bg-[#0e1015] text-white'
          }`}
        >
          <button
            onClick={() => {
              const target = contextMenu.post;
              setContextMenu(null);
              onEditPost(target);
            }}
            className={`w-full px-3.5 py-2 flex items-center gap-2.5 transition text-left cursor-pointer ${
              isLight ? 'hover:bg-black hover:text-white' : 'hover:bg-white hover:text-black'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Edit Post</span>
          </button>
          <button
            onClick={() => {
              const target = contextMenu.post;
              setContextMenu(null);
              onDeletePost(target);
            }}
            className="w-full px-3.5 py-2 flex items-center gap-2.5 text-rose-500 hover:bg-rose-500 hover:text-white transition text-left cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Post</span>
          </button>
        </div>
      )}
    </div>
  );
};
