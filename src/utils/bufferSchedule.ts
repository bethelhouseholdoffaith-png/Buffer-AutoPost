import { BufferChannel } from '../types';

export interface ScheduledPostSlotRef {
  dateKey: string;
  time: string;
}

export interface CalendarScheduleSlot {
  rawTime: string;
  formattedTime: string;
  paused: boolean;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function normalizeDayKey(day: string): string {
  const clean = (day || '').trim().toLowerCase();
  if (clean.startsWith('sun')) return 'sun';
  if (clean.startsWith('mon')) return 'mon';
  if (clean.startsWith('tue')) return 'tue';
  if (clean.startsWith('wed')) return 'wed';
  if (clean.startsWith('thu')) return 'thu';
  if (clean.startsWith('fri')) return 'fri';
  if (clean.startsWith('sat')) return 'sat';
  return clean.slice(0, 3);
}

export function getLocalDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function formatTimeSlot(timeStr: string): string {
  try {
    const [hStr, mStr = '00'] = timeStr.split(':');
    let h = parseInt(hStr, 10);
    const m = mStr.padStart(2, '0');
    if (isNaN(h)) return timeStr;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  } catch {
    return timeStr;
  }
}

export function formatCompactTime(timeStr: string): string {
  // e.g. "09:00" -> "9:00 AM"
  try {
    const [hStr, mStr = '00'] = timeStr.split(':');
    let h = parseInt(hStr, 10);
    const m = mStr.padStart(2, '0');
    if (isNaN(h)) return timeStr;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  } catch {
    return timeStr;
  }
}

/**
 * Get configured Buffer posting spot times & pause flags for a given day of the week.
 * Reads `postingSchedule { day, paused, times }` and `isQueuePaused` from Buffer GraphQL data.
 */
export function getBufferScheduleSlotsForDate(
  date: Date,
  channels: BufferChannel[],
  selectedChannelId?: string | null
): CalendarScheduleSlot[] {
  const dayKey = DAY_KEYS[date.getDay()];
  // Map rawTime -> whether ANY matching channel has an active (unpaused) slot at this time
  const slotMap = new Map<string, { hasActive: boolean; hasPaused: boolean }>();

  const activeChannels =
    selectedChannelId && selectedChannelId !== 'all'
      ? channels.filter((c) => c.id === selectedChannelId)
      : channels;

  for (const ch of activeChannels) {
    const channelPaused = Boolean(ch.isQueuePaused);

    if (Array.isArray(ch.postingSchedule) && ch.postingSchedule.length > 0) {
      for (const entry of ch.postingSchedule) {
        if (normalizeDayKey(entry.day) !== dayKey) continue;
        const isPaused = channelPaused || Boolean(entry.paused);
        for (const t of entry.times || []) {
          const prev = slotMap.get(t) || { hasActive: false, hasPaused: false };
          slotMap.set(t, {
            hasActive: prev.hasActive || !isPaused,
            hasPaused: prev.hasPaused || isPaused,
          });
        }
      }
    } else if (Array.isArray(ch.schedules) && ch.schedules.length > 0) {
      for (const slot of ch.schedules) {
        const slotDays = (slot.days || []).map(normalizeDayKey);
        if (!slotDays.includes(dayKey)) continue;
        const isPaused = channelPaused || Boolean(slot.paused);
        for (const t of slot.times || []) {
          const prev = slotMap.get(t) || { hasActive: false, hasPaused: false };
          slotMap.set(t, {
            hasActive: prev.hasActive || !isPaused,
            hasPaused: prev.hasPaused || isPaused,
          });
        }
      }
    }
  }

  return Array.from(slotMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rawTime, status]) => ({
      rawTime,
      formattedTime: formatCompactTime(rawTime),
      paused: !status.hasActive && status.hasPaused,
    }));
}

/**
 * Legacy string helper returning only active raw times.
 */
export function getBufferSpotsForDate(
  date: Date,
  channels: BufferChannel[],
  selectedChannelId?: string | null
): string[] {
  return getBufferScheduleSlotsForDate(date, channels, selectedChannelId)
    .filter((s) => !s.paused)
    .map((s) => s.rawTime);
}

/**
 * Find the next immediate unoccupied & unpaused Buffer posting spot from today (local time) onwards.
 * Strictly skips paused days, paused channel queues, and already occupied slots.
 */
export function findNextBufferSpot(
  channels: BufferChannel[],
  selectedChannelId?: string | null,
  existingPosts: ScheduledPostSlotRef[] = [],
  now = new Date()
): { dateKey: string; time: string; label: string; slotNumber: number } {
  const occupiedSet = new Set<string>();
  for (const post of existingPosts) {
    if (post.dateKey && post.time) {
      occupiedSet.add(`${post.dateKey}___${post.time.trim().toUpperCase()}`);
      occupiedSet.add(`${post.dateKey}___${post.time.trim().replace(/^0/, '').toUpperCase()}`);
    }
  }

  for (let offset = 0; offset <= 30; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const dateKey = getLocalDateKey(d);
    const activeSlots = getBufferScheduleSlotsForDate(d, channels, selectedChannelId).filter(
      (s) => !s.paused
    );

    for (let i = 0; i < activeSlots.length; i++) {
      const slot = activeSlots[i];
      const formattedTime = slot.formattedTime;
      const paddedTime = formatTimeSlot(slot.rawTime);

      const isOccupied =
        occupiedSet.has(`${dateKey}___${formattedTime.toUpperCase()}`) ||
        occupiedSet.has(`${dateKey}___${paddedTime.toUpperCase()}`);

      if (isOccupied) continue;

      const [hStr, mStr = '00'] = slot.rawTime.split(':');
      const spotDate = new Date(d);
      spotDate.setHours(parseInt(hStr, 10), parseInt(mStr, 10), 0, 0);

      if (offset > 0 || spotDate.getTime() > now.getTime()) {
        const dayLabel =
          offset === 0
            ? 'Today'
            : offset === 1
            ? 'Tomorrow'
            : d.toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' });

        return {
          dateKey,
          time: formattedTime,
          label: `${dayLabel}, ${formattedTime} · Slot #${i + 1}`,
          slotNumber: i + 1,
        };
      }
    }
  }

  const fallbackDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    dateKey: getLocalDateKey(fallbackDate),
    time: '9:00 AM',
    label: 'Tomorrow, 9:00 AM · Custom Slot',
    slotNumber: 1,
  };
}
