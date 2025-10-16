/**
 * Volume Rendering Types for DRR (Digitally Reconstructed Radiograph)
 * Based on 3D Slicer .vp preset file format
 */

/**
 * Transfer function control point
 * Maps a scalar value (e.g., Hounsfield Unit) to an output value
 */
export interface TransferFunctionPoint {
  /** Scalar value (e.g., Hounsfield Unit for CT) */
  value: number;
  /** Output value (opacity or color component) */
  output: number;
}

/**
 * RGB color with optional alpha
 */
export interface RGBColor {
  r: number; // 0-1 range
  g: number; // 0-1 range
  b: number; // 0-1 range
  a?: number; // Optional alpha 0-1 range
}

/**
 * Color transfer function control point
 * Maps a scalar value to RGB color
 */
export interface ColorTransferFunctionPoint {
  /** Scalar value (e.g., Hounsfield Unit) */
  value: number;
  /** RGB color at this scalar value */
  color: RGBColor;
}

/**
 * Opacity transfer function
 * Defines opacity mapping from scalar values
 */
export interface OpacityTransferFunction {
  /** Control points for opacity mapping */
  points: TransferFunctionPoint[];
}

/**
 * Color transfer function
 * Defines color mapping from scalar values
 */
export interface ColorTransferFunction {
  /** Control points for color mapping */
  points: ColorTransferFunctionPoint[];
}

/**
 * Volume rendering blend modes
 */
export enum VolumeBlendMode {
  /** Composite rendering (front-to-back blending) */
  COMPOSITE = 'composite',
  /** Maximum Intensity Projection */
  MIP = 'mip',
  /** Minimum Intensity Projection */
  MIN_IP = 'minip',
  /** Average Intensity Projection */
  AVERAGE = 'average',
  /** Radon Transform (simulates X-ray absorption) */
  RADON_TRANSFORM = 'radon',
}

/**
 * Volume rendering configuration
 */
export interface VolumeRenderingConfig {
  /** Opacity transfer function */
  opacityTransferFunction: OpacityTransferFunction;
  /** Color transfer function */
  colorTransferFunction: ColorTransferFunction;
  /** Blend mode for volume rendering */
  blendMode: VolumeBlendMode;
  /** Sample distance for ray casting (smaller = higher quality, slower) */
  sampleDistance?: number;
  /** Whether to use shading */
  shade?: boolean;
  /** Ambient lighting coefficient (0-1) */
  ambient?: number;
  /** Diffuse lighting coefficient (0-1) */
  diffuse?: number;
  /** Specular lighting coefficient (0-1) */
  specular?: number;
  /** Specular power (higher = sharper highlights) */
  specularPower?: number;
}

/**
 * Parsed .vp preset file from 3D Slicer
 */
export interface VolumeRenderingPreset {
  /** Preset name/identifier */
  name: string;
  /** Opacity transfer function control points */
  opacityPoints: TransferFunctionPoint[];
  /** Color transfer function control points (optional) */
  colorPoints?: ColorTransferFunctionPoint[];
  /** Recommended blend mode for this preset */
  blendMode: VolumeBlendMode;
  /** Additional rendering parameters */
  renderingConfig?: Partial<VolumeRenderingConfig>;
}

/**
 * DRR-specific rendering parameters
 */
export interface DRRRenderingParams {
  /** Fluoroscopy angle: LAO/RAO (-90 to +90) */
  laoRao: number;
  /** Fluoroscopy angle: CRAN/CAUD (-90 to +90) */
  cranCaud: number;
  /** Distance from focal point to detector (mm) */
  sourceToDetectorDistance: number;
  /** Camera focal point (world coordinates) */
  focalPoint: [number, number, number];
  /** Volume rendering preset to use */
  preset: VolumeRenderingPreset;
  /** Window width for display (optional) */
  windowWidth?: number;
  /** Window level for display (optional) */
  windowLevel?: number;
}

/**
 * DRR viewport configuration
 */
export interface DRRViewportConfig {
  /** Viewport HTML element ID */
  viewportId: string;
  /** Volume ID to render */
  volumeId: string;
  /** DRR rendering parameters */
  renderingParams: DRRRenderingParams;
  /** Viewport width in pixels */
  width: number;
  /** Viewport height in pixels */
  height: number;
}
