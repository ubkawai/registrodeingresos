import { useEffect, useRef } from "react";

// Los lectores de código de barras USB (alámbricos) y los inalámbricos
// (dongle 2.4GHz o Bluetooth HID) funcionan como un teclado: "escriben" el
// código muy rápido y terminan con Enter. Este hook escucha el teclado a nivel
// global y distingue una lectura del lector (teclas muy seguidas) de una
// persona escribiendo.

type Options = {
  enabled?: boolean;
  minLength?: number;
  // Tiempo máximo entre teclas para considerarlo lector (ms).
  // Los inalámbricos suelen ser algo más lentos que los alámbricos.
  maxKeyIntervalMs?: number;
  // Si el lector no envía Enter, se procesa tras este tiempo sin teclas (ms).
  idleFlushMs?: number;
};

const isEditable = (el: EventTarget | null) => {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

export const useBarcodeScanner = (
  onScan: (code: string) => void,
  {
    enabled = true,
    minLength = 6,
    maxKeyIntervalMs = 80,
    idleFlushMs = 200,
  }: Options = {}
) => {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let buffer = "";
    let lastKeyAt = 0;
    let flushTimer: number | null = null;

    const clearFlush = () => {
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
    };

    const flush = () => {
      clearFlush();
      const code = buffer.trim();
      buffer = "";
      if (code.length >= minLength) onScanRef.current(code);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Si el foco está en un campo de texto, ese campo recibe la lectura.
      if (isEditable(e.target)) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const now = performance.now();

      if (e.key === "Enter" || e.key === "Tab") {
        if (buffer.length >= minLength) {
          e.preventDefault();
          flush();
        } else {
          buffer = "";
          clearFlush();
        }
        return;
      }

      if (e.key.length !== 1) return;

      // Pausa larga entre teclas => es una persona, reinicia el buffer.
      if (now - lastKeyAt > maxKeyIntervalMs) buffer = "";
      lastKeyAt = now;
      buffer += e.key;

      clearFlush();
      flushTimer = window.setTimeout(flush, idleFlushMs);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearFlush();
    };
  }, [enabled, minLength, maxKeyIntervalMs, idleFlushMs]);
};
