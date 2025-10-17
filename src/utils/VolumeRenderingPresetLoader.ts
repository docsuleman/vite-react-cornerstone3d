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
    }

    return points;
  }

  /**
   * Create FluoroRenderingPreset_01 (based on 3D Slicer)
   * Optimized for contrast-enhanced CT - highlights contrast media in vessels
   */
  static createBasicFluoroPreset(): VolumeRenderingPreset {
    return {
      name: 'Slicer Fluoro 01 (Basic)',
      opacityPoints: [
        { value: -1024, output: 0 }, // Air: transparent
        { value: -1024, output: 0 },
        { value: 112.576698303223, output: 0 }, // Soft tissue threshold: transparent
        { value: 1500, output: 0.3 }, // Contrast/bone: visible (boosted from 0.03)
        { value: 3071, output: 1.0 }, // Maximum: fully visible (boosted from 0.1)
      ],
      colorPoints: [
        { value: -1024, color: { r: 1, g: 1, b: 1 } }, // Air: white (invisible)
        { value: 100, color: { r: 1, g: 1, b: 1 } }, // Soft tissue: white (invisible)
        { value: 150, color: { r: 0.7, g: 0.7, b: 0.7 } }, // Dense tissue: light gray
        { value: 300, color: { r: 0.3, g: 0.3, b: 0.3 } }, // Contrast start: dark gray
        { value: 500, color: { r: 0.1, g: 0.1, b: 0.1 } }, // Contrast/bone: very dark
        { value: 3071, color: { r: 0, g: 0, b: 0 } }, // Maximum: black
      ],
      blendMode: VolumeBlendMode.COMPOSITE, // Composite like 3D Slicer, not MIP
      renderingConfig: {
        shade: false,
        sampleDistance: 1.0,
      },
    };
  }

  /**
   * Create FluoroRenderingPreset_03 (based on 3D Slicer)
   * Enhanced for contrast-enhanced cardiac CT - more gradual opacity ramp
   */
  static createEnhancedFluoroPreset(): VolumeRenderingPreset {
    return {
      name: 'Slicer Fluoro 03 (Enhanced)',
      opacityPoints: [
        { value: -1024, output: 0 }, // Air: fully transparent (no attenuation)
        { value: 0, output: 0 }, // Water: transparent
        { value: 50, output: 0.1 }, // Soft tissue: minimal attenuation
        { value: 150, output: 0.3 }, // Dense tissue: some attenuation
        { value: 300, output: 0.6 }, // Contrast/calcification: high attenuation
        { value: 500, output: 0.8 }, // High contrast: very high attenuation
        { value: 1000, output: 0.95 }, // Bone/dense contrast: near complete attenuation
        { value: 3071, output: 1.0 }, // Maximum: complete attenuation
      ],
      colorPoints: [
        { value: -1024, color: { r: 0, g: 0, b: 0 } }, // Air: black (full transmission)
        { value: 0, color: { r: 0, g: 0, b: 0 } }, // Water: black
        { value: 100, color: { r: 0.1, g: 0.1, b: 0.1 } }, // Soft tissue: very dark gray
        { value: 200, color: { r: 0.3, g: 0.3, b: 0.3 } }, // Dense tissue: dark gray
        { value: 400, color: { r: 0.6, g: 0.6, b: 0.6 } }, // Contrast: medium gray
        { value: 800, color: { r: 0.9, g: 0.9, b: 0.9 } }, // High contrast: light gray
        { value: 3071, color: { r: 1, g: 1, b: 1 } }, // Maximum: white (full attenuation)
      ],
      blendMode: VolumeBlendMode.AVERAGE, // Use average for X-ray simulation
      renderingConfig: {
        shade: false,
        sampleDistance: 1.0,
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
        // Continue loading other presets even if one fails
      }
    }

    return presets;
  }
}
