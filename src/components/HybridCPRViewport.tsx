import React, { useEffect, useRef, useState } from 'react';
import { FaSearchPlus, FaSearchMinus, FaAdjust, FaUndo, FaDotCircle } from 'react-icons/fa';
import {
  RenderingEngine,
  Enums as CornerstoneEnums,
  volumeLoader,
  cornerstoneStreamingImageVolumeLoader,
  cache,
  Types
} from "@cornerstonejs/core";
import { init as csRenderInit } from "@cornerstonejs/core";
import { init as csToolsInit } from "@cornerstonejs/tools";
import { init as dicomImageLoaderInit } from "@cornerstonejs/dicom-image-loader";
import * as cornerstoneTools from "@cornerstonejs/tools";

import createImageIdsAndCacheMetaData from '../lib/createImageIdsAndCacheMetaData';
import { VTKCPRGenerator } from '../utils/VTKCPRGenerator';
import VTKToCornerstone3DConverter from '../utils/VTKToCornerstone3DConverter';
import { CPRCoordinateConverter } from '../utils/CPRCoordinateConverter';
import CPRAwareSphereMarkerTool from '../customTools/CPRAwareSphereMarkerTool';

const {
  ToolGroupManager,
  Enums: csToolsEnums,
  CrosshairsTool,
  ZoomTool,
  PanTool,
  WindowLevelTool,
} = cornerstoneTools;

const { MouseBindings } = csToolsEnums;

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface HybridCPRViewportProps {
  patientInfo?: {
    patientID?: string;
    patientName?: string;
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
  };
  rootPoints: Point3D[];
  annularPlane?: {
    center: [number, number, number];
    normal: [number, number, number];
    points: Array<{ id: string; position: [number, number, number]; type: string }>;
    confidence: number;
  };
  modifiedCenterline?: Point3D[];
  onAnnulusPointSelected?: (point: Point3D, crossSectionIndex: number) => void;
  onCuspDotsUpdate?: (dots: { id: string; pos: [number, number, number]; color: string; cuspType: string }[]) => void;
  width?: number;
  height?: number;
  backgroundColor?: [number, number, number];
}

// Register volume loader
volumeLoader.registerUnknownVolumeLoader(cornerstoneStreamingImageVolumeLoader);

const HybridCPRViewport: React.FC<HybridCPRViewportProps> = ({
  patientInfo,
  rootPoints,
  annularPlane,
  modifiedCenterline,
  onAnnulusPointSelected,
  onCuspDotsUpdate,
  width = 800,
  height = 600,
  backgroundColor = [0, 0, 0]
}) => {
  const cpr1Ref = useRef<HTMLDivElement>(null);
  const cpr2Ref = useRef<HTMLDivElement>(null);
  const crossSectionRef = useRef<HTMLDivElement>(null);
  
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowLevel, setWindowLevel] = useState({ window: 350, level: 40 }); // CT Angiography
  const [zoom, setZoom] = useState(1.0);
  const [crosshairPosition, setCrosshairPosition] = useState(0.5);
  const [rotationAngle, setRotationAngle] = useState(0);
  const [cuspDots, setCuspDots] = useState<Array<{
    id: string;
    realWorldPos: [number, number, number];
    color: string;
    cuspType: 'left' | 'right' | 'non-coronary';
    placementIndex: number;
  }>>([]);

  // VTK and Cornerstone objects
  const vtkCPRGenerator = useRef<VTKCPRGenerator | null>(null);
  const coordinateConverter = useRef<CPRCoordinateConverter | null>(null);
  const renderingEngine = useRef<RenderingEngine | null>(null);
  const toolGroup = useRef<any>(null);

  // Static IDs
  const toolGroupId = "HYBRID_CPR_TOOLGROUP_ID";
  const renderingEngineId = "hybridCPRRenderingEngine";

  useEffect(() => {
    if (!patientInfo?.seriesInstanceUID || rootPoints.length < 3) return;

    initializeHybridCPRViewport();

    return () => {
      cleanup();
    };
  }, [patientInfo, rootPoints]);

  const cleanup = () => {
    try {
      
      // Clean up VTK objects
      if (vtkCPRGenerator.current) {
        vtkCPRGenerator.current.dispose();
        vtkCPRGenerator.current = null;
      }

      // Clean up tool group
      try {
        const existingToolGroup = ToolGroupManager.getToolGroup(toolGroupId);
        if (existingToolGroup) {
          ToolGroupManager.destroyToolGroup(toolGroupId);
        }
      } catch (error) {
      }

      // Clean up synthetic images
      VTKToCornerstone3DConverter.cleanup('hybrid_cpr');

    } catch (error) {
    }
  };

  const initializeHybridCPRViewport = async () => {
    try {
      setIsLoading(true);
      setError(null);

      await csRenderInit();
      await csToolsInit();
      dicomImageLoaderInit({ maxWebWorkers: 1 });

      
      // Load original DICOM images
      const imageIds = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: patientInfo!.studyInstanceUID!,
        SeriesInstanceUID: patientInfo!.seriesInstanceUID!,
        wadoRsRoot: "http://127.0.0.1/orthanc/dicom-web",
      });

      if (imageIds.length === 0) {
        throw new Error('No DICOM images found for this series');
      }


      // Create volume from DICOM data
      const volumeId = `streamingImageVolume_${Date.now()}`;
      const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds });
      volume.load();

      // Wait for volume to load (increased time for hybrid approach)
      await new Promise(resolve => setTimeout(resolve, 5000)); // Increased to 5 seconds
      
      // Additional debugging for volume state

      
      // Initialize VTK CPR Generator
      vtkCPRGenerator.current = new VTKCPRGenerator();
      
      // Generate centerline from root points
      const centerlinePoints = modifiedCenterline || generateCenterlineFromRootPoints(rootPoints);
      
      // Create VTK ImageData from Cornerstone volume
      const vtkImageData = await createVTKImageDataFromVolume(volume);
      
      // Add timeout wrapper for CPR generation
      const generateCPRWithTimeout = async (imageData: any, centerline: any, width: number, label: string) => {
        return Promise.race([
          vtkCPRGenerator.current!.generateCPR(imageData, centerline, width),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`${label} CPR generation timed out after 30 seconds`)), 30000)
          )
        ]);
      };
      
      // Generate CPR views with timeout protection
      const cpr1Result = await generateCPRWithTimeout(vtkImageData, centerlinePoints, 400, 'CPR1');
      
      vtkCPRGenerator.current.setCPRRotation(90); // Rotate for second view
      const cpr2Result = await generateCPRWithTimeout(vtkImageData, centerlinePoints, 400, 'CPR2');

      vtkCPRGenerator.current.setCPRRotation(0); // Reset rotation
      const crossSectionResult = await generateCPRWithTimeout(vtkImageData, centerlinePoints, 200, 'CrossSection');


      // Convert VTK results to Cornerstone3D format
      
      const cpr1ImageIds = await VTKToCornerstone3DConverter.convertVTKImageToCornerstoneImageIds(
        cpr1Result, 
        'hybrid_cpr_view1'
      );
      
      const cpr2ImageIds = await VTKToCornerstone3DConverter.convertVTKImageToCornerstoneImageIds(
        cpr2Result, 
        'hybrid_cpr_view2'
      );
      
      const crossSectionImageIds = await VTKToCornerstone3DConverter.convertVTKImageToCornerstoneImageIds(
        crossSectionResult, 
        'hybrid_cpr_cross'
      );


      // Set up coordinate converter
      coordinateConverter.current = new CPRCoordinateConverter(cpr1Result.transformData);

      // Setup Cornerstone3D rendering
      await setupCornerstoneRendering({
        cpr1ImageIds,
        cpr2ImageIds,
        crossSectionImageIds
      });

      // Setup tools
      await setupTools();

      setIsInitialized(true);
      setIsLoading(false);


    } catch (err) {
      setError(`Failed to initialize: ${err}`);
      setIsLoading(false);
    }
  };

  const generateCenterlineFromRootPoints = (points: Point3D[]): Point3D[] => {
    if (points.length < 2) return points;
    
    const centerline: Point3D[] = [];
    const numInterpolatedPoints = 50;
    
    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];
      
      for (let j = 0; j < numInterpolatedPoints; j++) {
        const t = j / numInterpolatedPoints;
        centerline.push({
          x: start.x + t * (end.x - start.x),
          y: start.y + t * (end.y - start.y),
          z: start.z + t * (end.z - start.z)
        });
      }
    }
    
    centerline.push(points[points.length - 1]);
    return centerline;
  };

  const createVTKImageDataFromVolume = async (volume: any): Promise<any> => {
    
    const dimensions = volume.dimensions;
    const spacing = volume.spacing;
    const origin = volume.origin;
    
    
    // Enhanced scalar data extraction using same patterns as TriViewCPRViewport
    let scalarData = null;
    let attempts = [];
    
    // Method 1: Try volume.imageData with detailed inspection
    if (volume.imageData) {
      try {
        if (volume.imageData.getPointData && volume.imageData.getPointData().getScalars) {
          const scalars = volume.imageData.getPointData().getScalars();
          if (scalars) {
            scalarData = scalars.getData();
            attempts.push('volume.imageData.getPointData().getScalars().getData() - SUCCESS');
          } else {
            attempts.push('volume.imageData.getPointData().getScalars() - NULL SCALARS');
          }
        } else {
          attempts.push('volume.imageData - NO getPointData() OR getScalars()');
        }
      } catch (e) {
        attempts.push(`volume.imageData access - ERROR: ${e.message}`);
      }
    } else {
      attempts.push('volume.imageData - NOT AVAILABLE');
    }
    
    // Method 2: Try getScalarData() with polling
    if (!scalarData) {
      
      let waitTime = 0;
      const maxWaitTime = 10000; // 10 seconds
      const pollInterval = 500; // Check every 500ms
      
      while (waitTime < maxWaitTime && !scalarData) {
        
        // Try official VoxelManager method first
        try {
          if (volume.voxelManager?.getCompleteScalarDataArray) {
            scalarData = volume.voxelManager.getCompleteScalarDataArray();
            if (scalarData && scalarData.length > 0) {
              attempts.push(`polling getCompleteScalarDataArray() at ${waitTime}ms - SUCCESS (${scalarData.length} voxels)`);
              break;
            }
          }
        } catch (e) {
          if (waitTime % 2000 === 0) { // Log errors every 2 seconds to avoid spam
          }
        }
        
        // Try standard getScalarData as fallback
        try {
          if (volume.getScalarData) {
            scalarData = volume.getScalarData();
            if (scalarData && scalarData.length > 0) {
              attempts.push(`polling getScalarData() at ${waitTime}ms - SUCCESS`);
              break;
            }
          }
        } catch (e) {
          // Still not available
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        waitTime += pollInterval;
      }
    }
    
    // Method 3: Frame reconstruction as last resort
    if (!scalarData) {
      
      try {
        // Check if we have a streaming volume with cached frames
        const streamingVolume = volume;
        
        if (streamingVolume.cachedFrames && Object.keys(streamingVolume.cachedFrames).length > 0) {
          
          const totalVoxels = dimensions[0] * dimensions[1] * dimensions[2];
          scalarData = new Float32Array(totalVoxels);
          
          let voxelIndex = 0;
          let framesProcessed = 0;
          
          for (let i = 0; i < dimensions[2]; i++) {
            const frame = streamingVolume.cachedFrames[i];
            
            if (frame) {
              let frameData = null;
              let pixelDataSource = 'unknown';
              
              // Try multiple ways to access frame pixel data
              if (frame.pixelData && frame.pixelData.length > 0) {
                frameData = frame.pixelData;
                pixelDataSource = 'frame.pixelData';
              } else if (frame.getPixelData && typeof frame.getPixelData === 'function') {
                frameData = frame.getPixelData();
                pixelDataSource = 'frame.getPixelData()';
              } else if (frame.arrayBuffer) {
                frameData = new Uint16Array(frame.arrayBuffer);
                pixelDataSource = 'arrayBuffer->Uint16Array';
              }
              
              if (frameData && frameData.length > 0) {
                const frameSize = dimensions[0] * dimensions[1];
                const pixelsToAdd = Math.min(frameSize, frameData.length, totalVoxels - voxelIndex);
                
                for (let j = 0; j < pixelsToAdd; j++) {
                  scalarData[voxelIndex++] = frameData[j];
                }
                
                framesProcessed++;
              }
            }
          }
          
          if (voxelIndex > 0) {
            attempts.push(`frame reconstruction - SUCCESS (${voxelIndex} voxels from ${framesProcessed} frames)`);
          } else {
            scalarData = null;
            attempts.push('frame reconstruction - NO DATA');
          }
        } else {
          attempts.push('frame reconstruction - NO CACHED FRAMES');
        }
      } catch (frameError) {
        scalarData = null;
        attempts.push(`frame reconstruction - ERROR: ${frameError.message}`);
      }
    }
    
    if (!scalarData) {
      throw new Error(`No scalar data available in volume. Attempted: ${attempts.join(', ')}`);
    }
    
    
    // Create VTK ImageData (simplified - would need proper VTK integration)
    const vtkImageData = {
      getDimensions: () => dimensions,
      getSpacing: () => spacing,
      getOrigin: () => origin,
      getPointData: () => ({
        getScalars: () => ({
          getData: () => scalarData
        })
      })
    };
    
    return vtkImageData;
  };

  const setupCornerstoneRendering = async (imageData: {
    cpr1ImageIds: string[];
    cpr2ImageIds: string[];
    crossSectionImageIds: string[];
  }) => {

    // Create rendering engine
    renderingEngine.current = new RenderingEngine(renderingEngineId);

    // Setup viewports
    const viewports = [
      { id: "cpr1", element: cpr1Ref.current, imageIds: imageData.cpr1ImageIds },
      { id: "cpr2", element: cpr2Ref.current, imageIds: imageData.cpr2ImageIds },
      { id: "crossSection", element: crossSectionRef.current, imageIds: imageData.crossSectionImageIds }
    ];

    viewports.forEach(({ id, element, imageIds }) => {
      if (!element) return;

      renderingEngine.current!.enableElement({
        viewportId: id,
        type: CornerstoneEnums.ViewportType.STACK,
        element,
        defaultOptions: {
          background: backgroundColor,
        },
      });

      const viewport = renderingEngine.current!.getViewport(id) as Types.IStackViewport;
      viewport.setStack(imageIds);
      viewport.render();
    });

  };

  const setupTools = async () => {

    // Add tools
    cornerstoneTools.addTool(CrosshairsTool);
    cornerstoneTools.addTool(ZoomTool);
    cornerstoneTools.addTool(PanTool);
    cornerstoneTools.addTool(WindowLevelTool);
    cornerstoneTools.addTool(CPRAwareSphereMarkerTool);

    // Destroy existing tool group if it exists
    try {
      const existingToolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (existingToolGroup) {
        ToolGroupManager.destroyToolGroup(toolGroupId);
      }
    } catch (error) {
      // Tool group doesn't exist, which is fine
    }

    // Create tool group
    toolGroup.current = ToolGroupManager.createToolGroup(toolGroupId);
    
    if (!toolGroup.current) {
      throw new Error('Failed to create tool group');
    }

    // Configure tools
    toolGroup.current.addTool(ZoomTool.toolName);
    toolGroup.current.addTool(PanTool.toolName);
    toolGroup.current.addTool(WindowLevelTool.toolName);
    toolGroup.current.addTool(CPRAwareSphereMarkerTool.toolName);

    // Set default tool states
    toolGroup.current.setToolActive(ZoomTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Secondary }],
    });
    
    toolGroup.current.setToolActive(CPRAwareSphereMarkerTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Primary }],
    });

    // Setup coordinate-aware sphere tool
    const sphereTool = toolGroup.current.getToolInstance(CPRAwareSphereMarkerTool.toolName);
    if (sphereTool && coordinateConverter.current) {
      sphereTool.setCoordinateConverter(coordinateConverter.current);
      
      if (onCuspDotsUpdate) {
        sphereTool.setPositionUpdateCallback((spheres: any[]) => {
          const dots = spheres.map(sphere => ({
            id: sphere.id,
            pos: [sphere.pos.x, sphere.pos.y, sphere.pos.z] as [number, number, number],
            color: sphere.color,
            cuspType: sphere.cuspType || 'left'
          }));
          onCuspDotsUpdate(dots);
        });
      }
    }

    // Add viewports to tool group
    const viewportIds = ["cpr1", "cpr2", "crossSection"];
    viewportIds.forEach((id) => {
      toolGroup.current!.addViewport(id, renderingEngineId);
    });

  };

  const handleZoom = (factor: number) => {
    setZoom(zoom * factor);
    
    // Zoom all viewports
    const viewportIds = ["cpr1", "cpr2", "crossSection"];
    viewportIds.forEach((id) => {
      try {
        const viewport = renderingEngine.current?.getViewport(id);
        if (viewport) {
          const camera = viewport.getCamera();
          camera.parallelScale = camera.parallelScale / factor;
          viewport.setCamera(camera);
          viewport.render();
        }
      } catch (error) {
      }
    });
  };

  const handleSliceNavigation = (position: number) => {
    setCrosshairPosition(position);
    
    if (vtkCPRGenerator.current && coordinateConverter.current) {
      // Update CPR position
      const newTransformData = vtkCPRGenerator.current.updateCPRPosition(position * 100);
      coordinateConverter.current.updateTransformData(newTransformData);
      
      // Update sphere positions
      const sphereTool = toolGroup.current?.getToolInstance(CPRAwareSphereMarkerTool.toolName);
      if (sphereTool) {
        sphereTool.updateSpherePositions();
      }
    }
  };

  const handleRotation = (angle: number) => {
    setRotationAngle(angle);
    
    if (vtkCPRGenerator.current) {
      vtkCPRGenerator.current.setCPRRotation(angle);
      
      // Force re-render
      const viewportIds = ["cpr1", "cpr2", "crossSection"];
      viewportIds.forEach((id) => {
        const viewport = renderingEngine.current?.getViewport(id);
        if (viewport) {
          viewport.render();
        }
      });
    }
  };

  return (
    <div className="flex flex-col w-full h-full bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-white">
            Hybrid CPR Viewport - VTK + Cornerstone3D
          </h3>
          {patientInfo && (
            <div className="text-sm text-slate-300">
              Patient: {patientInfo.patientName || 'Unknown'}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {/* Navigation Controls */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Slice:</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={crosshairPosition}
              onChange={(e) => handleSliceNavigation(parseFloat(e.target.value))}
              className="w-20 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-xs text-slate-400">{Math.round(crosshairPosition * 100)}%</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Rotate:</span>
            <input
              type="range"
              min="0"
              max="360"
              step="5"
              value={rotationAngle}
              onChange={(e) => handleRotation(parseInt(e.target.value))}
              className="w-20 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-xs text-slate-400">{rotationAngle}°</span>
          </div>

          {/* Tool Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleZoom(1.2)}
              className="p-2 rounded text-sm bg-slate-700 text-slate-300 hover:bg-slate-600"
            >
              <FaSearchPlus />
            </button>
            <button
              onClick={() => handleZoom(0.8)}
              className="p-2 rounded text-sm bg-slate-700 text-slate-300 hover:bg-slate-600"
            >
              <FaSearchMinus />
            </button>
          </div>

          {/* Status */}
          <div className="text-xs text-slate-400">
            Dots: {cuspDots.length}/3 | Zoom: {zoom.toFixed(1)}x
          </div>
        </div>
      </div>

      {/* Loading/Error States */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="flex items-center gap-3 text-white">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <span>Generating Hybrid CPR...</span>
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
                setTimeout(() => initializeHybridCPRViewport(), 100);
              }}
              className="bg-red-700 hover:bg-red-600 px-3 py-1 rounded text-xs"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Three CPR Views */}
      <div className="flex-1 grid grid-cols-3 gap-1 bg-slate-900">
        {/* CPR View 1 */}
        <div className="relative bg-black border border-slate-700">
          <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
            CPR View 1
          </div>
          <div 
            ref={cpr1Ref} 
            className="w-full h-full"
            style={{ minHeight: '300px' }}
          />
        </div>
        
        {/* CPR View 2 */}
        <div className="relative bg-black border border-slate-700">
          <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
            CPR View 2
          </div>
          <div 
            ref={cpr2Ref} 
            className="w-full h-full"
            style={{ minHeight: '300px' }}
          />
        </div>
        
        {/* Cross Section */}
        <div className="relative bg-black border border-slate-700">
          <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
            Cross Section
          </div>
          <div 
            ref={crossSectionRef} 
            className="w-full h-full"
            style={{ minHeight: '300px' }}
          />
        </div>
      </div>
    </div>
  );
};

export default HybridCPRViewport;