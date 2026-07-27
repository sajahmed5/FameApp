import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

import { recordSwipe, undoSwipe, type SwipeDirection } from '@/lib/deck';

type SwipeOp = { id: string; type: 'swipe'; postId: string; direction: SwipeDirection };
type UndoOp = { id: string; type: 'undo'; postId: string };
type Op = SwipeOp | UndoOp;

/**
 * Durable, offline-tolerant queue of swipe writes.
 *
 * Swipes are recorded optimistically (the card leaves immediately); the actual write is
 * enqueued and processed FIFO in the background. If a write fails (offline / server
 * error) the op stays queued and is retried on reconnect. Because record_swipe and
 * undo_swipe are idempotent, retries are safe.
 *
 * Undo annihilation: undoing a swipe that hasn't been sent yet simply removes the queued
 * swipe (no server round-trip). If the swipe is already sent (or in flight), an undo op is
 * enqueued so the server reverses it via a compensating ledger entry.
 */
export class SwipeQueue {
  private ops: Op[] = [];
  private storageKey: string;
  private looping = false;
  private inFlight = false;
  private seq = 0;
  private netUnsub?: () => void;
  private onChange?: (pending: number) => void;

  constructor(userId: string, onChange?: (pending: number) => void) {
    this.storageKey = `swipe-queue:${userId}`;
    this.onChange = onChange;
  }

  async init(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(this.storageKey);
      if (raw) this.ops = JSON.parse(raw) as Op[];
    } catch {
      // corrupt/absent — start empty
    }
    this.netUnsub = NetInfo.addEventListener((state) => {
      if (state.isConnected) void this.process();
    });
    this.notify();
    void this.process();
  }

  dispose(): void {
    this.netUnsub?.();
  }

  get pending(): number {
    return this.ops.length;
  }

  enqueueSwipe(postId: string, direction: SwipeDirection): void {
    this.ops.push({ id: this.nextId(), type: 'swipe', postId, direction });
    void this.persist();
    this.notify();
    void this.process();
  }

  enqueueUndo(postId: string): void {
    // If the matching swipe hasn't been sent yet, cancel it instead of round-tripping.
    const idx = this.ops.findIndex(
      (op, i) => op.type === 'swipe' && op.postId === postId && !(this.inFlight && i === 0),
    );
    if (idx >= 0) {
      this.ops.splice(idx, 1);
    } else {
      this.ops.push({ id: this.nextId(), type: 'undo', postId });
    }
    void this.persist();
    this.notify();
    void this.process();
  }

  /** Force a flush attempt (e.g. from a retry button or AppState becoming active). */
  flush(): void {
    void this.process();
  }

  private nextId(): string {
    this.seq += 1;
    return `${Date.now()}-${this.seq}`;
  }

  private notify(): void {
    this.onChange?.(this.ops.length);
  }

  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(this.storageKey, JSON.stringify(this.ops));
    } catch {
      // best-effort persistence
    }
  }

  private async process(): Promise<void> {
    if (this.looping) return;
    this.looping = true;
    try {
      while (this.ops.length) {
        const op = this.ops[0];
        this.inFlight = true;
        let ok = false;
        try {
          if (op.type === 'swipe') await recordSwipe(op.postId, op.direction);
          else await undoSwipe(op.postId);
          ok = true;
        } catch {
          ok = false;
        }
        this.inFlight = false;
        if (!ok) return; // keep the op; retry on the next trigger (reconnect / flush)
        this.ops.shift();
        await this.persist();
        this.notify();
      }
    } finally {
      this.looping = false;
      this.inFlight = false;
    }
  }
}
