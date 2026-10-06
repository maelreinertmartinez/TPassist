import type { LockInfo, LocksDto } from '@tpassist/shared';
import { useEffect, useRef, useState } from 'react';

/** Horloge locale pour faire défiler les comptes à rebours entre deux signaux du serveur. */
export function useLockClock(locks: LocksDto | null | undefined) {
  const receivedAt = useRef(Date.now());
  const visibleMs = useRef(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    receivedAt.current = Date.now();
    visibleMs.current = 0;
  }, [locks]);

  useEffect(() => {
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      if (document.visibilityState === 'visible') visibleMs.current += now - last;
      last = now;
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  /** Temps restant estimé (ms) ; 0 si débloqué ; null si un prérequis manque. */
  return (lock: LockInfo | null | undefined): number | null => {
    if (!lock) return null;
    if (lock.unlocked) return 0;
    if (lock.remainingMs === null) return null;
    return Math.max(0, lock.remainingMs - visibleMs.current);
  };
}
