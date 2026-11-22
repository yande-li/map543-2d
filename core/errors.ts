export type MapErrorCode =
  | 'GEOBUF_DECODE_ERROR'
  | 'IMAGE_DECODE_ERROR'
  | 'WASM_MEMORY_ERROR'
  | 'SHADER_COMPILE_ERROR'
  | 'INVALID_STYLE_ERROR'
  | 'RESOURCE_LIMIT_EXCEEDED';

/**
 * Typed error normalized at library boundaries without exposing raw WASM offsets or trap traces.
 */
export class MapError extends Error {
  readonly code: MapErrorCode;

  constructor(code: MapErrorCode, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = 'MapError';
    this.code = code;
  }
}

/**
 * Normalizes an unknown thrown value into a typed MapError.
 */
export function toMapError(
  err: unknown,
  fallbackCode: MapErrorCode,
  fallbackMessage = 'Operation failed'
): MapError {
  if (err instanceof MapError) return err;
  if (err instanceof Error) {
    return new MapError(fallbackCode, err.message, { cause: err });
  }
  return new MapError(fallbackCode, fallbackMessage);
}
