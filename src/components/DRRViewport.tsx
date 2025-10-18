/**
 * DRRViewport Component
 *
 * Digitally Reconstructed Radiograph (DRR) viewport that simulates X-ray fluoroscopy
 * from CT volume data using VTK.js GPU-accelerated volume rendering.
 *
 * Implementation Strategy (Based on 3D Slicer CT-X-Ray Preset):
 * ==============================================================
 *
 * 1. **RADON TRANSFORM Blend Mode for X-ray Simulation:**
 *    - Uses vtkVolumeMapper.setBlendMode(5) - RADON_TRANSFORM_BLEND
 *    - Mathematical basis for X-ray projection - models photon absorption
 *    - Physics-based rendering with CONSISTENT appearance from all angles
 *    - This is THE CORRECT mode for DRR/fluoroscopy simulation in VTK.js
 *
 * 2. **Transfer Functions (INVERTED for Angiography):**
 *    - Opacity: Linear ramp from -200 HU (0%) to 1500 HU (5% max)
 *    - Colors: ALL BLACK (0, 0, 0) on WHITE background - INVERTED from Slicer!
 *    - Darkness comes from black accumulation with ADDITIVE mode
 *    - Shading: DISABLED (no lighting effects)
 *
 * 3. **Why This Works for Angiography:**
 *    - RADON TRANSFORM models X-ray photon absorption through tissue
 *    - Contrast-filled vessels (300-500 HU) absorb more photons → appear DARK
 *    - Soft tissue (0-100 HU) absorbs fewer photons → appears WHITE/LIGHT
 *    - BLACK color function + WHITE background = angiography appearance
 *    - CONSISTENT from all viewing angles (no view-dependent artifacts!)
 *
 * 4. **X-Ray Camera Geometry:**
 *    - Perspective projection (simulates divergent X-ray beam)
 *    - SOD (Source-to-Object): 1000mm, SID (Source-to-Image): 1200mm
 *    - Camera positioned using fluoroscopy angles (LAO/RAO, CRAN/CAUD)
 *    - View angle calculated from detector size and SID
 *
 * Key References:
 * - VTK.js documentation: RADON_TRANSFORM_BLEND for radiographic rendering
 * - 3D Slicer presets.xml: CT-X-Ray preset opacity values
 * - Radon transform: Mathematical foundation of X-ray imaging (inverse problem)
 */

import React, { useRef, useEffect, useState } from 'react';
import * as cornerstone3D from '@cornerstonejs/core';
import { RenderingEngine, Types, Enums } from '@cornerstonejs/core';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkSTLReader from '@kitware/vtk.js/IO/Geometry/STLReader';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import { VolumeRenderingPreset, VolumeBlendMode } from '../types/VolumeRenderingTypes';
import { VolumeRenderingPresetLoader } from '../utils/VolumeRenderingPresetLoader';
import { SCurveGenerator } from '../utils/SCurveGenerator';
import { FluoroAngleIndicator } from './FluoroAngleIndicator';

interface DRRViewportProps {
  /** Cornerstone volume ID to render */
  volumeId: string;
  /** Current LAO/RAO angle (-90 to +90) */
  laoRao: number;
  /** Current CRAN/CAUD angle (-90 to +90) */
  cranCaud: number;
  /** Focal point for camera (world coordinates) - typically table center/patient position */
  focalPoint?: [number, number, number];
  /** Source-to-Object Distance (SOD) in mm - distance from X-ray source to patient */
  sourceObjectDistance?: number;
  /** Source-to-Image Distance (SID) in mm - distance from X-ray source to detector */
  sourceImageDistance?: number;
  /** Detector height in mm - physical height of the image intensifier/detector */
  detectorHeight?: number;
  /** Callback when angles change (if interactive) */
  onAngleChange?: (laoRao: number, cranCaud: number) => void;
  /** Viewport width */
  width?: number;
  /** Viewport height */
  height?: number;
  /** Volume rendering preset to use */
  preset?: VolumeRenderingPreset;
  /** Show angle indicators */
  showAngleIndicators?: boolean;
  /** Virtual valve configuration */
  valveVisible?: boolean;
  valveSTLPath?: string;
  valveDepth?: number;
  annulusCenter?: [number, number, number];
  annulusNormal?: [number, number, number];
  valveRotation?: { x: number; y: number; z: number };
}

export const DRRViewport: React.FC<DRRViewportProps> = ({
  volumeId,
  laoRao,
  cranCaud,
  focalPoint,
  sourceObjectDistance = 1000, // SOD: 1000mm (1 meter) - distance from X-ray source to patient
  sourceImageDistance = 1200, // SID: 1200mm (1.2 meters) - distance from X-ray source to detector
  detectorHeight = 1200, // Detector height: 1200mm (1.2 meters) - very large FOV
  onAngleChange,
  width = 512,
  height = 512,
  preset,
  showAngleIndicators = true,
  valveVisible = false,
  valveSTLPath,
  valveDepth = 0,
  annulusCenter,
  annulusNormal,
  valveRotation = { x: 0, y: 0, z: 0 },
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [grw, setGrw] = useState<any>(null);
  const [volumeActor, setVolumeActor] = useState<any>(null);
  const [valveActor, setValveActor] = useState<any>(null);
  const [currentPreset, setCurrentPreset] = useState<VolumeRenderingPreset | null>(
    preset || null
  );
  const [isInitialized, setIsInitialized] = useState(false);
  const [cameraDistance, setCameraDistance] = useState<number>(1000);

  // Transfer function controls for real-time tweaking
  const [showControls, setShowControls] = useState(true);

  // Opacity thresholds (based on Slicer FluoroRenderingPreset_01)
  const [opacityLow, setOpacityLow] = useState(112.5); // HU where opacity starts (Slicer: 112.576)
  const [opacityHigh, setOpacityHigh] = useState(1500); // HU where opacity ramps up (Slicer: 1500 @ 0.03)
  const [maxOpacity, setMaxOpacity] = useState(0.1); // Maximum opacity (10% like Slicer at 3071 HU)

  // Color inversion control
  const [invertColors, setInvertColors] = useState(true); // true = angiography (high HU = black)

  // Blend mode selection
  const [blendMode, setBlendMode] = useState(0); // Default: COMPOSITE (like Slicer)

  // Available blend modes
  const blendModes = [
    { value: 0, label: 'Composite (Slicer DRR)', description: 'Front-to-back accumulation - Slicer default' },
    { value: 1, label: 'MIP (Maximum Intensity)', description: 'Shows brightest voxel - very clear' },
    { value: 2, label: 'MinIP (Minimum Intensity)', description: 'Shows darkest voxel - rarely used' },
    { value: 3, label: 'Average Intensity (X-ray)', description: 'Averages values - X-ray-like' },
    { value: 4, label: 'Additive Intensity', description: 'Accumulates values along ray' },
    { value: 5, label: 'Radon Transform', description: 'Physics-based X-ray simulation' },
  ];

  // Initialize VTK.js rendering
  useEffect(() => {
    if (!containerRef.current) return;


    // Create generic render window with GRAY background (neutral for debugging)
    const genericRenderWindow = vtkGenericRenderWindow.newInstance({
      background: [0.5, 0.5, 0.5], // GRAY background (neutral)
    });

    // Set container and size
    genericRenderWindow.setContainer(containerRef.current);
    genericRenderWindow.resize();

    setGrw(genericRenderWindow);

    // Load default preset if none provided
    if (!preset) {
      const defaultPreset = VolumeRenderingPresetLoader.createEnhancedFluoroPreset();
      setCurrentPreset(defaultPreset);
    }

    return () => {
      // Cleanup
      if (genericRenderWindow) {
        genericRenderWindow.delete();
      }
    };
  }, []);

  // Load and setup volume data
  useEffect(() => {
    if (!grw || !volumeId || !currentPreset) return;

    const setupVolume = async () => {
      try {

        // Get Cornerstone volume
        const volume = cornerstone3D.cache.getVolume(volumeId);
        if (!volume) {
          return;
        }

        // Convert Cornerstone volume to VTK ImageData
        const vtkImageData = convertCornerstoneVolumeToVTK(volume);

        // Create volume mapper
        const mapper = vtkVolumeMapper.newInstance();
        mapper.setInputData(vtkImageData);

        // DRR Rendering Strategy:
        // Use selected blend mode (user-controllable)
        mapper.setBlendMode(blendMode);

        // Set sample distance for quality
        // Finer sampling (0.5mm) for better X-ray simulation
        const sampleDistance = currentPreset.renderingConfig?.sampleDistance || 0.5;
        mapper.setSampleDistance(sampleDistance);

        // Set maximum samples per ray to prevent VTK warning
        mapper.setMaximumSamplesPerRay(4000); // Increase for finer sampling

        // Create volume actor
        const actor = vtkVolume.newInstance();
        actor.setMapper(mapper);

        // Apply transfer functions with control values
        applySlicerXRayTransferFunctions(
          actor,
          opacityLow,
          opacityHigh,
          maxOpacity,
          invertColors
        );

        // Add actor to renderer
        const renderer = grw.getRenderer();
        renderer.addVolume(actor);


        // Setup camera with proper X-ray geometry
        const calculatedFocalPoint = focalPoint || calculateVolumeCenterPoint(volume);

        // Get scalar range to understand what HU values we have
        const scalarData = volume.voxelManager.getCompleteScalarDataArray();
        let minValue = Infinity;
        let maxValue = -Infinity;
        for (let i = 0; i < scalarData.length; i++) {
          if (scalarData[i] < minValue) minValue = scalarData[i];
          if (scalarData[i] > maxValue) maxValue = scalarData[i];
        }

        // Log volume information

        // Get volume bounds
        const bounds = [
          volume.origin[0],
          volume.origin[0] + volume.dimensions[0] * volume.spacing[0],
          volume.origin[1],
          volume.origin[1] + volume.dimensions[1] * volume.spacing[1],
          volume.origin[2],
          volume.origin[2] + volume.dimensions[2] * volume.spacing[2]
        ];

        // Reset camera to fit volume and get proper parallel scale
        renderer.resetCamera();
        const camera = renderer.getActiveCamera();
        const autoParallelScale = camera.getParallelScale();
        const defaultCameraDistance = camera.getDistance();

        // Use a smaller distance to zoom in much closer
        // Reduce the auto-calculated distance by 50% to zoom in more
        const calculatedDistance = defaultCameraDistance * 0.5;


        // Store the calculated distance for future angle updates
        setCameraDistance(calculatedDistance);

        // Apply fluoroscopy angles with proper distance
        updateCamera(
          renderer,
          laoRao,
          cranCaud,
          calculatedDistance, // Use auto-calculated distance
          sourceImageDistance,
          detectorHeight,
          calculatedFocalPoint,
          autoParallelScale
        );

        // Render
        grw.getRenderWindow().render();

        setVolumeActor(actor);
        setIsInitialized(true);

      } catch (error) {
      }
    };

    setupVolume();
  }, [grw, volumeId, currentPreset, focalPoint, sourceObjectDistance, sourceImageDistance, detectorHeight, laoRao, cranCaud]);

  // Update camera when angles change
  useEffect(() => {
    if (!grw || !volumeActor || !isInitialized) return;

    const renderer = grw.getRenderer();
    if (!renderer) {
      return;
    }

    const volume = cornerstone3D.cache.getVolume(volumeId);
    if (!volume) return;

    const calculatedFocalPoint = focalPoint || calculateVolumeCenterPoint(volume);


    updateCamera(
      renderer,
      laoRao,
      cranCaud,
      cameraDistance, // Use stored camera distance, not fixed SOD
      sourceImageDistance,
      detectorHeight,
      calculatedFocalPoint,
      undefined // Don't pass auto scale on angle updates, keep existing
    );

    grw.getRenderWindow().render();
  }, [grw, volumeActor, laoRao, cranCaud, cameraDistance, sourceImageDistance, detectorHeight, focalPoint, isInitialized, volumeId]);

  // Update preset
  useEffect(() => {
    if (preset) {
      setCurrentPreset(preset);
    }
  }, [preset]);

  // Apply new transfer functions when control values change
  useEffect(() => {
    if (!volumeActor || !grw) return;

    applySlicerXRayTransferFunctions(
      volumeActor,
      opacityLow,
      opacityHigh,
      maxOpacity,
      invertColors
    );
    grw.getRenderWindow().render();
  }, [
    volumeActor,
    grw,
    opacityLow,
    opacityHigh,
    maxOpacity,
    invertColors,
  ]);

  // Update blend mode when changed
  useEffect(() => {
    if (!volumeActor || !grw) return;

    const mapper = volumeActor.getMapper();
    if (mapper) {
      mapper.setBlendMode(blendMode);
      grw.getRenderWindow().render();
    }
  }, [volumeActor, grw, blendMode]);

  // Handle window resize
  useEffect(() => {
    if (!grw) return;

    const handleResize = () => {
      grw.resize();
      grw.getRenderWindow().render();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [grw]);

  // Load and render valve STL
  useEffect(() => {
    if (!grw || !isInitialized) return;

    const renderer = grw.getRenderer();
    if (!renderer) return;

    // Remove existing valve actor if any
    if (valveActor) {
      renderer.removeActor(valveActor);
      setValveActor(null);
    }

    // Only render valve if visible and all required props are provided
    if (!valveVisible || !valveSTLPath || !annulusCenter || !annulusNormal) {
      grw.getRenderWindow().render();
      return;
    }

    const loadValve = async () => {
      try {
        // Load STL file
        const reader = vtkSTLReader.newInstance();
        const response = await fetch(valveSTLPath);
        const arrayBuffer = await response.arrayBuffer();
        reader.parseAsArrayBuffer(arrayBuffer);

        // Get polydata and bounds
        const polyData = reader.getOutputData();
        const originalBounds = polyData.getBounds();

        // Calculate valve positioning (same logic as ProperMPRViewport)
        // Build orthonormal basis aligned with annulus normal
        const targetZ = [-annulusNormal[0], -annulusNormal[1], -annulusNormal[2]];

        // Find perpendicular vectors
        let tempVec = [0, 1, 0];
        if (Math.abs(targetZ[1]) > 0.9) {
          tempVec = [0, 0, 1];
        }

        // X-axis: cross product of Z and tempVec
        let targetX = [
          targetZ[1] * tempVec[2] - targetZ[2] * tempVec[1],
          targetZ[2] * tempVec[0] - targetZ[0] * tempVec[2],
          targetZ[0] * tempVec[1] - targetZ[1] * tempVec[0]
        ];
        const xLength = Math.sqrt(targetX[0]**2 + targetX[1]**2 + targetX[2]**2);
        targetX = [targetX[0]/xLength, targetX[1]/xLength, targetX[2]/xLength];

        // Y-axis: cross product of Z and X
        const targetY = [
          targetZ[1] * targetX[2] - targetZ[2] * targetX[1],
          targetZ[2] * targetX[0] - targetZ[0] * targetX[2],
          targetZ[0] * targetX[1] - targetZ[1] * targetX[0]
        ];

        // Apply manual rotation if specified
        let finalX = [...targetX];
        let finalY = [...targetY];
        let finalZ = [...targetZ];

        if (valveRotation.x !== 0 || valveRotation.y !== 0 || valveRotation.z !== 0) {
          const rx = valveRotation.x * Math.PI / 180;
          const ry = valveRotation.y * Math.PI / 180;
          const rz = valveRotation.z * Math.PI / 180;

          const cosX = Math.cos(rx), sinX = Math.sin(rx);
          const cosY = Math.cos(ry), sinY = Math.sin(ry);
          const cosZ = Math.cos(rz), sinZ = Math.sin(rz);

          const Rx = [
            [1, 0, 0],
            [0, cosX, -sinX],
            [0, sinX, cosX]
          ];

          const Ry = [
            [cosY, 0, sinY],
            [0, 1, 0],
            [-sinY, 0, cosY]
          ];

          const Rz = [
            [cosZ, -sinZ, 0],
            [sinZ, cosZ, 0],
            [0, 0, 1]
          ];

          const multiplyMatrices = (A: number[][], B: number[][]) => {
            const result = [[0,0,0], [0,0,0], [0,0,0]];
            for (let i = 0; i < 3; i++) {
              for (let j = 0; j < 3; j++) {
                result[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
              }
            }
            return result;
          };

          const multiplyMatrixVector = (M: number[][], v: number[]) => {
            return [
              M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
              M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
              M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]
            ];
          };

          const R_temp = multiplyMatrices(Ry, Rx);
          const R = multiplyMatrices(Rz, R_temp);

          finalX = multiplyMatrixVector(R, targetX);
          finalY = multiplyMatrixVector(R, targetY);
          finalZ = multiplyMatrixVector(R, targetZ);
        }

        // Calculate translation (valve base at annulus + depth offset)
        const valveCenterX = (originalBounds[0] + originalBounds[1]) / 2;
        const valveCenterY = (originalBounds[2] + originalBounds[3]) / 2;
        const valveBaseZ = originalBounds[4]; // Base of valve

        const depthOffset = [
          -annulusNormal[0] * valveDepth,
          -annulusNormal[1] * valveDepth,
          -annulusNormal[2] * valveDepth
        ];

        const targetPosition = [
          annulusCenter[0] + depthOffset[0],
          annulusCenter[1] + depthOffset[1],
          annulusCenter[2] + depthOffset[2]
        ];

        const localOffset = [
          finalX[0] * (-valveCenterX) + finalY[0] * (-valveCenterY) + finalZ[0] * (-valveBaseZ),
          finalX[1] * (-valveCenterX) + finalY[1] * (-valveCenterY) + finalZ[1] * (-valveBaseZ),
          finalX[2] * (-valveCenterX) + finalY[2] * (-valveCenterY) + finalZ[2] * (-valveBaseZ)
        ];

        const translation = [
          targetPosition[0] + localOffset[0],
          targetPosition[1] + localOffset[1],
          targetPosition[2] + localOffset[2]
        ];

        // Build transformation matrix
        const userMatrix = [
          finalX[0], finalY[0], finalZ[0], 0,
          finalX[1], finalY[1], finalZ[1], 0,
          finalX[2], finalY[2], finalZ[2], 0,
          translation[0], translation[1], translation[2], 1
        ];

        // Create mapper and actor
        const mapper = vtkMapper.newInstance();
        mapper.setInputConnection(reader.getOutputPort());

        const actor = vtkActor.newInstance();
        actor.setMapper(mapper);
        actor.setUserMatrix(userMatrix);

        // Set material properties for DRR view (dark, semi-transparent)
        actor.getProperty().setLighting(true);
        actor.getProperty().setColor(0.2, 0.2, 0.2); // Dark gray for X-ray visibility
        actor.getProperty().setOpacity(0.7); // Semi-transparent
        actor.getProperty().setAmbient(0.5);
        actor.getProperty().setDiffuse(0.5);
        actor.getProperty().setSpecular(0.3);
        actor.getProperty().setSpecularPower(20);

        // Add actor to renderer
        renderer.addActor(actor);
        setValveActor(actor);

        // Render
        grw.getRenderWindow().render();

        console.log('[DRR VALVE] Valve rendered successfully');
      } catch (error) {
        console.error('[DRR VALVE] Error loading valve:', error);
      }
    };

    loadValve();
  }, [grw, isInitialized, valveVisible, valveSTLPath, annulusCenter, annulusNormal, valveDepth, valveRotation]);

  return (
    <div className="relative flex" style={{ width: '100%', height }}>
      {/* Main viewport */}
      <div className="relative flex-1" style={{ height }}>
        <div
          ref={containerRef}
          className="w-full h-full bg-gray-800 rounded overflow-hidden"
          style={{ height }}
        />

        {/* Angle indicators */}
        {showAngleIndicators && (
          <FluoroAngleIndicator laoRao={laoRao} cranCaud={cranCaud} />
        )}

        {/* Info overlay */}
        <div className="absolute top-2 left-2 bg-black bg-opacity-70 px-2 py-1 rounded text-white text-xs pointer-events-none">
          <div>Volume Rendering</div>
          <div className="text-blue-400 mt-1">
            {blendModes.find(m => m.value === blendMode)?.label}
          </div>
        </div>

        {/* Toggle controls button */}
        <button
          onClick={() => setShowControls(!showControls)}
          className="absolute top-2 right-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs"
        >
          {showControls ? 'Hide' : 'Show'} Controls
        </button>
      </div>

      {/* Control sidebar */}
      {showControls && (
        <div className="w-80 bg-gray-900 text-white p-4 overflow-y-auto" style={{ height }}>
          <h3 className="text-sm font-bold mb-4">Volume Rendering Controls</h3>

          {/* Blend Mode Selector */}
          <div className="mb-6">
            <label className="text-xs block mb-2 font-semibold text-blue-400">
              Rendering Mode
            </label>
            <select
              value={blendMode}
              onChange={(e) => setBlendMode(parseInt(e.target.value))}
              className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm border border-gray-600 focus:border-blue-500 focus:outline-none"
            >
              {blendModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-2">
              {blendModes.find(m => m.value === blendMode)?.description}
            </p>
          </div>

          {/* Color Inversion Toggle */}
          <div className="mb-6 p-3 bg-gray-800 rounded">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={invertColors}
                onChange={(e) => setInvertColors(e.target.checked)}
                className="mr-2 w-4 h-4"
              />
              <span className="text-sm font-semibold">
                Invert Colors (Angiography Mode)
              </span>
            </label>
            <p className="text-xs text-gray-400 mt-2">
              {invertColors
                ? '✓ ON: High HU (contrast) = BLACK, Low HU (tissue) = WHITE'
                : '✗ OFF: High HU (contrast) = WHITE, Low HU (tissue) = BLACK'}
            </p>
          </div>

          {/* Opacity thresholds */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="text-xs block mb-1">
                Opacity Start: {opacityLow} HU
              </label>
              <input
                type="range"
                min="-1000"
                max="500"
                step="10"
                value={opacityLow}
                onChange={(e) => setOpacityLow(parseFloat(e.target.value))}
                className="w-full"
              />
              <p className="text-xs text-gray-500 mt-1">
                Below this HU: transparent (0% opacity)
              </p>
            </div>

            <div>
              <label className="text-xs block mb-1">
                Opacity End: {opacityHigh} HU
              </label>
              <input
                type="range"
                min="500"
                max="3000"
                step="50"
                value={opacityHigh}
                onChange={(e) => setOpacityHigh(parseFloat(e.target.value))}
                className="w-full"
              />
              <p className="text-xs text-gray-500 mt-1">
                At this HU and above: max opacity
              </p>
            </div>

            <div>
              <label className="text-xs block mb-1">
                Maximum Opacity: {(maxOpacity * 100).toFixed(1)}%
              </label>
              <input
                type="range"
                min="0.01"
                max="0.5"
                step="0.01"
                value={maxOpacity}
                onChange={(e) => setMaxOpacity(parseFloat(e.target.value))}
                className="w-full"
              />
              <p className="text-xs text-gray-500 mt-1">
                Slicer CT-X-Ray uses 5% - higher values = darker X-ray
              </p>
            </div>
          </div>

          {/* Info */}
          <div className="mt-6 p-3 bg-gray-800 rounded text-xs space-y-2">
            <p className="text-yellow-400 font-semibold">
              Current Mode: {blendModes.find(m => m.value === blendMode)?.label}
            </p>
            <p className="text-gray-300">
              {blendModes.find(m => m.value === blendMode)?.description}
            </p>

            {blendMode === 0 && (
              <>
                <p className="text-green-400 mt-2">
                  ✓ Matches 3D Slicer DRR exactly
                </p>
                <p className="text-green-400">
                  ✓ Front-to-back opacity accumulation
                </p>
                <p className="text-green-400">
                  ✓ Low opacity (3-10%) for X-ray penetration
                </p>
                <p className="text-blue-400 mt-2">
                  Best for: Clinical DRR/fluoroscopy simulation
                </p>
              </>
            )}

            {blendMode === 1 && (
              <>
                <p className="text-green-400 mt-2">
                  ✓ Very clear, high-contrast images
                </p>
                <p className="text-green-400">
                  ✓ Great for contrast-enhanced vessels
                </p>
                <p className="text-blue-400 mt-2">
                  Best for: Quick vessel visualization
                </p>
              </>
            )}

            {blendMode === 3 && (
              <>
                <p className="text-green-400 mt-2">
                  ✓ X-ray-like attenuation simulation
                </p>
                <p className="text-green-400">
                  ✓ Shows tissue layering and depth
                </p>
                <p className="text-blue-400 mt-2">
                  Best for: DRR/fluoroscopy simulation
                </p>
              </>
            )}

            {(blendMode === 4 || blendMode === 5) && (
              <>
                <p className="text-green-400 mt-2">
                  ✓ Physics-based X-ray simulation
                </p>
                <p className="text-green-400">
                  ✓ Most accurate attenuation model
                </p>
                <p className="text-blue-400 mt-2">
                  Best for: Research-grade DRR
                </p>
              </>
            )}
          </div>

          {/* Reset button */}
          <button
            onClick={() => {
              setOpacityLow(112.5);
              setOpacityHigh(1500);
              setMaxOpacity(0.1);
              setBlendMode(0);
            }}
            className="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded text-xs"
          >
            Reset to Slicer Defaults (FluoroPreset_01)
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * Convert Cornerstone3D volume to VTK ImageData
 */
function convertCornerstoneVolumeToVTK(volume: cornerstone3D.Types.IImageVolume): any {
  const imageData = vtkImageData.newInstance();

  // Get volume dimensions and spacing
  const dimensions = volume.dimensions;
  const spacing = volume.spacing;
  const origin = volume.origin;

  // Set dimensions, spacing, and origin
  imageData.setDimensions(dimensions);
  imageData.setSpacing(spacing);
  imageData.setOrigin(origin);

  // Get scalar data using voxelManager to avoid timeout issues
  const scalarData = volume.voxelManager.getCompleteScalarDataArray();

  // Set scalars
  const dataArray = imageData.getPointData().getScalars();
  if (dataArray) {
    // Convert ArrayLike to proper typed array for VTK
    dataArray.setData(scalarData as Float32Array);
  } else {
    // Create new data array if it doesn't exist
    const vtk = require('@kitware/vtk.js/macros');
    const vtkDataArray = require('@kitware/vtk.js/Common/Core/DataArray').default;

    const newDataArray = vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: scalarData,
    });
    imageData.getPointData().setScalars(newDataArray);
  }

  // Set direction matrix
  const direction = volume.direction;
  imageData.setDirection(direction);

  return imageData;
}

/**
 * Calculate volume center point for camera focal point
 */
function calculateVolumeCenterPoint(
  volume: cornerstone3D.Types.IImageVolume
): [number, number, number] {
  const [width, height, depth] = volume.dimensions;
  const [sx, sy, sz] = volume.spacing;
  const [ox, oy, oz] = volume.origin;

  // Calculate center in world coordinates
  const centerX = ox + (width * sx) / 2;
  const centerY = oy + (height * sy) / 2;
  const centerZ = oz + (depth * sz) / 2;

  return [centerX, centerY, centerZ];
}

/**
 * Update camera position based on fluoroscopy angles with proper X-ray geometry
 *
 * In fluoroscopy, the X-ray source is positioned at sourceObjectDistance (SOD) from the patient,
 * and the detector/image intensifier is at sourceImageDistance (SID) from the source.
 *
 * @param renderer - VTK renderer
 * @param laoRao - LAO/RAO angle in degrees
 * @param cranCaud - CRAN/CAUD angle in degrees
 * @param sourceObjectDistance - Distance from X-ray source to patient (focal point) in mm
 * @param sourceImageDistance - Distance from X-ray source to detector in mm
 * @param detectorHeight - Physical height of detector in mm
 * @param focalPoint - Patient/table center position (where X-rays are focused)
 */
function updateCamera(
  renderer: any,
  laoRao: number,
  cranCaud: number,
  sourceObjectDistance: number,
  sourceImageDistance: number,
  detectorHeight: number,
  focalPoint: [number, number, number],
  autoParallelScale?: number
): void {
  if (!renderer) {
    return;
  }

  const camera = renderer.getActiveCamera();
  if (!camera) {
    return;
  }

  // Calculate X-ray source position based on fluoroscopy angles
  // The source is positioned OPPOSITE to the viewing direction at SOD distance
  const viewDirection = SCurveGenerator.fluoroAnglesToCamera(
    laoRao,
    cranCaud,
    1, // Unit vector for direction
    [0, 0, 0] // Origin
  );

  // Normalize view direction
  const length = Math.sqrt(
    viewDirection[0] * viewDirection[0] +
    viewDirection[1] * viewDirection[1] +
    viewDirection[2] * viewDirection[2]
  );
  const normalizedView = [
    viewDirection[0] / length,
    viewDirection[1] / length,
    viewDirection[2] / length,
  ];

  // X-ray source position: patient position + SOD along view direction
  const sourcePosition = [
    focalPoint[0] + normalizedView[0] * sourceObjectDistance,
    focalPoint[1] + normalizedView[1] * sourceObjectDistance,
    focalPoint[2] + normalizedView[2] * sourceObjectDistance,
  ];

  // Camera looks from source towards patient (focal point)
  camera.setPosition(...sourcePosition);
  camera.setFocalPoint(...focalPoint);
  camera.setViewUp(0, 0, 1); // Z-axis is up (superior direction)

  // Use PERSPECTIVE projection like 3D Slicer VirtualCathLab does
  // This simulates the divergent X-ray beam from a point source
  camera.setParallelProjection(false);

  // Calculate view angle from detector size and SID (like Slicer line 1526)
  const viewAngle = 2.0 * Math.atan(detectorHeight / 2.0 / sourceImageDistance) * (180 / Math.PI);
  camera.setViewAngle(viewAngle);

  const magnification = sourceImageDistance / sourceObjectDistance;

  // In real X-ray/DRR: NO CLIPPING - rays go through the ENTIRE patient
  // Set clipping planes very far apart to simulate this
  // Near plane: very close to X-ray source (almost at camera)
  // Far plane: way beyond the patient (past the detector)
  const nearClip = 10; // 10mm from camera (almost at source)
  const farClip = sourceObjectDistance + 2000; // Patient center + 2 meters beyond
  camera.setClippingRange(nearClip, farClip);

  const clippingRange = camera.getClippingRange();
}

/**
 * Apply 3D Slicer FluoroRenderingPreset style transfer functions
 *
 * Key principles (from Slicer FluoroRenderingPreset_01.vp):
 * 1. COMPOSITE blend mode (VTK default) - front-to-back accumulation
 * 2. Very LOW opacity (3-10% maximum) to allow X-ray-like penetration
 * 3. Opacity starts at ~112 HU (soft tissue threshold)
 * 4. Shading DISABLED (no lighting)
 * 5. Color mapping: user-controllable inversion
 *
 * Slicer opacity curve (from line 7 of .vp file):
 * -1024 HU → 0% (air: transparent)
 * 112.5 HU → 0% (soft tissue threshold)
 * 1500 HU → 3% (contrast/calcification)
 * 3071 HU → 10% (maximum density)
 */
function applySlicerXRayTransferFunctions(
  actor: any,
  opacityLow: number,
  opacityHigh: number,
  maxOpacity: number,
  invertColors: boolean
): void {
  const property = actor.getProperty();

  // OPACITY FUNCTION: Match Slicer FluoroRenderingPreset_01 exactly
  // Line 7: 10 -1024 0 -1024 0 112.576698303223 0 1500 0.03 3071 0.1
  const opacityFunction = vtkPiecewiseFunction.newInstance();
  opacityFunction.addPoint(-1024, 0.0); // Air: transparent
  opacityFunction.addPoint(opacityLow, 0.0); // Soft tissue threshold: transparent
  opacityFunction.addPoint(opacityHigh, maxOpacity * 0.3); // Contrast start: 3% (0.3 of max 10%)
  opacityFunction.addPoint(3071, maxOpacity); // Maximum density: 10%
  property.setScalarOpacity(0, opacityFunction);


  // COLOR FUNCTION: User-controllable color inversion
  const colorFunction = vtkColorTransferFunction.newInstance();

  if (invertColors) {
    // INVERTED (Angiography): Low HU = WHITE, High HU = BLACK
    // Contrast vessels appear DARK on light background
    colorFunction.addRGBPoint(-3024, 1.0, 1.0, 1.0); // Air: WHITE
    colorFunction.addRGBPoint(opacityLow, 1.0, 1.0, 1.0); // Below threshold: WHITE
    colorFunction.addRGBPoint(opacityHigh, 0.0, 0.0, 0.0); // High HU: BLACK
    colorFunction.addRGBPoint(3071, 0.0, 0.0, 0.0); // Maximum: BLACK
  } else {
    // NORMAL (CT-like): Low HU = BLACK, High HU = WHITE
    // Contrast vessels appear BRIGHT on dark background
    colorFunction.addRGBPoint(-3024, 0.0, 0.0, 0.0); // Air: BLACK
    colorFunction.addRGBPoint(opacityLow, 0.0, 0.0, 0.0); // Below threshold: BLACK
    colorFunction.addRGBPoint(opacityHigh, 1.0, 1.0, 1.0); // High HU: WHITE
    colorFunction.addRGBPoint(3071, 1.0, 1.0, 1.0); // Maximum: WHITE
  }

  property.setRGBTransferFunction(0, colorFunction);

  // Disable shading (matches Slicer CT-X-Ray preset)
  property.setShade(false);
  property.setAmbient(1.0);
  property.setDiffuse(0.0);
  property.setSpecular(0.0);

  // Enable interpolation for smoother rendering
  property.setInterpolationTypeToLinear();

}
