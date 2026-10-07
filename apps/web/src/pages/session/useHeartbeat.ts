// Présence et chronomètre de la séance.
import type { HeartbeatResponse } from '@tpassist/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';

const HEARTBEAT_MS = 5000;

/**
 * Envoie le signal de présence toutes les 5 s et à chaque changement de visibilité de la page :
 * le serveur compte le temps actif (qui débloque les aides) et avance le chronomètre.
 * @returns une fonction pour envoyer un signal immédiatement (avant une demande d'aide, par exemple)
 */
export function useHeartbeat(sessionId: string | undefined, questionId: string | null, active: boolean, onBeat: (r: HeartbeatResponse) => void) {
  const handler = useRef(onBeat);
  handler.current = onBeat;
  const beat = useCallback(async () => {
    if (!active) return;
    try {
      handler.current(await api.post<HeartbeatResponse>(`/api/sessions/${sessionId}/heartbeat`, { questionId, visible: document.visibilityState === 'visible' }));
    } catch {
      // réseau : on réessaiera au prochain battement
    }
  }, [sessionId, questionId, active]);

  useEffect(() => {
    void beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    const onVisibility = () => void beat();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [beat]);

  return beat;
}

/**
 * Chronomètre affiché (en secondes) : recalé sur la valeur du serveur, il avance seul chaque seconde
 * quand `ticking` est vrai (EI chronométrée en cours).
 */
export function useSessionClock(serverSec: number | undefined, ticking: boolean) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (serverSec !== undefined) setSec(serverSec);
  }, [serverSec]);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setSec((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  return [sec, setSec] as const;
}
