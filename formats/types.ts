export interface PreparedFeature {
  packedXY: Float32Array;
  ringLengths: Int32Array;
  ringCount: number;
  isPolygon: boolean;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface PreparedLayer {
  name: string;
  features: PreparedFeature[];
}
