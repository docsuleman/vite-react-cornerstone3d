import React, { useEffect, useRef, useState } from 'react';
import createImageIdsAndCacheMetaData from '../lib/createImageIdsAndCacheMetaData';
import {
  RenderingEngine,
  Enums,
  Types,
  volumeLoader,
  cornerstoneStreamingImageVolumeLoader,
  setVolumesForViewports,
} from "@cornerstonejs/core";
import * as cornerstoneTools from "@cornerstonejs/tools";
import { initializeCornerstone, isCornerStoneInitialized } from '../utils/cornerstoneInit';
import { performWebGLDiagnostics, logWebGLDiagnostics, isWebGLSuitableForMedicalImaging } from '../utils/webglDiagnostics';
import { FaCrosshairs, FaSearchPlus, FaArrowsAlt, FaAdjust, FaCircle } from "react-icons/fa";
import SphereMarkerTool from '../customTools/Spheremarker';

const {
  ToolGroupManager,
  Enums: csToolsEnums,
  CrosshairsTool,
  ZoomTool,
  PanTool,
  WindowLevelTool,
  StackScrollTool,
  LengthTool,
  AngleTool,
  EllipticalROITool,
  RectangleROITool,
  CircleROITool,
  DragProbeTool,
  OrientationMarkerTool,
  SplineROITool,
  synchronizers,
} = cornerstoneTools;

const { createSlabThicknessSynchronizer } = synchronizers;
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
  currentStage?: string;
}

const ProperMPRViewport: React.FC<ProperMPRViewportProps> = ({ 
  patientInfo,
  onImageLoaded,
  onSpherePositionsUpdate,
  currentStage 
}) => {
  const elementRefs = {
    axial: useRef<HTMLDivElement>(null),
    sagittal: useRef<HTMLDivElement>(null),
    coronal: useRef<HTMLDivElement>(null),
  };

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageInfo, setImageInfo] = useState<any>(null);
  const [renderingEngine, setRenderingEngine] = useState<RenderingEngine | null>(null);
  const [activeTool, setActiveTool] = useState<string>('Zoom');
  const [windowLevel, setWindowLevel] = useState({ window: 350, level: 40 }); // CT Angiography
  const running = useRef(false);
  const synchronizerRef = useRef<any>(null);

  const [currentIds, setCurrentIds] = useState(() => {
    const instanceId = Math.random().toString(36).substr(2, 9);
    const timestamp = Date.now();
    return {
      toolGroupId: `MPR_TOOLGROUP_ID_${instanceId}_${timestamp}`,
      renderingEngineId: `mprRenderingEngine_${instanceId}_${timestamp}`,
      synchronizerId: `SLAB_THICKNESS_SYNCHRONIZER_ID_${instanceId}_${timestamp}`
    };
  });

  useEffect(() => {
    if (!patientInfo?.seriesInstanceUID) return;

    initializeMPRViewport();

    // Cleanup function when component unmounts or dependencies change
    return () => {
      cleanup();
    };
  }, [patientInfo, currentStage]);

  // Additional cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    if (!running.current) {
      return; // Already cleaned up
    }
    
    try {
      
      // Clean up synchronizers first
      if (synchronizerRef.current) {
        try {
          synchronizerRef.current.destroy();
          synchronizerRef.current = null;
        } catch (error) {
        }
      }

      // Clean up tool group first - important to do this before destroying rendering engine
      try {
        const existingToolGroup = ToolGroupManager.getToolGroup(currentIds.toolGroupId);
        if (existingToolGroup) {
          ToolGroupManager.destroyToolGroup(currentIds.toolGroupId);
        }
      } catch (error) {
      }

      // Enhanced viewport cleanup with better WebGL resource management
      if (renderingEngine && typeof renderingEngine.getViewport === 'function') {
        try {
          const viewportIds = ["axial", "sagittal", "coronal"];
          
          // Phase 1: Clear volumes and stop rendering
          viewportIds.forEach(id => {
            try {
              const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
              if (viewport) {
                
                // Clear volumes safely
                if (typeof (viewport as any).setVolumes === 'function') {
                  try {
                    (viewport as any).setVolumes([]);
                  } catch (volumeError) {
                  }
                }
                
                // Clear any cached data
                const canvas = viewport.getCanvas();
                if (canvas) {
                  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                  if (gl && !gl.isContextLost()) {
                    // Force WebGL to finish all operations
                    gl.finish();
                    gl.flush();
                  }
                }
              }
            } catch (error) {
            }
          });
          
          // Phase 2: Disable elements with delay
          setTimeout(() => {
            viewportIds.forEach(id => {
              try {
                if (typeof renderingEngine.disableElement === 'function') {
                  renderingEngine.disableElement(id);
                }
              } catch (error) {
              }
            });
            
            // Phase 3: Destroy rendering engine with additional delay
            setTimeout(() => {
              if (renderingEngine && typeof renderingEngine.destroy === 'function') {
                try {
                  renderingEngine.destroy();
                  setRenderingEngine(null);
                } catch (error) {
                  setRenderingEngine(null); // Still clear the reference
                }
              }
              
              // Force garbage collection if available
              if (window.gc) {
                try {
                  window.gc();
                } catch (gcError) {
                }
              }
            }, 200);
          }, 100);
          
        } catch (error) {
        }
      }

      running.current = false;
    } catch (error) {
      running.current = false;
    }
  };

  const initializeMPRViewport = async () => {
    if (running.current) {
      return;
    }
    
    // Cleanup any previous instance first
    cleanup();
    
    // Wait longer for WebGL context cleanup to complete and prevent conflicts
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Generate new IDs for this initialization
    const instanceId = Math.random().toString(36).substr(2, 9);
    const timestamp = Date.now();
    const newIds = {
      toolGroupId: `MPR_TOOLGROUP_ID_${instanceId}_${timestamp}`,
      renderingEngineId: `mprRenderingEngine_${instanceId}_${timestamp}`,
      synchronizerId: `SLAB_THICKNESS_SYNCHRONIZER_ID_${instanceId}_${timestamp}`
    };
    setCurrentIds(newIds);
    
    running.current = true;

    try {
      setIsLoading(true);
      setError(null);


      // Comprehensive WebGL environment validation
      
      const webglDiagnostics = performWebGLDiagnostics();
      logWebGLDiagnostics(webglDiagnostics);
      
      if (!webglDiagnostics.supported) {
        const errorMessage = `WebGL is not supported or available.\n\nIssues:\n${webglDiagnostics.issues.join('\n')}\n\nRecommendations:\n${webglDiagnostics.recommendations.join('\n')}`;
        throw new Error(errorMessage);
      }
      
      if (!isWebGLSuitableForMedicalImaging(webglDiagnostics)) {
        const warningMessage = `WebGL environment may not be suitable for medical imaging.\n\nIssues:\n${webglDiagnostics.issues.join('\n')}\n\nRecommendations:\n${webglDiagnostics.recommendations.join('\n')}\n\nThe application will attempt to continue, but performance may be limited.`;
        
        // Still continue, but user will be warned
        if (webglDiagnostics.issues.some(issue => issue.includes('Software rendering'))) {
        }
      }
      

      // Initialize Cornerstone3D if not already initialized
      if (!isCornerStoneInitialized()) {
        await initializeCornerstone();
        
        // Wait a bit more for full initialization
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (!isCornerStoneInitialized()) {
          throw new Error('Failed to initialize Cornerstone3D');
        }
      } else {
      }


      // Load DICOM images using the original method
      const imageIds = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: patientInfo!.studyInstanceUID!,
        SeriesInstanceUID: patientInfo!.seriesInstanceUID!,
        wadoRsRoot: "http://127.0.0.1/orthanc/dicom-web",
      });

      if (imageIds.length === 0) {
        throw new Error('No DICOM images found for this series');
      }


      // Create rendering engine
      const newRenderingEngine = new RenderingEngine(newIds.renderingEngineId);
      setRenderingEngine(newRenderingEngine);

      // Create volume
      const volumeId = "streamingImageVolume";
      const volume = await volumeLoader.createAndCacheVolume(volumeId, {
        imageIds,
      });

      await volume.load();

      // Setup viewports
      const viewports = [
        { id: "axial", orientation: Enums.OrientationAxis.AXIAL, type: Enums.ViewportType.ORTHOGRAPHIC },
        { id: "sagittal", orientation: Enums.OrientationAxis.SAGITTAL, type: Enums.ViewportType.ORTHOGRAPHIC },
        { id: "coronal", orientation: Enums.OrientationAxis.CORONAL, type: Enums.ViewportType.ORTHOGRAPHIC },
      ];

      
      // Enhanced viewport enabling with better WebGL context handling
      for (const { id, orientation } of viewports) {
        const element = elementRefs[id as keyof typeof elementRefs].current;
        if (element) {
          try {
            
            // Enhanced element preparation for WebGL context creation
            element.innerHTML = '';
            element.style.width = '100%';
            element.style.height = '100%';
            element.style.display = 'block';
            element.style.position = 'relative';
            
            // Ensure element has proper dimensions before WebGL context creation
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) {
              // Force minimum dimensions
              element.style.minWidth = '300px';
              element.style.minHeight = '300px';
            }
            
            // Force browser to recalculate layout multiple times
            element.offsetHeight;
            element.offsetWidth;
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Verify element is ready for WebGL context
            const finalRect = element.getBoundingClientRect();
            
            if (finalRect.width === 0 || finalRect.height === 0) {
              throw new Error(`Element ${id} still has zero dimensions after preparation`);
            }
            
            // Add progressive delay between viewport creations to prevent WebGL conflicts
            const delay = viewports.findIndex(v => v.id === id) * 150;
            await new Promise(resolve => setTimeout(resolve, delay + 100));
            
            // Enable viewport with enhanced WebGL context options and retries
            let enableAttempts = 0;
            const maxEnableAttempts = 3;
            let viewport = null;
            
            while (enableAttempts < maxEnableAttempts && !viewport) {
              try {
                enableAttempts++;
                
                // Test WebGL availability before viewport creation
                const testCanvas = document.createElement('canvas');
                const testGL = testCanvas.getContext('webgl2', {
                  preserveDrawingBuffer: true,
                  premultipliedAlpha: false,
                  antialias: true,
                  alpha: false,
                  depth: true,
                  stencil: false,
                  powerPreference: 'high-performance'
                }) || testCanvas.getContext('webgl', {
                  preserveDrawingBuffer: true,
                  premultipliedAlpha: false,
                  antialias: true,
                  alpha: false,
                  depth: true,
                  stencil: false,
                  powerPreference: 'high-performance'
                });
                
                if (!testGL) {
                  throw new Error(`WebGL not supported in browser for ${id}`);
                }
                
                if (testGL.isContextLost()) {
                  throw new Error(`WebGL context is lost for ${id}`);
                }
                
                // Clean up test canvas
                testGL.getExtension('WEBGL_lose_context')?.loseContext();
                testCanvas.remove();
                
                // Enable viewport with Cornerstone3D compatible options
                newRenderingEngine.enableElement({
                  viewportId: id,
                  type: Enums.ViewportType.ORTHOGRAPHIC,
                  element,
                  defaultOptions: { 
                    orientation,
                    background: [0, 0, 0], // Black background
                    suppressEvents: false
                  },
                });
                
                // Verify viewport was created
                viewport = newRenderingEngine.getViewport(id);
                if (viewport) {
                  break;
                }
                
              } catch (enableError) {
                
                if (enableAttempts < maxEnableAttempts) {
                  // Wait before retry with increasing delay
                  await new Promise(resolve => setTimeout(resolve, 200 * enableAttempts));
                } else {
                  throw new Error(`Failed to enable viewport ${id} after ${maxEnableAttempts} attempts: ${enableError.message}`);
                }
              }
            }
            
            // Enhanced viewport verification with Cornerstone3D compatibility
            if (!viewport) {
              throw new Error(`Viewport ${id} was not created after successful enableElement call`);
            }
            
            // Verify canvas is available
            const canvas = viewport.getCanvas();
            if (!canvas) {
              throw new Error(`Canvas not available for viewport ${id}`);
            }
            
            
            // For Cornerstone3D viewports, test functionality rather than direct WebGL access
            // Cornerstone3D manages its own WebGL context internally
            let viewportFunctional = false;
            
            try {
              // Test viewport functionality by attempting basic operations
              
              // Test 1: Camera operations
              viewport.resetCamera();
              
              // Test 2: Basic rendering
              viewport.render();
              
              // Test 3: Get viewport properties
              const camera = viewport.getCamera();
              if (camera) {
              }
              
              viewportFunctional = true;
              
            } catch (functionalityError) {
              
              // If basic functionality fails, try WebGL context diagnostics
              try {
                // Attempt to get WebGL context for diagnostics only
                const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                
                if (gl && !gl.isContextLost()) {
                  
                  // Sometimes a delayed retry helps with Cornerstone3D initialization
                  await new Promise(resolve => setTimeout(resolve, 100));
                  
                  try {
                    viewport.resetCamera();
                    viewport.render();
                    viewportFunctional = true;
                  } catch (retryError) {
                  }
                } else {
                }
              } catch (diagnosticError) {
              }
            }
            
            // Only throw error if viewport is completely non-functional
            if (!viewportFunctional) {
              // Enhanced diagnostics for debugging
              const webglSupport = !!window.WebGLRenderingContext;
              const webgl2Support = !!window.WebGL2RenderingContext;
              
              
              // Final test with independent WebGL context
              const testCanvas = document.createElement('canvas');
              const testContext = testCanvas.getContext('webgl');
              if (testContext) {
                testContext.getExtension('WEBGL_lose_context')?.loseContext();
              } else {
              }
              testCanvas.remove();
              
              throw new Error(`Viewport ${id} failed functionality tests. Cornerstone3D may not be properly initialized or WebGL resources are unavailable.`);
            }
            
            // Add enhanced context loss handlers to the canvas
            canvas.addEventListener('webglcontextlost', (event) => {
              event.preventDefault();
              
              // Set error state to trigger re-initialization
              setError(`WebGL context lost for ${id}. Please refresh to retry.`);
            });
            
            canvas.addEventListener('webglcontextrestored', (event) => {
              
              // Clear error state and trigger re-initialization
              setError(null);
              setTimeout(() => {
                initializeMPRViewport();
              }, 100);
            });
            
            
            // Final verification that everything is working
            try {
              viewport.resetCamera();
              viewport.render();
            } catch (renderError) {
              // Don't throw here, volume loading might fix rendering issues
            }
            
          } catch (error) {
            throw error; // Re-throw to stop initialization if any viewport fails
          }
        } else {
          throw new Error(`Element not found for viewport: ${id}`);
        }
      }
      
      // Additional stabilization period for WebGL contexts
      await new Promise(resolve => setTimeout(resolve, 500));

      // Enhanced volume loading with better WebGL context management
      
      // Wait longer for WebGL contexts to stabilize
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      try {
        // Force garbage collection to free up WebGL resources
        if (window.gc) {
          window.gc();
        }
        
        // Set volumes using individual viewport approach for better error handling
        const viewportIds = viewports.map(v => v.id);
        let successCount = 0;
        
        for (const viewportId of viewportIds) {
          try {
            const viewport = newRenderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
            
            if (viewport && typeof viewport.setVolumes === 'function') {
              // Set volume with retry mechanism
              let retryCount = 0;
              const maxRetries = 3;
              
              while (retryCount < maxRetries) {
                try {
                  await viewport.setVolumes([{
                    volumeId,
                    callback: ({ volumeActor }) => {
                      
                      // Set proper volume properties for medical imaging
                      if (volumeActor) {
                        const property = volumeActor.getProperty();
                        if (property) {
                          // Use proper medical imaging transfer function
                          property.setInterpolationTypeToLinear();
                          property.setUseGradientOpacity(0, false);
                          property.setShade(false);
                          property.setAmbient(0.3);
                          property.setDiffuse(0.7);
                          property.setSpecular(0.2);
                        }
                      }
                    }
                  }]);
                  
                  // Wait for volume to be set
                  await new Promise(resolve => setTimeout(resolve, 200));
                  
                  // Reset camera to fit content
                  viewport.resetCamera();
                  
                  // Apply initial window/level for medical imaging
                  viewport.setProperties({
                    voiRange: {
                      lower: windowLevel.level - windowLevel.window / 2,
                      upper: windowLevel.level + windowLevel.window / 2,
                    },
                  });
                  
                  // Force render
                  viewport.render();
                  
                  successCount++;
                  break; // Success, exit retry loop
                  
                } catch (retryError) {
                  retryCount++;
                  
                  if (retryCount < maxRetries) {
                    // Wait before retry with exponential backoff
                    await new Promise(resolve => setTimeout(resolve, 200 * retryCount));
                  } else {
                    throw retryError; // Max retries reached
                  }
                }
              }
            } else {
              throw new Error(`Viewport ${viewportId} does not support setVolumes`);
            }
            
          } catch (error) {
          }
          
          // Small delay between viewport setups to prevent race conditions
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        if (successCount > 0) {
        } else {
        }
        
      } catch (error) {
      }

      // Setup tools
      await setupTools(newRenderingEngine, newIds);

      // Enhanced camera fitting with better WebGL handling
      setTimeout(async () => {
        for (const { id } of viewports) {
          try {
            const viewport = newRenderingEngine.getViewport(id) as Types.IVolumeViewport;
            
            if (!viewport) {
              continue;
            }
            
            // Check if viewport has volumes before trying to fit
            const volumes = viewport.getActors();
            if (!volumes || volumes.length === 0) {
              continue;
            }
            
            // Reset camera with enhanced parameters
            viewport.resetCamera();
            
            // Get viewport bounds safely
            let bounds;
            try {
              bounds = viewport.getBounds();
            } catch (boundsError) {
              continue;
            }
            
            if (bounds) {
              const canvas = viewport.getCanvas();
              if (canvas) {
                const { width: canvasWidth, height: canvasHeight } = canvas;
                
                // Calculate the bounding box of the image
                const [xMin, xMax, yMin, yMax] = bounds;
                const imageWidth = Math.abs(xMax - xMin);
                const imageHeight = Math.abs(yMax - yMin);
                
                if (imageWidth > 0 && imageHeight > 0) {
                  // Calculate scale factors for both dimensions
                  const scaleX = canvasWidth / imageWidth;
                  const scaleY = canvasHeight / imageHeight;
                  
                  // Use the smaller scale to ensure the entire image fits
                  const scale = Math.min(scaleX, scaleY) * 0.85; // More conservative padding
                  
                  // Set the parallel scale (controls zoom level)
                  const parallelScale = Math.max(imageWidth, imageHeight) / (2 * scale);
                  
                  viewport.setCamera({
                    parallelScale: parallelScale,
                  });
                  
                }
              }
            }
            
            // Force render with error handling
            try {
              viewport.render();
            } catch (renderError) {
            }
            
            // Small delay between viewport operations
            await new Promise(resolve => setTimeout(resolve, 100));
            
          } catch (error) {
            
            // Fallback: try basic reset
            try {
              const viewport = newRenderingEngine.getViewport(id) as Types.IVolumeViewport;
              if (viewport) {
                viewport.resetCamera();
                viewport.render();
              }
            } catch (fallbackError) {
            }
          }
        }
      }, 3000); // Increased delay to allow volumes to fully load

      setImageInfo({
        width: 512, // Default - will be updated when volume loads
        height: 512,
        numberOfImages: imageIds.length,
        seriesInstanceUID: patientInfo?.seriesInstanceUID,
        volumeId: volumeId,
        status: 'MPR Viewport with safer volume loading'
      });

      if (onImageLoaded) {
        onImageLoaded({ imageIds, volume });
      }

      setIsLoading(false);

    } catch (err) {
      setError(`Failed to load DICOM images: ${err}`);
      setIsLoading(false);
      running.current = false;
    }
  };

  const setupTools = async (engine: RenderingEngine, ids: typeof currentIds) => {
    // Add tools to Cornerstone3D (simplified - no crosshairs for now)
    cornerstoneTools.addTool(ZoomTool);
    cornerstoneTools.addTool(PanTool);
    cornerstoneTools.addTool(WindowLevelTool);
    cornerstoneTools.addTool(StackScrollTool);
    cornerstoneTools.addTool(SphereMarkerTool);

    // Create tool group
    const toolGroup = ToolGroupManager.createToolGroup(ids.toolGroupId);

    // Add tools to tool group (no crosshairs to avoid annotation errors)
    toolGroup?.addTool(ZoomTool.toolName);
    toolGroup?.addTool(PanTool.toolName);
    toolGroup?.addTool(WindowLevelTool.toolName);
    toolGroup?.addTool(StackScrollTool.toolName);
    toolGroup?.addTool(SphereMarkerTool.toolName);

    // Set up callback for sphere position updates
    if (onSpherePositionsUpdate) {
      const sphereTool = toolGroup?.getToolInstance(SphereMarkerTool.toolName) as SphereMarkerTool;
      if (sphereTool) {
        sphereTool.setPositionUpdateCallback((spheres) => {
          onSpherePositionsUpdate(spheres);
        });
      }
    }

    // Set tool modes (simplified without crosshairs)
    toolGroup?.setToolActive(ZoomTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Primary }],
    });
    toolGroup?.setToolActive(PanTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Secondary }],
    });
    toolGroup?.setToolActive(WindowLevelTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Primary, modifierKey: csToolsEnums.KeyboardBindings.Ctrl }],
    });
    toolGroup?.setToolActive(StackScrollTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Wheel }],
    });

    // Add viewports to tool group (matching original App.tsx)
    const viewportIds = ["axial", "sagittal", "coronal"];
    viewportIds.forEach((id) => {
      toolGroup?.addViewport(id, ids.renderingEngineId);
    });

    // Skip synchronizer and zoom sync setup for now to avoid conflicts

  };

  const handleToolChange = (toolName: string) => {
    if (!renderingEngine) return;
    
    try {
      const toolGroup = ToolGroupManager.getToolGroup(currentIds.toolGroupId);
      if (!toolGroup) return;

      // Set all tools to passive first
      toolGroup.setToolPassive(ZoomTool.toolName);
      toolGroup.setToolPassive(PanTool.toolName);
      toolGroup.setToolPassive(SphereMarkerTool.toolName);
      
      // Activate selected tool
      if (toolName === 'SphereMarker') {
        toolGroup.setToolActive(SphereMarkerTool.toolName, {
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
      }
      
      setActiveTool(toolName);
    } catch (error) {
    }
  };

  const handleWindowLevelChange = (window: number, level: number) => {
    if (!renderingEngine) return;

    try {
      const viewportIds = ["axial", "sagittal", "coronal"];
      viewportIds.forEach(viewportId => {
        const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
        if (viewport) {
          viewport.setProperties({
            voiRange: {
              lower: level - window / 2,
              upper: level + window / 2,
            },
          });
          viewport.render();
        }
      });
      
      setWindowLevel({ window, level });
    } catch (error) {
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
              onClick={() => handleToolChange('SphereMarker')}
              className={`p-2 rounded text-sm flex items-center gap-1 ${activeTool === 'SphereMarker' ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              <FaCircle />
              Sphere
            </button>
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
        </div>
      )}

      {/* MPR Viewports */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
            <div className="flex items-center gap-3 text-white">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <span>Loading DICOM Volume from Orthanc...</span>
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
              
              {error.includes('WebGL') && (
                <div className="bg-red-800 border border-red-600 rounded p-3 mb-3">
                  <p className="text-xs font-semibold mb-2">WebGL Troubleshooting:</p>
                  <ul className="text-xs space-y-1">
                    <li>• Ensure your browser supports WebGL (Chrome, Firefox, Safari, Edge)</li>
                    <li>• Check if WebGL is enabled in browser settings</li>
                    <li>• Update your graphics drivers</li>
                    <li>• Try refreshing the page</li>
                    <li>• Close other tabs using 3D graphics</li>
                  </ul>
                </div>
              )}
              
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