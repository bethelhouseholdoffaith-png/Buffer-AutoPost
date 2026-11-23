import React, { useState, useEffect } from 'react';
import { X, Calendar as CalendarIcon, Clock, Save } from 'lucide-react';
import { ScheduledPostItem } from './CalendarGrid';
import { LiquidGlassSurface } from './LiquidGlassSurface';

interface EditPostModalProps {
  post: ScheduledPostItem | null;
  theme?: 'black' | 'charcoal' | 'light';
  liquidGlass?: boolean;
  onClose: () => void;
  onSave: (updated: ScheduledPostItem) => Promise<void> | void;
}

const TIME_OPTIONS = [
  '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
  '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM',
  '6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM', '10:00 PM',
];

export const EditPostModal: React.FC<EditPostModalProps> = ({
  post,
  theme = 'black',
  liquidGlass = false,
  onClose,
  onSave,
}) => {
  const [title, setTitle] = useState('');
  const [dateKey, setDateKey] = useState('');
  const [time, setTime] = useState('9:00 AM');
  const [isSaving, setIsSaving] = useState(false);

  const isLight = theme === 'light';

  useEffect(() => {
    if (post) {
      setTitle(post.title);
      setDateKey(post.dateKey);
      setTime(post.time.replace(/^0(\d:)/, '$1'));
      setIsSaving(false);
    }
  }, [post]);

  useEffect(() => {
    if (!post) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [post, isSaving, onClose]);

  if (!post) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({
        ...post,
        title: title.trim() || post.title,
        dateKey: dateKey || post.dateKey,
        time: time || post.time,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit Scheduled Post"
      className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-md flex items-center justify-center p-4 select-none"
    >
      <div className="w-full max-w-md">
        <LiquidGlassSurface
          enabled={liquidGlass}
          isLight={isLight}
          className="rounded-3xl overflow-hidden font-sans"
        >
          <form onSubmit={handleSubmit}>
            {/* Header */}
            <div
              className={`px-6 py-4 border-b flex items-center justify-between ${
                isLight ? 'border-neutral-200' : 'border-[#1c1e24]'
              }`}
            >
              <h3
                className={`text-xs font-extrabold uppercase tracking-wider ${
                  isLight ? 'text-neutral-900' : 'text-white'
                }`}
              >
                Edit Scheduled Post
              </h3>
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                aria-label="Close modal"
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
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-post-title"
                  className={`block text-[11px] font-bold uppercase tracking-wider ${
                    isLight ? 'text-neutral-600' : 'text-[#a3a3a3]'
                  }`}
                >
                  Post Title / Caption
                </label>
                <textarea
                  id="edit-post-title"
                  rows={3}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={`w-full px-3.5 py-2.5 text-sm font-semibold rounded-2xl border focus:outline-none transition resize-none ${
                    isLight
                      ? 'border-neutral-300 bg-white text-neutral-900 focus:border-black'
                      : 'border-[#2c3038] bg-[#121318] text-white focus:border-white'
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="edit-post-date"
                    className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${
                      isLight ? 'text-neutral-600' : 'text-[#a3a3a3]'
                    }`}
                  >
                    <CalendarIcon className="w-3 h-3" />
                    <span>Date</span>
                  </label>
                  <input
                    id="edit-post-date"
                    type="date"
                    value={dateKey}
                    onChange={(e) => setDateKey(e.target.value)}
                    className={`w-full px-3 py-2 rounded-xl border text-xs font-bold tabular-nums focus:outline-none ${
                      isLight
                        ? 'border-neutral-300 bg-white text-neutral-900 focus:border-black'
                        : 'border-[#2c3038] bg-[#121318] text-white focus:border-white'
                    }`}
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="edit-post-time"
                    className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${
                      isLight ? 'text-neutral-600' : 'text-[#a3a3a3]'
                    }`}
                  >
                    <Clock className="w-3 h-3" />
                    <span>Time</span>
                  </label>
                  <select
                    id="edit-post-time"
                    value={TIME_OPTIONS.includes(time) ? time : TIME_OPTIONS[1]}
                    onChange={(e) => setTime(e.target.value)}
                    className={`w-full px-3 py-2 rounded-xl border text-xs font-bold tabular-nums focus:outline-none ${
                      isLight
                        ? 'border-neutral-300 bg-white text-neutral-900 focus:border-black'
                        : 'border-[#2c3038] bg-[#121318] text-white focus:border-white'
                    }`}
                  >
                    {!TIME_OPTIONS.includes(time) && (
                      <option value={time}>{time}</option>
                    )}
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
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
                disabled={isSaving}
                className={`px-4 py-2 text-xs font-semibold transition cursor-pointer ${
                  isLight
                    ? 'text-neutral-500 hover:text-black'
                    : 'text-[#a3a3a3] hover:text-white'
                }`}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSaving}
                className={`px-5 py-2.5 rounded-full text-xs font-extrabold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-[0.98] ${
                  isLight
                    ? 'bg-black text-white hover:bg-neutral-800'
                    : 'bg-white text-black hover:bg-neutral-200'
                }`}
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          </form>
        </LiquidGlassSurface>
      </div>
    </div>
  );
};
