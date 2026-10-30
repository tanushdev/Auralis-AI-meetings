"use client";

import { useEffect, useState } from "react";

export function useMeetingTimer(startedAt: string | null | undefined): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!startedAt) {
      setSeconds(0);
      return;
    }
    const start = new Date(startedAt).getTime();
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return seconds;
}
