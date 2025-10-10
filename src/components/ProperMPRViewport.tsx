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
import { FaCrosshairs, FaSearchPlus, FaArrowsAlt, FaAdjust, FaCircle, FaMousePointer, FaScroll, FaTrash, FaDotCircle, FaPlay, FaPause } from "react-icons/fa";
import SphereMarkerTool from '../customTools/Spheremarker';
import CuspNadirTool from '../customTools/CuspNadirTool';
import FixedCrosshairTool from '../customTools/FixedCrosshairTool';
import { WorkflowStage } from '../types/WorkflowTypes';
import { CenterlineGenerator } from '../utils/CenterlineGenerator';

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

const { createSlabThicknessSynchronizer, createCameraPositionSynchronizer } = synchronizers;
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
  existingSpheres?: { id: string; pos: [number, number, number]; color: string }[];
}

const ProperMPRViewport: React.FC<ProperMPRViewportProps> = ({
  patientInfo,
  onImageLoaded,
  onSpherePositionsUpdate,
  onCuspDotsUpdate,
  currentStage,
  existingSpheres
}) => {
  const elementRefs = {
    axial: useRef(null),
    sagittal: useRef(null),
    coronal: useRef(null),
  };

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string>('Zoom');

  // Use refs for imageInfo to avoid re-renders that break CrosshairsTool
  const imageInfoRef = useRef<any>(null);
  const [windowLevel, setWindowLevel] = useState({ window: 900, level: 350 }); // Cardiac CTA default
  const [phaseInfo, setPhaseInfo] = useState<any>(null); // Cardiac phase information
  const [selectedPhase, setSelectedPhase] = useState<number | null>(null); // Currently selected phase
  const [isPlayingCine, setIsPlayingCine] = useState(false); // Cine playback state
  const [isPreloading, setIsPreloading] = useState(false); // Track if we're in preloading mode
  const running = useRef(false);
  const cineIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const preloadedVolumesRef = useRef<{ [phaseIndex: number]: string }>({}); // Store preloaded volume IDs
  const renderingEngineRef = useRef<RenderingEngine | null>(null);
  const allPhasesLoadedRef = useRef(false); // Track if all phases have been loaded once
  const isSwitchingPhaseRef = useRef(false); // Track if we're currently switching phases
  const savedCameraStatesRef = useRef<any>({}); // Store camera states to preserve crosshair position
  const savedCrosshairFocalPointRef = useRef<any>(null); // Store crosshair focal point during phase switching

  // Use static IDs like App.tsx
  const toolGroupId = "MPR_TOOLGROUP_ID";
  const renderingEngineId = "mprRenderingEngine";
  const synchronizerId = "MPR_SLAB_THICKNESS_SYNCHRONIZER_ID";
  const cameraPositionSynchronizerId = "MPR_CAMERA_POSITION_SYNCHRONIZER_ID";

  // Store synchronizer refs for cleanup
  const slabSynchronizerRef = useRef<any>(null);
  const cameraSynchronizerRef = useRef<any>(null);
  const lockedFocalPointRef = useRef<Types.Point3 | null>(null);

  // Preload all phases sequentially when play is first hit
  useEffect(() => {
    if (!isPlayingCine || !phaseInfo || !phaseInfo.isMultiPhase || !patientInfo) {
      return;
    }

    const preloadSequentially = async () => {
      // Check if all phases are already loaded
      const allLoaded = Object.keys(preloadedVolumesRef.current).length === phaseInfo.totalPhases;

      if (allLoaded) {
        console.log('✅ All phases already loaded, starting cine immediately');
        allPhasesLoadedRef.current = true;
        setIsPreloading(false);
        return;
      }

      console.log('🔄 First time play - preloading all phases sequentially...');
      setIsPreloading(true);

      try {
        // Load each phase one by one and display it
        for (let phaseIndex = 0; phaseIndex < phaseInfo.totalPhases; phaseIndex++) {
          if (!preloadedVolumesRef.current[phaseIndex]) {
            console.log(`📥 Preloading phase ${phaseIndex + 1}/${phaseInfo.totalPhases}...`);

            // Set this as the current phase so it displays
            setSelectedPhase(phaseIndex);

            // Wait a bit for the phase to load and display
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        console.log('✅ All phases preloaded! Starting 1.5s loop...');
        allPhasesLoadedRef.current = true;
        setIsPreloading(false);
      } catch (error) {
        console.error('❌ Error during sequential preload:', error);
        setIsPreloading(false);
      }
    };

    preloadSequentially();
  }, [isPlayingCine, phaseInfo, patientInfo]);

  // Cine playback effect - play all phases in 1.5 seconds loop (only after preloading)
  useEffect(() => {
    if (isPlayingCine && phaseInfo && phaseInfo.isMultiPhase && !isPreloading && allPhasesLoadedRef.current) {
      // Calculate interval: 1500ms (1.5 seconds) divided by number of phases
      const totalDuration = 1500; // 1.5 seconds in milliseconds
      const interval = totalDuration / phaseInfo.totalPhases;

      console.log(`🎬 Starting 1.5s cine loop: ${phaseInfo.totalPhases} phases (${interval.toFixed(0)}ms per phase)`);

      cineIntervalRef.current = setInterval(() => {
        setSelectedPhase(prevPhase => {
          const currentPhase = prevPhase ?? 0;
          const nextPhase = (currentPhase + 1) % phaseInfo.totalPhases;
          return nextPhase;
        });
      }, interval);

      return () => {
        if (cineIntervalRef.current) {
          clearInterval(cineIntervalRef.current);
          cineIntervalRef.current = null;
        }
      };
    } else {
      if (cineIntervalRef.current) {
        clearInterval(cineIntervalRef.current);
        cineIntervalRef.current = null;
      }
    }
  }, [isPlayingCine, phaseInfo, isPreloading]);

  // Phase switching effect - load and display the selected phase
  useEffect(() => {
    if (!phaseInfo || !phaseInfo.isMultiPhase || selectedPhase === null || !patientInfo) {
      return;
    }

    const switchPhase = async () => {
      try {
        isSwitchingPhaseRef.current = true;
        console.log(`🔄 Switching to phase ${selectedPhase + 1}/${phaseInfo.totalPhases}`);

        // Get or create volume for this phase
        let phaseVolumeId = preloadedVolumesRef.current[selectedPhase];

        if (!phaseVolumeId) {
          // Load this phase's volume by calling createImageIdsAndCacheMetaData with the selected phase
          console.log(`📥 Loading volume for phase ${selectedPhase + 1}...`);

          const { imageIds: phaseImageIds } = await createImageIdsAndCacheMetaData({
            StudyInstanceUID: patientInfo.studyInstanceUID!,
            SeriesInstanceUID: patientInfo.seriesInstanceUID!,
            wadoRsRoot: "http://127.0.0.1/orthanc/dicom-web",
            selectedPhase: selectedPhase, // Pass the selected phase
          });

          phaseVolumeId = `streamingImageVolume_phase${selectedPhase}_${Date.now()}`;

          const phaseVolume = await volumeLoader.createAndCacheVolume(phaseVolumeId, {
            imageIds: phaseImageIds,
          });

          // WAIT for the volume to fully load before continuing
          await phaseVolume.load();

          // Cache the volume ID
          preloadedVolumesRef.current[selectedPhase] = phaseVolumeId;
          console.log(`✅ Loaded phase ${selectedPhase + 1} volume: ${phaseVolumeId}`);
        }

        // Apply the phase volume to all viewports
        const viewportIds = ["axial", "sagittal", "coronal"];
        const renderingEngine = renderingEngineRef.current || new RenderingEngine(renderingEngineId);

        // Calculate W/L once
        const lower = windowLevel.level - windowLevel.window / 2;
        const upper = windowLevel.level + windowLevel.window / 2;

        // Save current camera states for all viewports BEFORE any changes
        viewportIds.forEach(id => {
          const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
          if (viewport) {
            savedCameraStatesRef.current[id] = viewport.getCamera();
          }
        });

        // CRITICAL: Save crosshair focal point from axial viewport
        const axialViewport = renderingEngine.getViewport("axial") as Types.IVolumeViewport;
        if (axialViewport) {
          const camera = axialViewport.getCamera();
          savedCrosshairFocalPointRef.current = [...camera.focalPoint]; // Clone the array
          console.log(`💾 Saved crosshair focal point:`, savedCrosshairFocalPointRef.current);
        }

        // Update all viewports with new volume - do all at once to minimize time
        await Promise.all(viewportIds.map(async (id) => {
          const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
          if (viewport) {
            await viewport.setVolumes([{
              volumeId: phaseVolumeId,
              callback: ({ volumeActor }) => {
                volumeActor.getProperty().getRGBTransferFunction(0).setRange(lower, upper);
              }
            }], false);
          }
        }));

        // Restore cameras for all viewports after volumes are set
        viewportIds.forEach(id => {
          const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
          const savedCamera = savedCameraStatesRef.current[id];
          if (viewport && savedCamera) {
            viewport.setCamera(savedCamera);
          }
        });

        // CRITICAL: Force render ALL viewports synchronously to restore crosshair sync
        renderingEngine.renderViewports(viewportIds);
        console.log(`✅ Rendered all viewports with restored cameras`);

        // CRITICAL FIX: Restore crosshair focal point after phase switch
        // The CrosshairsTool maintains its own internal state that gets lost during volume changes
        // We need to force it to update its focal point to the saved position
        if (savedCrosshairFocalPointRef.current) {
          console.log(`🎯 Restoring crosshair focal point:`, savedCrosshairFocalPointRef.current);

          // Wait a small moment for renders to complete, then force focal point update
          setTimeout(() => {
            viewportIds.forEach(id => {
              const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
              if (viewport) {
                const camera = viewport.getCamera();
                // Force set the camera with the saved focal point to trigger crosshair update
                viewport.setCamera({
                  ...camera,
                  focalPoint: savedCrosshairFocalPointRef.current as Types.Point3
                });
              }
            });

            // Force render again to show updated crosshairs
            renderingEngine.renderViewports(viewportIds);
            console.log(`✅ Crosshair focal point restored and synced across all viewports`);
          }, 50); // Small delay to ensure volumes are fully set
        }

        console.log(`✅ Switched to phase ${selectedPhase + 1} with W/L: ${windowLevel.window}/${windowLevel.level}`);
        isSwitchingPhaseRef.current = false;
      } catch (error) {
        console.error(`❌ Failed to switch to phase ${selectedPhase}:`, error);
        isSwitchingPhaseRef.current = false;
      }
    };

    switchPhase();
  }, [selectedPhase, phaseInfo, patientInfo]);

  useEffect(() => {
    if (!patientInfo?.seriesInstanceUID) return;

    console.log('🔄 Stage changed to:', currentStage, '- Initializing MPR Viewport');
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

      // DON'T destroy synchronizer - keep it alive for reuse (fixes sync issues)
      // slabSynchronizerRef.current = null;

      // Clean up tool group
      try {
        const existingToolGroup = ToolGroupManager.getToolGroup(toolGroupId);
        if (existingToolGroup) {
          ToolGroupManager.destroyToolGroup(toolGroupId);
        }
      } catch (error) {
        console.warn('Failed to destroy tool group:', error);
      }

      // CRITICAL: Reset running flag so re-initialization can happen
      running.current = false;

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

      // Load DICOM images and get phase information
      const { imageIds, phaseInfo: detectedPhaseInfo } = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: patientInfo!.studyInstanceUID!,
        SeriesInstanceUID: patientInfo!.seriesInstanceUID!,
        wadoRsRoot: "http://127.0.0.1/orthanc/dicom-web",
      });

      if (imageIds.length === 0) {
        throw new Error('No DICOM images found for this series');
      }

      // Store phase information
      setPhaseInfo(detectedPhaseInfo);
      console.log(`📋 Found ${imageIds.length} DICOM images`);
      console.log(`📊 Phase Info:`, detectedPhaseInfo);

      // Set initial phase if multi-phase
      if (detectedPhaseInfo && detectedPhaseInfo.isMultiPhase) {
        setSelectedPhase(0); // Default to first phase
        console.log(`🎬 Multi-phase dataset detected with ${detectedPhaseInfo.totalPhases} phases`);
      }

      // Try to reuse existing rendering engine if it exists (this is what makes it work when coming back!)
      let renderingEngine = renderingEngineRef.current;
      const isFirstLoad = !renderingEngine;
      if (!renderingEngine) {
        renderingEngine = new RenderingEngine(renderingEngineId);
        renderingEngineRef.current = renderingEngine;
        console.log('🆕🆕🆕 FIRST LOAD - Created new rendering engine');
      } else {
        console.log('♻️♻️♻️ SECOND LOAD - Reusing existing rendering engine');
      }

      // Log the state of everything
      console.log('📊 State Check:');
      console.log('  - Is First Load:', isFirstLoad);
      console.log('  - Rendering Engine exists:', !!renderingEngine);
      console.log('  - Synchronizer exists:', !!slabSynchronizerRef.current);
      console.log('  - Viewports on engine:', renderingEngine.getViewports().map(v => v.id));
      
      // Create volume (exactly like App.tsx)
      const volumeId = `streamingImageVolume_${Date.now()}`;
      const volume = await volumeLoader.createAndCacheVolume(volumeId, {
        imageIds,
      });

      // Start volume loading (streaming)
      volume.load();

      // If multi-phase, cache the first phase volume
      if (detectedPhaseInfo && detectedPhaseInfo.isMultiPhase) {
        preloadedVolumesRef.current[0] = volumeId;
        console.log(`💾 Cached phase 0 volume: ${volumeId}`);
      }

      // Setup viewports (exactly like App.tsx)
      const viewports = [
        { id: "axial", orientation: Enums.OrientationAxis.AXIAL },
        { id: "sagittal", orientation: Enums.OrientationAxis.SAGITTAL },
        { id: "coronal", orientation: Enums.OrientationAxis.CORONAL },
      ];

      // Enable viewports and set volumes (check if already enabled first)
      // CRITICAL: Don't await setVolumes - let it stream in background like App.tsx
      console.log('🔧 Setting up viewports...');
      viewports.forEach(({ id, orientation }) => {
        // Check if viewport already exists
        let viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;

        if (!viewport) {
          // Viewport doesn't exist, enable it
          console.log(`  🆕 ${id}: Creating NEW viewport`);
          renderingEngine.enableElement({
            viewportId: id,
            type: Enums.ViewportType.ORTHOGRAPHIC,
            element: elementRefs[id].current,
            defaultOptions: {
              orientation,
              background: [0, 0, 0]
            },
          });
          viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
        } else {
          console.log(`  ♻️ ${id}: REUSING existing viewport`);
        }

        // Don't await - let volumes load in background like App.tsx
        viewport.setVolumes([{ volumeId }]);
        viewport.render();
        console.log(`  ✅ ${id}: setVolumes and render called`);
      });

      // Setup tools first WITHOUT any state updates
      await setupTools();

      // CRITICAL: Set imageInfo in ref (no re-render since it's a ref)
      // The layout shift from the info bar was the real issue, not this assignment
      console.log('📊 Setting imageInfo in ref...');
      imageInfoRef.current = {
        width: 512,
        height: 512,
        numberOfImages: imageIds.length,
        seriesInstanceUID: patientInfo?.seriesInstanceUID,
        volumeId: volumeId,
        status: 'MPR Viewport Active'
      };

      if (onImageLoaded) {
        onImageLoaded({ imageIds, volume });
      }

      console.log('✅ MPR Viewport initialized successfully!');
      setIsLoading(false);

      // Apply initial window/level AFTER everything else to avoid interfering with CrosshairsTool
      // Small delay to let CrosshairsTool fully stabilize
      setTimeout(() => {
        console.log('🎨 Applying initial window/level to viewports...');
        const viewportIds = ["axial", "sagittal", "coronal"];
        viewportIds.forEach((id) => {
          const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
          if (viewport) {
            viewport.setProperties({
              voiRange: {
                lower: windowLevel.level - windowLevel.window / 2,
                upper: windowLevel.level + windowLevel.window / 2,
              },
            });
            viewport.render();
          }
        });
        console.log(`✅ Applied initial W/L: ${windowLevel.window}/${windowLevel.level}`);
      }, 200);

      // For ANNULUS_DEFINITION stage, position axial view perpendicular to centerline at valve
      console.log('🔍 Checking annulus definition camera setup:', {
        currentStage,
        isAnnulusStage: currentStage === WorkflowStage.ANNULUS_DEFINITION,
        hasExistingSpheres: !!existingSpheres,
        sphereCount: existingSpheres?.length || 0
      });

      if (currentStage === WorkflowStage.ANNULUS_DEFINITION && existingSpheres && existingSpheres.length >= 3) {
        console.log('✅ Condition met! Setting up centerline camera in 500ms...');
        setTimeout(() => {
          console.log('🎯 Setting up centerline-aligned axial view at valve position');

          // Generate centerline from root points
          const centerlineData = CenterlineGenerator.generateFromRootPoints(
            existingSpheres.map((sphere, index) => ({
              id: sphere.id,
              position: sphere.pos,
              type: index === 0 ? 'lv_outflow' : index === 1 ? 'aortic_valve' : 'ascending_aorta',
              timestamp: Date.now()
            }))
          );

          const numPoints = centerlineData.position.length / 3;

          // Find valve point (middle sphere, red one) on centerline
          const valvePos = existingSpheres[1].pos;

          // Find closest centerline point to valve
          let closestIndex = 0;
          let minDist = Infinity;

          for (let i = 0; i < numPoints; i++) {
            const x = centerlineData.position[i * 3];
            const y = centerlineData.position[i * 3 + 1];
            const z = centerlineData.position[i * 3 + 2];

            const dist = Math.sqrt(
              Math.pow(x - valvePos[0], 2) +
              Math.pow(y - valvePos[1], 2) +
              Math.pow(z - valvePos[2], 2)
            );

            if (dist < minDist) {
              minDist = dist;
              closestIndex = i;
            }
          }

          // Get valve point on centerline
          const valveCenterlinePos = [
            centerlineData.position[closestIndex * 3],
            centerlineData.position[closestIndex * 3 + 1],
            centerlineData.position[closestIndex * 3 + 2]
          ];

          // Calculate centerline tangent at valve
          let tangent = [0, 0, 1];
          if (closestIndex > 0 && closestIndex < numPoints - 1) {
            const prevPoint = [
              centerlineData.position[(closestIndex - 1) * 3],
              centerlineData.position[(closestIndex - 1) * 3 + 1],
              centerlineData.position[(closestIndex - 1) * 3 + 2]
            ];
            const nextPoint = [
              centerlineData.position[(closestIndex + 1) * 3],
              centerlineData.position[(closestIndex + 1) * 3 + 1],
              centerlineData.position[(closestIndex + 1) * 3 + 2]
            ];

            tangent = [
              nextPoint[0] - prevPoint[0],
              nextPoint[1] - prevPoint[1],
              nextPoint[2] - prevPoint[2]
            ];

            // Normalize
            const len = Math.sqrt(tangent[0] ** 2 + tangent[1] ** 2 + tangent[2] ** 2);
            if (len > 0) {
              tangent[0] /= len;
              tangent[1] /= len;
              tangent[2] /= len;
            }
          }

          console.log('📍 Valve position:', valveCenterlinePos);
          console.log('📐 Centerline tangent at valve:', tangent);

          // Position axial viewport to look along centerline at valve
          // This makes the viewing plane PERPENDICULAR to the centerline
          const axialViewport = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
          if (axialViewport) {
            const cameraDistance = 200; // Distance from focal point

            // Camera looks ALONG the centerline tangent (toward the focal point)
            // This creates a plane perpendicular to the centerline
            const cameraPos = [
              valveCenterlinePos[0] + tangent[0] * cameraDistance,
              valveCenterlinePos[1] + tangent[1] * cameraDistance,
              valveCenterlinePos[2] + tangent[2] * cameraDistance
            ] as Types.Point3;

            // Calculate viewUp perpendicular to tangent
            // Use cross product to get a consistent perpendicular vector
            let viewUp: Types.Point3;

            // Choose a reference vector that's not parallel to tangent
            const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];

            // Cross product: tangent × reference = perpendicular
            const cross = [
              tangent[1] * reference[2] - tangent[2] * reference[1],
              tangent[2] * reference[0] - tangent[0] * reference[2],
              tangent[0] * reference[1] - tangent[1] * reference[0]
            ];

            // Normalize
            const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
            if (crossLen > 0) {
              viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
            } else {
              viewUp = [0, 0, 1] as Types.Point3;
            }

            axialViewport.setCamera({
              position: cameraPos,
              focalPoint: valveCenterlinePos as Types.Point3,
              viewUp: viewUp,
              parallelScale: 100, // Increased to show more anatomy around valve
            });

            // Store the locked focal point for annulus definition
            lockedFocalPointRef.current = valveCenterlinePos as Types.Point3;
            console.log('🔒 Locked focal point at valve:', lockedFocalPointRef.current);

            axialViewport.render();

            // Force another render after a short delay to ensure it sticks
            setTimeout(() => {
              axialViewport.render();
              renderingEngine.renderViewports(['axial', 'sagittal', 'coronal']);
            }, 100);

            const camera = axialViewport.getCamera();
            console.log('✅ Axial viewport plane perpendicular to centerline at valve');
            console.log('   Camera position:', camera.position);
            console.log('   Focal point:', camera.focalPoint);
            console.log('   ViewUp:', camera.viewUp);
            console.log('   View plane normal:', camera.viewPlaneNormal);

            // CRITICAL FIX: Get the ACTUAL screen-space directions from the axial camera
            // Instead of using calculated viewUp and sagittalDirection, use what Cornerstone actually set up
            // This ensures the sagittal/coronal views match the crosshair lines exactly

            // Get actual viewUp from camera (this is the GREEN vertical line direction in screen space)
            const actualViewUp = camera.viewUp;

            // Calculate viewRight (RED horizontal line direction) = viewUp × viewPlaneNormal
            // IMPORTANT: Use actualViewUp × viewPlaneNormal (not the reverse) for correct right-hand coordinate system
            const viewPlaneNormal = camera.viewPlaneNormal;
            const actualViewRight = [
              actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
              actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
              actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
            ];

            // Normalize
            const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
            if (rightLen > 0) {
              actualViewRight[0] /= rightLen;
              actualViewRight[1] /= rightLen;
              actualViewRight[2] /= rightLen;
            }

            console.log('📐 Screen-space directions from axial camera:');
            console.log('   actualViewUp (GREEN line):', actualViewUp);
            console.log('   actualViewRight (RED line):', actualViewRight);
            console.log('   viewPlaneNormal (forward):', viewPlaneNormal);

            // CRITICAL FIX: Get initial rotation angle from FixedCrosshairTool
            // The crosshair might already have a rotation offset that we need to account for
            const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
            const fixedCrosshairTool = toolGroup?.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
            const initialRotation = fixedCrosshairTool?.getRotationAngle ? fixedCrosshairTool.getRotationAngle() : 0;

            console.log('🔄 Initial crosshair rotation:', (initialRotation * 180 / Math.PI).toFixed(1), '°');

            // Apply initial rotation to the screen-space directions
            // This ensures cameras match the actual crosshair line orientations
            const cos = Math.cos(initialRotation);
            const sin = Math.sin(initialRotation);

            // Rotate actualViewRight and actualViewUp by the initial rotation angle
            const rotatedViewRight = [
              actualViewRight[0] * cos - actualViewUp[0] * sin,
              actualViewRight[1] * cos - actualViewUp[1] * sin,
              actualViewRight[2] * cos - actualViewUp[2] * sin
            ];

            const rotatedViewUp = [
              actualViewRight[0] * sin + actualViewUp[0] * cos,
              actualViewRight[1] * sin + actualViewUp[1] * cos,
              actualViewRight[2] * sin + actualViewUp[2] * cos
            ];

            console.log('📐 Rotated directions (matching crosshair lines):');
            console.log('   rotatedViewUp (GREEN line after rotation):', rotatedViewUp);
            console.log('   rotatedViewRight (RED line after rotation):', rotatedViewRight);

            // Position sagittal viewport - looks perpendicular to GREEN line
            const sagittalViewport = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
            if (sagittalViewport) {
              const sagCameraPos = [
                valveCenterlinePos[0] + rotatedViewRight[0] * cameraDistance,
                valveCenterlinePos[1] + rotatedViewRight[1] * cameraDistance,
                valveCenterlinePos[2] + rotatedViewRight[2] * cameraDistance
              ] as Types.Point3;

              sagittalViewport.setCamera({
                position: sagCameraPos,
                focalPoint: valveCenterlinePos as Types.Point3,
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: 100,
              });

              sagittalViewport.render();
              console.log('✅ Sagittal viewport: camera perpendicular to GREEN line');
            }

            // Position coronal viewport - looks perpendicular to RED line
            const coronalViewport = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
            if (coronalViewport) {
              const corCameraPos = [
                valveCenterlinePos[0] + rotatedViewUp[0] * cameraDistance,
                valveCenterlinePos[1] + rotatedViewUp[1] * cameraDistance,
                valveCenterlinePos[2] + rotatedViewUp[2] * cameraDistance
              ] as Types.Point3;

              coronalViewport.setCamera({
                position: corCameraPos,
                focalPoint: valveCenterlinePos as Types.Point3,
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: 100,
              });

              coronalViewport.render();
              console.log('✅ Coronal viewport: camera perpendicular to RED line');
            }

            // For annulus definition, hide interactive crosshairs and show fixed ones
            setTimeout(() => {
              try {
                const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
                if (toolGroup) {
                  console.log('🔄 Switching to fixed crosshairs for annulus definition...');

                  // Disable interactive CrosshairsTool
                  toolGroup.setToolDisabled(CrosshairsTool.toolName);

                  // Enable FixedCrosshairTool and set its position
                  const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
                  if (fixedCrosshairTool) {
                    fixedCrosshairTool.setFixedPosition(valveCenterlinePos as Types.Point3, renderingEngineId);

                    // CRITICAL: Set tool to ACTIVE (not just enabled) so mouse callbacks work
                    toolGroup.setToolActive(FixedCrosshairTool.toolName, {
                      bindings: [{ mouseButton: MouseBindings.Primary }],
                    });

                    console.log('✅ Fixed crosshairs activated at valve position with rotation enabled');
                  }

                  // Force render all viewports to show fixed crosshairs
                  renderingEngine.renderViewports(['axial', 'sagittal', 'coronal']);
                }
              } catch (error) {
                console.error('Failed to setup fixed crosshairs:', error);
              }

              console.log('🔄 All viewports aligned to centerline-based coordinate system');
            }, 200);
          }
        }, 500); // Delay after tools are set up
      }

    } catch (err) {
      console.error('❌ Failed to initialize MPR Viewport:', err);
      setError(`Failed to load DICOM images: ${err}`);
      setIsLoading(false);
    }
  };

  const setupTools = async () => {
    try {
      console.log('🔧🔧🔧 SETUP TOOLS STARTING...');

      // Add tools to Cornerstone3D (exactly like App.tsx)
      cornerstoneTools.addTool(CrosshairsTool);
      cornerstoneTools.addTool(ZoomTool);
      cornerstoneTools.addTool(PanTool);
      cornerstoneTools.addTool(WindowLevelTool);
      cornerstoneTools.addTool(StackScrollTool);
      cornerstoneTools.addTool(SphereMarkerTool);
      cornerstoneTools.addTool(CuspNadirTool);
      cornerstoneTools.addTool(FixedCrosshairTool);

      // Destroy existing tool group if it exists
      try {
        const existingToolGroup = ToolGroupManager.getToolGroup(toolGroupId);
        if (existingToolGroup) {
          console.log('  🗑️ Destroying existing tool group');
          ToolGroupManager.destroyToolGroup(toolGroupId);
        }
      } catch (error) {
        // Tool group doesn't exist, which is fine
        console.log('  ✅ No existing tool group to destroy');
      }

      // Create tool group
      console.log('  🆕 Creating new tool group');
      const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);

      if (!toolGroup) {
        throw new Error('Failed to create tool group');
      }

      // Add Crosshairs tool and configure it to link the three viewports (exactly like App.tsx)
      // Note: Don't activate yet - wait until viewports are added
      // CRITICAL: During ANNULUS_DEFINITION, lock crosshair center at valve (allow rotation, no translation)
      toolGroup.addTool(CrosshairsTool.toolName, {
        getReferenceLineColor: (viewportId) => {
          const colors = {
            axial: "rgb(200, 0, 0)",
            sagittal: "rgb(200, 200, 0)",
            coronal: "rgb(0, 200, 0)",
          };
          return colors[viewportId];
        },
        // Allow all crosshair interactions (we'll lock focal point via event listener)
        getReferenceLineControllable: () => true,
        getReferenceLineDraggableRotatable: () => true,
        getReferenceLineSlabThicknessControlsOn: () => true,
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

      // Add FixedCrosshairTool for annulus definition (fixed, non-draggable crosshairs)
      toolGroup.addTool(FixedCrosshairTool.toolName);

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

      // CRITICAL: Activate CrosshairsTool BEFORE adding viewports (like App.tsx)
      // This is the correct order for proper synchronization
      console.log('  🎯 Activating CrosshairsTool BEFORE adding viewports...');
      toolGroup.setToolActive(CrosshairsTool.toolName, {
        bindings: [{
          mouseButton: MouseBindings.Primary,
        }],
      });
      console.log('  ✅ CrosshairsTool activated');

      // Add viewports to the tool group AFTER activating CrosshairsTool
      const viewportIds = ["axial", "sagittal", "coronal"];
      console.log('  📌 Adding viewports to tool group:', viewportIds);
      viewportIds.forEach((id) => {
        toolGroup.addViewport(id, renderingEngineId);
        console.log(`    - Added ${id} to tool group`);
      });

      // CRITICAL: Force render ALL viewports AFTER CrosshairsTool activation
      // This ensures CrosshairsTool's initial state is rendered correctly
      const renderingEngine = renderingEngineRef.current;
      if (renderingEngine) {
        console.log('  🎨 Force rendering all viewports...');
        renderingEngine.renderViewports(viewportIds);
        console.log('  ✅ Force rendered all viewports');
      }

      // Setup slab synchronizer
      const synchronizerId = 'MPR_SLAB_THICKNESS_SYNCHRONIZER_ID';
      if (!slabSynchronizerRef.current) {
        const synchronizer = createSlabThicknessSynchronizer(synchronizerId);
        slabSynchronizerRef.current = synchronizer;
        viewportIds.forEach((id) => {
          synchronizer.add({ renderingEngineId, viewportId: id });
        });
        synchronizer.setEnabled(true);
        console.log('  ✅ Created and enabled slab synchronizer');
      }

      console.log('✅✅✅ SETUP TOOLS COMPLETE');
    } catch (error) {
      console.error('❌ Failed to setup tools:', error);
      throw error;
    }
  };

  const handleToolChange = (toolName: string) => {
    try {
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (!toolGroup) return;

      // During annulus definition, keep CrosshairsTool disabled (don't set to passive)
      if (currentStage !== WorkflowStage.ANNULUS_DEFINITION) {
        toolGroup.setToolPassive(CrosshairsTool.toolName);
      }

      // Set other tools to passive first
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
        // During annulus definition, crosshairs are fixed (non-interactive)
        // Don't allow switching to regular crosshairs
        if (currentStage === WorkflowStage.ANNULUS_DEFINITION) {
          console.log('⚠️ Crosshairs are locked during annulus definition');
          return; // Don't activate regular crosshairs
        }

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

  // Handle stage changes to lock/unlock tools and switch crosshair modes
  useEffect(() => {
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    if (!toolGroup) return;

    const sphereTool = toolGroup.getToolInstance(SphereMarkerTool.toolName) as SphereMarkerTool;
    const cuspTool = toolGroup.getToolInstance(CuspNadirTool.toolName) as CuspNadirTool;
    const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;

    if (currentStage === WorkflowStage.ANNULUS_DEFINITION) {
      // Lock sphere tool, unlock cusp tool
      if (sphereTool && typeof sphereTool.setDraggable === 'function') {
        sphereTool.setDraggable(false);
      }
      if (cuspTool) {
        cuspTool.setDraggable(true);
      }

      // Switch to fixed crosshairs if we have a locked position
      if (lockedFocalPointRef.current && fixedCrosshairTool) {
        console.log('🔄 Switching to fixed crosshairs...');

        // Disable regular crosshairs and other primary button tools
        toolGroup.setToolDisabled(CrosshairsTool.toolName);
        toolGroup.setToolPassive(SphereMarkerTool.toolName);
        toolGroup.setToolPassive(WindowLevelTool.toolName);

        fixedCrosshairTool.setFixedPosition(lockedFocalPointRef.current, renderingEngineId);

        // CRITICAL: Set tool to ACTIVE (not just enabled) so mouse callbacks work
        toolGroup.setToolActive(FixedCrosshairTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });

        // Keep zoom and scroll active on their own bindings
        toolGroup.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Secondary }],
        });
        toolGroup.setToolActive(StackScrollTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Wheel }],
        });

        // Force render all viewports
        if (renderingEngineRef.current) {
          renderingEngineRef.current.renderViewports(['axial', 'sagittal', 'coronal']);
        }
      }

      console.log('🔒 Stage: Annulus Definition - Locked spheres, unlocked cusp dots, fixed crosshairs');
    } else {
      // Unlock sphere tool, lock cusp tool
      if (sphereTool && typeof sphereTool.setDraggable === 'function') {
        sphereTool.setDraggable(true);
      }
      if (cuspTool) {
        cuspTool.setDraggable(false);
      }

      // Switch back to regular crosshairs
      if (fixedCrosshairTool) {
        console.log('🔄 Switching to interactive crosshairs...');
        toolGroup.setToolDisabled(FixedCrosshairTool.toolName);
        fixedCrosshairTool.clearFixedPosition();
        toolGroup.setToolActive(CrosshairsTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });

        // Force render all viewports
        if (renderingEngineRef.current) {
          renderingEngineRef.current.renderViewports(['axial', 'sagittal', 'coronal']);
        }
      }

      console.log('🔓 Stage changed - Unlocked spheres, interactive crosshairs');
    }
  }, [currentStage]);

  const handleWindowLevelChange = (window: number, level: number) => {
    try {
      setWindowLevel({ window, level });

      // Apply window/level to all viewports
      const viewportIds = ["axial", "sagittal", "coronal"];
      const renderingEngine = renderingEngineRef.current || new RenderingEngine(renderingEngineId);

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

  // Listen for VOI changes from WindowLevel tool and update state
  useEffect(() => {
    if (!renderingEngineRef.current) return;

    const handleVOIModified = (evt: any) => {
      // Don't update state if we're currently switching phases
      if (isSwitchingPhaseRef.current) {
        console.log('📊 Ignoring VOI event during phase switch');
        return;
      }

      const { viewportId, volumeId, range } = evt.detail;

      // Calculate window/level from VOI range
      const newWindow = Math.round(range.upper - range.lower);
      const newLevel = Math.round((range.upper + range.lower) / 2);

      // Update state to match current viewport settings
      setWindowLevel({ window: newWindow, level: newLevel });

      console.log(`📊 W/L changed by tool: Window=${newWindow}, Level=${newLevel}`);
    };

    const handleCameraModified = (evt: any) => {
      const { element, camera } = evt.detail;

      // If we're NOT switching phases, this is a user interaction - save it
      if (!isSwitchingPhaseRef.current && element && camera) {
        const viewportId = element.viewportId || element.getAttribute?.('data-viewport-uid');
        if (viewportId) {
          // Update the saved camera state so phase switching uses the new position
          savedCameraStatesRef.current[viewportId] = camera;
        }
      }
    };

    // Listen for events
    document.addEventListener('CORNERSTONE_VOI_MODIFIED', handleVOIModified);
    document.addEventListener('CORNERSTONE_CAMERA_MODIFIED', handleCameraModified);

    return () => {
      document.removeEventListener('CORNERSTONE_VOI_MODIFIED', handleVOIModified);
      document.removeEventListener('CORNERSTONE_CAMERA_MODIFIED', handleCameraModified);
    };
  }, [renderingEngineRef.current]);

  // Lock crosshair focal point during annulus definition by using a synchronizer
  useEffect(() => {
    if (!renderingEngineRef.current || !lockedFocalPointRef.current || currentStage !== WorkflowStage.ANNULUS_DEFINITION) {
      return;
    }

    const renderingEngine = renderingEngineRef.current;
    const lockedFocalPoint = lockedFocalPointRef.current;
    const viewportIds = ['axial', 'sagittal', 'coronal'];

    console.log('🔒 Setting up focal point locking synchronizer');

    // Use requestAnimationFrame to continuously enforce the locked focal point
    let rafId: number;
    const enforceLock = () => {
      viewportIds.forEach(id => {
        try {
          const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
          if (viewport) {
            const camera = viewport.getCamera();
            const currentFocalPoint = camera.focalPoint;

            // Check if focal point has drifted
            const dx = currentFocalPoint[0] - lockedFocalPoint[0];
            const dy = currentFocalPoint[1] - lockedFocalPoint[1];
            const dz = currentFocalPoint[2] - lockedFocalPoint[2];
            const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

            if (distance > 0.1) { // Threshold to avoid floating point issues
              // Restore the locked focal point while preserving other camera properties
              viewport.setCamera({
                ...camera,
                focalPoint: lockedFocalPoint
              });
              console.log(`🔒 Enforced locked focal point on ${id} (drift: ${distance.toFixed(2)}mm)`);
            }
          }
        } catch (error) {
          // Viewport might not be ready yet
        }
      });

      // Continue the loop
      rafId = requestAnimationFrame(enforceLock);
    };

    // Start the enforcement loop
    rafId = requestAnimationFrame(enforceLock);

    console.log('✅ Focal point locking active');

    return () => {
      cancelAnimationFrame(rafId);
      console.log('🔓 Focal point locking deactivated');
    };
  }, [currentStage, lockedFocalPointRef.current, renderingEngineRef.current]);

  // Preload adjacent phases for smooth cine playback
  const preloadAdjacentPhases = async () => {
    if (!phaseInfo || !phaseInfo.isMultiPhase || selectedPhase === null || !patientInfo) {
      return;
    }

    try {
      const currentPhase = selectedPhase;
      const nextPhase = (currentPhase + 1) % phaseInfo.totalPhases;
      const prevPhase = (currentPhase - 1 + phaseInfo.totalPhases) % phaseInfo.totalPhases;

      // Preload next and previous phases
      for (const phaseIndex of [nextPhase, prevPhase]) {
        if (!preloadedVolumesRef.current[phaseIndex]) {
          console.log(`🔄 Preloading phase ${phaseIndex + 1}...`);

          const { imageIds: phaseImageIds } = await createImageIdsAndCacheMetaData({
            StudyInstanceUID: patientInfo.studyInstanceUID!,
            SeriesInstanceUID: patientInfo.seriesInstanceUID!,
            wadoRsRoot: "http://127.0.0.1/orthanc/dicom-web",
            selectedPhase: phaseIndex,
          });

          const phaseVolumeId = `streamingImageVolume_phase${phaseIndex}_${Date.now()}`;

          const phaseVolume = await volumeLoader.createAndCacheVolume(phaseVolumeId, {
            imageIds: phaseImageIds,
          });
          await phaseVolume.load();

          preloadedVolumesRef.current[phaseIndex] = phaseVolumeId;
          console.log(`✅ Preloaded phase ${phaseIndex + 1}`);
        }
      }
    } catch (error) {
      console.warn('Phase preloading error:', error);
    }
  };

  // Preload adjacent phases when phase changes (only when not in preloading mode)
  useEffect(() => {
    if (phaseInfo && phaseInfo.isMultiPhase && selectedPhase !== null && !isPreloading && allPhasesLoadedRef.current) {
      preloadAdjacentPhases();
    }
  }, [selectedPhase, phaseInfo, isPreloading]);

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
              onClick={() => handleWindowLevelChange(900, 350)}
              className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-white text-sm"
            >
              Angio
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

      {/* Image Info and Phase Controls */}
      {/* CRITICAL: Use absolute positioning to prevent layout shift that breaks CrosshairsTool */}
      <div
        className="px-3 py-2 bg-slate-900 border-b border-slate-700 text-xs text-slate-400 flex items-center justify-between absolute top-[60px] left-0 right-0 z-10"
        style={{
          opacity: (!isLoading && imageInfoRef.current) ? 1 : 0,
          pointerEvents: (!isLoading && imageInfoRef.current) ? 'auto' : 'none'
        }}
      >
          {imageInfoRef.current && (
            <>
              <div>
                <span className="mr-4">
                  Series: {patientInfo?.seriesInstanceUID}
                </span>
                <span className="mr-4">
                  Images: {imageInfoRef.current.numberOfImages}
                </span>
                <span className="mr-4">
                  Volume: {imageInfoRef.current.volumeId}
                </span>
                <span className="text-green-400">
                  {imageInfoRef.current.status}
                </span>
              </div>

              {/* Phase Controls - only show if multi-phase */}
              {phaseInfo && phaseInfo.isMultiPhase && (
            <div className="flex items-center gap-3">
              <span className="text-slate-300">Cardiac Phase:</span>
              <button
                onClick={() => setIsPlayingCine(!isPlayingCine)}
                className={`p-2 rounded ${isPlayingCine ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                title={isPlayingCine ? 'Pause Cine' : 'Play Cine'}
              >
                {isPlayingCine ? <FaPause /> : <FaPlay />}
              </button>
              <select
                value={selectedPhase ?? 0}
                onChange={(e) => {
                  setIsPlayingCine(false);
                  setSelectedPhase(parseInt(e.target.value));
                }}
                className="bg-slate-700 text-white px-3 py-1 rounded"
                disabled={isPreloading}
              >
                {phaseInfo.phases.map((phase, index) => (
                  <option key={index} value={index}>
                    {phase.phaseName || `Phase ${index + 1}`}
                  </option>
                ))}
              </select>
              {isPreloading ? (
                <span className="text-xs text-yellow-400 flex items-center gap-2">
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-yellow-400"></div>
                  Loading phases...
                </span>
              ) : (
                <span className="text-xs text-slate-400">
                  ({phaseInfo.totalPhases} phases, 1.5s loop)
                </span>
              )}
                </div>
              )}
            </>
          )}
      </div>

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