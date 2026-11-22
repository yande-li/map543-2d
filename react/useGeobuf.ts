import { useEffect, useState } from 'react';
import { MapError, toMapError } from '../core/errors';
import {
  loadGeobuf,
  type LoadGeobufOptions,
  type ParsedGeobuf,
} from '../formats/geobuf';

export interface UseGeobufResult {
  data: ParsedGeobuf | null;
  loading: boolean;
  error: MapError | null;
}

/**
 * Fetches and parses a Geobuf file declaratively with automatic AbortController cleanup.
 */
export function useGeobuf(
  src: string | null | undefined,
  options?: Omit<LoadGeobufOptions, 'signal'>
): UseGeobufResult {
  const [state, setState] = useState<UseGeobufResult>({
    data: null,
    loading: Boolean(src),
    error: null,
  });

  const defaultLayerName = options?.defaultLayerName;
  const maxBytes = options?.maxBytes;
  const allowedLayers = options?.allowedLayers;
  const antimeridianLayers = options?.antimeridianLayers;

  useEffect(() => {
    if (!src) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));

    void loadGeobuf(src, {
      signal: controller.signal,
      ...(defaultLayerName !== undefined ? { defaultLayerName } : {}),
      ...(maxBytes !== undefined ? { maxBytes } : {}),
      ...(allowedLayers !== undefined ? { allowedLayers } : {}),
      ...(antimeridianLayers !== undefined ? { antimeridianLayers } : {}),
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, loading: false, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            data: null,
            loading: false,
            error: toMapError(err, 'GEOBUF_DECODE_ERROR'),
          });
        }
      });

    return () => {
      controller.abort();
    };
  }, [src, defaultLayerName, maxBytes, allowedLayers, antimeridianLayers]);

  return state;
}
