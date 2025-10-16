/**
 * DRRViewport Component
 * Digitally Reconstructed Radiograph viewport using VTK.js volume rendering
 * Simulates X-ray fluoroscopy from CT data using GPU ray casting
 */

import React, { useRef, useEffect, useState } from 'react';
import * as cornerstone3D from '@cornerstonejs/core';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
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
  /** Focal point for camera (world coordinates) */
  focalPoint?: [number, number, number];
  /** Camera distance from focal point */
  cameraDistance?: number;
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
}

export const DRRViewport: React.FC<DRRViewportProps> = ({
  volumeId,
  laoRao,
  cranCaud,
  focalPoint,
  cameraDistance = 500,
  onAngleChange,
  width = 512,
  height = 512,
  preset,
  showAngleIndicators = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [grw, setGrw] = useState<any>(null);
  const [volumeActor, setVolumeActor] = useState<any>(null);
  const [currentPreset, setCurrentPreset] = useState<VolumeRenderingPreset | null>(
    preset || null
  );
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize VTK.js rendering
  useEffect(() => {
    if (!containerRef.current) return;

    console.log('🎥 Initializing DRR viewport with VTK.js...');

    // Create generic render window
    const genericRenderWindow = vtkGenericRenderWindow.newInstance({
      background: [0, 0, 0],
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
        console.log('📦 Loading volume data for DRR:', volumeId);

        // Get Cornerstone volume
        const volume = cornerstone3D.cache.getVolume(volumeId);
        if (!volume) {
          console.error('Volume not found in cache:', volumeId);
          return;
        }

        // Convert Cornerstone volume to VTK ImageData
        const vtkImageData = convertCornerstoneVolumeToVTK(volume);

        // Create volume mapper
        const mapper = vtkVolumeMapper.newInstance();
        mapper.setInputData(vtkImageData);

        // Set blend mode based on preset
        switch (currentPreset.blendMode) {
          case VolumeBlendMode.MIP:
            mapper.setBlendModeToMaximumIntensity();
            break;
          case VolumeBlendMode.MIN_IP:
            mapper.setBlendModeToMinimumIntensity();
            break;
          case VolumeBlendMode.AVERAGE:
            mapper.setBlendModeToAverageIntensity();
            break;
          case VolumeBlendMode.RADON_TRANSFORM:
            // Radon transform approximation using composite rendering
            // with carefully tuned opacity for X-ray absorption simulation
            mapper.setBlendModeToComposite();
            break;
          default:
            mapper.setBlendModeToComposite();
        }

        // Set sample distance for quality (DRR doesn't need ultra-fine sampling)
        // Use 1.0mm for good balance between quality and performance
        const sampleDistance = currentPreset.renderingConfig?.sampleDistance || 1.0;
        mapper.setSampleDistance(Math.max(sampleDistance, 1.0)); // Minimum 1.0mm to avoid too many samples

        // Set maximum samples per ray to prevent VTK warning
        mapper.setMaximumSamplesPerRay(2000); // Increase from default 1000

        // Create volume actor
        const actor = vtkVolume.newInstance();
        actor.setMapper(mapper);

        // Apply transfer functions from preset
        applyTransferFunctions(actor, currentPreset);

        // Add actor to renderer
        const renderer = grw.getRenderer();
        renderer.addVolume(actor);

        // Setup camera
        const calculatedFocalPoint = focalPoint || calculateVolumeCenterPoint(volume);
        updateCamera(
          renderer,
          laoRao,
          cranCaud,
          cameraDistance,
          calculatedFocalPoint
        );

        // Reset camera to fit volume
        renderer.resetCamera();

        // Render
        grw.getRenderWindow().render();

        setVolumeActor(actor);
        setIsInitialized(true);

        console.log('✅ DRR viewport initialized successfully');
      } catch (error) {
        console.error('Error setting up DRR volume:', error);
      }
    };

    setupVolume();
  }, [grw, volumeId, currentPreset, focalPoint, cameraDistance]);

  // Update camera when angles change
  useEffect(() => {
    if (!grw || !volumeActor || !isInitialized) return;

    const renderer = grw.getRenderer();
    const volume = cornerstone3D.cache.getVolume(volumeId);
    if (!volume) return;

    const calculatedFocalPoint = focalPoint || calculateVolumeCenterPoint(volume);
    updateCamera(renderer, laoRao, cranCaud, cameraDistance, calculatedFocalPoint);

    grw.getRenderWindow().render();
  }, [grw, volumeActor, laoRao, cranCaud, cameraDistance, focalPoint, isInitialized]);

  // Update preset
  useEffect(() => {
    if (preset) {
      setCurrentPreset(preset);
    }
  }, [preset]);

  // Apply new transfer functions when preset changes
  useEffect(() => {
    if (!volumeActor || !currentPreset || !grw) return;

    applyTransferFunctions(volumeActor, currentPreset);
    grw.getRenderWindow().render();
  }, [volumeActor, currentPreset, grw]);

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

  return (
    <div className="relative" style={{ width, height }}>
      <div
        ref={containerRef}
        className="w-full h-full bg-black rounded overflow-hidden"
        style={{ width, height }}
      />

      {/* Angle indicators */}
      {showAngleIndicators && (
        <FluoroAngleIndicator laoRao={laoRao} cranCaud={cranCaud} />
      )}

      {/* Info overlay */}
      <div className="absolute top-2 left-2 bg-black bg-opacity-70 px-2 py-1 rounded text-white text-xs pointer-events-none">
        <div>DRR View</div>
        {currentPreset && (
          <div className="text-slate-400 mt-1">{currentPreset.name}</div>
        )}
      </div>
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
    dataArray.setData(scalarData);
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
 * Update camera position based on fluoroscopy angles
 */
function updateCamera(
  renderer: any,
  laoRao: number,
  cranCaud: number,
  distance: number,
  focalPoint: [number, number, number]
): void {
  const camera = renderer.getActiveCamera();

  // Convert fluoroscopy angles to camera position using SCurveGenerator
  const cameraPosition = SCurveGenerator.fluoroAnglesToCamera(
    laoRao,
    cranCaud,
    distance,
    focalPoint
  );

  camera.setPosition(...cameraPosition);
  camera.setFocalPoint(...focalPoint);
  camera.setViewUp(0, 0, 1); // Z-axis is up

  // Use parallel projection for true orthographic fluoroscopy view
  camera.setParallelProjection(true);

  // Set parallel scale based on distance (adjust for zoom level)
  camera.setParallelScale(distance / 4);
}

/**
 * Apply transfer functions from preset to volume actor
 */
function applyTransferFunctions(actor: any, preset: VolumeRenderingPreset): void {
  const property = actor.getProperty();

  // Create opacity transfer function
  const opacityFunction = vtkPiecewiseFunction.newInstance();
  for (const point of preset.opacityPoints) {
    opacityFunction.addPoint(point.value, point.output);
  }
  property.setScalarOpacity(0, opacityFunction);

  // Create color transfer function
  const colorFunction = vtkColorTransferFunction.newInstance();
  if (preset.colorPoints && preset.colorPoints.length > 0) {
    for (const point of preset.colorPoints) {
      colorFunction.addRGBPoint(
        point.value,
        point.color.r,
        point.color.g,
        point.color.b
      );
    }
  } else {
    // Default grayscale ramp if no color points
    colorFunction.addRGBPoint(-1024, 0, 0, 0); // Black
    colorFunction.addRGBPoint(3071, 1, 1, 1); // White
  }
  property.setRGBTransferFunction(0, colorFunction);

  // Apply shading settings
  if (preset.renderingConfig?.shade !== undefined) {
    property.setShade(preset.renderingConfig.shade);
  }

  // Apply lighting parameters if specified
  if (preset.renderingConfig?.ambient !== undefined) {
    property.setAmbient(preset.renderingConfig.ambient);
  }
  if (preset.renderingConfig?.diffuse !== undefined) {
    property.setDiffuse(preset.renderingConfig.diffuse);
  }
  if (preset.renderingConfig?.specular !== undefined) {
    property.setSpecular(preset.renderingConfig.specular);
  }
  if (preset.renderingConfig?.specularPower !== undefined) {
    property.setSpecularPower(preset.renderingConfig.specularPower);
  }

  // Enable interpolation for smoother rendering
  property.setInterpolationTypeToLinear();
}
