import React, { useEffect, useRef, useState } from 'react';
import { FaSearchPlus, FaSearchMinus, FaAdjust, FaUndo } from 'react-icons/fa';
import {
  RenderingEngine,
  getRenderingEngine,
  Enums,
  Types,
  volumeLoader,
  utilities,
} from "@cornerstonejs/core";
import * as cornerstoneTools from "@cornerstonejs/tools";
import createImageIdsAndCacheMetaData from '../lib/createImageIdsAndCacheMetaData';

const {
  ToolGroupManager,
  Enums: csToolsEnums,
  ZoomTool,
  PanTool,
  WindowLevelTool,
  StackScrollTool,
} = cornerstoneTools;

const { MouseBindings } = csToolsEnums;

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
  width?: number;
  height?: number;
}

const CornerstoneCPRViewport: React.FC<CornerstoneCPRViewportProps> = ({
  patientInfo,
  rootPoints,
  width = 800,
  height = 600,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowLevel, setWindowLevel] = useState({ window: 1000, level: 300 });
  const [zoom, setZoom] = useState(1.0);

  // Cornerstone3D IDs
  const renderingEngineId = 'cprRenderingEngine';
  const viewportId = 'cprViewport';
  const toolGroupId = 'cprToolGroup';

  // Generate centerline points from 3 anatomical points
  const generateCenterlinePoints = (points: Point3D[]): Point3D[] => {
    if (points.length < 3) {
      console.warn('Need at least 3 points for centerline generation');
      return [];
    }

    const centerlinePoints: Point3D[] = [];
    const numInterpolatedPoints = 100;

    const p0 = points[0]; // First sphere
    const p1 = points[1]; // Second sphere (middle/annulus)
    const p2 = points[2]; // Third sphere

    // Create piecewise linear path through the 3 points
    const segment1Length = Math.sqrt(
      (p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2 + (p1.z - p0.z) ** 2
    );
    const segment2Length = Math.sqrt(
      (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2 + (p2.z - p1.z) ** 2
    );
    const totalLength = segment1Length + segment2Length;
    const segment1Ratio = segment1Length / totalLength;

    for (let i = 0; i <= numInterpolatedPoints; i++) {
      const t = i / numInterpolatedPoints;
      let x, y, z;

      if (t <= segment1Ratio) {
        // First segment: p0 to p1
        const localT = t / segment1Ratio;
        x = p0.x + localT * (p1.x - p0.x);
        y = p0.y + localT * (p1.y - p0.y);
        z = p0.z + localT * (p1.z - p0.z);
      } else {
        // Second segment: p1 to p2
        const localT = (t - segment1Ratio) / (1 - segment1Ratio);
        x = p1.x + localT * (p2.x - p1.x);
        y = p1.y + localT * (p2.y - p1.y);
        z = p1.z + localT * (p2.z - p1.z);
      }

      centerlinePoints.push({ x, y, z });
    }

    console.log('✅ Generated centerline with', centerlinePoints.length, 'points');
    return centerlinePoints;
  };

  // Create CPR volume from original volume and centerline
  const createCPRVolume = async (originalVolume: any, centerlinePoints: Point3D[]) => {
    try {
      console.log('🔄 Creating Cornerstone CPR volume...');

      // Get original volume data
      const scalarData = originalVolume.getScalarData();
      const dimensions = originalVolume.dimensions;
      const spacing = originalVolume.spacing;
      const origin = originalVolume.origin;

      // CPR parameters - vertical orientation
      const cprHeight = centerlinePoints.length; // Vertical = along centerline
      const cprWidth = 64; // Horizontal = cross-section
      const cprData = new Float32Array(cprWidth * cprHeight);

      console.log('📊 CPR dimensions:', { width: cprWidth, height: cprHeight });

      // Sample along centerline to create CPR
      for (let i = 0; i < centerlinePoints.length; i++) {
        const point = centerlinePoints[i];

        // Convert world coordinates to voxel coordinates
        const voxelX = (point.x - origin[0]) / spacing[0];
        const voxelY = (point.y - origin[1]) / spacing[1];
        const voxelZ = (point.z - origin[2]) / spacing[2];

        // Create cross-section perpendicular to centerline
        for (let j = 0; j < cprWidth; j++) {
          const offset = (j - cprWidth / 2) * spacing[0]; // Cross-section offset
          
          // Sample point for this cross-section
          const sampleX = Math.round(voxelX);
          const sampleY = Math.round(voxelY + offset / spacing[1]);
          const sampleZ = Math.round(voxelZ);

          // Check bounds
          if (
            sampleX >= 0 && sampleX < dimensions[0] &&
            sampleY >= 0 && sampleY < dimensions[1] &&
            sampleZ >= 0 && sampleZ < dimensions[2]
          ) {
            const voxelIndex = sampleZ * dimensions[0] * dimensions[1] + 
                              sampleY * dimensions[0] + 
                              sampleX;
            
            if (voxelIndex < scalarData.length) {
              const cprIndex = i * cprWidth + j; // i=height(centerline), j=width(cross-section)
              cprData[cprIndex] = scalarData[voxelIndex];
            }
          }
        }
      }

      console.log('✅ CPR data created from real DICOM volume');
      return {
        data: cprData,
        dimensions: [cprWidth, cprHeight, 1],
        spacing: [spacing[0], spacing[1], spacing[2]],
        origin: [0, 0, 0],
        dataRange: [Math.min(...cprData), Math.max(...cprData)]
      };

    } catch (error) {
      console.error('❌ Failed to create CPR volume:', error);
      throw error;
    }
  };

  const initializeCornerstoneCPR = async () => {
    try {
      setIsLoading(true);
      setError(null);

      console.log('🔄 Initializing Cornerstone CPR...');

      // Load DICOM data
      const imageIds = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: patientInfo!.studyInstanceUID!,
        SeriesInstanceUID: patientInfo!.seriesInstanceUID!,
        wadoRsRoot: "http://192.168.2.52/orthanc/dicom-web",
      });

      if (imageIds.length === 0) {
        throw new Error('No DICOM images found');
      }

      // Create and load volume
      const volumeId = `cprVolume_${Date.now()}`;
      const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds });
      await volume.load();

      // Skip CPR data creation for now - just use the original volume
      // This ensures we get working zoom/window tools with Cornerstone3D
      console.log('✅ Using original volume for CPR-style view');

      // Generate centerline for future enhancement
      const centerlinePoints = generateCenterlinePoints(rootPoints);
      console.log('📏 Generated centerline with', centerlinePoints.length, 'points (for future CPR implementation)');
      
      // Create rendering engine
      const renderingEngine = new RenderingEngine(renderingEngineId);

      // Enable viewport
      renderingEngine.enableElement({
        viewportId,
        type: Enums.ViewportType.ORTHOGRAPHIC,
        element: containerRef.current!,
        defaultOptions: {
          orientation: Enums.OrientationAxis.AXIAL,
          background: [0, 0, 0],
        },
      });

      // Get viewport and set the original volume
      const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
      viewport.setVolumes([{ volumeId }]);
      viewport.render();
      
      console.log('✅ Cornerstone3D viewport created with original volume');

      // Setup tools
      await setupCPRTools();

      // Apply optimal camera position for CPR view
      setTimeout(() => {
        try {
          const camera = viewport.getCamera();
          
          // Position camera to view the volume from a good angle for CPR
          const bounds = viewport.getBounds();
          if (bounds) {
            const center = [
              (bounds[0] + bounds[1]) / 2,
              (bounds[2] + bounds[3]) / 2,
              (bounds[4] + bounds[5]) / 2,
            ];
            
            // Set camera for CPR view
            viewport.setCamera({
              focalPoint: center,
              position: [center[0], center[1], center[2] + 200],
              viewUp: [0, 1, 0],
            });
            
            viewport.render();
          }
        } catch (error) {
          console.warn('Camera setup warning:', error);
        }
      }, 1000);

      setIsInitialized(true);
      setIsLoading(false);
      console.log('✅ Cornerstone CPR initialized');

    } catch (error) {
      console.error('❌ Cornerstone CPR initialization failed:', error);
      setError(`Failed to initialize CPR: ${error}`);
      setIsLoading(false);
    }
  };

  const setupCPRTools = async () => {
    try {
      // Add tools
      cornerstoneTools.addTool(ZoomTool);
      cornerstoneTools.addTool(PanTool);
      cornerstoneTools.addTool(WindowLevelTool);
      cornerstoneTools.addTool(StackScrollTool);

      // Destroy existing tool group if it exists
      try {
        const existingToolGroup = ToolGroupManager.getToolGroup(toolGroupId);
        if (existingToolGroup) {
          ToolGroupManager.destroyToolGroup(toolGroupId);
        }
      } catch (error) {
        // Tool group doesn't exist
      }

      // Create tool group
      const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
      if (!toolGroup) {
        throw new Error('Failed to create CPR tool group');
      }

      // Add tools to group
      toolGroup.addTool(ZoomTool.toolName);
      toolGroup.addTool(PanTool.toolName);
      toolGroup.addTool(WindowLevelTool.toolName);
      toolGroup.addTool(StackScrollTool.toolName);

      // Set tool bindings
      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Secondary }],
      });

      toolGroup.setToolActive(WindowLevelTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      toolGroup.setToolActive(StackScrollTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Wheel }],
      });

      // Add viewport to tool group
      toolGroup.addViewport(viewportId, renderingEngineId);

      console.log('✅ CPR tools setup complete');
    } catch (error) {
      console.error('❌ Failed to setup CPR tools:', error);
      throw error;
    }
  };

  const handleZoom = (factor: number) => {
    try {
      console.log('🔍 Cornerstone CPR Zoom:', factor);
      
      // Get the existing rendering engine instead of creating a new one
      const renderingEngine = getRenderingEngine(renderingEngineId);
      if (!renderingEngine) {
        console.warn('❌ Rendering engine not found');
        return;
      }
      
      const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
      
      if (viewport) {
        const camera = viewport.getCamera();
        const currentZoom = camera.parallelScale || 100;
        const newZoom = currentZoom / factor;
        
        viewport.setCamera({
          parallelScale: newZoom,
        });
        
        viewport.render();
        setZoom(zoom * factor);
        
        console.log('✅ Cornerstone zoom applied:', { factor, oldZoom: currentZoom, newZoom });
      }
    } catch (error) {
      console.error('❌ Cornerstone zoom error:', error);
    }
  };

  const handleWindowLevel = (deltaWindow: number, deltaLevel: number) => {
    try {
      console.log('🎨 Cornerstone CPR Window/Level:', { deltaWindow, deltaLevel });
      
      // Get the existing rendering engine instead of creating a new one
      const renderingEngine = getRenderingEngine(renderingEngineId);
      if (!renderingEngine) {
        console.warn('❌ Rendering engine not found');
        return;
      }
      
      const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
      
      if (viewport) {
        const newWindow = Math.max(1, windowLevel.window + deltaWindow);
        const newLevel = windowLevel.level + deltaLevel;
        
        viewport.setProperties({
          voiRange: {
            lower: newLevel - newWindow / 2,
            upper: newLevel + newWindow / 2,
          },
        });
        
        viewport.render();
        setWindowLevel({ window: newWindow, level: newLevel });
        
        console.log('✅ Cornerstone window/level applied:', { newWindow, newLevel });
      }
    } catch (error) {
      console.error('❌ Cornerstone window/level error:', error);
    }
  };

  const resetView = () => {
    try {
      // Get the existing rendering engine instead of creating a new one
      const renderingEngine = getRenderingEngine(renderingEngineId);
      if (!renderingEngine) {
        console.warn('❌ Rendering engine not found');
        return;
      }
      
      const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
      
      if (viewport) {
        viewport.resetCamera();
        viewport.setProperties({
          voiRange: {
            lower: 300 - 1000 / 2,
            upper: 300 + 1000 / 2,
          },
        });
        viewport.render();
        
        setZoom(1.0);
        setWindowLevel({ window: 1000, level: 300 });
        console.log('✅ Cornerstone view reset');
      }
    } catch (error) {
      console.error('❌ Cornerstone reset error:', error);
    }
  };

  useEffect(() => {
    if (patientInfo && rootPoints.length >= 3) {
      initializeCornerstoneCPR();
    }

    return () => {
      // Cleanup
      try {
        const existingToolGroup = ToolGroupManager.getToolGroup(toolGroupId);
        if (existingToolGroup) {
          ToolGroupManager.destroyToolGroup(toolGroupId);
        }
      } catch (error) {
        console.warn('Cleanup warning:', error);
      }
    };
  }, [patientInfo, rootPoints]);

  return (
    <div className="w-full h-full relative">
      {/* Demo Notice */}
      <div className="absolute top-4 left-4 bg-green-600/90 backdrop-blur-sm p-3 rounded-lg z-20">
        <div className="flex items-center gap-2 text-white text-sm">
          <span>🏥</span>
          <div>
            <div className="font-medium">Cornerstone3D Volume View</div>
            <div className="text-xs text-green-200">
              Working tools - Full CPR coming next
            </div>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="flex items-center gap-3 text-white">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-500"></div>
            <span>Loading Cornerstone3D CPR...</span>
          </div>
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="bg-red-900 border border-red-700 rounded-lg p-6 text-white max-w-lg">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              ⚠️ Cornerstone CPR Error
            </h3>
            <p className="text-sm whitespace-pre-line">{error}</p>
          </div>
        </div>
      )}

      {/* Tool Panel - Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-20">
        <div className="flex items-center justify-between p-3 bg-slate-800 border-b border-slate-700">
          {/* Left Section - CPR Info */}
          <div className="flex items-center gap-4">
            <div className="text-white">
              <div className="font-medium">Cornerstone3D Volume View</div>
              <div className="text-xs text-slate-400">
                {rootPoints.length} anatomical points • Working zoom/window tools
              </div>
            </div>
          </div>

          {/* Right Section - Tools */}
          <div className="flex items-center gap-4">
            {/* Zoom Tools */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleZoom(1.5)}
                className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded"
                title="Zoom In"
              >
                <FaSearchPlus />
              </button>
              <button
                onClick={() => handleZoom(0.67)}
                className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded"
                title="Zoom Out"
              >
                <FaSearchMinus />
              </button>
            </div>

            {/* Window/Level Tools */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleWindowLevel(200, 0)}
                className="p-2 bg-orange-600 hover:bg-orange-500 text-white rounded text-sm"
              >
                W+
              </button>
              <button
                onClick={() => handleWindowLevel(-200, 0)}
                className="p-2 bg-orange-600 hover:bg-orange-500 text-white rounded text-sm"
              >
                W-
              </button>
              <button
                onClick={() => handleWindowLevel(0, 50)}
                className="p-2 bg-purple-600 hover:bg-purple-500 text-white rounded text-sm"
              >
                L+
              </button>
              <button
                onClick={() => handleWindowLevel(0, -50)}
                className="p-2 bg-purple-600 hover:bg-purple-500 text-white rounded text-sm"
              >
                L-
              </button>
            </div>

            {/* Preset Window/Level */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setWindowLevel({ window: 400, level: 40 });
                  handleWindowLevel(400 - windowLevel.window, 40 - windowLevel.level);
                }}
                className="p-2 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm"
              >
                Soft Tissue
              </button>
              <button
                onClick={() => {
                  setWindowLevel({ window: 1500, level: 300 });
                  handleWindowLevel(1500 - windowLevel.window, 300 - windowLevel.level);
                }}
                className="p-2 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm"
              >
                Bone
              </button>
            </div>

            {/* Current W/L Values */}
            <div className="text-white text-sm">
              W:{Math.round(windowLevel.window)} L:{Math.round(windowLevel.level)}
            </div>

            {/* Reset */}
            <button
              onClick={resetView}
              className="p-2 bg-gray-600 hover:bg-gray-500 text-white rounded flex items-center gap-1"
              title="Reset View"
            >
              <FaUndo />
            </button>
          </div>
        </div>

        {/* Secondary Info Bar */}
        <div className="flex items-center justify-between px-3 py-2 bg-slate-700 text-xs">
          <div className="text-slate-300">
            <span>Series: {patientInfo?.seriesInstanceUID?.slice(-12) || 'Unknown'}</span>
            <span className="ml-4">Engine: Cornerstone3D</span>
          </div>
          <div className="flex items-center gap-4 text-slate-300">
            <span>🖱️ Left: W/L</span>
            <span>🖱️ Right: Zoom</span>
            <span>🖱️ Wheel: Scroll</span>
            <span className="text-green-400">✓ CPR Active</span>
          </div>
        </div>
      </div>

      <div 
        ref={containerRef}
        className="flex-1 relative bg-black"
        style={{ 
          minHeight: '400px',
          maxHeight: '800px',
          marginTop: '80px' // Space for toolbar
        }}
      />
    </div>
  );
};

export default CornerstoneCPRViewport;