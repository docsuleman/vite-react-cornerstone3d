import React, { useEffect, useRef, useState } from 'react';
import {
  RenderingEngine,
  Enums,
  Types,
  volumeLoader,
  cornerstoneStreamingImageVolumeLoader,
  getRenderingEngine,
} from "@cornerstonejs/core";
import { init as csRenderInit } from "@cornerstonejs/core";
import { init as csToolsInit } from "@cornerstonejs/tools";
import { init as dicomImageLoaderInit } from "@cornerstonejs/dicom-image-loader";
import * as cornerstoneTools from "@cornerstonejs/tools";
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkCellPicker from '@kitware/vtk.js/Rendering/Core/CellPicker';
import { FaSearchPlus, FaSearchMinus, FaAdjust, FaUndo, FaDotCircle } from 'react-icons/fa';

import createImageIdsAndCacheMetaData from '../lib/createImageIdsAndCacheMetaData';
import { initializeCornerstone } from '../utils/cornerstoneInit';
import { CenterlineGenerator } from '../utils/CenterlineGenerator';
import { VTKCPRGenerator } from '../utils/VTKCPRGenerator';
import { RootPointType } from '../types/WorkflowTypes';

const {
  ToolGroupManager,
  Enums: csToolsEnums,
  CrosshairsTool,
  ZoomTool,
  PanTool,
  WindowLevelTool,
} = cornerstoneTools;

const { MouseBindings } = csToolsEnums;
const { ViewportType } = Enums;

// Register volume loader
volumeLoader.registerUnknownVolumeLoader(cornerstoneStreamingImageVolumeLoader);

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface CornerstoneCPRViewportProps {
  patientInfo?: {
    patientID?: string;
    patientName?: string;
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
  };
  rootPoints: Point3D[];
  onCuspDotsUpdate?: (dots: { id: string; pos: [number, number, number]; color: string; cuspType: string }[]) => void;
  width?: number;
  height?: number;
  backgroundColor?: [number, number, number];
}

const CornerstoneCPRViewport: React.FC<CornerstoneCPRViewportProps> = ({
  patientInfo,
  rootPoints,
  onCuspDotsUpdate,
  width = 800,
  height = 600,
  backgroundColor = [0, 0, 0]
}) => {
  // Refs for viewport elements
  const axialRef = useRef<HTMLDivElement>(null);
  const sagittalRef = useRef<HTMLDivElement>(null);
  const coronalRef = useRef<HTMLDivElement>(null);
  
  // State
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlacingCuspDots, setIsPlacingCuspDots] = useState(false);
  const [cuspDots, setCuspDots] = useState<Array<{
    id: string;
    worldPos: [number, number, number];
    color: string;
    cuspType: 'left' | 'right' | 'non-coronary';
    actor: any;
  }>>([]);

  // Refs for Cornerstone objects
  const renderingEngine = useRef<RenderingEngine | null>(null);
  const toolGroup = useRef<any>(null);
  const volumeId = useRef<string>('');
  const picker = useRef<any>(null);

  // Static IDs - using stable IDs like ProperMPRViewport
  const renderingEngineId = 'cprRenderingEngine';
  const toolGroupId = 'CPR_TOOLGROUP';
  const viewportIds = ['cpr-main', 'cpr-longitudinal', 'cpr-cross-section'];

  useEffect(() => {
    if (!patientInfo?.seriesInstanceUID || rootPoints.length < 3) return;

    console.log('🔄 Initializing Cornerstone3D CPR Viewport...');
    
    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      initializeCornerstoneCPR();
    }, 100);

    return () => {
      clearTimeout(timer);
      cleanup();
    };
  }, [patientInfo, rootPoints]);

  const cleanup = () => {
    try {
      console.log('🧹 Cleaning up Cornerstone CPR Viewport...');
      
      // Clean up cusp dot actors
      cuspDots.forEach(dot => {
        viewportIds.forEach(viewportId => {
          try {
            const viewport = renderingEngine.current?.getViewport(viewportId);
            if (viewport && dot.actor) {
              // Remove actor from viewport (Cornerstone3D handles this)
              viewport.render();
            }
          } catch (e) {
            console.warn(`Failed to remove actor from ${viewportId}:`, e);
          }
        });
      });

      // Clean up tool group
      try {
        const existingToolGroup = ToolGroupManager.getToolGroup(toolGroupId);
        if (existingToolGroup) {
          ToolGroupManager.destroyToolGroup(toolGroupId);
        }
      } catch (error) {
        console.warn('Failed to destroy tool group:', error);
      }

      // Clean up rendering engine
      if (renderingEngine.current) {
        renderingEngine.current.destroy();
        renderingEngine.current = null;
      }

      console.log('✅ Cornerstone CPR Viewport cleanup complete');
    } catch (error) {
      console.warn('Cleanup error:', error);
    }
  };

  const initializeCornerstoneCPR = async () => {
    try {
      setIsLoading(true);
      setError(null);

      console.log('🔄 Initializing Cornerstone3D...');
      await initializeCornerstone();

      console.log('🔍 Loading DICOM data...');
      const imageIds = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: patientInfo!.studyInstanceUID!,
        SeriesInstanceUID: patientInfo!.seriesInstanceUID!,
        wadoRsRoot: "http://127.0.0.1/orthanc/dicom-web",
      });

      if (imageIds.length === 0) {
        throw new Error('No DICOM images found for this series');
      }

      console.log(`📋 Found ${imageIds.length} DICOM images`);

      // Create volume
      const volumeName = `cprVolume_${Date.now()}`;
      volumeId.current = `cornerstoneStreamingImageVolume:${volumeName}`;
      const volume = await volumeLoader.createAndCacheVolume(volumeId.current, { imageIds });
      volume.load();

      // Wait for volume to load
      console.log('⏳ Waiting for volume to load...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Clean up any existing rendering engine with this ID
      try {
        const existingEngine = getRenderingEngine(renderingEngineId);
        if (existingEngine) {
          existingEngine.destroy();
        }
      } catch (e) {
        // No existing engine
      }

      // Create rendering engine
      renderingEngine.current = new RenderingEngine(renderingEngineId);

      // Check if rendering engine was created successfully
      if (!renderingEngine.current) {
        throw new Error('Failed to create rendering engine');
      }

      // Setup viewports
      await setupViewports();
      
      // Setup volume rendering
      await setupVolumeRendering();
      
      // Setup tools and picking
      await setupToolsAndPicking();

      setIsInitialized(true);
      setIsLoading(false);

      console.log('✅ Cornerstone3D CPR Viewport initialized successfully!');

    } catch (err) {
      console.error('❌ Failed to initialize Cornerstone CPR Viewport:', err);
      setError(`Failed to initialize: ${err}`);
      setIsLoading(false);
    }
  };

  const setupViewports = async () => {
    console.log('🔧 Setting up CPR viewports...');

    // Check if DOM elements are ready
    if (!axialRef.current || !sagittalRef.current || !coronalRef.current) {
      console.error('Viewport DOM elements not ready');
      return;
    }

    if (!renderingEngine.current) {
      console.error('Rendering engine not initialized');
      return;
    }

    try {
      // Use enableElement like ProperMPRViewport does
      const viewports = [
        { id: 'cpr-main', element: axialRef.current, orientation: Enums.OrientationAxis.AXIAL },
        { id: 'cpr-longitudinal', element: sagittalRef.current, orientation: Enums.OrientationAxis.SAGITTAL },
        { id: 'cpr-cross-section', element: coronalRef.current, orientation: Enums.OrientationAxis.CORONAL },
      ];

      viewports.forEach(({ id, element, orientation }) => {
        renderingEngine.current!.enableElement({
          viewportId: id,
          type: Enums.ViewportType.ORTHOGRAPHIC,
          element: element,
          defaultOptions: {
            orientation,
            background: backgroundColor as Types.Point3,
          },
        });
      });
    } catch (error) {
      console.error('Failed to setup viewports:', error);
      throw error;
    }
  };

  const setupVolumeRendering = async () => {
    console.log('🔧 Setting up CPR volume rendering...');

    try {
      // Generate centerline FIRST before setting up viewports
      const centerline = CenterlineGenerator.generateFromRootPoints(
        rootPoints.map((point, index) => ({
          id: `root-${index}`,
          position: [point.x, point.y, point.z] as [number, number, number],
          type: index === 0 ? RootPointType.LV_OUTFLOW : index === 1 ? RootPointType.AORTIC_VALVE : RootPointType.ASCENDING_AORTA,
          timestamp: Date.now()
        }))
      );

      // Set volumes and immediately apply CPR transformations
      for (const viewportId of viewportIds) {
        const viewport = renderingEngine.current!.getViewport(viewportId) as Types.IVolumeViewport;
        viewport.setVolumes([{ volumeId: volumeId.current }]);
        
        // Don't render with default orientation - apply CPR first
      }

      // Apply CPR transformations BEFORE any render
      console.log('🚀 About to apply CPR transformations...');
      await applyCPRToViewports(centerline);
      
      // Force render all viewports with CPR positioning
      console.log('🎬 Rendering CPR views...');
      viewportIds.forEach(id => {
        const viewport = renderingEngine.current!.getViewport(id);
        console.log(`📺 Rendering viewport: ${id}`);
        viewport.render();
      });

      // Force an additional render cycle to ensure changes take effect
      setTimeout(() => {
        viewportIds.forEach(id => {
          renderingEngine.current!.getViewport(id).render();
        });
        console.log('🔄 Additional render cycle completed');
      }, 100);

      console.log('✅ CPR views initialized successfully');
    } catch (err) {
      console.error('Failed to setup CPR volume rendering:', err);
      throw err;
    }
  };

  const applyCPRToViewports = async (centerline: any) => {
    console.log('🔄 Applying CPR transformations to viewports...');
    
    // Get the volume viewport
    const mainViewport = renderingEngine.current!.getViewport('cpr-main') as Types.IVolumeViewport;
    const longViewport = renderingEngine.current!.getViewport('cpr-longitudinal') as Types.IVolumeViewport;
    const crossViewport = renderingEngine.current!.getViewport('cpr-cross-section') as Types.IVolumeViewport;
    
    if (!mainViewport || !longViewport || !crossViewport) {
      console.error('Failed to get viewports for CPR');
      return;
    }

    // Find the annular plane location (approximately 2/3 along the centerline)
    const annularIndex = Math.floor(centerline.length * 0.67);
    const annularPoint = [
      centerline.position[annularIndex * 3],
      centerline.position[annularIndex * 3 + 1],
      centerline.position[annularIndex * 3 + 2]
    ];

    // Calculate the tangent at the annular point (centerline direction)
    const tangentIndex = Math.min(annularIndex + 1, centerline.length - 1);
    const tangent = [
      centerline.position[tangentIndex * 3] - centerline.position[annularIndex * 3],
      centerline.position[tangentIndex * 3 + 1] - centerline.position[annularIndex * 3 + 1],
      centerline.position[tangentIndex * 3 + 2] - centerline.position[annularIndex * 3 + 2]
    ];
    
    // Normalize tangent
    const tangentLength = Math.sqrt(tangent[0]**2 + tangent[1]**2 + tangent[2]**2);
    const normalizedTangent = tangent.map(t => t / tangentLength);

    // Set up main CPR view (perpendicular to centerline at annulus)
    // This gives us the en face view of the annulus
    const { viewUp, viewPlaneNormal } = createOrthogonalVectors(normalizedTangent);
    
    // Reset all cameras first
    mainViewport.resetCamera();
    longViewport.resetCamera();
    crossViewport.resetCamera();
    
    console.log('🎯 Setting CPR cameras:', {
      annularPoint,
      normalizedTangent,
      viewUp,
      viewPlaneNormal
    });
    
    // Main view: En face view of annulus (perpendicular to centerline)
    mainViewport.setCamera({
      position: [
        annularPoint[0] + normalizedTangent[0] * 200,
        annularPoint[1] + normalizedTangent[1] * 200,
        annularPoint[2] + normalizedTangent[2] * 200
      ] as Types.Point3,
      focalPoint: annularPoint as Types.Point3,
      viewUp: viewUp as Types.Point3,
      viewPlaneNormal: normalizedTangent as Types.Point3,
      parallelScale: 25 // Zoom in more for annulus view
    });

    // Set slab thickness for CPR-like visualization
    const mainProperties = mainViewport.getProperties();
    mainViewport.setProperties({
      ...mainProperties,
      slabThickness: 10 // Thin slab for CPR effect
    });

    // Longitudinal view: Along the centerline showing the curve
    // Calculate multiple points along centerline for better orientation
    const startIndex = Math.max(0, annularIndex - 10);
    const endIndex = Math.min(centerline.length - 1, annularIndex + 10);
    
    const startPoint = [
      centerline.position[startIndex * 3],
      centerline.position[startIndex * 3 + 1],
      centerline.position[startIndex * 3 + 2]
    ];
    
    const endPoint = [
      centerline.position[endIndex * 3],
      centerline.position[endIndex * 3 + 1],
      centerline.position[endIndex * 3 + 2]
    ];
    
    // Create a view that shows the centerline from the side
    const centerlineDirection = [
      endPoint[0] - startPoint[0],
      endPoint[1] - startPoint[1],
      endPoint[2] - startPoint[2]
    ];
    
    const clLength = Math.sqrt(centerlineDirection[0]**2 + centerlineDirection[1]**2 + centerlineDirection[2]**2);
    const normalizedCLDir = centerlineDirection.map(d => d / clLength);
    
    longViewport.setCamera({
      position: [
        annularPoint[0] + viewPlaneNormal[0] * 200,
        annularPoint[1] + viewPlaneNormal[1] * 200,
        annularPoint[2] + viewPlaneNormal[2] * 200
      ] as Types.Point3,
      focalPoint: annularPoint as Types.Point3,
      viewUp: [0, 0, 1] as Types.Point3, // Keep anatomical orientation
      viewPlaneNormal: viewPlaneNormal as Types.Point3,
      parallelScale: 40 // Wider view to see the curve
    });

    const longProperties = longViewport.getProperties();
    longViewport.setProperties({
      ...longProperties,
      slabThickness: 20 // Thicker slab to show more of the curve
    });

    // Cross-sectional view: True cross-section perpendicular to both other views
    crossViewport.setCamera({
      position: [
        annularPoint[0] + viewUp[0] * 200,
        annularPoint[1] + viewUp[1] * 200,
        annularPoint[2] + viewUp[2] * 200
      ] as Types.Point3,
      focalPoint: annularPoint as Types.Point3,
      viewUp: normalizedTangent as Types.Point3,
      viewPlaneNormal: viewUp as Types.Point3,
      parallelScale: 35
    });

    const crossProperties = crossViewport.getProperties();
    crossViewport.setProperties({
      ...crossProperties,
      slabThickness: 5 // Very thin for true cross-section
    });

    console.log('✅ CPR views configured at annular plane');
  };

  const createOrthogonalVectors = (direction: number[]): { viewUp: number[], viewPlaneNormal: number[] } => {
    // Create two vectors orthogonal to the given direction
    let viewUp = [0, 1, 0]; // Default up vector
    
    // If direction is too close to Y axis, use X axis as up
    const dotY = Math.abs(direction[0] * 0 + direction[1] * 1 + direction[2] * 0);
    if (dotY > 0.9) {
      viewUp = [1, 0, 0];
    }
    
    // Cross product to get perpendicular vector
    const viewPlaneNormal = [
      viewUp[1] * direction[2] - viewUp[2] * direction[1],
      viewUp[2] * direction[0] - viewUp[0] * direction[2],
      viewUp[0] * direction[1] - viewUp[1] * direction[0]
    ];
    
    // Normalize
    const vpnLength = Math.sqrt(viewPlaneNormal[0]**2 + viewPlaneNormal[1]**2 + viewPlaneNormal[2]**2);
    const normalizedVPN = viewPlaneNormal.map(v => v / vpnLength);
    
    // Recalculate viewUp to ensure orthogonality
    const correctedViewUp = [
      direction[1] * normalizedVPN[2] - direction[2] * normalizedVPN[1],
      direction[2] * normalizedVPN[0] - direction[0] * normalizedVPN[2],
      direction[0] * normalizedVPN[1] - direction[1] * normalizedVPN[0]
    ];
    
    const vuLength = Math.sqrt(correctedViewUp[0]**2 + correctedViewUp[1]**2 + correctedViewUp[2]**2);
    const normalizedVU = correctedViewUp.map(v => v / vuLength);
    
    return {
      viewUp: normalizedVU,
      viewPlaneNormal: normalizedVPN
    };
  };

  const setupToolsAndPicking = async () => {
    console.log('🔧 Setting up tools and picking...');

    // Add tools
    cornerstoneTools.addTool(ZoomTool);
    cornerstoneTools.addTool(PanTool);
    cornerstoneTools.addTool(WindowLevelTool);

    // Create tool group
    try {
      const existingToolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (existingToolGroup) {
        ToolGroupManager.destroyToolGroup(toolGroupId);
      }
    } catch (error) {
      // Tool group doesn't exist
    }

    toolGroup.current = ToolGroupManager.createToolGroup(toolGroupId);

    // Configure tools
    toolGroup.current.addTool(ZoomTool.toolName);
    toolGroup.current.addTool(PanTool.toolName);  
    toolGroup.current.addTool(WindowLevelTool.toolName);

    toolGroup.current.setToolActive(ZoomTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Secondary }],
    });

    toolGroup.current.setToolActive(PanTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Auxiliary }],
    });

    // Add viewports to tool group
    viewportIds.forEach(viewportId => {
      toolGroup.current!.addViewport(viewportId, renderingEngineId);
    });

    // Setup VTK picker for cusp dot placement
    picker.current = vtkCellPicker.newInstance({ opacityThreshold: 0.0001 });
    picker.current.setPickFromList(1);
    picker.current.setTolerance(0);
    picker.current.initializePickList();

    // Add volume actors to pick list and setup click handlers
    viewportIds.forEach(viewportId => {
      const viewport = renderingEngine.current!.getViewport(viewportId) as Types.IVolumeViewport;
      const defaultActor = viewport.getDefaultActor();
      if (defaultActor?.actor) {
        picker.current.addPickList(defaultActor.actor);
        prepareImageDataForPicking(viewport);
      }

      // Add click handler for cusp dot placement
      const element = viewport.element;
      element.addEventListener('mousedown', (evt) => {
        if (evt.button === 0 && onCuspDotsUpdate && isPlacingCuspDots && cuspDots.length < 3) { // Left click
          handleCuspDotPlacement(evt, viewport, viewportId);
        }
      });
    });
  };

  const prepareImageDataForPicking = (viewport: Types.IVolumeViewport) => {
    const volumeActor = viewport.getDefaultActor()?.actor;
    if (!volumeActor) return;

    const imageData = volumeActor.getMapper().getInputData();
    if (!imageData) return;

    const { voxelManager } = imageData.get('voxelManager') || {};
    if (!voxelManager) return;

    // Create fake scalars for VTK picking
    const fakeScalars = {
      getData: () => voxelManager.getCompleteScalarDataArray(),
      getNumberOfComponents: () => voxelManager.numberOfComponents,
      getDataType: () => voxelManager.getCompleteScalarDataArray().constructor.name,
    };

    imageData.setPointData({
      getScalars: () => fakeScalars,
    });
  };

  const handleCuspDotPlacement = (evt: MouseEvent, viewport: Types.IVolumeViewport, viewportId: string) => {
    evt.preventDefault();
    evt.stopPropagation();

    const element = viewport.element;
    const rect = element.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;

    // Get canvas coordinates
    const canvasPos = [x, y] as Types.Point2;
    const worldPos = viewport.canvasToWorld(canvasPos);
    // For CPR views, we need to ensure the picked point is on the annular plane
    if (worldPos) {
      addCuspDot(worldPos as [number, number, number]);
    }
  };

  const addCuspDot = (worldPos: [number, number, number]) => {
    const cuspTypes: Array<'left' | 'right' | 'non-coronary'> = ['left', 'right', 'non-coronary'];
    const colors = ['#22c55e', '#ef4444', '#eab308']; // green, red, yellow
    
    const cuspType = cuspTypes[cuspDots.length];
    const color = colors[cuspDots.length];
    const dotId = `cusp_${cuspType}_${Date.now()}`;

    console.log(`🎯 Adding cusp dot: ${cuspType} at`, worldPos);

    // Create VTK sphere
    const sphereSource = vtkSphereSource.newInstance();
    sphereSource.setCenter(worldPos);
    sphereSource.setRadius(3);

    const sphereMapper = vtkMapper.newInstance();
    sphereMapper.setInputConnection(sphereSource.getOutputPort());

    const sphereActor = vtkActor.newInstance();
    sphereActor.setMapper(sphereMapper);
    sphereActor.getProperty().setColor(...hexToRgb(color));

    // Add sphere to all viewports
    viewportIds.forEach(viewportId => {
      const viewport = renderingEngine.current!.getViewport(viewportId) as Types.IVolumeViewport;
      const actorUID = `${dotId}_${viewportId}`;
      viewport.addActor({ actor: sphereActor, uid: actorUID });
      viewport.render();
    });

    // Add to state
    const newDot = {
      id: dotId,
      worldPos,
      color,
      cuspType,
      actor: sphereActor
    };

    const updatedDots = [...cuspDots, newDot];
    setCuspDots(updatedDots);

    // Notify parent component
    if (onCuspDotsUpdate) {
      const dotsForCallback = updatedDots.map(dot => ({
        id: dot.id,
        pos: dot.worldPos,
        color: dot.color,
        cuspType: dot.cuspType
      }));
      onCuspDotsUpdate(dotsForCallback);
    }

    console.log(`✅ Cusp dot placed: ${cuspType} (${updatedDots.length}/3)`);
  };

  const clearCuspDots = () => {
    console.log('🧹 Clearing all cusp dots...');
    
    // Remove actors from all viewports
    cuspDots.forEach(dot => {
      viewportIds.forEach(viewportId => {
        const viewport = renderingEngine.current!.getViewport(viewportId) as Types.IVolumeViewport;
        const actorUID = `${dot.id}_${viewportId}`;
        viewport.removeActors([actorUID]);
        viewport.render();
      });
    });

    setCuspDots([]);
    
    if (onCuspDotsUpdate) {
      onCuspDotsUpdate([]);
    }
  };

  const hexToRgb = (hex: string): [number, number, number] => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16) / 255,
      parseInt(result[2], 16) / 255,
      parseInt(result[3], 16) / 255
    ] : [1, 1, 1];
  };

  return (
    <div className="flex flex-col w-full h-full bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-white">
            CPR Annulus Definition - Place 3 Cusp Nadir Points
          </h3>
          {patientInfo && (
            <div className="text-sm text-slate-300">
              Patient: {patientInfo.patientName || 'Unknown'}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {/* Cusp Dot Controls - Only show when callback is provided */}
          {onCuspDotsUpdate && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsPlacingCuspDots(!isPlacingCuspDots)}
                className={`px-3 py-1 text-sm rounded flex items-center gap-1 transition-colors ${
                  isPlacingCuspDots 
                    ? 'bg-teal-600 text-white' 
                    : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                }`}
              >
                <FaDotCircle />
                {isPlacingCuspDots ? 'Active' : 'Place Cusps'}
              </button>
              <button
                onClick={clearCuspDots}
                className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
                disabled={cuspDots.length === 0}
              >
                Clear ({cuspDots.length}/3)
              </button>
            </div>
          )}

          {/* Status */}
          <div className="text-xs text-slate-400">
            Dots: {cuspDots.length}/3 | Root Points: {rootPoints.length}
          </div>
        </div>
      </div>

      {/* Loading/Error States */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="flex items-center gap-3 text-white">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <span>Loading Cornerstone3D CPR...</span>
          </div>
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="bg-red-900 border border-red-700 rounded-lg p-6 text-white max-w-lg">
            <h3 className="font-semibold mb-2">⚠️ Initialization Error</h3>
            <p className="text-sm whitespace-pre-line mb-3">{error}</p>
            <button
              onClick={() => {
                setError(null);
                setTimeout(() => initializeCornerstoneCPR(), 100);
              }}
              className="bg-red-700 hover:bg-red-600 px-3 py-1 rounded text-xs"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Instructions overlay */}
      {onCuspDotsUpdate && isPlacingCuspDots && (
        <div className="absolute top-16 left-4 bg-teal-600 bg-opacity-90 text-white text-sm px-3 py-2 rounded z-10">
          Left-click on any view to place cusp nadir points ({cuspDots.length}/3)
        </div>
      )}

      {/* Three-View CPR Layout for Annulus Definition */}
      <div className="flex-1 grid grid-cols-3 gap-1 bg-slate-900">
        {/* CPR Main View - En Face Annulus */}
        <div className="relative bg-black border border-teal-600">
          <div className="absolute top-2 left-2 z-10 bg-teal-900 bg-opacity-90 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
            <div className="w-2 h-2 bg-teal-400 rounded-full animate-pulse"></div>
            CPR: Annulus En Face
          </div>
          <div className="absolute bottom-2 left-2 z-10 bg-black bg-opacity-70 text-teal-300 text-[10px] px-2 py-1 rounded">
            Perpendicular to centerline
          </div>
          <div ref={axialRef} className="w-full h-full" />
        </div>
        
        {/* CPR Longitudinal View */}
        <div className="relative bg-black border border-teal-600">
          <div className="absolute top-2 left-2 z-10 bg-teal-900 bg-opacity-90 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
            <div className="w-2 h-2 bg-teal-400 rounded-full animate-pulse"></div>
            CPR: Curved Longitudinal
          </div>
          <div className="absolute bottom-2 left-2 z-10 bg-black bg-opacity-70 text-teal-300 text-[10px] px-2 py-1 rounded">
            Along aortic centerline
          </div>
          <div ref={sagittalRef} className="w-full h-full" />
        </div>
        
        {/* CPR Cross-Section View */}
        <div className="relative bg-black border border-teal-600">
          <div className="absolute top-2 left-2 z-10 bg-teal-900 bg-opacity-90 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
            <div className="w-2 h-2 bg-teal-400 rounded-full animate-pulse"></div>
            CPR: Cross-Section
          </div>
          <div className="absolute bottom-2 left-2 z-10 bg-black bg-opacity-70 text-teal-300 text-[10px] px-2 py-1 rounded">
            Orthogonal slice
          </div>
          <div ref={coronalRef} className="w-full h-full" />
        </div>
      </div>
    </div>
  );
};

export default CornerstoneCPRViewport;