import { useEffect, useState } from 'react';
import { initWasm, isWasmReady } from '../wasm/bridge';

/**
 * Ensures the WASM runtime is initialized and returns true once ready.
 */
export function useWasmReady(): boolean {
  const [ready, setReady] = useState(() => isWasmReady());

  useEffect(() => {
    if (ready) return;
    let active = true;
    void initWasm()
      .then((ok) => {
        if (active && ok) setReady(true);
      })
      .catch(() => {
        // Keep ready false if WASM runtime fails to initialize
      });
    return () => {
      active = false;
    };
  }, [ready]);

  return ready;
}
