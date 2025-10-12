/**
 * 3D Volume Rendering - Example Implementation
 *
 * Source: Cornerstone.js official example
 * https://www.cornerstonejs.org/live-examples/volumeviewport3d
 *
 * This example demonstrates how to create and configure 3D volume rendering
 * viewports for medical imaging visualization.
 *
 * Key Features:
 * - VOLUME_3D viewport type for volumetric rendering
 * - Preset configurations (CT-Bone, CT-Chest, MIP, etc.)
 * - Sample distance control for quality/performance balance
 * - Rotation and camera manipulation
 * - Background color customization
 *
 * Use Cases:
 * - 3D anatomical visualization
 * - Bone structure analysis
 * - Vascular imaging (with MIP preset)
 * - Surgical planning
 * - 4th viewport in ROOT_DEFINITION stage (our TAVI workflow)
 */

import type { Types } from '@cornerstonejs/core';
import {
  CONSTANTS,
  Enums,
  getRenderingEngine,
  RenderingEngine,
  setVolumesForViewports,
  volumeLoader,
} from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';

const { ToolGroupManager } = cornerstoneTools;
const { ViewportType } = Enums;

/**
 * 3D Volume Viewport Configuration
 */
export interface Volume3DConfig {
  viewportId: string;
  element: HTMLDivElement;
  volumeId: string;
  renderingEngineId: string;
  preset?: string; // Default: 'CT-Bone'
  orientation?: Enums.OrientationAxis;
  background?: Types.Point3;
  sampleDistanceMultiplier?: number; // 1-16, lower = better quality
}

/**
 * Available presets for 3D volume rendering
 *
 * Common presets from CONSTANTS.VIEWPORT_PRESETS:
 * - CT-Bone: Optimized for bone visualization
 * - CT-Chest: Optimized for chest CT
 * - CT-Abdomen: Optimized for abdominal CT
 * - CT-Cardiac: Optimized for cardiac CT
 * - MR-Default: Default MR preset
 * - PET: PET scan visualization
 * - MIP: Maximum Intensity Projection
 */
export const Volume3DPresets = {
  CT_BONE: 'CT-Bone',
  CT_CHEST: 'CT-Chest',
  CT_ABDOMEN: 'CT-Abdomen',
  CT_CARDIAC: 'CT-Cardiac',
  CT_LUNGS: 'CT-Lungs',
  MR_DEFAULT: 'MR-Default',
  PET: 'PET',
  MIP: 'MIP',
} as const;

/**
 * Sample Distance Multiplier Guidelines
 *
 * Controls rendering quality vs performance:
 * - 1: Highest quality, slowest (recommended for static views)
 * - 2-4: Good quality, moderate speed (recommended for interactive)
 * - 5-8: Lower quality, faster (recommended for real-time manipulation)
 * - 9-16: Lowest quality, fastest (for preview/draft mode)
 */
export const SampleDistanceMultipliers = {
  HIGHEST_QUALITY: 1,
  HIGH_QUALITY: 2,
  BALANCED: 4,
  PERFORMANCE: 8,
  DRAFT: 16,
} as const;

/**
 * Creates and configures a 3D volume viewport
 *
 * @param config - Configuration for the 3D viewport
 * @returns Configured viewport instance
 *
 * @example
 * const viewport = await setup3DVolumeViewport({
 *   viewportId: 'volume3D',
 *   element: document.getElementById('viewport3D'),
 *   volumeId: 'volumeId',
 *   renderingEngineId: 'myEngine',
 *   preset: 'CT-Bone',
 *   sampleDistanceMultiplier: 2
 * });
 */
export async function setup3DVolumeViewport(
  config: Volume3DConfig
): Promise<Types.IVolumeViewport> {
  const {
    viewportId,
    element,
    volumeId,
    renderingEngineId,
    preset = Volume3DPresets.CT_BONE,
    orientation = Enums.OrientationAxis.CORONAL,
    background = CONSTANTS.BACKGROUND_COLORS.slicer3D,
    sampleDistanceMultiplier = SampleDistanceMultipliers.HIGH_QUALITY,
  } = config;

  // Get rendering engine
  const renderingEngine = getRenderingEngine(renderingEngineId);
  if (!renderingEngine) {
    throw new Error(`Rendering engine not found: ${renderingEngineId}`);
  }

  // Create viewport configuration
  const viewportInput = {
    viewportId,
    type: ViewportType.VOLUME_3D,
    element,
    defaultOptions: {
      orientation,
      background,
    },
  };

  // Enable the viewport
  renderingEngine.setViewports([viewportInput]);

  // Get the viewport
  const viewport = renderingEngine.getViewport(
    viewportId
  ) as Types.IVolumeViewport;

  // Set volume
  await setVolumesForViewports(renderingEngine, [{ volumeId }], [viewportId]);

  // Apply preset and sample distance
  viewport.setProperties({
    preset,
    sampleDistanceMultiplier,
  });

  // Render
  viewport.render();

  console.log('✅ 3D volume viewport setup complete:', viewportId);

  return viewport;
}

/**
 * Changes the rendering preset of a 3D viewport
 *
 * @param viewport - 3D volume viewport
 * @param presetName - Name of the preset to apply
 *
 * @example
 * changeVolume3DPreset(viewport, 'CT-Chest');
 */
export function changeVolume3DPreset(
  viewport: Types.IVolumeViewport,
  presetName: string
) {
  viewport.setProperties({ preset: presetName });
  viewport.render();
  console.log('🎨 Preset changed to:', presetName);
}

/**
 * Adjusts sample distance multiplier for quality/performance balance
 *
 * @param viewport - 3D volume viewport
 * @param multiplier - Sample distance multiplier (1-16)
 *
 * @example
 * // High quality for static viewing
 * setSampleDistance(viewport, 1);
 *
 * // Balanced for interaction
 * setSampleDistance(viewport, 4);
 */
export function setSampleDistance(
  viewport: Types.IVolumeViewport,
  multiplier: number
) {
  if (multiplier < 1 || multiplier > 16) {
    console.warn('Sample distance multiplier should be between 1-16');
    multiplier = Math.max(1, Math.min(16, multiplier));
  }

  viewport.setProperties({ sampleDistanceMultiplier: multiplier });
  viewport.render();
  console.log('📏 Sample distance multiplier set to:', multiplier);
}

/**
 * Applies random rotation to 3D viewport (useful for testing)
 *
 * @param viewport - 3D volume viewport
 *
 * @example
 * applyRandomRotation(viewport);
 */
export function applyRandomRotation(viewport: Types.IVolumeViewport) {
  const randomAngle = Math.random() * 360;
  viewport.setViewPresentation({ rotation: randomAngle });
  viewport.render();
  console.log('🔄 Applied rotation:', randomAngle.toFixed(2), 'degrees');
}

/**
 * Sets specific rotation angle for 3D viewport
 *
 * @param viewport - 3D volume viewport
 * @param angle - Rotation angle in degrees
 *
 * @example
 * setRotation(viewport, 45);
 */
export function setRotation(viewport: Types.IVolumeViewport, angle: number) {
  viewport.setViewPresentation({ rotation: angle });
  viewport.render();
  console.log('🔄 Rotation set to:', angle, 'degrees');
}

/**
 * Resets camera to default position
 *
 * @param viewport - 3D volume viewport
 *
 * @example
 * resetCamera(viewport);
 */
export function resetCamera(viewport: Types.IVolumeViewport) {
  viewport.resetCamera();
  viewport.render();
  console.log('📷 Camera reset to default position');
}

/**
 * Complete example setup for 3D volume rendering
 *
 * This is the full implementation from the Cornerstone.js example
 */
export async function example3DVolumeSetup(
  renderingEngineId: string,
  element: HTMLDivElement,
  volumeId: string,
  imageIds: string[]
): Promise<Types.IVolumeViewport> {
  const viewportId = '3D_VIEWPORT';
  const toolGroupId = '3D_TOOL_GROUP';

  // Create tool group for 3D manipulation
  const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);

  // Add 3D manipulation bindings (rotation, zoom, pan)
  // This is a helper from Cornerstone that adds common 3D tools
  // Typically includes: TrackballRotateTool, Zoom, Pan
  // Note: You'll need to implement addManipulationBindings or add tools manually

  // Create rendering engine
  const renderingEngine = new RenderingEngine(renderingEngineId);

  // Setup viewport
  const viewportInputArray = [
    {
      viewportId,
      type: ViewportType.VOLUME_3D,
      element,
      defaultOptions: {
        orientation: Enums.OrientationAxis.CORONAL,
        background: CONSTANTS.BACKGROUND_COLORS.slicer3D,
      },
    },
  ];

  renderingEngine.setViewports(viewportInputArray);

  // Add viewport to tool group
  toolGroup.addViewport(viewportId, renderingEngineId);

  // Create and load volume
  const volume = await volumeLoader.createAndCacheVolume(volumeId, {
    imageIds,
  });
  await volume.load();

  // Get viewport
  const viewport = renderingEngine.getViewport(
    viewportId
  ) as Types.IVolumeViewport;

  // Set volume and apply preset
  await setVolumesForViewports(renderingEngine, [{ volumeId }], [viewportId]);

  viewport.setProperties({
    preset: Volume3DPresets.CT_BONE,
    sampleDistanceMultiplier: SampleDistanceMultipliers.HIGH_QUALITY,
  });

  viewport.render();

  return viewport;
}

/**
 * React Hook for 3D Volume Viewport
 *
 * @example
 * const My3DViewer = () => {
 *   const viewportRef = useRef<HTMLDivElement>(null);
 *   const [preset, setPreset] = useState('CT-Bone');
 *   const [quality, setQuality] = useState(2);
 *   const viewportInstanceRef = useRef<Types.IVolumeViewport>(null);
 *
 *   useEffect(() => {
 *     if (!viewportRef.current) return;
 *
 *     const init = async () => {
 *       const viewport = await setup3DVolumeViewport({
 *         viewportId: 'volume3D',
 *         element: viewportRef.current,
 *         volumeId: 'myVolume',
 *         renderingEngineId: 'myEngine',
 *         preset: 'CT-Bone',
 *         sampleDistanceMultiplier: 2
 *       });
 *       viewportInstanceRef.current = viewport;
 *     };
 *
 *     init();
 *   }, []);
 *
 *   const handlePresetChange = (newPreset: string) => {
 *     setPreset(newPreset);
 *     if (viewportInstanceRef.current) {
 *       changeVolume3DPreset(viewportInstanceRef.current, newPreset);
 *     }
 *   };
 *
 *   const handleQualityChange = (newQuality: number) => {
 *     setQuality(newQuality);
 *     if (viewportInstanceRef.current) {
 *       setSampleDistance(viewportInstanceRef.current, newQuality);
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <div>
 *         <select onChange={(e) => handlePresetChange(e.target.value)}>
 *           <option value="CT-Bone">CT-Bone</option>
 *           <option value="CT-Chest">CT-Chest</option>
 *           <option value="MIP">MIP</option>
 *         </select>
 *         <input
 *           type="range"
 *           min="1"
 *           max="16"
 *           value={quality}
 *           onChange={(e) => handleQualityChange(Number(e.target.value))}
 *         />
 *       </div>
 *       <div ref={viewportRef} style={{ width: '500px', height: '500px' }} />
 *     </div>
 *   );
 * };
 */

/**
 * Integration with ProperMPRViewport
 *
 * For ROOT_DEFINITION stage, add 3D viewport alongside MPR views:
 *
 * @example
 * // In ProperMPRViewport.tsx, for ROOT_DEFINITION stage:
 *
 * useEffect(() => {
 *   if (currentStage === WorkflowStage.ROOT_DEFINITION && elementRefs.volume3D.current) {
 *     setup3DVolumeViewport({
 *       viewportId: 'volume3D',
 *       element: elementRefs.volume3D.current,
 *       volumeId: volumeId,
 *       renderingEngineId: 'mprEngine',
 *       preset: 'CT-Cardiac',
 *       sampleDistanceMultiplier: 4 // Balanced quality
 *     });
 *   }
 * }, [currentStage]);
 */

/**
 * Export constants for reference
 */
export const VOLUME_3D_CONSTANTS = {
  VIEWPORT_TYPE: ViewportType.VOLUME_3D,
  DEFAULT_PRESET: Volume3DPresets.CT_BONE,
  DEFAULT_QUALITY: SampleDistanceMultipliers.HIGH_QUALITY,
  BACKGROUND_COLORS: CONSTANTS.BACKGROUND_COLORS,
  PRESETS: Volume3DPresets,
  QUALITY_LEVELS: SampleDistanceMultipliers,
};

/**
 * Important Notes:
 *
 * 1. Performance Considerations:
 *    - 3D rendering is GPU-intensive
 *    - Lower sample distance = higher quality but slower
 *    - Consider using draft mode during interaction, then high quality when static
 *
 * 2. Preset Selection:
 *    - CT-Bone: Best for skeletal structures
 *    - CT-Cardiac: Best for TAVI and cardiac imaging
 *    - MIP: Best for vascular structures
 *    - Choose based on anatomical region of interest
 *
 * 3. Viewport Type:
 *    - Must use ViewportType.VOLUME_3D (not ORTHOGRAPHIC)
 *    - Requires volume (not stack) data
 *    - Different tools than 2D viewports (trackball rotation, etc.)
 *
 * 4. Memory Usage:
 *    - 3D viewports use more GPU memory
 *    - Consider disposing when not needed
 *    - Monitor performance on lower-end systems
 */
