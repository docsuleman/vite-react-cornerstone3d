/**
 * VolumeRenderingPresetLoader
 * Parses 3D Slicer .vp (Volume Property) preset files for DRR rendering
 *
 * .vp File Format:
 * - Line 7: Opacity transfer function
 *   Format: [count] [HU1] [opacity1] [HU2] [opacity2] ...
 *   Example: "10 -1024 0 -1024 0 112.576 0 1500 0.03 3071 0.1"
 *
 * - Line 8 (optional): Color transfer function
 *   Format: [count] [HU1] [R1] [G1] [B1] [HU2] [R2] [G2] [B2] ...
 */

import {
  VolumeRenderingPreset,
  TransferFunctionPoint,
  ColorTransferFunctionPoint,
  VolumeBlendMode,
  RGBColor,
} from '../types/VolumeRenderingTypes';

export class VolumeRenderingPresetLoader {
  /**
   * Load and parse a .vp preset file
   *
   * @param presetPath - Path to .vp file (relative to public/assets)
   * @param presetName - Name for this preset
   * @returns Parsed VolumeRenderingPreset
   */
  static async loadPreset(
    presetPath: string,
    presetName: string
  ): Promise<VolumeRenderingPreset> {
    try {
      // Fetch the .vp file
      const response = await fetch(presetPath);
      if (!response.ok) {
        throw new Error(`Failed to load preset: ${response.statusText}`);
      }

      const text = await response.text();
      const lines = text.split('\n');

      // Parse opacity transfer function (line 7, index 6)
      const opacityPoints = this.parseOpacityTransferFunction(lines[6]);

      // Parse color transfer function if present (line 8, index 7)
      let colorPoints: ColorTransferFunctionPoint[] | undefined;
      if (lines.length > 7 && lines[7].trim()) {
        colorPoints = this.parseColorTransferFunction(lines[7]);
      }

      // For fluoroscopy/DRR, we typically want radon transform (simulates X-ray absorption)
      // But we can also use MIP for enhanced visibility
      const blendMode = VolumeBlendMode.RADON_TRANSFORM;

      return {
        name: presetName,
        opacityPoints,
        colorPoints,
        blendMode,
        renderingConfig: {
          shade: false, // No shading for X-ray simulation
          sampleDistance: 0.5, // Fine sampling for quality
        },
      };
    } catch (error) {
      console.error('Error loading volume rendering preset:', error);
      throw error;
    }
  }

  /**
   * Parse opacity transfer function from .vp file line
   * Format: [count] [HU1] [opacity1] [HU2] [opacity2] ...
   *
   * @param line - Line 7 from .vp file
   * @returns Array of opacity control points
   */
  private static parseOpacityTransferFunction(line: string): TransferFunctionPoint[] {
    const values = line.trim().split(/\s+/).map(parseFloat);

    if (values.length < 1) {
      throw new Error('Invalid opacity transfer function: no values');
    }

    const count = values[0];
    const points: TransferFunctionPoint[] = [];

    // Parse pairs of [HU, opacity]
    for (let i = 1; i < values.length - 1; i += 2) {
      const huValue = values[i];
      const opacity = values[i + 1];

      points.push({
        value: huValue,
        output: opacity,
      });
    }

    if (points.length !== count) {
      console.warn(
        `Opacity transfer function count mismatch: expected ${count}, got ${points.length}`
      );
    }

    return points;
  }

  /**
   * Parse color transfer function from .vp file line
   * Format: [count] [HU1] [R1] [G1] [B1] [HU2] [R2] [G2] [B2] ...
   *
   * @param line - Line 8 from .vp file
   * @returns Array of color control points
   */
  private static parseColorTransferFunction(line: string): ColorTransferFunctionPoint[] {
    const values = line.trim().split(/\s+/).map(parseFloat);

    if (values.length < 1) {
      return [];
    }

    const count = values[0];
    const points: ColorTransferFunctionPoint[] = [];

    // Parse sets of [HU, R, G, B]
    for (let i = 1; i < values.length - 3; i += 4) {
      const huValue = values[i];
      const r = values[i + 1];
      const g = values[i + 2];
      const b = values[i + 3];

      points.push({
        value: huValue,
        color: { r, g, b },
      });
    }

    if (points.length !== count) {
      console.warn(
        `Color transfer function count mismatch: expected ${count}, got ${points.length}`
      );
    }

    return points;
  }

  /**
   * Create a grayscale fluoroscopy preset programmatically
   * This is useful for X-ray simulation without loading a .vp file
   *
   * @returns Basic fluoroscopy preset
   */
  static createBasicFluoroPreset(): VolumeRenderingPreset {
    return {
      name: 'Basic Fluoroscopy',
      opacityPoints: [
        { value: -1024, output: 0 }, // Air: transparent
        { value: -1024, output: 0 },
        { value: 150, output: 0 }, // Soft tissue: mostly transparent
        { value: 200, output: 0.02 }, // Dense tissue: slight opacity
        { value: 500, output: 0.05 }, // Bone start: visible
        { value: 1500, output: 0.15 }, // Dense bone: more visible
        { value: 3071, output: 0.2 }, // Maximum: cap opacity
      ],
      colorPoints: [
        { value: -1024, color: { r: 0, g: 0, b: 0 } }, // Air: black
        { value: 150, color: { r: 0.2, g: 0.2, b: 0.2 } }, // Soft tissue: dark gray
        { value: 500, color: { r: 0.6, g: 0.6, b: 0.6 } }, // Bone: light gray
        { value: 3071, color: { r: 1, g: 1, b: 1 } }, // Maximum: white
      ],
      blendMode: VolumeBlendMode.RADON_TRANSFORM,
      renderingConfig: {
        shade: false,
        sampleDistance: 1.0, // Increased for better performance
      },
    };
  }

  /**
   * Create an enhanced fluoroscopy preset for better bone visibility
   *
   * @returns Enhanced fluoroscopy preset
   */
  static createEnhancedFluoroPreset(): VolumeRenderingPreset {
    return {
      name: 'Enhanced Fluoroscopy',
      opacityPoints: [
        { value: -1024, output: 0 }, // Air: transparent
        { value: -1024, output: 0 },
        { value: 112.576, output: 0 }, // Soft tissue threshold
        { value: 150, output: 0.01 }, // Soft tissue: minimal opacity
        { value: 200, output: 0.03 }, // Dense tissue
        { value: 400, output: 0.08 }, // Bone start
        { value: 1000, output: 0.15 }, // Dense bone
        { value: 1500, output: 0.25 }, // Very dense bone
        { value: 3071, output: 0.3 }, // Maximum
      ],
      colorPoints: [
        { value: -1024, color: { r: 0, g: 0, b: 0 } },
        { value: 150, color: { r: 0.15, g: 0.15, b: 0.15 } },
        { value: 400, color: { r: 0.5, g: 0.5, b: 0.5 } },
        { value: 1000, color: { r: 0.8, g: 0.8, b: 0.8 } },
        { value: 3071, color: { r: 1, g: 1, b: 1 } },
      ],
      blendMode: VolumeBlendMode.RADON_TRANSFORM,
      renderingConfig: {
        shade: false,
        sampleDistance: 1.0, // Good balance of quality and performance for DRR
      },
    };
  }

  /**
   * Load all available fluoroscopy presets from the assets folder
   *
   * @returns Array of available presets
   */
  static async loadAllFluoroPresets(): Promise<VolumeRenderingPreset[]> {
    const presets: VolumeRenderingPreset[] = [];

    // Add programmatic presets
    presets.push(this.createBasicFluoroPreset());
    presets.push(this.createEnhancedFluoroPreset());

    // Load .vp files from assets
    const presetFiles = [
      {
        path: '/assets/oldTools/SlicerHeart/Resources/VolumeRendering/FluoroRenderingPreset_01.vp',
        name: 'Slicer Fluoro 01',
      },
      {
        path: '/assets/oldTools/SlicerHeart/Resources/VolumeRendering/FluoroRenderingPreset_02.vp',
        name: 'Slicer Fluoro 02',
      },
      {
        path: '/assets/oldTools/SlicerHeart/Resources/VolumeRendering/FluoroRenderingPreset_03.vp',
        name: 'Slicer Fluoro 03',
      },
    ];

    // Load each preset file
    for (const { path, name } of presetFiles) {
      try {
        const preset = await this.loadPreset(path, name);
        presets.push(preset);
      } catch (error) {
        console.warn(`Failed to load preset ${name}:`, error);
        // Continue loading other presets even if one fails
      }
    }

    return presets;
  }
}
