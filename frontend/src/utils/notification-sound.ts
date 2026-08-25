/**
 * notification-sound.ts — chuông thông báo bằng Web Audio API (không cần file
 * mp3/ogg, không lo license hay bundle size).
 *
 * Chuông 2 nốt "ding-dong" (E6 → C6) với envelope mượt, âm lượng nhẹ. Trình
 * duyệt chặn autoplay trước khi user tương tác lần đầu → AudioContext được
 * resume trong handler click/keydown cài sẵn ở module scope; nếu thông báo đến
 * trước tương tác đầu thì bỏ lượt đó (im lặng, không lỗi).
 */

let ctx: AudioContext | null = null;
let unlocked = false;
/** Chống kêu liên tục khi nhiều thông báo dồn về trong vài giây. */
let lastPlayedAt = 0;
const MIN_INTERVAL_MS = 3_000;

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC: typeof AudioContext | undefined =
    window.AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return null; // trình duyệt quá cũ — im lặng
  if (!ctx) ctx = new AC();
  return ctx;
}

/** Resume context trong gesture đầu tiên của user (autoplay policy). */
function unlock(): void {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') {
    c.resume().catch(() => {});
  }
  // Coi là unlocked sau gesture kể cả khi state chưa kịp đổi.
  unlocked = true;
}

if (typeof window !== 'undefined') {
  const opts = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', unlock, opts);
  window.addEventListener('keydown', unlock, opts);
}

/**
 * Phát chuông thông báo. No-op an toàn khi: tab nền chưa từng có gesture,
 * AudioContext bị treo, hoặc gọi liên tiếp dưới MIN_INTERVAL_MS.
 */
export function playNotificationSound(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    // Tab đang ẩn vẫn cho phép phát (user muốn nghe khi làm việc elsewhere) —
    // nhưng nếu chưa unlocked thì bỏ qua vì autoplay policy.
  }
  if (!unlocked) return;

  const now = Date.now();
  if (now - lastPlayedAt < MIN_INTERVAL_MS) return;
  lastPlayedAt = now;

  try {
    const c = ensureCtx();
    if (!c || c.state === 'suspended') {
      // Thử resume; nếu vẫn suspended (chưa có gesture thật) thì bỏ lượt.
      c?.resume().catch(() => {});
      if (!c || c.state === 'suspended') return;
    }

    const t0 = c.currentTime;
    const master = c.createGain();
    master.gain.value = 0.18; // nhẹ — không startle người dùng
    master.connect(c.destination);

    // Hai nốt: E6 (1318.5Hz) rồi C6 (1046.5Hz), mỗi nốt ~0.22s, decay mượt.
    const notes: Array<{ freq: number; start: number }> = [
      { freq: 1318.5, start: 0 },
      { freq: 1046.5, start: 0.22 },
    ];
    for (const { freq, start } of notes) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + start);
      gain.gain.linearRampToValueAtTime(1, t0 + start + 0.02); // attack nhanh
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + start + 0.45); // decay
      osc.connect(gain);
      gain.connect(master);
      osc.start(t0 + start);
      osc.stop(t0 + start + 0.5);
    }
  } catch {
    // Mọi lỗi audio phải im lặng — thông báo text vẫn quan trọng hơn.
  }
}
