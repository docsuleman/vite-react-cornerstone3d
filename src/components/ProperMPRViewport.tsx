import React, { useEffect, useRef, useState } from 'react';
import createImageIdsAndCacheMetaData from '../lib/createImageIdsAndCacheMetaData';
import {
  RenderingEngine,
  Enums,
  Types,
  volumeLoader,
  cornerstoneStreamingImageVolumeLoader,
} from "@cornerstonejs/core";
import { init as csRenderInit } from "@cornerstonejs/core";
import { init as csToolsInit } from "@cornerstonejs/tools";
import { init as dicomImageLoaderInit } from "@cornerstonejs/dicom-image-loader";
import * as cornerstoneTools from "@cornerstonejs/tools";
import { initializeCornerstone, isCornerStoneInitialized } from '../utils/cornerstoneInit';
import { FaCrosshairs, FaSearchPlus, FaArrowsAlt, FaAdjust, FaCircle, FaMousePointer, FaScroll, FaTrash, FaDotCircle } from "react-icons/fa";
import SphereMarkerTool from '../customTools/Spheremarker';
import CuspNadirTool from '../customTools/CuspNadirTool';
import { WorkflowStage } from '../types/WorkflowTypes';

const {
  ToolGroupManager,
  Enums: csToolsEnums,
  CrosshairsTool,
  ZoomTool,
  PanTool,
  WindowLevelTool,
  StackScrollTool,
  synchronizers,
} = cornerstoneTools;

const { createSlabThicknessSynchronizer, createCameraPositionSynchronizer, getSynchronizer } = synchronizers;
const { MouseBindings } = csToolsEnums;

// Register volume loader
volumeLoader.registerUnknownVolumeLoader(cornerstoneStreamingImageVolumeLoader);

interface ProperMPRViewportProps {
  patientInfo?: {
    patientID?: string;
    patientName?: string;
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
  };
  onImageLoaded?: (imageData: any) => void;
  onSpherePositionsUpdate?: (spheres: { id: string; pos: [number, number, number]; color: string }[]) => void;
  onCuspDotsUpdate?: (dots: { id: string; pos: [number, number, number]; color: string; cuspType: string }[]) => void;
  currentStage?: WorkflowStage;
}

const ProperMPRViewport: React.FC<ProperMPRViewportProps> = ({ 
  patientInfo,
  onImageLoaded,
  onSpherePositionsUpdate,
  onCuspDotsUpdate,
  currentStage 
}) => {
  const elementRefs = {
    axial: useRef(null),
    sagittal: useRef(null),
    coronal: useRef(null),
  };

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageInfo, setImageInfo] = useState<any>(null);
  const [activeTool, setActiveTool] = useState<string>('Zoom');
  const [windowLevel, setWindowLevel] = useState({ window: 400, level: 40 });
  const running = useRef(false);

  // Use static IDs like App.tsx
  const toolGroupId = "MPR_TOOLGROUP_ID";
  const renderingEngineId = "mprRenderingEngine";
  const synchronizerId = "MPR_SLAB_THICKNESS_SYNCHRONIZER_ID";
  const cameraPositionSynchronizerId = "MPR_CAMERA_POSITION_SYNCHRONIZER_ID";

  useEffect(() => {
    if (!patientInfo?.seriesInstanceUID) return;

    console.log('🔄 Stage changed to:', currentStage, '- Initializing Simple MPR Viewport');
    console.log('🔄 Is annulus definition stage?', currentStage === WorkflowStage.ANNULUS_DEFINITION);
    initializeMPRViewport();

    // Cleanup function
    return () => {
      cleanup();
    };
  }, [patientInfo, currentStage]);

  const cleanup = () => {
    if (!running.current) {
      return;
    }
    
    try {
      console.log('🧹 Cleaning up MPR Viewport...');
      
      // Clean up synchronizer
      try {
        const existingSynchronizer = getSynchronizer(synchronizerId);
        if (existingSynchronizer) {
          existingSynchronizer.destroy();
        }
      } catch (error) {
        console.warn('Failed to destroy synchronizer:', error);
      }
      
      // Clean up tool group
      try {
        const existingToolGroup = ToolGroupManager.getToolGroup(toolGroupId);
        if (existingToolGroup) {
          ToolGroupManager.destroyToolGroup(toolGroupId);
        }
      } catch (error) {
        console.warn('Failed to destroy tool group:', error);
      }

      console.log('✅ MPR Viewport cleanup complete');
    } catch (error) {
      console.warn('Cleanup error:', error);
    }
  };

  const initializeMPRViewport = async () => {
    if (running.current) {
      return;
    }
    running.current = true;

    try {
      setIsLoading(true);
      setError(null);

      console.log('🔄 Checking if already initialized...');

      // Check if already initialized - if so, skip init
      let needsInit = false;
      try {
        const existingEngine = renderingEngineId && 
          document.querySelector(`[data-viewport-uid*="${renderingEngineId}"]`);
        if (!existingEngine) {
          needsInit = true;
        }
      } catch {
        needsInit = true;
      }

      if (needsInit) {
        console.log('🔄 Initializing Cornerstone3D...');
        await csRenderInit();
        await csToolsInit();
        dicomImageLoaderInit({ maxWebWorkers: 1 });
      }

      console.log('🔍 Loading DICOM images...');

      // Load DICOM images using the same method as App.tsx
      const imageIds = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: patientInfo!.studyInstanceUID!,
        SeriesInstanceUID: patientInfo!.seriesInstanceUID!,
        wadoRsRoot: "http://127.0.0.1/orthanc/dicom-web",
      });

      if (imageIds.length === 0) {
        throw new Error('No DICOM images found for this series');
      }

      console.log(`📋 Found ${imageIds.length} DICOM images`);

      // Create rendering engine (exactly like App.tsx)
      const renderingEngine = new RenderingEngine(renderingEngineId);
      
      // Create volume (exactly like App.tsx)
      const volumeId = `streamingImageVolume_${Date.now()}`;
      const volume = await volumeLoader.createAndCacheVolume(volumeId, {
        imageIds,
      });
      volume.load();

      // Setup viewports (exactly like App.tsx)
      const viewports = [
        { id: "axial", orientation: Enums.OrientationAxis.AXIAL },
        { id: "sagittal", orientation: Enums.OrientationAxis.SAGITTAL },
        { id: "coronal", orientation: Enums.OrientationAxis.CORONAL },
      ];

      // Enable viewports and set volumes (exactly like App.tsx)
      viewports.forEach(({ id, orientation }) => {
        renderingEngine.enableElement({
          viewportId: id,
          type: Enums.ViewportType.ORTHOGRAPHIC,
          element: elementRefs[id].current,
          defaultOptions: { 
            orientation,
            background: [0, 0, 0]
          },
        });

        const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
        viewport.setVolumes([{ volumeId }]);
        viewport.render();
      });

      // Setup tools first
      await setupTools();

      // Camera fitting after a delay - ensure consistent zoom across all viewports
      setTimeout(() => {
        try {
          // Calculate camera settings once based on the first viewport for consistency
          const firstViewport = renderingEngine.getViewport("axial") as Types.IVolumeViewport;
          firstViewport.resetCamera();
          
          const bounds = firstViewport.getBounds();
          const canvas = firstViewport.getCanvas();
          
          let commonParallelScale = 100; // Smaller scale for better zoom
          
          if (bounds && canvas) {
            const { width: canvasWidth, height: canvasHeight } = canvas;
            const [xMin, xMax, yMin, yMax, zMin, zMax] = bounds;
            const imageWidth = Math.abs(xMax - xMin);
            const imageHeight = Math.abs(yMax - yMin);
            
            // Better scaling calculation to fill viewports
            const scaleX = canvasWidth / imageWidth;
            const scaleY = canvasHeight / imageHeight;
            const scale = Math.min(scaleX, scaleY) * 0.8; // Fill more of the viewport
            commonParallelScale = Math.max(imageWidth, imageHeight) / (2 * scale);
            
            console.log(`📏 Calculated scale: imageWidth=${imageWidth}, imageHeight=${imageHeight}, scale=${scale}, parallelScale=${commonParallelScale}`);
          }
          
          // Apply the same camera settings to ALL viewports for consistent zoom and positioning
          viewports.forEach(({ id }) => {
            const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
            viewport.resetCamera();
            
            // Set consistent camera with proper fitting
            viewport.setCamera({
              parallelScale: commonParallelScale,
            });
            
            // Additional viewport fitting to reduce black space
            try {
              const bounds = viewport.getBounds();
              if (bounds) {
                viewport.fitToCanvas();
              }
            } catch (error) {
              console.warn(`Viewport ${id} fitToCanvas failed:`, error);
            }
            
            viewport.render();
            console.log(`📷 Set camera for viewport ${id}: parallelScale=${commonParallelScale}`);
          });
          
          console.log(`📷 Applied consistent camera settings (parallelScale: ${commonParallelScale})`);
        } catch (error) {
          console.warn('Error setting consistent camera:', error);
          // Fallback: individual reset
          viewports.forEach(({ id }) => {
            const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
            viewport.resetCamera();
            viewport.render();
          });
        }
      }, 2000);

      setImageInfo({
        width: 512,
        height: 512,
        numberOfImages: imageIds.length,
        seriesInstanceUID: patientInfo?.seriesInstanceUID,
        volumeId: volumeId,
        status: 'MPR Viewport Active'
      });

      if (onImageLoaded) {
        onImageLoaded({ imageIds, volume });
      }

      console.log('✅ MPR Viewport initialized successfully!');
      setIsLoading(false);

    } catch (err) {
      console.error('❌ Failed to initialize MPR Viewport:', err);
      setError(`Failed to load DICOM images: ${err}`);
      setIsLoading(false);
    }
  };

  const setupTools = async () => {
    try {
      // Add tools to Cornerstone3D (exactly like App.tsx)
      cornerstoneTools.addTool(CrosshairsTool);
      cornerstoneTools.addTool(ZoomTool);
      cornerstoneTools.addTool(PanTool);
      cornerstoneTools.addTool(WindowLevelTool);
      cornerstoneTools.addTool(StackScrollTool);
      cornerstoneTools.addTool(SphereMarkerTool);
      cornerstoneTools.addTool(CuspNadirTool);

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
      const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
      
      if (!toolGroup) {
        throw new Error('Failed to create tool group');
      }

      // Add Crosshairs tool and configure it to link the three viewports (exactly like App.tsx)
      toolGroup.addTool(CrosshairsTool.toolName, {
        getReferenceLineColor: (viewportId) => {
          const colors = {
            axial: "rgb(200, 0, 0)",
            sagittal: "rgb(200, 200, 0)",
            coronal: "rgb(0, 200, 0)",
          };
          return colors[viewportId];
        },
        getReferenceLineControllable: () => true,
        getReferenceLineDraggableRotatable: () => true,
        getReferenceLineSlabThicknessControlsOn: () => true,
      });
      toolGroup.setToolActive(CrosshairsTool.toolName, {
        bindings: [
         {
            mouseButton: MouseBindings.Primary, // Left Click
          },
        ],
      });

      toolGroup.addTool(ZoomTool.toolName, {
        invert: false,
        preventZoomOutsideImage: true,
      });

      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [
         {
            mouseButton: MouseBindings.Secondary, // Right Click
          },
        ],
      });

      toolGroup.addTool(PanTool.toolName);

      toolGroup.addTool(CrosshairsTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      toolGroup.addTool(WindowLevelTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      toolGroup.addTool(StackScrollTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });
      toolGroup.setToolActive(StackScrollTool.toolName, {
        bindings: [
          {
            mouseButton: MouseBindings.Wheel,
          }
        ]
      });

      toolGroup.addTool(SphereMarkerTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      // Add CuspNadirTool for cusp nadir point identification
      toolGroup.addTool(CuspNadirTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      // Set up callback for sphere position updates
      if (onSpherePositionsUpdate) {
        const sphereTool = toolGroup.getToolInstance(SphereMarkerTool.toolName) as SphereMarkerTool;
        if (sphereTool) {
          sphereTool.setPositionUpdateCallback((spheres) => {
            onSpherePositionsUpdate(spheres);
          });
        }
      }

      // Set up callback for cusp dots position updates
      if (onCuspDotsUpdate) {
        const cuspTool = toolGroup.getToolInstance(CuspNadirTool.toolName) as CuspNadirTool;
        if (cuspTool) {
          cuspTool.setPositionUpdateCallback((dots) => {
            onCuspDotsUpdate(dots);
          });
        }
      }

      // Add viewports to the tool group (exactly like App.tsx)
      const viewportIds = ["axial", "sagittal", "coronal"];
      viewportIds.forEach((id) => {
        toolGroup.addViewport(id, renderingEngineId);
      });

      // Set up synchronizers (exactly like App.tsx)
      const synchronizer = createSlabThicknessSynchronizer(synchronizerId);
      viewportIds.forEach((id) => {
        synchronizer.add({
          renderingEngineId,
          viewportId: id,
        });
      });
      synchronizer.setEnabled(true);

      console.log('✅ Tools setup complete (App.tsx pattern)');
    } catch (error) {
      console.error('❌ Failed to setup tools:', error);
      throw error;
    }
  };

  const handleToolChange = (toolName: string) => {
    try {
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (!toolGroup) return;

      // Set all tools to passive first
      toolGroup.setToolPassive(CrosshairsTool.toolName);
      toolGroup.setToolPassive(ZoomTool.toolName);
      toolGroup.setToolPassive(PanTool.toolName);
      toolGroup.setToolPassive(SphereMarkerTool.toolName);
      toolGroup.setToolPassive(CuspNadirTool.toolName);
      toolGroup.setToolPassive(WindowLevelTool.toolName);
      
      // Always keep these tools active with their default bindings
      toolGroup.setToolActive(StackScrollTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Wheel }],
      });
      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Secondary }],
      });
      
      // Activate selected tool
      if (toolName === 'SphereMarker') {
        toolGroup.setToolActive(SphereMarkerTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });
      } else if (toolName === 'CuspNadir') {
        console.log('🎯 Activating CuspNadir tool');
        toolGroup.setToolActive(CuspNadirTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });
      } else if (toolName === 'Zoom') {
        toolGroup.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });
      } else if (toolName === 'Pan') {
        toolGroup.setToolActive(PanTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });
      } else if (toolName === 'Crosshairs') {
        toolGroup.setToolActive(CrosshairsTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });
      } else if (toolName === 'WindowLevel') {
        toolGroup.setToolActive(WindowLevelTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });
      }
      
      setActiveTool(toolName);
    } catch (error) {
      console.warn('Tool change error:', error);
    }
  };

  const handleClearSpheres = () => {
    try {
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (!toolGroup) return;
      
      const sphereTool = toolGroup.getToolInstance(SphereMarkerTool.toolName) as SphereMarkerTool;
      if (sphereTool) {
        sphereTool.clearAll();
        console.log('🧹 Cleared all spheres and connection lines');
      }
    } catch (error) {
      console.warn('Clear spheres error:', error);
    }
  };

  const handleClearCuspDots = () => {
    try {
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (!toolGroup) return;
      
      const cuspTool = toolGroup.getToolInstance(CuspNadirTool.toolName) as CuspNadirTool;
      if (cuspTool) {
        cuspTool.clearAll();
        console.log('🧹 Cleared all cusp nadir dots');
      }
    } catch (error) {
      console.warn('Clear cusp dots error:', error);
    }
  };

  // Handle stage changes to lock/unlock tools
  useEffect(() => {
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    if (!toolGroup) return;

    const sphereTool = toolGroup.getToolInstance(SphereMarkerTool.toolName) as SphereMarkerTool;
    const cuspTool = toolGroup.getToolInstance(CuspNadirTool.toolName) as CuspNadirTool;

    if (currentStage === WorkflowStage.ANNULUS_DEFINITION) {
      // Lock sphere tool, unlock cusp tool
      if (sphereTool && typeof sphereTool.setDraggable === 'function') {
        sphereTool.setDraggable(false);
      }
      if (cuspTool) {
        cuspTool.setDraggable(true);
      }
      console.log('🔒 Stage: Annulus Definition - Locked spheres, unlocked cusp dots');
    } else {
      // Unlock sphere tool, lock cusp tool
      if (sphereTool && typeof sphereTool.setDraggable === 'function') {
        sphereTool.setDraggable(true);
      }
      if (cuspTool) {
        cuspTool.setDraggable(false);
      }
    }
  }, [currentStage]);

  const handleWindowLevelChange = (window: number, level: number) => {
    try {
      setWindowLevel({ window, level });
      
      // Apply window/level to all viewports
      const viewportIds = ["axial", "sagittal", "coronal"];
      const renderingEngine = new RenderingEngine(renderingEngineId);
      
      viewportIds.forEach((id) => {
        try {
          const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
          if (viewport) {
            viewport.setProperties({
              voiRange: {
                lower: level - window / 2,
                upper: level + window / 2,
              },
            });
            viewport.render();
          }
        } catch (error) {
          console.warn(`Failed to set W/L for viewport ${id}:`, error);
        }
      });
      
      console.log(`📊 Applied W/L: Window=${window}, Level=${level}`);
    } catch (error) {
      console.warn('Window/Level error:', error);
    }
  };

  return (
    <div className="flex flex-col w-full h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-4">
          {patientInfo && (
            <div className="text-sm">
              <span className="text-slate-300">Patient: </span>
              <span className="text-white font-medium">{patientInfo.patientName || 'Unknown'}</span>
              <span className="text-slate-400 ml-2">({patientInfo.patientID || 'Unknown ID'})</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {/* Tool Selection */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-300">Tools:</span>
            <button
              onClick={() => handleToolChange('Crosshairs')}
              className={`p-2 rounded text-sm flex items-center gap-1 ${activeTool === 'Crosshairs' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              <FaCrosshairs />
              Crosshairs
            </button>
            <button
              onClick={() => handleToolChange('WindowLevel')}
              className={`p-2 rounded text-sm flex items-center gap-1 ${activeTool === 'WindowLevel' ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              <FaAdjust />
              W/L
            </button>
            <button
              onClick={() => handleToolChange('SphereMarker')}
              className={`p-2 rounded text-sm flex items-center gap-1 ${activeTool === 'SphereMarker' ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              <FaCircle />
              Sphere
            </button>
            {/* Show CuspNadir tool only during annulus definition stage */}
            {currentStage === WorkflowStage.ANNULUS_DEFINITION && (
              <button
                onClick={() => handleToolChange('CuspNadir')}
                className={`p-2 rounded text-sm flex items-center gap-1 ${activeTool === 'CuspNadir' ? 'bg-teal-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
              >
                <FaDotCircle />
                Cusp Dots
              </button>
            )}
            <button
              onClick={() => handleToolChange('Zoom')}
              className={`p-2 rounded text-sm flex items-center gap-1 ${activeTool === 'Zoom' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              <FaSearchPlus />
              Zoom
            </button>
            <button
              onClick={() => handleToolChange('Pan')}
              className={`p-2 rounded text-sm flex items-center gap-1 ${activeTool === 'Pan' ? 'bg-yellow-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              <FaArrowsAlt />
              Pan
            </button>
          </div>
          
          {/* Always Active Tools Info */}
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <FaScroll />
              Scroll: Mouse Wheel
            </span>
            <span className="flex items-center gap-1">
              <FaMousePointer />
              Zoom: Right Click
            </span>
          </div>

          {/* Window/Level Presets */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-300">W/L:</span>
            <button
              onClick={() => handleWindowLevelChange(400, 40)}
              className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-white text-sm"
            >
              Soft Tissue
            </button>
            <button
              onClick={() => handleWindowLevelChange(1500, 300)}
              className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-white text-sm"
            >
              Bone
            </button>
            <button
              onClick={() => handleWindowLevelChange(2000, 0)}
              className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-white text-sm"
            >
              Lung
            </button>
            <span className="text-xs text-slate-400">
              W:{windowLevel.window} L:{windowLevel.level}
            </span>
          </div>
        </div>
      </div>

      {/* Image Info */}
      {imageInfo && !isLoading && (
        <div className="px-3 py-2 bg-slate-900 border-b border-slate-700 text-xs text-slate-400">
          <span className="mr-4">
            Series: {patientInfo?.seriesInstanceUID}
          </span>
          <span className="mr-4">
            Images: {imageInfo.numberOfImages}
          </span>
          <span className="mr-4">
            Volume: {imageInfo.volumeId}
          </span>
          <span className="text-green-400">
            {imageInfo.status}
          </span>
        </div>
      )}

      {/* MPR Viewports */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
            <div className="flex items-center gap-3 text-white">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <span>Loading DICOM Volume (Simple Pattern)...</span>
            </div>
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
            <div className="bg-red-900 border border-red-700 rounded-lg p-6 text-white max-w-lg">
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                ⚠️ DICOM Loading Error
              </h3>
              <p className="text-sm whitespace-pre-line mb-3">{error}</p>
              
              <div className="flex items-center justify-between">
                <p className="text-xs text-red-200">
                  Series: {patientInfo?.seriesInstanceUID || 'Not selected'}
                </p>
                <button
                  onClick={() => {
                    setError(null);
                    setTimeout(() => initializeMPRViewport(), 100);
                  }}
                  className="bg-red-700 hover:bg-red-600 px-3 py-1 rounded text-xs"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        )}
        
        {!patientInfo?.seriesInstanceUID && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
            <div className="text-center text-slate-400">
              <div className="text-4xl mb-4">🏥</div>
              <h3 className="text-lg font-medium mb-2">No Series Selected</h3>
              <p className="text-sm">Please select a patient and series to view MPR images.</p>
            </div>
          </div>
        )}
        
        {/* Three MPR views in a grid */}
        <div className="grid grid-cols-3 h-full gap-1 bg-slate-900">
          {/* Axial View */}
          <div className="relative bg-black border border-slate-700">
            <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
              Axial
            </div>
            <div 
              ref={elementRefs.axial} 
              className="w-full h-full"
              style={{ minHeight: '300px' }}
            />
          </div>
          
          {/* Sagittal View */}
          <div className="relative bg-black border border-slate-700">
            <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
              Sagittal
            </div>
            <div 
              ref={elementRefs.sagittal} 
              className="w-full h-full"
              style={{ minHeight: '300px' }}
            />
          </div>
          
          {/* Coronal View */}
          <div className="relative bg-black border border-slate-700">
            <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
              Coronal
            </div>
            <div 
              ref={elementRefs.coronal} 
              className="w-full h-full"
              style={{ minHeight: '300px' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProperMPRViewport;