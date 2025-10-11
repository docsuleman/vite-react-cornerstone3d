import React, { useEffect, useRef, useState, useCallback } from 'react';
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
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkImageCPRMapper from '@kitware/vtk.js/Rendering/Core/ImageCPRMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { mat3, vec3 } from 'gl-matrix';

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
  renderMode?: 'mpr' | 'cpr'; // Toggle between standard MPR and straightened CPR
}

const ProperMPRViewport: React.FC<ProperMPRViewportProps> = ({
  patientInfo,
  onImageLoaded,
  onSpherePositionsUpdate,
  onCuspDotsUpdate,
  currentStage,
  existingSpheres,
  renderMode = 'mpr' // Default to standard MPR
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
  const [cprActorsReady, setCprActorsReady] = useState(false); // Track when CPR actors are set up
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
  const centerlineDataRef = useRef<any>(null); // Store centerline for scrolling
  const spherePositionsRef = useRef<Types.Point3[]>([]); // Store the 3 sphere positions
  const currentSphereIndexRef = useRef<number>(1); // Current sphere (0=LV, 1=valve, 2=ascending)
  const currentCenterlineIndexRef = useRef<number>(0); // Current position along centerline - now supports fractional values for smooth scrolling
  const cprScrollStepSizeRef = useRef<number>(0.1); // Fractional step size for CPR scrolling (in index units, not mm)
  const cuspDotsRef = useRef<{ id: string; pos: [number, number, number]; color: string; cuspType: string }[]>([]); // Store cusp dots
  const savedCameraZoomRef = useRef<number>(60); // Store zoom level (parallelScale) for preservation between stages
  const annulusLineActorsRef = useRef<{ sagittal: any; coronal: any } | null>(null); // Store annulus reference line actors
  const cprPositionLineActorsRef = useRef<{ sagittal: any; coronal: any } | null>(null); // Store CPR position indicator line actors
  const cprPositionRatioRef = useRef<number>(0); // Store current position ratio for redrawing after render
  const cprAnnulusRatioRef = useRef<number | undefined>(undefined); // Store annulus position ratio for reference line
  const cprActorsRef = useRef<{ actor: any; mapper: any; viewportId: string; config: any }[]>([]); // Store CPR actors and mappers when in CPR mode
  const currentVolumeRef = useRef<any>(null); // Store current volume for CPR conversion
  const centerlinePolyDataRef = useRef<any>(null); // Store VTK centerline polydata for CPR rotation
  const cprRotationAngleRef = useRef<number>(0); // Store cumulative CPR rotation angle in radians
  const cprRotationCallbackRef = useRef<((deltaAngle: number) => void) | null>(null); // Store CPR rotation callback in stable ref
  const renderModeRef = useRef<string>(renderMode); // Store current render mode to avoid closure issues
  const originalCameraStatesRef = useRef<{ [viewportId: string]: any }>({}); // Store original camera states before CPR
  const isSettingUpCPRRef = useRef<boolean>(false); // Prevent concurrent setupCPRActors calls
  const axialReferenceFrameRef = useRef<{ viewUp: Types.Point3; viewRight: Types.Point3; viewPlaneNormal: Types.Point3 } | null>(null); // Store axial camera reference frame for rotation

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

  // Setup/cleanup CPR actors when render mode changes
  useEffect(() => {
    const renderingEngine = renderingEngineRef.current;
    if (!renderingEngine) return;

    if (renderMode === 'cpr' && centerlineDataRef.current && currentVolumeRef.current) {
      console.log('🔄 Render mode changed to CPR, setting up CPR actors...');

      // Save camera states NOW, before any modifications (only if not already saved)
      if (Object.keys(originalCameraStatesRef.current).length === 0) {
        const viewportsToSave = ['axial', 'sagittal', 'coronal']; // Save all three viewports
        viewportsToSave.forEach(viewportId => {
          const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
          if (viewport) {
            const camera = viewport.getCamera();
            originalCameraStatesRef.current[viewportId] = {
              position: [...camera.position] as Types.Point3,
              focalPoint: [...camera.focalPoint] as Types.Point3,
              viewUp: [...camera.viewUp] as Types.Point3,
              parallelScale: camera.parallelScale
            };
            console.log(`💾 [PRE-CPR] Saved original camera state for ${viewportId}:`, originalCameraStatesRef.current[viewportId]);
          }
        });
      }

      // Mark actors as not ready (rotation angle will be captured after CPR setup)
      setCprActorsReady(false);
      // Wait a bit for viewports to be ready, then setup actors
      // Callback will be set automatically by the useEffect once actors are ready
      setTimeout(async () => {
        // CRITICAL: Capture rotation angle BEFORE setupCPRActors
        // setupCPRActors uses cprRotationAngleRef.current to set initial rotation on mappers
        const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
        if (toolGroup) {
          const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as any;
          if (fixedCrosshairTool && typeof fixedCrosshairTool.getRotationAngle === 'function') {
            const currentRotation = fixedCrosshairTool.getRotationAngle();
            console.log(`📐 Capturing current crosshair rotation BEFORE CPR setup: ${(currentRotation * 180 / Math.PI).toFixed(1)}° (${currentRotation.toFixed(4)} rad)`);

            // Store rotation angle BEFORE setupCPRActors so it can use it
            cprRotationAngleRef.current = currentRotation;
          } else {
            console.warn('⚠️ Could not get crosshair rotation angle, using 0°');
            cprRotationAngleRef.current = 0;
          }
        } else {
          console.warn('⚠️ Tool group not found, using rotation 0°');
          cprRotationAngleRef.current = 0;
        }

        // Now setup CPR actors - they will use the rotation angle we just captured
        await setupCPRActors();
        console.log('✅ CPR actors setup complete with initial rotation');

        setCprActorsReady(true); // Mark actors as ready

        // Initialize CPR position indicator lines at current centerline index
        requestAnimationFrame(() => {
          updateCPRPositionLines(currentCenterlineIndexRef.current);
          console.log('✅ CPR position indicator lines initialized');
        });
      }, 500);
    } else if (renderMode === 'mpr') {
      console.log('🔄 Render mode changed to MPR, removing CPR actors...');
      setCprActorsReady(false); // Mark actors as not ready
      // Remove CPR actors when switching back to MPR
      cprActorsRef.current.forEach(({ actor, viewportId }) => {
        const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
        if (viewport) {
          try {
            viewport.removeActors([`cprActor_${viewportId}`]);
          } catch (e) {
            console.warn('Failed to remove CPR actor:', e);
          }
        }
      });
      cprActorsRef.current = [];

      // Clear CPR position indicator lines reference (canvas drawings will be cleared on viewport render)
      cprPositionLineActorsRef.current = null;
      console.log('🧹 Cleared CPR position indicator lines');

      // Show volume actors again and restore camera states
      const viewportIds = ['axial', 'sagittal', 'coronal'];
      viewportIds.forEach(id => {
        const viewport = renderingEngine.getViewport(id) as Types.IVolumeViewport;
        if (viewport) {
          // Re-enable volume actors
          const allActors = viewport.getActors();
          allActors.forEach((actorEntry: any) => {
            if (actorEntry.actor && typeof actorEntry.actor.setVisibility === 'function') {
              actorEntry.actor.setVisibility(true);
              console.log(`  👁️ Restored volume actor visibility in ${id}`);
            }
          });

          // Restore original camera state if available, otherwise reset camera
          const savedCamera = originalCameraStatesRef.current[id];
          if (savedCamera) {
            console.log(`📷 Restoring original camera for ${id}:`, savedCamera);
            viewport.setCamera(savedCamera);
          } else {
            console.log(`🔄 Resetting camera for ${id} (no saved state)`);
            viewport.resetCamera();
          }

          viewport.render();
        }
      });

      // Force a full re-render of all viewports
      renderingEngine.renderViewports(viewportIds);

      // CRITICAL: Jump to valve/annulus point to trigger scroll synchronization
      // This ensures all viewports are correctly aligned when switching back to MPR
      if (centerlineDataRef.current) {
        const numCenterlinePoints = centerlineDataRef.current.position.length / 3;

        // Find the centerline point closest to the red sphere (aortic valve, index 1)
        let targetIndex = -1;

        if (spherePositionsRef.current.length >= 2) {
          // Get the red sphere position (middle sphere - aortic valve at index 1)
          const redSpherePos = spherePositionsRef.current[1]; // [x, y, z]

          // Find the closest centerline point to the red sphere
          let minDistance = Infinity;
          let closestIndex = -1;

          for (let i = 0; i < numCenterlinePoints; i++) {
            const x = centerlineDataRef.current.position[i * 3];
            const y = centerlineDataRef.current.position[i * 3 + 1];
            const z = centerlineDataRef.current.position[i * 3 + 2];

            const distance = Math.sqrt(
              Math.pow(x - redSpherePos[0], 2) +
              Math.pow(y - redSpherePos[1], 2) +
              Math.pow(z - redSpherePos[2], 2)
            );

            if (distance < minDistance) {
              minDistance = distance;
              closestIndex = i;
            }
          }

          if (closestIndex >= 0) {
            targetIndex = closestIndex;
            console.log(`🎯 Found centerline point closest to red sphere (valve) at index ${targetIndex}/${numCenterlinePoints} (distance: ${minDistance.toFixed(2)}mm)`);
          }
        }

        // Fallback: Try to find annulus plane marker in modified centerline
        if (targetIndex < 0) {
          const modifiedCenterline = centerlineDataRef.current.modifiedCenterline;
          if (modifiedCenterline && Array.isArray(modifiedCenterline)) {
            const annulusIndex = modifiedCenterline.findIndex((p: any) => p.isAnnulusPlane === true);
            if (annulusIndex >= 0) {
              const ratio = annulusIndex / modifiedCenterline.length;
              targetIndex = Math.round(ratio * (numCenterlinePoints - 1));
              console.log(`🎯 Found annulus plane marker at index ${targetIndex}/${numCenterlinePoints}`);
            }
          }
        }

        // Final fallback: Use 40% through centerline
        if (targetIndex < 0) {
          targetIndex = Math.round(numCenterlinePoints * 0.4);
          console.log(`🎯 Using calculated annulus position at ~40% of centerline: index ${targetIndex}/${numCenterlinePoints}`);
        }

        // Update current index and trigger scroll synchronization
        if (targetIndex >= 0 && targetIndex < numCenterlinePoints) {
          currentCenterlineIndexRef.current = targetIndex;

          // Manually update axial viewport camera at this centerline position
          const axialViewport = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
          if (axialViewport) {
            // Get position at target index
            const position = [
              centerlineDataRef.current.position[targetIndex * 3],
              centerlineDataRef.current.position[targetIndex * 3 + 1],
              centerlineDataRef.current.position[targetIndex * 3 + 2]
            ] as Types.Point3;

            // Calculate tangent at this position
            let tangent: Types.Point3;
            if (targetIndex > 0 && targetIndex < numCenterlinePoints - 1) {
              const prevPos = [
                centerlineDataRef.current.position[(targetIndex - 1) * 3],
                centerlineDataRef.current.position[(targetIndex - 1) * 3 + 1],
                centerlineDataRef.current.position[(targetIndex - 1) * 3 + 2]
              ];
              const nextPos = [
                centerlineDataRef.current.position[(targetIndex + 1) * 3],
                centerlineDataRef.current.position[(targetIndex + 1) * 3 + 1],
                centerlineDataRef.current.position[(targetIndex + 1) * 3 + 2]
              ];
              tangent = [
                (nextPos[0] - prevPos[0]) / 2,
                (nextPos[1] - prevPos[1]) / 2,
                (nextPos[2] - prevPos[2]) / 2
              ] as Types.Point3;
            } else {
              tangent = [0, 0, 1] as Types.Point3;
            }

            // Normalize tangent
            const tangentLength = Math.sqrt(tangent[0] ** 2 + tangent[1] ** 2 + tangent[2] ** 2);
            if (tangentLength > 0) {
              tangent = [tangent[0] / tangentLength, tangent[1] / tangentLength, tangent[2] / tangentLength] as Types.Point3;
            }

            // Update axial camera to look perpendicular to centerline at this position
            // Use saved parallelScale to maintain zoom level
            const savedAxialCamera = originalCameraStatesRef.current['axial'];
            const cameraDistance = 200;
            const newCameraPos = [
              position[0] + tangent[0] * cameraDistance,
              position[1] + tangent[1] * cameraDistance,
              position[2] + tangent[2] * cameraDistance
            ] as Types.Point3;

            // Calculate viewUp perpendicular to tangent
            let viewUp: Types.Point3;
            const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
            const cross = [
              tangent[1] * reference[2] - tangent[2] * reference[1],
              tangent[2] * reference[0] - tangent[0] * reference[2],
              tangent[0] * reference[1] - tangent[1] * reference[0]
            ];
            const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
            if (crossLen > 0) {
              viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
            } else {
              viewUp = [0, 0, 1] as Types.Point3;
            }

            axialViewport.setCamera({
              position: newCameraPos,
              focalPoint: position,
              viewUp: viewUp,
              parallelScale: savedAxialCamera?.parallelScale || 60, // Use saved zoom level or default to 60
            });
            axialViewport.render();

            console.log(`✅ Updated axial viewport to centerline index ${targetIndex}`);

            // Directly update sagittal and coronal viewports to be centered on the annulus point
            // Get the actual camera after setting (to get viewPlaneNormal)
            const updatedCamera = axialViewport.getCamera();
            const viewPlaneNormal = updatedCamera.viewPlaneNormal;
            const actualViewUp = updatedCamera.viewUp;

            // Calculate actualViewRight (perpendicular to viewUp and viewPlaneNormal)
            const actualViewRight = [
              actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
              actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
              actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
            ];

            const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
            if (rightLen > 0) {
              actualViewRight[0] /= rightLen;
              actualViewRight[1] /= rightLen;
              actualViewRight[2] /= rightLen;
            }

            // Apply rotation if any
            const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
            const fixedCrosshairTool = toolGroup?.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
            const rotationAngle = fixedCrosshairTool?.getRotationAngle() || 0;

            const cos = Math.cos(rotationAngle);
            const sin = Math.sin(rotationAngle);

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

            // Update sagittal viewport - centered on annulus point
            const sagittalVp = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
            if (sagittalVp) {
              const savedSagCamera = originalCameraStatesRef.current['sagittal'];
              const sagCameraPos = [
                position[0] + rotatedViewRight[0] * cameraDistance,
                position[1] + rotatedViewRight[1] * cameraDistance,
                position[2] + rotatedViewRight[2] * cameraDistance
              ] as Types.Point3;

              sagittalVp.setCamera({
                position: sagCameraPos,
                focalPoint: position, // Centered on annulus point
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: savedSagCamera?.parallelScale || sagittalVp.getCamera().parallelScale
              });
              sagittalVp.render();
              console.log(`✅ Updated sagittal viewport centered on annulus point`);
            }

            // Update coronal viewport - centered on annulus point
            const coronalVp = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
            if (coronalVp) {
              const savedCorCamera = originalCameraStatesRef.current['coronal'];
              const corCameraPos = [
                position[0] + rotatedViewUp[0] * cameraDistance,
                position[1] + rotatedViewUp[1] * cameraDistance,
                position[2] + rotatedViewUp[2] * cameraDistance
              ] as Types.Point3;

              coronalVp.setCamera({
                position: corCameraPos,
                focalPoint: position, // Centered on annulus point
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: savedCorCamera?.parallelScale || coronalVp.getCamera().parallelScale
              });
              coronalVp.render();
              console.log(`✅ Updated coronal viewport centered on annulus point`);
            }
          }
        }
      }

      // Clear saved camera states so they can be re-saved next time
      originalCameraStatesRef.current = {};

      console.log('✅ MPR mode restored with camera states and annulus plane navigation');
    }
  }, [renderMode]);

  // Sync window/level changes to CPR actors
  useEffect(() => {
    if (renderMode === 'cpr' && cprActorsRef.current.length > 0 && renderingEngineRef.current) {
      console.log('🎨 Syncing window/level to CPR actors:', windowLevel);
      cprActorsRef.current.forEach(({ actor }) => {
        const property = actor.getProperty();
        property.setColorWindow(windowLevel.window);
        property.setColorLevel(windowLevel.level);
      });
      renderingEngineRef.current.renderViewports(['axial', 'sagittal', 'coronal']);
    }
  }, [windowLevel, renderMode]);

  // Create the CPR rotation callback function and store it in ref
  // This function is created once and stored, not recreated on every render
  // Update renderMode ref whenever it changes
  useEffect(() => {
    renderModeRef.current = renderMode;
    console.log(`📝 Render mode updated to: ${renderMode}`);
  }, [renderMode]);

  const createCPRRotationCallback = useCallback(() => {
    const callback = (deltaAngle: number) => {
      console.log(`🔄 CPR Rotation callback called! renderMode=${renderModeRef.current}, deltaAngle=${deltaAngle.toFixed(4)}`);

      // NEGATE deltaAngle to fix rotation direction (clockwise crosshair = clockwise CPR)
      cprRotationAngleRef.current += -deltaAngle;
      const totalAngle = cprRotationAngleRef.current;

      // Update direction matrices for all CPR actors (no need to recreate!)
      console.log(`🔄 CPR Rotation - Total angle: ${(totalAngle * 180 / Math.PI).toFixed(1)}°, CPR actors count: ${cprActorsRef.current.length}`);

      // Update rotation using setDirectionMatrix (fast, no recreation needed)
      updateCPRRotations(totalAngle);
      console.log(`✅ CPR rotation complete at ${(totalAngle * 180 / Math.PI).toFixed(1)}°`);
    };

    cprRotationCallbackRef.current = callback;
    return callback;
  }, []); // Empty deps - create once and reuse

  // Function to ensure CPR rotation callback is set on the tool
  const ensureCPRRotationCallbackSet = useCallback(() => {
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    if (!toolGroup) return false;

    const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
    if (!fixedCrosshairTool || typeof fixedCrosshairTool.setCPRRotationCallback !== 'function') {
      return false;
    }

    // Create callback if not already created
    if (!cprRotationCallbackRef.current) {
      createCPRRotationCallback();
    }

    // Set the callback on the tool
    fixedCrosshairTool.setCPRRotationCallback(cprRotationCallbackRef.current);
    return true;
  }, [createCPRRotationCallback]);

  // Manage CPR rotation callback based on render mode
  useEffect(() => {
    if (renderMode === 'mpr') {
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (toolGroup) {
        const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
        if (fixedCrosshairTool && typeof fixedCrosshairTool.setCPRRotationCallback === 'function') {
          fixedCrosshairTool.setCPRRotationCallback(null);
          cprRotationAngleRef.current = 0;
          cprRotationCallbackRef.current = null;
        }
      }
    }
  }, [renderMode]);

  // Ensure CPR callback is always set when CPR actors are ready
  useEffect(() => {
    if (renderMode !== 'cpr' || !cprActorsReady) {
      return;
    }

    console.log('🔧 Setting up CPR rotation callback...');
    const success = ensureCPRRotationCallbackSet();
    if (success) {
      console.log('✅ CPR rotation callback successfully set on FixedCrosshairTool');
    } else {
      console.warn('⚠️ Failed to set CPR rotation callback');
    }

    // Re-check periodically to ensure callback stays set
    // Only re-set if callback is actually null/undefined (truly lost), not if reference changed
    const intervalId = setInterval(() => {
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (toolGroup) {
        const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as any;
        if (fixedCrosshairTool && typeof fixedCrosshairTool.getCPRRotationCallback === 'function') {
          const currentCallback = fixedCrosshairTool.getCPRRotationCallback();
          // Only re-set if callback is null/undefined (truly missing)
          // Don't care about reference equality - different reference is okay after mode switch
          if (!currentCallback) {
            console.log('🔄 Re-setting CPR rotation callback (was lost)');
            ensureCPRRotationCallbackSet();
          }
        }
      }
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [renderMode, cprActorsReady, ensureCPRRotationCallbackSet]);

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

  // Helper function to convert Cornerstone volume to VTK ImageData
  const convertCornerstoneVolumeToVTK = async (volume: any): Promise<any> => {
    try {
      // Get volume data using voxelManager (avoids timeout issues)
      const scalarData = volume.voxelManager.getCompleteScalarDataArray();

      if (!scalarData || scalarData.length === 0) {
        throw new Error('Volume scalar data is empty or not available');
      }

      const { dimensions, spacing, origin, direction } = volume;

      // Create VTK ImageData
      const imageData = vtkImageData.newInstance();
      imageData.setDimensions(dimensions);
      imageData.setSpacing(spacing);
      imageData.setOrigin(origin);
      imageData.setDirection(direction);

      // Create scalar array manually
      const scalarArray = vtkDataArray.newInstance({
        name: 'Pixels',
        numberOfComponents: 1,
        values: scalarData
      });

      // Set the scalars on the imageData
      imageData.getPointData().setScalars(scalarArray);

      console.log('✅ Converted Cornerstone volume to VTK ImageData');
      return imageData;
    } catch (error) {
      console.error('❌ Failed to convert volume to VTK:', error);
      throw error;
    }
  };

  // Helper to rotate a vector around an axis by an angle (Rodrigues' formula)
  const rotateVectorAroundAxis = (v: number[], axis: number[], angle: number): number[] => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dot = v[0]*axis[0] + v[1]*axis[1] + v[2]*axis[2];

    return [
      v[0]*cos + (axis[1]*v[2] - axis[2]*v[1])*sin + axis[0]*dot*(1-cos),
      v[1]*cos + (axis[2]*v[0] - axis[0]*v[2])*sin + axis[1]*dot*(1-cos),
      v[2]*cos + (axis[0]*v[1] - axis[1]*v[0])*sin + axis[2]*dot*(1-cos)
    ];
  };

  // Helper function to densely interpolate centerline points to reduce banding artifacts
  const interpolateCenterline = (originalPoints: Float32Array, targetNumPoints: number = 500): Float32Array => {
    const numOriginal = originalPoints.length / 3;

    // Calculate cumulative arc lengths
    const arcLengths = [0];
    for (let i = 1; i < numOriginal; i++) {
      const dx = originalPoints[i*3] - originalPoints[(i-1)*3];
      const dy = originalPoints[i*3+1] - originalPoints[(i-1)*3+1];
      const dz = originalPoints[i*3+2] - originalPoints[(i-1)*3+2];
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      arcLengths.push(arcLengths[i-1] + dist);
    }

    const totalLength = arcLengths[numOriginal - 1];
    const interpolated = new Float32Array(targetNumPoints * 3);

    // Interpolate points evenly along arc length
    for (let i = 0; i < targetNumPoints; i++) {
      const targetLength = (i / (targetNumPoints - 1)) * totalLength;

      // Find segment containing this arc length
      let segmentIdx = 0;
      for (let j = 1; j < arcLengths.length; j++) {
        if (arcLengths[j] >= targetLength) {
          segmentIdx = j - 1;
          break;
        }
      }

      // Interpolate within segment
      const segmentStart = arcLengths[segmentIdx];
      const segmentEnd = arcLengths[segmentIdx + 1];
      const t = segmentEnd > segmentStart ? (targetLength - segmentStart) / (segmentEnd - segmentStart) : 0;

      interpolated[i*3] = originalPoints[segmentIdx*3] + t * (originalPoints[(segmentIdx+1)*3] - originalPoints[segmentIdx*3]);
      interpolated[i*3+1] = originalPoints[segmentIdx*3+1] + t * (originalPoints[(segmentIdx+1)*3+1] - originalPoints[segmentIdx*3+1]);
      interpolated[i*3+2] = originalPoints[segmentIdx*3+2] + t * (originalPoints[(segmentIdx+1)*3+2] - originalPoints[segmentIdx*3+2]);
    }

    return interpolated;
  };

  // Helper function to convert centerline to VTK PolyData with orientation tensors for straightened mode
  const convertCenterlineToVTKPolyData = (centerlineData: any, rotationAngle: number = 0): any => {
    try {
      // CRITICAL: Densely interpolate centerline to avoid banding artifacts
      const originalPoints = new Float32Array(centerlineData.position);
      const pointsArray = interpolateCenterline(originalPoints, 500);
      const numPoints = pointsArray.length / 3;

      console.log(`📊 Interpolated centerline from ${originalPoints.length/3} to ${numPoints} points`);

      const polyData = vtkPolyData.newInstance();
      const points = vtkPoints.newInstance();
      const lines = vtkCellArray.newInstance();

      points.setData(pointsArray, 3);

      // Calculate orientation matrices using ROTATION-MINIMIZING FRAMES
      // VTK ImageCPRMapper expects 3x3 orientation matrices (9 components per point)
      const orientationMatrices = new Float32Array(numPoints * 9); // 3x3 matrix per point

      // Use a CONSTANT reference direction (world "up" = patient superior) for all points
      // This prevents wobble/twist as frame propagates along centerline
      const worldUp = [0, 0, 1]; // Z-axis = superior in patient coordinates

      for (let i = 0; i < numPoints; i++) {
        // Calculate tangent at this point
        let tangent: number[];

        if (i === 0) {
          // First point: use direction to next point
          if (numPoints > 1) {
            tangent = [
              pointsArray[3] - pointsArray[0],
              pointsArray[4] - pointsArray[1],
              pointsArray[5] - pointsArray[2]
            ];
          } else {
            tangent = [0, 0, 1];
          }
        } else if (i === numPoints - 1) {
          // Last point: use direction from previous
          tangent = [
            pointsArray[i * 3] - pointsArray[(i - 1) * 3],
            pointsArray[i * 3 + 1] - pointsArray[(i - 1) * 3 + 1],
            pointsArray[i * 3 + 2] - pointsArray[(i - 1) * 3 + 2]
          ];
        } else {
          // Middle points: average of directions
          tangent = [
            (pointsArray[(i + 1) * 3] - pointsArray[(i - 1) * 3]) / 2,
            (pointsArray[(i + 1) * 3 + 1] - pointsArray[(i - 1) * 3 + 1]) / 2,
            (pointsArray[(i + 1) * 3 + 2] - pointsArray[(i - 1) * 3 + 2]) / 2
          ];
        }

        // Normalize tangent
        const tangentLength = Math.sqrt(tangent[0] * tangent[0] + tangent[1] * tangent[1] + tangent[2] * tangent[2]);
        if (tangentLength > 0) {
          tangent[0] /= tangentLength;
          tangent[1] /= tangentLength;
          tangent[2] /= tangentLength;
        } else {
          tangent = [0, 0, 1];
        }

        // Calculate normal: project worldUp onto plane perpendicular to tangent
        // normal = worldUp - (worldUp · tangent) * tangent
        const dot = worldUp[0] * tangent[0] + worldUp[1] * tangent[1] + worldUp[2] * tangent[2];
        let normal = [
          worldUp[0] - dot * tangent[0],
          worldUp[1] - dot * tangent[1],
          worldUp[2] - dot * tangent[2]
        ];

        // Normalize normal
        const normalLength = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
        if (normalLength > 1e-6) {
          normal[0] /= normalLength;
          normal[1] /= normalLength;
          normal[2] /= normalLength;
        } else {
          // Tangent is parallel to worldUp - use a different reference
          const altRef = [1, 0, 0];
          const altDot = altRef[0] * tangent[0] + altRef[1] * tangent[1] + altRef[2] * tangent[2];
          normal = [
            altRef[0] - altDot * tangent[0],
            altRef[1] - altDot * tangent[1],
            altRef[2] - altDot * tangent[2]
          ];
          const altNormalLength = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
          if (altNormalLength > 0) {
            normal[0] /= altNormalLength;
            normal[1] /= altNormalLength;
            normal[2] /= altNormalLength;
          }
        }

        // Calculate binormal = tangent × normal (right-handed system)
        const binormal = [
          tangent[1] * normal[2] - tangent[2] * normal[1],
          tangent[2] * normal[0] - tangent[0] * normal[2],
          tangent[0] * normal[1] - tangent[1] * normal[0]
        ];

        // Store orientation matrix for this point (3x3, COLUMN-MAJOR: [normal, binormal, tangent])
        const offset = i * 9;
        orientationMatrices[offset + 0] = normal[0];
        orientationMatrices[offset + 1] = binormal[0];
        orientationMatrices[offset + 2] = tangent[0];
        orientationMatrices[offset + 3] = normal[1];
        orientationMatrices[offset + 4] = binormal[1];
        orientationMatrices[offset + 5] = tangent[1];
        orientationMatrices[offset + 6] = normal[2];
        orientationMatrices[offset + 7] = binormal[2];
        orientationMatrices[offset + 8] = tangent[2];
      }

      // Create line connectivity
      const lineArray = new Uint32Array(numPoints + 1);
      lineArray[0] = numPoints;
      for (let i = 0; i < numPoints; i++) {
        lineArray[i + 1] = i;
      }

      lines.setData(lineArray);

      // Set up polydata
      polyData.setPoints(points);
      polyData.setLines(lines);

      // Add orientation matrices as point data (9 components for 3x3 matrix)
      // CRITICAL: Must be named "Orientation" for vtkImageCPRMapper to recognize it
      const orientationData = vtkDataArray.newInstance({
        name: 'Orientation',
        numberOfComponents: 9,
        values: orientationMatrices,
      });
      polyData.getPointData().addArray(orientationData);

      console.log(`✅ Converted centerline to VTK PolyData with ${numPoints} points and orientation matrices (rotation: ${(rotationAngle * 180 / Math.PI).toFixed(1)}°)`);
      return polyData;
    } catch (error) {
      console.error('❌ Failed to convert centerline to VTK:', error);
      throw error;
    }
  };

  // Helper function to setup CPR actors on Cornerstone viewports
  const setupCPRActors = async () => {
    // Guard against concurrent calls
    if (isSettingUpCPRRef.current) {
      console.log('⏭️ Skipping CPR setup - already in progress');
      return;
    }

    try {
      isSettingUpCPRRef.current = true;
      console.log('🔄 Setting up CPR actors...');

      if (!currentVolumeRef.current || !centerlineDataRef.current) {
        console.warn('⚠️ Volume or centerline not available for CPR setup');
        isSettingUpCPRRef.current = false;
        return;
      }

      const renderingEngine = renderingEngineRef.current;
      if (!renderingEngine) {
        console.warn('⚠️ Rendering engine not available');
        isSettingUpCPRRef.current = false;
        return;
      }

      // Convert Cornerstone volume to VTK ImageData
      const vtkImageData = await convertCornerstoneVolumeToVTK(currentVolumeRef.current);

      // Get current rotation angle
      const rotationAngle = cprRotationAngleRef.current;

      // Clear any existing CPR actors
      cprActorsRef.current.forEach(({ actor, viewportId }) => {
        const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
        if (viewport) {
          try {
            viewport.removeActors([`cprActor_${viewportId}`]);
          } catch (e) {
            console.warn('Failed to remove existing CPR actor:', e);
          }
        }
      });
      cprActorsRef.current = [];

      // Create CPR actors ONLY for sagittal and coronal (axial stays as cross-section)
      // Use straightened mode with orientation tensors for rotation support
      // Swapped sagittal and coronal viewports
      const viewportConfigs = [
        { id: 'coronal', mode: 'straightened', cprWidth: 50, rotationOffset: 0 },  // 0° offset
        { id: 'sagittal', mode: 'straightened', cprWidth: 50, rotationOffset: Math.PI / 2 }  // 90° offset - orthogonal to coronal
      ];

      // First pass: Create all mappers and actors
      const setupData: Array<{ config: any; viewport: any; mapper: any; actor: any }> = [];

      for (const config of viewportConfigs) {
        const viewport = renderingEngine.getViewport(config.id) as Types.IVolumeViewport;
        if (!viewport) {
          console.warn(`⚠️ Viewport ${config.id} not found`);
          continue;
        }

        // Calculate rotation angle for this viewport (base rotation + offset for orthogonal views)
        const currentRotation = cprRotationAngleRef.current;
        const viewportRotation = currentRotation + config.rotationOffset;

        // CRITICAL: Create SEPARATE centerline WITHOUT rotation in orientation matrices
        // Orientation matrices provide smooth parallel transport only
        const viewportCenterline = convertCenterlineToVTKPolyData(centerlineDataRef.current, 0);

        // Create CPR mapper
        const mapper = vtkImageCPRMapper.newInstance();
        mapper.setBackgroundColor(0, 0, 0, 0); // Transparent background

        // Use straightened mode with orientation tensors
        mapper.useStraightenedMode();

        // Set image data and centerline (orientation matrices for smooth parallel transport)
        mapper.setImageData(vtkImageData);
        mapper.setCenterlineData(viewportCenterline);
        mapper.setWidth(config.cprWidth);

        // Apply rotation via direction matrix (like TrueCPRViewport)
        const cos = Math.cos(viewportRotation);
        const sin = Math.sin(viewportRotation);
        const directions = new Float32Array([
          cos, -sin, 0,
          sin, cos, 0,
          0, 0, 1
        ]);
        mapper.setDirectionMatrix(directions);

        // Force mapper to update
        mapper.modified();

        console.log(`✅ CPR mapper configured for ${config.id}:`, {
          mode: config.mode,
          width: config.cprWidth,
          rotation: `${(viewportRotation * 180 / Math.PI).toFixed(1)}°`,
          rotationOffset: `${(config.rotationOffset * 180 / Math.PI).toFixed(1)}°`,
          height: mapper.getHeight(),
          centerlinePoints: viewportCenterline.getPoints().getNumberOfPoints()
        });

        // Create actor
        const actor = vtkImageSlice.newInstance();
        actor.setMapper(mapper);

        // Set window/level on actor property
        const property = actor.getProperty();
        property.setColorWindow(windowLevel.window);
        property.setColorLevel(windowLevel.level);
        property.setInterpolationTypeToLinear();

        setupData.push({ config, viewport, mapper, actor });

        // Store mapper reference for later rotation updates
        cprActorsRef.current.push({ actor, mapper, viewportId: config.id, config });
      }

      // Second pass: Add actors to viewports
      for (const { config, viewport, actor } of setupData) {
        // CRITICAL: Hide all volume actors before adding CPR actor
        // Otherwise the volume will render on top of the CPR
        const allActors = viewport.getActors();
        allActors.forEach((actorEntry: any) => {
          if (actorEntry.actor && typeof actorEntry.actor.setVisibility === 'function') {
            actorEntry.actor.setVisibility(false);
            console.log(`  🙈 Hid volume actor in ${config.id}`);
          }
        });

        // Add actor to Cornerstone viewport
        const actorUID = `cprActor_${config.id}`;
        viewport.addActor({ uid: actorUID, actor });

        // Set up camera for CPR viewing
        const bounds = actor.getBounds();
        if (bounds && bounds.length === 6) {
          const center = [
            (bounds[0] + bounds[1]) / 2,
            (bounds[2] + bounds[3]) / 2,
            (bounds[4] + bounds[5]) / 2
          ];

          const maxDim = Math.max(
            bounds[1] - bounds[0],
            bounds[3] - bounds[2],
            bounds[5] - bounds[4]
          );

          // Position camera to look at the CPR reconstruction
          const cameraConfig = {
            position: [center[0], center[1], center[2] + maxDim] as Types.Point3,
            focalPoint: center as Types.Point3,
            viewUp: [0, 1, 0] as Types.Point3,
            parallelScale: maxDim / 2
          };

          viewport.setCamera(cameraConfig);
        }

        // Render this viewport
        viewport.render();

        console.log(`✅ Added CPR actor to ${config.id} viewport`);
      }

      // Capture axial camera reference frame for rotation alignment
      const axialViewport = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
      if (axialViewport) {
        const axialCamera = axialViewport.getCamera();
        const viewUp = axialCamera.viewUp;
        const viewPlaneNormal = axialCamera.viewPlaneNormal;

        // Calculate viewRight = viewUp × viewPlaneNormal
        const viewRight: Types.Point3 = [
          viewUp[1] * viewPlaneNormal[2] - viewUp[2] * viewPlaneNormal[1],
          viewUp[2] * viewPlaneNormal[0] - viewUp[0] * viewPlaneNormal[2],
          viewUp[0] * viewPlaneNormal[1] - viewUp[1] * viewPlaneNormal[0]
        ];

        axialReferenceFrameRef.current = {
          viewUp: viewUp as Types.Point3,
          viewRight,
          viewPlaneNormal: viewPlaneNormal as Types.Point3
        };

        console.log('📐 Captured axial reference frame for CPR rotation:', {
          viewUp,
          viewRight,
          viewPlaneNormal
        });
      }

      // Direction matrices already set during mapper creation above
      // Final render all viewports to show CPR
      renderingEngine.renderViewports(['axial', 'sagittal', 'coronal']);
      console.log('✅ CPR actors setup complete');

    } catch (error) {
      console.error('❌ Failed to setup CPR actors:', error);
    } finally {
      isSettingUpCPRRef.current = false;
    }
  };

  // Update CPR rotation dynamically (like TrueCPRViewport's updateCPROrientations)
  const updateCPRRotations = (rotationRadians: number) => {
    if (!cprActorsRef.current || cprActorsRef.current.length === 0) {
      console.warn('⚠️ No CPR actors available for rotation update');
      return;
    }

    console.log(`🔄 Updating CPR rotations to ${(rotationRadians * 180 / Math.PI).toFixed(1)}°`);

    cprActorsRef.current.forEach(({ mapper, viewportId, config }) => {
      if (!mapper || !config) return;

      // Calculate rotation for this view (base rotation + viewport-specific offset)
      const viewportRotation = rotationRadians + (config.rotationOffset || 0);

      // Update rotation via direction matrix (like TrueCPRViewport approach)
      const cos = Math.cos(viewportRotation);
      const sin = Math.sin(viewportRotation);
      const directions = new Float32Array([
        cos, -sin, 0,
        sin, cos, 0,
        0, 0, 1
      ]);
      mapper.setDirectionMatrix(directions);
      mapper.modified();

      console.log(`  🔄 Updated ${viewportId}: ${(viewportRotation * 180 / Math.PI).toFixed(1)}° (offset: ${((config.rotationOffset || 0) * 180 / Math.PI).toFixed(1)}°)`);

      // Trigger re-render
      const renderingEngine = renderingEngineRef.current;
      if (renderingEngine) {
        const viewport = renderingEngine.getViewport(viewportId);
        if (viewport) {
          viewport.render();
        }
      }
    });
  };

  // Draw CPR crosshair line on a viewport canvas (like MPR long axis view)
  const drawCPRPositionLineOnCanvas = (viewportId: string, positionRatio: number, annulusRatio?: number) => {
    if (!renderingEngineRef.current) {
      console.warn(`   ⚠️ No rendering engine for ${viewportId}`);
      return;
    }

    const renderingEngine = renderingEngineRef.current;
    const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
    if (!viewport) {
      console.warn(`   ⚠️ No viewport found for ${viewportId}`);
      return;
    }

    const canvas = viewport.getCanvas() as HTMLCanvasElement;
    if (!canvas) {
      console.warn(`   ⚠️ No canvas found for ${viewportId}`);
      return;
    }

    // Get canvas dimensions
    const { width, height } = canvas;

    // Calculate Y position in screen space (pixels)
    // Position ratio 0 = top of CPR (Y=0), ratio 1 = bottom (Y=height)
    const yPixel = positionRatio * height;
    const annulusYPixel = annulusRatio !== undefined ? annulusRatio * height : null;

    // Get 2D context for overlay
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    // Draw horizontal crosshair line with gap in the middle (like MPR long axis views)
    // Coronal view = red line, Sagittal view = green line
    const centerX = width / 2;
    const gapSize = 35; // Larger gap at center (like MPR long axis views)
    const lineMargin = 50; // Margin from edges
    const markerRadius = 5; // Circle marker radius
    const lineColor = viewportId === 'coronal' ? 'rgba(255, 50, 50, 0.7)' : 'rgba(50, 255, 50, 0.7)'; // Red for coronal, green for sagittal

    ctx.save();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);

    // Left segment (from margin to gap)
    const leftStart = lineMargin;
    const leftEnd = centerX - gapSize;
    ctx.beginPath();
    ctx.moveTo(leftStart, yPixel);
    ctx.lineTo(leftEnd, yPixel);
    ctx.stroke();

    // Right segment (from gap to margin)
    const rightStart = centerX + gapSize;
    const rightEnd = width - lineMargin;
    ctx.beginPath();
    ctx.moveTo(rightStart, yPixel);
    ctx.lineTo(rightEnd, yPixel);
    ctx.stroke();

    // Left end marker - filled circle
    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(leftStart, yPixel, markerRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Right end marker - hollow circle
    ctx.fillStyle = 'none';
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(rightEnd, yPixel, markerRadius, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.restore();

    // Draw fixed annulus reference line (if annulus position is provided)
    if (annulusYPixel !== null) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)'; // Yellow line for annulus
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]); // Dashed line

      ctx.beginPath();
      ctx.moveTo(0, annulusYPixel);
      ctx.lineTo(width, annulusYPixel);
      ctx.stroke();

      ctx.restore();

      // Calculate distance from annulus (in pixels, then convert to mm)
      const distancePixels = annulusYPixel - yPixel; // REVERSED: annulus - current (negative = below annulus)
      // Approximate: assume height represents total centerline length
      // Get total centerline length from centerlineDataRef
      if (centerlineDataRef.current) {
        const positions = centerlineDataRef.current.position;
        const numPoints = positions.length / 3;
        let totalLength = 0;
        for (let i = 1; i < numPoints; i++) {
          const dx = positions[i * 3] - positions[(i - 1) * 3];
          const dy = positions[i * 3 + 1] - positions[(i - 1) * 3 + 1];
          const dz = positions[i * 3 + 2] - positions[(i - 1) * 3 + 2];
          totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }

        // Convert pixel distance to mm
        const distanceMM = (distancePixels / height) * totalLength;

        // Draw distance label above the crosshair on the left
        ctx.save();
        ctx.fillStyle = 'yellow';
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        // Black outline for visibility
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 3;
        const distanceText = distanceMM >= 0 ? `+${distanceMM.toFixed(1)}mm` : `${distanceMM.toFixed(1)}mm`;
        ctx.strokeText(distanceText, leftStart, yPixel - 10);
        ctx.fillText(distanceText, leftStart, yPixel - 10);
        ctx.restore();
      }
    }
  };

  // Update CPR position indicator lines showing current scroll position
  const updateCPRPositionLines = (centerlineIndex: number) => {
    if (!renderingEngineRef.current || !centerlineDataRef.current || !cprActorsRef.current.length) {
      return;
    }

    // Calculate arc length DIRECTLY from the interpolated centerline positions
    // This is the exact same data the CPR mapper uses
    const positions = centerlineDataRef.current.position; // Float32Array of [x,y,z, x,y,z, ...]
    const numCenterlinePoints = positions.length / 3;

    // Calculate cumulative arc length up to current index (supports fractional indices)
    let cumulativeDistance = 0;
    const floorIndex = Math.floor(centerlineIndex);
    const fraction = centerlineIndex - floorIndex;

    // Add full segments up to floor index
    for (let i = 1; i <= floorIndex && i < numCenterlinePoints; i++) {
      const dx = positions[i * 3] - positions[(i - 1) * 3];
      const dy = positions[i * 3 + 1] - positions[(i - 1) * 3 + 1];
      const dz = positions[i * 3 + 2] - positions[(i - 1) * 3 + 2];
      const segmentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      cumulativeDistance += segmentLength;
    }

    // Add fractional part of the last segment
    if (fraction > 0 && floorIndex + 1 < numCenterlinePoints) {
      const dx = positions[(floorIndex + 1) * 3] - positions[floorIndex * 3];
      const dy = positions[(floorIndex + 1) * 3 + 1] - positions[floorIndex * 3 + 1];
      const dz = positions[(floorIndex + 1) * 3 + 2] - positions[floorIndex * 3 + 2];
      const segmentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      cumulativeDistance += segmentLength * fraction; // Add only the fractional part
    }

    // Calculate total arc length
    let totalDistance = 0;
    for (let i = 1; i < numCenterlinePoints; i++) {
      const dx = positions[i * 3] - positions[(i - 1) * 3];
      const dy = positions[i * 3 + 1] - positions[(i - 1) * 3 + 1];
      const dz = positions[i * 3 + 2] - positions[(i - 1) * 3 + 2];
      const segmentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
      totalDistance += segmentLength;
    }

    // Calculate position ratio (same method as CPR mapper)
    const positionRatio = totalDistance > 0 ? cumulativeDistance / totalDistance : 0;

    console.log(`📍 CPR position sync: index ${centerlineIndex}/${numCenterlinePoints - 1}, arc ${cumulativeDistance.toFixed(2)}/${totalDistance.toFixed(2)}mm = ${positionRatio.toFixed(3)}`);

    // Store position ratio for redrawing after renders
    cprPositionRatioRef.current = positionRatio;

    // Calculate annulus position ratio (find closest point to red sphere = valve/annulus)
    // Only calculate once and store in ref
    if (cprAnnulusRatioRef.current === undefined && spherePositionsRef.current.length > 1) {
      // Red sphere (index 1) is at the valve/annulus position
      const annulusWorldPos = spherePositionsRef.current[1]; // Red sphere at valve

      // Find closest centerline point to annulus position
      let closestIndex = -1;
      let minDist = Infinity;

      for (let i = 0; i < numCenterlinePoints; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        const dx = x - annulusWorldPos[0];
        const dy = y - annulusWorldPos[1];
        const dz = z - annulusWorldPos[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < minDist) {
          minDist = dist;
          closestIndex = i;
        }
      }

      if (closestIndex >= 0) {
        // Calculate arc length to annulus
        let annulusCumulativeDistance = 0;
        for (let i = 1; i <= closestIndex; i++) {
          const dx = positions[i * 3] - positions[(i - 1) * 3];
          const dy = positions[i * 3 + 1] - positions[(i - 1) * 3 + 1];
          const dz = positions[i * 3 + 2] - positions[(i - 1) * 3 + 2];
          const segmentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
          annulusCumulativeDistance += segmentLength;
        }
        cprAnnulusRatioRef.current = totalDistance > 0 ? annulusCumulativeDistance / totalDistance : 0.4;
        console.log(`📍 Annulus (red sphere) at centerline index ${closestIndex}, arc ${annulusCumulativeDistance.toFixed(2)}mm, ratio ${cprAnnulusRatioRef.current.toFixed(3)}`);
      } else {
        console.warn('⚠️ Could not find annulus position on centerline');
      }
    }

    // Draw lines immediately
    requestAnimationFrame(() => {
      drawCPRPositionLineOnCanvas('sagittal', positionRatio, cprAnnulusRatioRef.current);
      drawCPRPositionLineOnCanvas('coronal', positionRatio, cprAnnulusRatioRef.current);
    });
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

      // Store volume for CPR conversion
      currentVolumeRef.current = volume;

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
      });

      // Setup tools first WITHOUT any state updates
      await setupTools();

      // CRITICAL: Set imageInfo in ref (no re-render since it's a ref)
      // The layout shift from the info bar was the real issue, not this assignment
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

      setIsLoading(false);

      // Apply initial window/level AFTER everything else to avoid interfering with CrosshairsTool
      // Small delay to let CrosshairsTool fully stabilize
      setTimeout(() => {
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
      }, 200);

      // For ANNULUS_DEFINITION stage, position axial view perpendicular to centerline at valve
   

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

          // Store centerline data for scrolling
          centerlineDataRef.current = centerlineData;

          // Calculate optimal scroll step size for 0.1mm precision
          const numPoints = centerlineData.position.length / 3;
          let totalLength = 0;
          for (let i = 1; i < numPoints; i++) {
            const dx = centerlineData.position[i * 3] - centerlineData.position[(i - 1) * 3];
            const dy = centerlineData.position[i * 3 + 1] - centerlineData.position[(i - 1) * 3 + 1];
            const dz = centerlineData.position[i * 3 + 2] - centerlineData.position[(i - 1) * 3 + 2];
            totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
          }
          const avgSegmentLength = totalLength / (numPoints - 1);
          const targetStepMM = 0.1; // 0.1mm per scroll event
          cprScrollStepSizeRef.current = targetStepMM / avgSegmentLength;
          console.log(`📏 Centerline: ${numPoints} points, ${totalLength.toFixed(1)}mm total, avg ${avgSegmentLength.toFixed(3)}mm/segment`);
          console.log(`📏 Scroll step: ${cprScrollStepSizeRef.current.toFixed(3)} index units = ${targetStepMM}mm`);

          // Store the 3 sphere positions for discrete scrolling
          spherePositionsRef.current = existingSpheres.map(sphere => sphere.pos as Types.Point3);
          currentSphereIndexRef.current = 1; // Start at valve (middle sphere)

          // Use valve sphere position directly (middle sphere)
          const valveCenterlinePos = existingSpheres[1].pos;

          // Find closest centerline point to valve to calculate tangent
          let closestIndex = 0;
          let minDist = Infinity;
          for (let i = 0; i < numPoints; i++) {
            const x = centerlineData.position[i * 3];
            const y = centerlineData.position[i * 3 + 1];
            const z = centerlineData.position[i * 3 + 2];

            const dist = Math.sqrt(
              Math.pow(x - valveCenterlinePos[0], 2) +
              Math.pow(y - valveCenterlinePos[1], 2) +
              Math.pow(z - valveCenterlinePos[2], 2)
            );

            if (dist < minDist) {
              minDist = dist;
              closestIndex = i;
            }
          }

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
              parallelScale: 60, // Zoomed in to focus on annulus area
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
                parallelScale: 60, // Zoomed in to focus on annulus area
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
                parallelScale: 60, // Zoomed in to focus on annulus area
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

                    // Set up callback to update valve sphere and viewports when center dot is dragged
                    // This enables viewport updates BEFORE cusp dots are placed (free dragging mode)
                    fixedCrosshairTool.setValveSphereUpdateCallback((newPosition: Types.Point3) => {
                      console.log('🔴 Center dot dragged (initial setup), updating valve sphere and viewports:', newPosition);

                      // Update valve sphere position
                      if (onSpherePositionsUpdate && existingSpheres) {
                        const updatedSpheres = existingSpheres.map((sphere, index) => {
                          if (index === 1) {
                            return { ...sphere, pos: newPosition };
                          }
                          return sphere;
                        });
                        onSpherePositionsUpdate(updatedSpheres);

                        // Update the visual sphere in the tool directly
                        const sphereTool = toolGroup?.getToolInstance(SphereMarkerTool.toolName) as any;
                        if (sphereTool && sphereTool.spheres && sphereTool.spheres.length >= 2) {
                          sphereTool.spheres[1].pos = [newPosition[0], newPosition[1], newPosition[2]];
                          if (sphereTool.spheres[1].source) {
                            sphereTool.spheres[1].source.setCenter(newPosition[0], newPosition[1], newPosition[2]);
                            sphereTool.spheres[1].source.modified();
                          }
                          sphereTool._updateConnectionLines();
                        }
                      }

                      // Update locked focal point ref
                      lockedFocalPointRef.current = newPosition;

                      // CRITICAL: Update all viewport cameras ONLY BEFORE annular plane is defined
                      // AFTER annular plane is defined, viewports stay locked to the annular plane orientation
                      const isAnnularPlaneDefined = cuspDotsRef.current && cuspDotsRef.current.length === 3;

                      if (!isAnnularPlaneDefined) {
                        // BEFORE 3 cusp dots: Update viewports to follow the new center position (like crosshair)
                        console.log('📐 Updating viewport cameras to follow center dot (before annular plane)');
                        const renderingEngine = renderingEngineRef.current;
                        if (renderingEngine) {
                          const currentAxialVp = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
                          if (currentAxialVp) {
                            // Get current axial camera settings
                            const currentAxialCamera = currentAxialVp.getCamera();
                            const cameraDistance = 200;

                            // Update axial viewport focal point
                            const newAxialCameraPos = [
                              newPosition[0] + currentAxialCamera.viewPlaneNormal[0] * cameraDistance,
                              newPosition[1] + currentAxialCamera.viewPlaneNormal[1] * cameraDistance,
                              newPosition[2] + currentAxialCamera.viewPlaneNormal[2] * cameraDistance
                            ] as Types.Point3;

                            currentAxialVp.setCamera({
                              ...currentAxialCamera,
                              position: newAxialCameraPos,
                              focalPoint: newPosition
                            });
                            currentAxialVp.render();

                            // Update sagittal and coronal viewports to show the new slice position
                            // Get current rotation angle from fixed crosshair
                            const currentRotationAngle = fixedCrosshairTool.getRotationAngle() || 0;
                            const cos = Math.cos(currentRotationAngle);
                            const sin = Math.sin(currentRotationAngle);

                            // Calculate view directions based on current rotation
                            const viewPlaneNormal = currentAxialCamera.viewPlaneNormal;
                            const actualViewUp = currentAxialCamera.viewUp;

                            const actualViewRight = [
                              actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
                              actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
                              actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
                            ];

                            const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
                            if (rightLen > 0) {
                              actualViewRight[0] /= rightLen;
                              actualViewRight[1] /= rightLen;
                              actualViewRight[2] /= rightLen;
                            }

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

                            // Update sagittal viewport
                            const sagittalVp = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
                            if (sagittalVp) {
                              const sagCameraPos = [
                                newPosition[0] + rotatedViewRight[0] * cameraDistance,
                                newPosition[1] + rotatedViewRight[1] * cameraDistance,
                                newPosition[2] + rotatedViewRight[2] * cameraDistance
                              ] as Types.Point3;

                              sagittalVp.setCamera({
                                position: sagCameraPos,
                                focalPoint: newPosition,
                                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                                parallelScale: sagittalVp.getCamera().parallelScale
                              });
                              sagittalVp.render();
                            }

                            // Update coronal viewport
                            const coronalVp = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
                            if (coronalVp) {
                              const corCameraPos = [
                                newPosition[0] + rotatedViewUp[0] * cameraDistance,
                                newPosition[1] + rotatedViewUp[1] * cameraDistance,
                                newPosition[2] + rotatedViewUp[2] * cameraDistance
                              ] as Types.Point3;

                              coronalVp.setCamera({
                                position: corCameraPos,
                                focalPoint: newPosition,
                                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                                parallelScale: coronalVp.getCamera().parallelScale
                              });
                              coronalVp.render();
                            }

                            console.log('✅ All viewports updated to follow new center position');
                          }
                        }
                      } else {
                        // AFTER 3 cusp dots: Viewports stay locked to annular plane orientation
                        console.log('🔒 Viewports locked to annular plane (after 3 cusp dots)');
                      }
                    });

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

      // For MEASUREMENTS stage, position cameras at annular plane
      if (currentStage === WorkflowStage.MEASUREMENTS && lockedFocalPointRef.current && centerlineDataRef.current) {
        console.log('✅ MEASUREMENTS stage - Positioning cameras at annular plane');
        setTimeout(() => {
          console.log('🎯 Setting up cameras at annular plane for measurements');

          const annulusCenter = lockedFocalPointRef.current!;
          const centerlineData = centerlineDataRef.current;

          // Find nearest centerline index to annulus center
          const nearestIndex = findNearestCenterlineIndex(annulusCenter);
          const position = getCenterlinePositionAtIndex(nearestIndex);
          const tangent = getCenterlineTangentAtIndex(nearestIndex);

          if (!position || !tangent) {
            console.warn('⚠️ Failed to get centerline position/tangent for measurements');
            return;
          }

          console.log('📍 Annulus center:', annulusCenter);
          console.log('📐 Centerline tangent:', tangent);

          const renderingEngine = renderingEngineRef.current;
          if (!renderingEngine) return;

          // Position axial viewport perpendicular to centerline at annulus
          const axialViewport = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
          if (axialViewport) {
            const cameraDistance = 200;

            const cameraPos = [
              position[0] + tangent[0] * cameraDistance,
              position[1] + tangent[1] * cameraDistance,
              position[2] + tangent[2] * cameraDistance
            ] as Types.Point3;

            // Calculate viewUp perpendicular to tangent
            let viewUp: Types.Point3;
            const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
            const cross = [
              tangent[1] * reference[2] - tangent[2] * reference[1],
              tangent[2] * reference[0] - tangent[0] * reference[2],
              tangent[0] * reference[1] - tangent[1] * reference[0]
            ];

            const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
            if (crossLen > 0) {
              viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
            } else {
              viewUp = [0, 0, 1] as Types.Point3;
            }

            axialViewport.setCamera({
              position: cameraPos,
              focalPoint: position,
              viewUp: viewUp,
              parallelScale: 60, // Zoomed in view
            });

            axialViewport.render();
            console.log('✅ Axial viewport: positioned at annular plane');

            // Position sagittal and coronal viewports
            const newCamera = axialViewport.getCamera();
            const viewPlaneNormal = newCamera.viewPlaneNormal;
            const actualViewUp = newCamera.viewUp;

            // Calculate actualViewRight
            const actualViewRight = [
              actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
              actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
              actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
            ];

            const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
            if (rightLen > 0) {
              actualViewRight[0] /= rightLen;
              actualViewRight[1] /= rightLen;
              actualViewRight[2] /= rightLen;
            }

            // Position sagittal viewport
            const sagittalViewport = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
            if (sagittalViewport) {
              const sagCameraPos = [
                position[0] + actualViewRight[0] * cameraDistance,
                position[1] + actualViewRight[1] * cameraDistance,
                position[2] + actualViewRight[2] * cameraDistance
              ] as Types.Point3;

              sagittalViewport.setCamera({
                position: sagCameraPos,
                focalPoint: position,
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: 60, // Zoomed in view
              });

              sagittalViewport.render();
              console.log('✅ Sagittal viewport: positioned at annular plane');
            }

            // Position coronal viewport
            const coronalViewport = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
            if (coronalViewport) {
              const corCameraPos = [
                position[0] + actualViewUp[0] * cameraDistance,
                position[1] + actualViewUp[1] * cameraDistance,
                position[2] + actualViewUp[2] * cameraDistance
              ] as Types.Point3;

              coronalViewport.setCamera({
                position: corCameraPos,
                focalPoint: position,
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: 60, // Zoomed in view
              });

              coronalViewport.render();
              console.log('✅ Coronal viewport: positioned at annular plane');
            }

            // Create annulus reference lines in sagittal and coronal views
            import('@kitware/vtk.js/Filters/Sources/LineSource').then((module) => {
              const vtkLineSource = module.default;
              return import('@kitware/vtk.js/Filters/General/TubeFilter').then((tubeModule) => {
                const vtkTubeFilter = tubeModule.default;
                return import('@kitware/vtk.js/Rendering/Core/Mapper').then((mapperModule) => {
                  const vtkMapper = mapperModule.default;
                  return import('@kitware/vtk.js/Rendering/Core/Actor').then((actorModule) => {
                    const vtkActor = actorModule.default;

                  // Remove old annulus lines if they exist
                  if (annulusLineActorsRef.current) {
                    if (sagittalViewport && annulusLineActorsRef.current.sagittal) {
                      try {
                        sagittalViewport.removeActor({ uid: 'annulus-line-sagittal' });
                      } catch (e) { /* ignore */ }
                    }
                    if (coronalViewport && annulusLineActorsRef.current.coronal) {
                      try {
                        coronalViewport.removeActor({ uid: 'annulus-line-coronal' });
                      } catch (e) { /* ignore */ }
                    }
                  }

                  // Create thin grayish-black line at annulus level
                  const lineLength = 80; // Shorter line to stay within viewport

                  // Sagittal view: line goes left-right (along actualViewUp direction)
                  if (sagittalViewport) {
                    const lineSource = vtkLineSource.newInstance();
                    const lineStart = [
                      position[0] - actualViewUp[0] * lineLength,
                      position[1] - actualViewUp[1] * lineLength,
                      position[2] - actualViewUp[2] * lineLength
                    ];
                    const lineEnd = [
                      position[0] + actualViewUp[0] * lineLength,
                      position[1] + actualViewUp[1] * lineLength,
                      position[2] + actualViewUp[2] * lineLength
                    ];
                    lineSource.setPoint1(lineStart);
                    lineSource.setPoint2(lineEnd);

                    // Use tube filter for smooth, anti-aliased appearance
                    const tubeFilter = vtkTubeFilter.newInstance();
                    tubeFilter.setInputConnection(lineSource.getOutputPort());
                    tubeFilter.setRadius(0.3); // Thin smooth tube (0.3mm)
                    tubeFilter.setNumberOfSides(16); // Smooth circular profile
                    tubeFilter.setCapping(true);

                    const mapper = vtkMapper.newInstance();
                    mapper.setInputConnection(tubeFilter.getOutputPort());

                    const actor = vtkActor.newInstance();
                    actor.setMapper(mapper);

                    const property = actor.getProperty();
                    property.setColor(0.55, 0.55, 0.55); // Medium gray
                    property.setOpacity(0.7);
                    property.setInterpolationToPhong(); // Smooth shading

                    sagittalViewport.addActor({ uid: 'annulus-line-sagittal', actor });

                    if (!annulusLineActorsRef.current) {
                      annulusLineActorsRef.current = { sagittal: null, coronal: null };
                    }
                    annulusLineActorsRef.current.sagittal = actor;
                  }

                  // Coronal view: line goes left-right (along actualViewRight direction)
                  if (coronalViewport) {
                    const lineSource = vtkLineSource.newInstance();
                    const lineStart = [
                      position[0] - actualViewRight[0] * lineLength,
                      position[1] - actualViewRight[1] * lineLength,
                      position[2] - actualViewRight[2] * lineLength
                    ];
                    const lineEnd = [
                      position[0] + actualViewRight[0] * lineLength,
                      position[1] + actualViewRight[1] * lineLength,
                      position[2] + actualViewRight[2] * lineLength
                    ];
                    lineSource.setPoint1(lineStart);
                    lineSource.setPoint2(lineEnd);

                    // Use tube filter for smooth, anti-aliased appearance
                    const tubeFilter = vtkTubeFilter.newInstance();
                    tubeFilter.setInputConnection(lineSource.getOutputPort());
                    tubeFilter.setRadius(0.3); // Thin smooth tube (0.3mm)
                    tubeFilter.setNumberOfSides(16); // Smooth circular profile
                    tubeFilter.setCapping(true);

                    const mapper = vtkMapper.newInstance();
                    mapper.setInputConnection(tubeFilter.getOutputPort());

                    const actor = vtkActor.newInstance();
                    actor.setMapper(mapper);

                    const property = actor.getProperty();
                    property.setColor(0.55, 0.55, 0.55); // Medium gray
                    property.setOpacity(0.7);
                    property.setInterpolationToPhong(); // Smooth shading

                    coronalViewport.addActor({ uid: 'annulus-line-coronal', actor });

                    if (!annulusLineActorsRef.current) {
                      annulusLineActorsRef.current = { sagittal: null, coronal: null };
                    }
                    annulusLineActorsRef.current.coronal = actor;
                  }

                    // Render viewports with new lines
                    renderingEngine.renderViewports(['sagittal', 'coronal']);
                    console.log('✅ Annulus reference lines added to sagittal and coronal views');
                  });
                });
              });
            });

            // Force render all viewports
            renderingEngine.renderViewports(['axial', 'sagittal', 'coronal']);
            console.log('🔄 All viewports positioned at annular plane for measurements');
          }
        }, 500); // Delay after tools are set up
      }

    } catch (err) {
      console.error('❌ Failed to initialize MPR Viewport:', err);
      setError(`Failed to load DICOM images: ${err}`);
      setIsLoading(false);
    }
  };

  const adjustToAnnularPlane = (dots: { id: string; pos: [number, number, number]; color: string; cuspType: string }[]) => {
    if (dots.length !== 3 || !renderingEngineRef.current) {
      console.warn('⚠️ Cannot adjust to annular plane: need exactly 3 dots and rendering engine');
      return;
    }

    const renderingEngine = renderingEngineRef.current;

    // Get the 3 cusp points
    const p1 = dots[0].pos as Types.Point3;
    const p2 = dots[1].pos as Types.Point3;
    const p3 = dots[2].pos as Types.Point3;

    console.log('📐 Calculating annular plane from 3 cusp points:');
    console.log(`   P1 (${dots[0].cuspType}) - Color: ${dots[0].color}:`, p1);
    console.log(`   P2 (${dots[1].cuspType}) - Color: ${dots[1].color}:`, p2);
    console.log(`   P3 (${dots[2].cuspType}) - Color: ${dots[2].color}:`, p3);
    console.log('   ⚠️ Colors should be: Red (#FF6B6B), Gold (#FFD700), Royal Blue (#4169E1)');
    console.log('   ℹ️ These are the ONLY 3 points used for centroid calculation');

    // Calculate two vectors in the plane
    const v1 = [
      p2[0] - p1[0],
      p2[1] - p1[1],
      p2[2] - p1[2]
    ];

    const v2 = [
      p3[0] - p1[0],
      p3[1] - p1[1],
      p3[2] - p1[2]
    ];

    // Calculate plane normal: v1 × v2
    let planeNormal = [
      v1[1] * v2[2] - v1[2] * v2[1],
      v1[2] * v2[0] - v1[0] * v2[2],
      v1[0] * v2[1] - v1[1] * v2[0]
    ];

    // Normalize
    const normalLen = Math.sqrt(planeNormal[0] ** 2 + planeNormal[1] ** 2 + planeNormal[2] ** 2);
    if (normalLen > 0) {
      planeNormal[0] /= normalLen;
      planeNormal[1] /= normalLen;
      planeNormal[2] /= normalLen;
    }

    // Calculate center of the 3 points (annulus center - centroid)
    const annulusCenter: Types.Point3 = [
      (p1[0] + p2[0] + p3[0]) / 3,
      (p1[1] + p2[1] + p3[1]) / 3,
      (p1[2] + p2[2] + p3[2]) / 3
    ];

    console.log('   Plane normal:', planeNormal);
    console.log('   📍 Annulus center (centroid of 3 cusp dots):', annulusCenter);
    console.log('   Distance from P1 to center:', Math.sqrt(
      (p1[0] - annulusCenter[0])**2 +
      (p1[1] - annulusCenter[1])**2 +
      (p1[2] - annulusCenter[2])**2
    ).toFixed(2), 'mm');
    console.log('   Distance from P2 to center:', Math.sqrt(
      (p2[0] - annulusCenter[0])**2 +
      (p2[1] - annulusCenter[1])**2 +
      (p2[2] - annulusCenter[2])**2
    ).toFixed(2), 'mm');
    console.log('   Distance from P3 to center:', Math.sqrt(
      (p3[0] - annulusCenter[0])**2 +
      (p3[1] - annulusCenter[1])**2 +
      (p3[2] - annulusCenter[2])**2
    ).toFixed(2), 'mm');

    // CRITICAL: Move the red sphere (valve) to the annulus center (centroid)
    // The valve position should be at the exact center of the triangle formed by the 3 cusp dots
    const valveSphere = spherePositionsRef.current[1]; // Middle sphere (red, valve)

    console.log('🔴 Moving RED valve sphere to annulus center (centroid):');
    console.log('   Original valve position:', valveSphere);
    console.log('   Target position (centroid):', annulusCenter);

    const moveDistance = Math.sqrt(
      (valveSphere[0] - annulusCenter[0])**2 +
      (valveSphere[1] - annulusCenter[1])**2 +
      (valveSphere[2] - annulusCenter[2])**2
    );
    console.log('   Distance to move:', moveDistance.toFixed(2), 'mm');

    // Update the valve sphere position to the centroid
    spherePositionsRef.current[1] = annulusCenter;

    // Update the sphere in the parent component and tool
    if (onSpherePositionsUpdate && existingSpheres) {
      const updatedSpheres = existingSpheres.map((sphere, index) => {
        if (index === 1) {
          // Update the middle sphere (valve) with centroid position
          return { ...sphere, pos: annulusCenter };
        }
        return sphere;
      });
      onSpherePositionsUpdate(updatedSpheres);

      // Update the visual sphere in the tool directly
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      const sphereTool = toolGroup?.getToolInstance(SphereMarkerTool.toolName) as any;
      if (sphereTool && sphereTool.spheres && sphereTool.spheres.length >= 2) {
        // Update the middle sphere (valve) position to centroid
        sphereTool.spheres[1].pos = [annulusCenter[0], annulusCenter[1], annulusCenter[2]];

        // Update the sphere source center
        if (sphereTool.spheres[1].source) {
          sphereTool.spheres[1].source.setCenter(annulusCenter[0], annulusCenter[1], annulusCenter[2]);
          sphereTool.spheres[1].source.modified();
        }

        // Update connection lines
        sphereTool._updateConnectionLines();

        // Render all viewports
        const enabledElements = getEnabledElements();
        enabledElements.forEach(({ viewport }: any) => viewport.render());

        console.log('✅ RED valve sphere moved to exact centroid position');
      }
    }

    // Regenerate centerline with the valve at centroid position
    console.log('🔄 Regenerating centerline with projected valve position...');
    const updatedCenterlineData = CenterlineGenerator.generateFromRootPoints(
      spherePositionsRef.current.map((pos, index) => ({
        id: `sphere-${index}`,
        position: pos,
        type: index === 0 ? 'lv_outflow' : index === 1 ? 'aortic_valve' : 'ascending_aorta',
        timestamp: Date.now()
      }))
    );
    centerlineDataRef.current = updatedCenterlineData;

    // Recalculate scroll step size for updated centerline
    const numPoints = updatedCenterlineData.position.length / 3;
    let totalLength = 0;
    for (let i = 1; i < numPoints; i++) {
      const dx = updatedCenterlineData.position[i * 3] - updatedCenterlineData.position[(i - 1) * 3];
      const dy = updatedCenterlineData.position[i * 3 + 1] - updatedCenterlineData.position[(i - 1) * 3 + 1];
      const dz = updatedCenterlineData.position[i * 3 + 2] - updatedCenterlineData.position[(i - 1) * 3 + 2];
      totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const avgSegmentLength = totalLength / (numPoints - 1);
    const targetStepMM = 0.1; // 0.1mm per scroll event
    cprScrollStepSizeRef.current = targetStepMM / avgSegmentLength;
    console.log(`📏 Updated scroll step: ${cprScrollStepSizeRef.current.toFixed(3)} index units = ${targetStepMM}mm`);

    console.log('✅ Centerline regenerated with projected valve');

    // IMPORTANT: Use the annulus center (centroid of 3 cusp dots) as the focal point
    // This ensures the red dot is at the center of the three cusp dots, on the annular plane
    const newFocalPoint = annulusCenter;

    console.log('🎯 Using annulus center as focal point (red dot position):', annulusCenter);

    // Position axial camera perpendicular to the annular plane
    const axialVp = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
    if (!axialVp) return;

    const cameraDistance = 200;

    // Camera position along the plane normal (from annulus center)
    const cameraPos: Types.Point3 = [
      newFocalPoint[0] + planeNormal[0] * cameraDistance,
      newFocalPoint[1] + planeNormal[1] * cameraDistance,
      newFocalPoint[2] + planeNormal[2] * cameraDistance
    ];

    // Calculate viewUp perpendicular to plane normal
    let viewUp: Types.Point3;
    const reference = Math.abs(planeNormal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const cross = [
      planeNormal[1] * reference[2] - planeNormal[2] * reference[1],
      planeNormal[2] * reference[0] - planeNormal[0] * reference[2],
      planeNormal[0] * reference[1] - planeNormal[1] * reference[0]
    ];

    const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
    if (crossLen > 0) {
      viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
    } else {
      viewUp = [0, 0, 1] as Types.Point3;
    }

    console.log('🎥 Setting axial camera perpendicular to annular plane:');
    console.log('   Camera position:', cameraPos);
    console.log('   Focal point (annulus center - centroid of 3 cusp dots):', newFocalPoint);
    console.log('   ViewUp:', viewUp);

    axialVp.setCamera({
      position: cameraPos,
      focalPoint: newFocalPoint,
      viewUp: viewUp,
      parallelScale: 60, // Zoomed in to focus on annulus area
    });

    axialVp.render();

    // Update fixed crosshair to annulus center (red dot at centroid of 3 cusp dots)
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    const fixedCrosshairTool = toolGroup?.getToolInstance(FixedCrosshairTool.toolName) as any;
    if (fixedCrosshairTool) {
      console.log('🎯 Setting fixed crosshair (red dot) position to annulus center:', newFocalPoint);
      console.log('   Annulus center (centroid of 3 cusp dots):', annulusCenter);
      console.log('   Are they the same?', newFocalPoint[0] === annulusCenter[0] && newFocalPoint[1] === annulusCenter[1] && newFocalPoint[2] === annulusCenter[2]);
      fixedCrosshairTool.setFixedPosition(newFocalPoint, renderingEngineId);

      // IMPORTANT: Lock the center dot to axial-only movement now that annular plane is defined
      fixedCrosshairTool.setAnnularPlaneDefined(true);

      // Set up callback to update valve sphere when center dot is dragged (axial-only after annular plane)
      fixedCrosshairTool.setValveSphereUpdateCallback((newPosition: Types.Point3) => {
        console.log('🔴 Center dot dragged, updating valve sphere and all viewport cameras:', newPosition);

        // Update valve sphere position
        if (onSpherePositionsUpdate && existingSpheres) {
          const updatedSpheres = existingSpheres.map((sphere, index) => {
            if (index === 1) {
              return { ...sphere, pos: newPosition };
            }
            return sphere;
          });
          onSpherePositionsUpdate(updatedSpheres);

          // Update the visual sphere in the tool directly
          const sphereTool = toolGroup?.getToolInstance(SphereMarkerTool.toolName) as any;
          if (sphereTool && sphereTool.spheres && sphereTool.spheres.length >= 2) {
            sphereTool.spheres[1].pos = [newPosition[0], newPosition[1], newPosition[2]];
            if (sphereTool.spheres[1].source) {
              sphereTool.spheres[1].source.setCenter(newPosition[0], newPosition[1], newPosition[2]);
              sphereTool.spheres[1].source.modified();
            }
            sphereTool._updateConnectionLines();
          }
        }

        // Update locked focal point ref
        lockedFocalPointRef.current = newPosition;

        // CRITICAL: Update all viewport cameras ONLY BEFORE annular plane is defined
        // AFTER annular plane is defined, viewports stay locked to the annular plane orientation
        const isAnnularPlaneDefined = cuspDotsRef.current && cuspDotsRef.current.length === 3;

        if (!isAnnularPlaneDefined) {
          // BEFORE 3 cusp dots: Update viewports to follow the new center position (like crosshair)
          console.log('📐 Updating viewport cameras to follow center dot (before annular plane)');
          const renderingEngine = getRenderingEngine(renderingEngineId);
          if (renderingEngine) {
          const currentAxialVp = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
          if (currentAxialVp) {
            // Get current axial camera settings
            const currentAxialCamera = currentAxialVp.getCamera();
            const cameraDistance = 200;

            // Update axial viewport focal point
            const newAxialCameraPos = [
              newPosition[0] + currentAxialCamera.viewPlaneNormal[0] * cameraDistance,
              newPosition[1] + currentAxialCamera.viewPlaneNormal[1] * cameraDistance,
              newPosition[2] + currentAxialCamera.viewPlaneNormal[2] * cameraDistance
            ] as Types.Point3;

            currentAxialVp.setCamera({
              ...currentAxialCamera,
              position: newAxialCameraPos,
              focalPoint: newPosition
            });
            currentAxialVp.render();

            // Update sagittal and coronal viewports to show the new slice position
            // Get current rotation angle from fixed crosshair
            const currentRotationAngle = fixedCrosshairTool.getRotationAngle() || 0;
            const cos = Math.cos(currentRotationAngle);
            const sin = Math.sin(currentRotationAngle);

            // Calculate view directions based on current rotation
            const viewPlaneNormal = currentAxialCamera.viewPlaneNormal;
            const actualViewUp = currentAxialCamera.viewUp;

            const actualViewRight = [
              actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
              actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
              actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
            ];

            const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
            if (rightLen > 0) {
              actualViewRight[0] /= rightLen;
              actualViewRight[1] /= rightLen;
              actualViewRight[2] /= rightLen;
            }

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

            // Update sagittal viewport
            const sagittalVp = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
            if (sagittalVp) {
              const sagCameraPos = [
                newPosition[0] + rotatedViewRight[0] * cameraDistance,
                newPosition[1] + rotatedViewRight[1] * cameraDistance,
                newPosition[2] + rotatedViewRight[2] * cameraDistance
              ] as Types.Point3;

              sagittalVp.setCamera({
                position: sagCameraPos,
                focalPoint: newPosition,
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: sagittalVp.getCamera().parallelScale
              });
              sagittalVp.render();
            }

            // Update coronal viewport
            const coronalVp = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
            if (coronalVp) {
              const corCameraPos = [
                newPosition[0] + rotatedViewUp[0] * cameraDistance,
                newPosition[1] + rotatedViewUp[1] * cameraDistance,
                newPosition[2] + rotatedViewUp[2] * cameraDistance
              ] as Types.Point3;

              coronalVp.setCamera({
                position: corCameraPos,
                focalPoint: newPosition,
                viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
                parallelScale: coronalVp.getCamera().parallelScale
              });
              coronalVp.render();
            }

            console.log('✅ All viewports updated to follow new center position');
          }
          }
        } else {
          // AFTER 3 cusp dots: Viewports stay locked to annular plane orientation
          console.log('🔒 Viewports locked to annular plane (after 3 cusp dots)');
        }
      });

      // Verify it was set correctly
      const verifyPosition = fixedCrosshairTool.getFixedPosition();
      console.log('🔍 Verified fixed crosshair position:', verifyPosition);
      console.log('✅ Fixed crosshair (red dot) positioned at annulus center');
      console.log('🔒 Center dot now locked to AXIAL-ONLY movement');
    } else {
      console.error('❌ FixedCrosshairTool not found!');
    }

    // Update sagittal and coronal viewports with new screen-space directions
    const newCamera = axialVp.getCamera();
    const viewPlaneNormal = newCamera.viewPlaneNormal;
    const actualViewUp = newCamera.viewUp;

    // Calculate actualViewRight
    const actualViewRight = [
      actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
      actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
      actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
    ];

    const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
    if (rightLen > 0) {
      actualViewRight[0] /= rightLen;
      actualViewRight[1] /= rightLen;
      actualViewRight[2] /= rightLen;
    }

    // Apply rotation if any
    const rotationAngle = fixedCrosshairTool?.getRotationAngle() || 0;
    const cos = Math.cos(rotationAngle);
    const sin = Math.sin(rotationAngle);

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

    // Update sagittal
    const sagittalVp = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
    if (sagittalVp) {
      const sagCameraPos = [
        newFocalPoint[0] + rotatedViewRight[0] * cameraDistance,
        newFocalPoint[1] + rotatedViewRight[1] * cameraDistance,
        newFocalPoint[2] + rotatedViewRight[2] * cameraDistance
      ] as Types.Point3;

      sagittalVp.setCamera({
        position: sagCameraPos,
        focalPoint: newFocalPoint,
        viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
        parallelScale: 60, // Zoomed in to focus on annulus area
      });

      sagittalVp.render();
      console.log('✅ Updated sagittal viewport to annular plane');
    }

    // Update coronal
    const coronalVp = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
    if (coronalVp) {
      const corCameraPos = [
        newFocalPoint[0] + rotatedViewUp[0] * cameraDistance,
        newFocalPoint[1] + rotatedViewUp[1] * cameraDistance,
        newFocalPoint[2] + rotatedViewUp[2] * cameraDistance
      ] as Types.Point3;

      coronalVp.setCamera({
        position: corCameraPos,
        focalPoint: newFocalPoint,
        viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
        parallelScale: 60, // Zoomed in to focus on annulus area
      });

      coronalVp.render();
      console.log('✅ Updated coronal viewport to annular plane');
    }

    // Update locked focal point ref to annulus center
    lockedFocalPointRef.current = newFocalPoint;

    // Force re-render cusp dots after camera adjustment to ensure proper positioning
    const currentToolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    if (currentToolGroup) {
      const cuspTool = currentToolGroup.getToolInstance('CuspNadir');
      if (cuspTool && typeof (cuspTool as any).forceReRenderDots === 'function') {
        console.log('🔄 Force re-rendering cusp dots after camera adjustment to annular plane');
        (cuspTool as any).forceReRenderDots();
      }
      // Note: Valve sphere already moved to centroid earlier in this function
    }

    console.log('✅ All viewports adjusted to be perpendicular to annular plane!');
    console.log('   Green crosshair center positioned at annulus center (centroid of 3 cusp dots)');
    console.log('   Red valve sphere MOVED to annulus center (should be at triangle center)');
    console.log('   All 3 cusp dots should now be visible in the axial view');
    console.log('   Centerline regenerated with valve at annulus center');
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

            // If in annulus definition stage and we have 3 cusp dots,
            // update crosshair when valve sphere (index 1) is dragged
            if (currentStage === WorkflowStage.ANNULUS_DEFINITION &&
                cuspDotsRef.current &&
                cuspDotsRef.current.length === 3 &&
                spheres.length >= 3) {

              const valvePos = spheres[1].pos as Types.Point3;

              // Update locked focal point to follow the valve sphere
              lockedFocalPointRef.current = valvePos;

              // Update crosshair center to valve sphere position
              const fixedCrosshairTool = toolGroup.getToolInstance('FixedCrosshair');
              if (fixedCrosshairTool && typeof (fixedCrosshairTool as any).setPosition === 'function') {
                (fixedCrosshairTool as any).setPosition(valvePos);
              }

              console.log('🔴 Valve sphere dragged, crosshair center updated to:', valvePos);
            }
          });
        }
      }

      // Set up callback for cusp dots position updates
      if (onCuspDotsUpdate) {
        const cuspTool = toolGroup.getToolInstance(CuspNadirTool.toolName) as CuspNadirTool;
        if (cuspTool) {
          cuspTool.setPositionUpdateCallback((dots) => {
            // Store cusp dots in ref
            cuspDotsRef.current = dots;

            // Call parent callback
            onCuspDotsUpdate(dots);

            // If we have 3 cusp dots during annulus definition, adjust plane
            if (dots.length === 3 && currentStage === WorkflowStage.ANNULUS_DEFINITION) {
              console.log('🎯 3 cusp dots placed! Adjusting axial view to be perpendicular to annular plane...');
              setTimeout(() => {
                adjustToAnnularPlane(dots);
              }, 100); // Small delay to let rendering settle
            }
          });
        }
      }

      // CRITICAL: Activate CrosshairsTool BEFORE adding viewports (like App.tsx)
      // This is the correct order for proper synchronization
      // EXCEPT for MEASUREMENTS stage where we use FixedCrosshairTool instead
      if (currentStage !== WorkflowStage.MEASUREMENTS) {
        console.log('  🎯 Activating CrosshairsTool BEFORE adding viewports...');
        toolGroup.setToolActive(CrosshairsTool.toolName, {
          bindings: [{
            mouseButton: MouseBindings.Primary,
          }],
        });
        console.log('  ✅ CrosshairsTool activated');
      } else {
        console.log('  ⏭️ Skipping CrosshairsTool activation (MEASUREMENTS stage uses FixedCrosshairTool)');
      }

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

      // CRITICAL: Configure distance measurement for MEASUREMENTS stage
      // This must happen AFTER tools are created and added to the tool group
      if (currentStage === WorkflowStage.MEASUREMENTS) {
        console.log('📏 Configuring distance measurement for MEASUREMENTS stage...');

        const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;

        if (lockedFocalPointRef.current && fixedCrosshairTool) {
          // Disable center dragging during measurements
          if (typeof fixedCrosshairTool.setCenterDraggingDisabled === 'function') {
            fixedCrosshairTool.setCenterDraggingDisabled(true);
            console.log('  🔒 Center dragging disabled');
          }

          // Enable distance measurement from annulus reference position
          if (typeof fixedCrosshairTool.setAnnulusReference === 'function') {
            fixedCrosshairTool.setAnnulusReference(lockedFocalPointRef.current);
            console.log('  📏 Distance measurement enabled at:', lockedFocalPointRef.current);
          }
        } else {
          console.warn('  ⚠️ Cannot configure distance measurement:', {
            hasLockedFocalPoint: !!lockedFocalPointRef.current,
            hasFixedCrosshairTool: !!fixedCrosshairTool
          });
        }
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
      toolGroup.setToolPassive(FixedCrosshairTool.toolName); // Also disable fixed crosshairs when switching tools

      // Always keep these tools active with their default bindings
      toolGroup.setToolActive(StackScrollTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Wheel }],
      });
      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Secondary }],
      });

      // Activate selected tool
      if (toolName === 'SphereMarker') {
        console.log('🎯 Activating SphereMarker tool for dragging spheres');
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
      // Allow sphere editing when explicitly selected, otherwise lock
      if (sphereTool && typeof sphereTool.setDraggable === 'function') {
        sphereTool.setDraggable(true); // Allow dragging if tool is selected
      }
      if (cuspTool) {
        cuspTool.setDraggable(true);
      }

      // Disable forceVisible - use normal slice-based visibility during annulus definition
      if (sphereTool && typeof sphereTool.setForceVisible === 'function') {
        sphereTool.setForceVisible(false);
      }
      if (cuspTool && typeof cuspTool.setForceVisible === 'function') {
        cuspTool.setForceVisible(false);
      }

      // During annulus definition, activate THREE tools: FixedCrosshairTool, CuspNadirTool, and SphereMarkerTool
      // CuspNadirTool will capture events when hovering over cusp dots
      // SphereMarkerTool will capture events when hovering over valve sphere
      // FixedCrosshairTool will handle rotation when not over any interactive element
      if (lockedFocalPointRef.current && fixedCrosshairTool) {
        console.log('🔄 Annulus Definition mode - Rotation, cusp dragging, and valve sphere dragging active');

        // Disable regular crosshairs
        toolGroup.setToolDisabled(CrosshairsTool.toolName);

        // Make non-primary tools passive
        toolGroup.setToolPassive(WindowLevelTool.toolName);

        // CRITICAL: Disable StackScrollTool during annulus definition
        // We handle scrolling manually to follow centerline
        toolGroup.setToolDisabled(StackScrollTool.toolName);
        console.log('🔇 StackScrollTool disabled for discrete scrolling');

        fixedCrosshairTool.setFixedPosition(lockedFocalPointRef.current, renderingEngineId);

        // NOTE: Center dragging re-enable and distance measurement disable
        // are handled by the "Configure Tools for Measurements Stage" useEffect

        // CRITICAL: Activate ALL THREE tools with same mouse button
        // Priority order (based on preMouseDownCallback return values):
        // 1. CuspNadirTool captures events when over a cusp dot
        // 2. SphereMarkerTool captures events when over valve sphere
        // 3. FixedCrosshairTool handles rotation when not over any interactive element
        toolGroup.setToolActive(CuspNadirTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });

        toolGroup.setToolActive(SphereMarkerTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });

        toolGroup.setToolActive(FixedCrosshairTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });

        // Keep zoom active on right mouse button
        toolGroup.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Secondary }],
        });

        // Force render all viewports
        if (renderingEngineRef.current) {
          renderingEngineRef.current.renderViewports(['axial', 'sagittal', 'coronal']);
        }
      }

      console.log('🔓 Stage: Annulus Definition - Both cusp dragging and rotation active');
    } else if (currentStage === WorkflowStage.MEASUREMENTS) {
      // Lock all spheres and cusp dots (no dragging during measurements)
      if (sphereTool && typeof sphereTool.setDraggable === 'function') {
        sphereTool.setDraggable(false);
      }
      if (cuspTool) {
        cuspTool.setDraggable(false);
      }

      // Use normal slice-based visibility (same as annulus definition)
      // Annotations will show only when on or near the current slice
      if (sphereTool && typeof sphereTool.setForceVisible === 'function') {
        sphereTool.setForceVisible(false);
      }
      if (cuspTool && typeof cuspTool.setForceVisible === 'function') {
        cuspTool.setForceVisible(false);
      }

      // During measurements, only rotation is active
      // Scrolling is handled manually along centerline
      console.log('🔄 Measurements mode - Rotation active, scrolling along centerline');

      // CRITICAL: Disable regular CrosshairsTool FIRST to prevent conflicts
      toolGroup.setToolDisabled(CrosshairsTool.toolName);
      console.log('🔇 CrosshairsTool disabled (using FixedCrosshairTool instead)');

      // CRITICAL: Disable StackScrollTool during measurements
      // We handle scrolling manually along centerline
      toolGroup.setToolDisabled(StackScrollTool.toolName);
      console.log('🔇 StackScrollTool disabled for continuous centerline scrolling');

      // Make non-primary tools passive
      toolGroup.setToolPassive(WindowLevelTool.toolName);

      // Keep cusp dots and spheres visible (slice-based) but not draggable
      // Setting tools to PASSIVE keeps them visible with slice-based visibility
      toolGroup.setToolPassive(CuspNadirTool.toolName);
      toolGroup.setToolPassive(SphereMarkerTool.toolName);
      console.log('✅ CuspNadirTool and SphereMarkerTool set to passive (slice-based visibility, not interactive)');

      // NOTE: FixedCrosshairTool configuration (drag disable, distance measurement)
      // is handled by a dedicated useEffect that runs when entering MEASUREMENTS stage
      // See "Configure Tools for Measurements Stage" useEffect below

      // CRITICAL: Ensure correct zoom level (60) for measurements stage
      // This preserves the zoom from annulus definition stage
      if (renderingEngineRef.current) {
        const renderingEngine = renderingEngineRef.current;
        const viewportIds = ['axial', 'sagittal', 'coronal'];

        viewportIds.forEach(viewportId => {
          const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
          if (viewport) {
            const currentCamera = viewport.getCamera();
            // Only update if zoom is different from desired value
            if (Math.abs(currentCamera.parallelScale - savedCameraZoomRef.current) > 0.1) {
              viewport.setCamera({
                ...currentCamera,
                parallelScale: savedCameraZoomRef.current
              });
              console.log(`  🔍 Set ${viewportId} zoom to ${savedCameraZoomRef.current}`);
            }
          }
        });

        renderingEngine.renderViewports(viewportIds);
      }

      // Keep zoom active on right mouse button
      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Secondary }],
      });

      console.log('🔓 Stage: Measurements - Fixed crosshair active, cusp dots visible (locked)');
    } else {
      // Unlock sphere tool, lock cusp tool
      if (sphereTool && typeof sphereTool.setDraggable === 'function') {
        sphereTool.setDraggable(true);
      }
      if (cuspTool) {
        cuspTool.setDraggable(false);
      }

      // Disable forceVisible - use normal slice-based visibility during root definition
      if (sphereTool && typeof sphereTool.setForceVisible === 'function') {
        sphereTool.setForceVisible(false);
      }
      if (cuspTool && typeof cuspTool.setForceVisible === 'function') {
        cuspTool.setForceVisible(false);
      }

      // Switch back to interactive tools (sphere marker for placement/dragging)
      console.log('🔄 Switching to interactive mode - SphereMarker tool active for dragging');

      // CRITICAL: Disable ALL crosshair tools first
      if (fixedCrosshairTool) {
        toolGroup.setToolDisabled(FixedCrosshairTool.toolName);
        fixedCrosshairTool.clearFixedPosition();
      }
      toolGroup.setToolDisabled(CrosshairsTool.toolName);

      // Re-enable StackScrollTool for normal scrolling
      toolGroup.setToolActive(StackScrollTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Wheel }],
      });

      // CRITICAL: Activate SphereMarker tool for placing and dragging spheres
      toolGroup.setToolActive(SphereMarkerTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });

      // Force render all viewports
      if (renderingEngineRef.current) {
        renderingEngineRef.current.renderViewports(['axial', 'sagittal', 'coronal']);
      }

      console.log('🔓 Stage: Root Definition - SphereMarker active, spheres draggable');
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

      // Also update CPR actors if in CPR mode
      if (renderMode === 'cpr' && cprActorsRef.current.length > 0) {
        console.log('🎨 Updating CPR actors window/level:', { window, level });
        cprActorsRef.current.forEach(({ actor }) => {
          const property = actor.getProperty();
          property.setColorWindow(window);
          property.setColorLevel(level);
        });
        renderingEngine.renderViewports(viewportIds);
      }

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

  // ============================================================================
  // Centerline Helper Functions for Measurements Stage Scrolling
  // ============================================================================

  /**
   * Get 3D position at a specific centerline index
   */
  const getCenterlinePositionAtIndex = (index: number): Types.Point3 | null => {
    if (!centerlineDataRef.current || !centerlineDataRef.current.position) {
      return null;
    }

    const numPoints = centerlineDataRef.current.position.length / 3;
    if (index < 0 || index >= numPoints) {
      return null;
    }

    // Support fractional indices with linear interpolation
    const lowerIndex = Math.floor(index);
    const upperIndex = Math.min(lowerIndex + 1, numPoints - 1);
    const fraction = index - lowerIndex;

    const lowerPos = [
      centerlineDataRef.current.position[lowerIndex * 3],
      centerlineDataRef.current.position[lowerIndex * 3 + 1],
      centerlineDataRef.current.position[lowerIndex * 3 + 2]
    ];

    const upperPos = [
      centerlineDataRef.current.position[upperIndex * 3],
      centerlineDataRef.current.position[upperIndex * 3 + 1],
      centerlineDataRef.current.position[upperIndex * 3 + 2]
    ];

    // Linear interpolation
    return [
      lowerPos[0] + (upperPos[0] - lowerPos[0]) * fraction,
      lowerPos[1] + (upperPos[1] - lowerPos[1]) * fraction,
      lowerPos[2] + (upperPos[2] - lowerPos[2]) * fraction
    ] as Types.Point3;
  };

  /**
   * Get tangent vector at a specific centerline index (direction along the path)
   */
  const getCenterlineTangentAtIndex = (index: number): Types.Point3 | null => {
    if (!centerlineDataRef.current || !centerlineDataRef.current.position) {
      return null;
    }

    const numPoints = centerlineDataRef.current.position.length / 3;
    if (index < 0 || index >= numPoints) {
      return null;
    }

    // Calculate tangent from adjacent points (works for fractional indices too)
    const baseIndex = Math.floor(index);
    let prevIndex = Math.max(0, baseIndex - 1);
    let nextIndex = Math.min(numPoints - 1, baseIndex + 1);

    const prevPos = [
      centerlineDataRef.current.position[prevIndex * 3],
      centerlineDataRef.current.position[prevIndex * 3 + 1],
      centerlineDataRef.current.position[prevIndex * 3 + 2]
    ];

    const nextPos = [
      centerlineDataRef.current.position[nextIndex * 3],
      centerlineDataRef.current.position[nextIndex * 3 + 1],
      centerlineDataRef.current.position[nextIndex * 3 + 2]
    ];

    // Tangent is direction from prev to next
    const tangent = [
      nextPos[0] - prevPos[0],
      nextPos[1] - prevPos[1],
      nextPos[2] - prevPos[2]
    ];

    // Normalize
    const length = Math.sqrt(tangent[0] ** 2 + tangent[1] ** 2 + tangent[2] ** 2);
    if (length === 0) {
      return [0, 0, 1] as Types.Point3; // Default fallback
    }

    return [
      tangent[0] / length,
      tangent[1] / length,
      tangent[2] / length
    ] as Types.Point3;
  };

  /**
   * Find the nearest centerline index to a given world position
   */
  const findNearestCenterlineIndex = (worldPos: Types.Point3): number => {
    if (!centerlineDataRef.current || !centerlineDataRef.current.position) {
      return 0;
    }

    const numPoints = centerlineDataRef.current.position.length / 3;
    let minDistance = Infinity;
    let nearestIndex = 0;

    for (let i = 0; i < numPoints; i++) {
      const pos = getCenterlinePositionAtIndex(i);
      if (!pos) continue;

      const distance = Math.sqrt(
        (pos[0] - worldPos[0]) ** 2 +
        (pos[1] - worldPos[1]) ** 2 +
        (pos[2] - worldPos[2]) ** 2
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestIndex = i;
      }
    }

    return nearestIndex;
  };

  // ============================================================================
  // Continuous Centerline Scrolling for Annulus Definition Stage
  // ============================================================================

  // Handle continuous centerline scrolling during annulus definition (same as measurements)
  useEffect(() => {
    if (currentStage !== WorkflowStage.ANNULUS_DEFINITION ||
        !centerlineDataRef.current ||
        !renderingEngineRef.current ||
        renderMode === 'cpr') {  // Skip scroll handler in CPR mode
      return;
    }

    const renderingEngine = renderingEngineRef.current;
    const numCenterlinePoints = centerlineDataRef.current.position.length / 3;

    // Initialize centerline index if needed
    if (currentCenterlineIndexRef.current === 0 && lockedFocalPointRef.current) {
      const nearestIndex = findNearestCenterlineIndex(lockedFocalPointRef.current);
      currentCenterlineIndexRef.current = nearestIndex;
      console.log(`📍 Initialized centerline index to ${nearestIndex} for annulus definition`);
    }

    // Get axial viewport element
    const axialViewport = renderingEngine.getViewport('axial');
    if (!axialViewport || !axialViewport.element) {
      return;
    }

    const axialElement = axialViewport.element;

    const handleWheel = (evt: WheelEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();

      // Use fractional scrolling for ultra-smooth navigation
      const scrollDirection = evt.deltaY > 0 ? 1 : -1;
      const fractionalStep = cprScrollStepSizeRef.current * scrollDirection;

      // Accumulate fractional position
      const newIndex = currentCenterlineIndexRef.current + fractionalStep;
      const clampedIndex = Math.max(0, Math.min(numCenterlinePoints - 1, newIndex));

      if (clampedIndex === currentCenterlineIndexRef.current) {
        return; // Already at boundary
      }

      currentCenterlineIndexRef.current = clampedIndex;

      // Get position and tangent at new centerline index (fractional supported)
      const newPosition = getCenterlinePositionAtIndex(clampedIndex);
      const tangent = getCenterlineTangentAtIndex(clampedIndex);

      if (!newPosition || !tangent) {
        console.warn('⚠️ Failed to get centerline position or tangent at index', clampedIndex);
        return;
      }

      console.log(`📜 MPR scroll to centerline index ${clampedIndex.toFixed(2)}/${numCenterlinePoints - 1}`);

      // Update axial viewport - position camera perpendicular to centerline
      const axialVp = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
      if (!axialVp) return;

      const camera = axialVp.getCamera();
      const cameraDistance = 200;

      // Position camera along the tangent (perpendicular to axial slice)
      const newCameraPos = [
        newPosition[0] + tangent[0] * cameraDistance,
        newPosition[1] + tangent[1] * cameraDistance,
        newPosition[2] + tangent[2] * cameraDistance
      ] as Types.Point3;

      // Calculate viewUp perpendicular to tangent
      let viewUp: Types.Point3;
      const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const cross = [
        tangent[1] * reference[2] - tangent[2] * reference[1],
        tangent[2] * reference[0] - tangent[0] * reference[2],
        tangent[0] * reference[1] - tangent[1] * reference[0]
      ];

      const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
      if (crossLen > 0) {
        viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
      } else {
        viewUp = [0, 0, 1] as Types.Point3;
      }

      axialVp.setCamera({
        position: newCameraPos,
        focalPoint: newPosition,
        viewUp: viewUp,
        parallelScale: camera.parallelScale,
      });

      axialVp.render();

      // Update fixed crosshair position
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      const fixedCrosshairTool = toolGroup?.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
      if (fixedCrosshairTool) {
        fixedCrosshairTool.setFixedPosition(newPosition, renderingEngineId);
      }

      // Update sagittal and coronal viewports with new screen-space directions
      const newCamera = axialVp.getCamera();
      const viewPlaneNormal = newCamera.viewPlaneNormal;
      const actualViewUp = newCamera.viewUp;

      // Calculate actualViewRight
      const actualViewRight = [
        actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
        actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
        actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
      ];

      const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
      if (rightLen > 0) {
        actualViewRight[0] /= rightLen;
        actualViewRight[1] /= rightLen;
        actualViewRight[2] /= rightLen;
      }

      // Apply rotation if any
      const rotationAngle = fixedCrosshairTool?.getRotationAngle() || 0;
      const cos = Math.cos(rotationAngle);
      const sin = Math.sin(rotationAngle);

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

      // Update sagittal
      const sagittalVp = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
      if (sagittalVp) {
        const sagCameraPos = [
          newPosition[0] + rotatedViewRight[0] * cameraDistance,
          newPosition[1] + rotatedViewRight[1] * cameraDistance,
          newPosition[2] + rotatedViewRight[2] * cameraDistance
        ] as Types.Point3;

        sagittalVp.setCamera({
          position: sagCameraPos,
          focalPoint: newPosition,
          viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
          parallelScale: sagittalVp.getCamera().parallelScale
        });

        sagittalVp.render();
      }

      // Update coronal
      const coronalVp = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
      if (coronalVp) {
        const corCameraPos = [
          newPosition[0] + rotatedViewUp[0] * cameraDistance,
          newPosition[1] + rotatedViewUp[1] * cameraDistance,
          newPosition[2] + rotatedViewUp[2] * cameraDistance
        ] as Types.Point3;

        coronalVp.setCamera({
          position: corCameraPos,
          focalPoint: newPosition,
          viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
          parallelScale: coronalVp.getCamera().parallelScale
        });

        coronalVp.render();
      }

      // CRITICAL: Manually trigger visibility updates for sphere and cusp tools
      // Since we're capturing the wheel event, the tools' visibility listeners don't run
      const tGroup = ToolGroupManager.getToolGroup(toolGroupId);
      const sphereToolInstance = tGroup?.getToolInstance(SphereMarkerTool.toolName) as SphereMarkerTool;
      const cuspToolInstance = tGroup?.getToolInstance(CuspNadirTool.toolName) as CuspNadirTool;

      if (sphereToolInstance && typeof sphereToolInstance.updateVisibilityForSingleViewport === 'function') {
        if (axialVp) sphereToolInstance.updateVisibilityForSingleViewport(axialVp, 0);
        if (sagittalVp) sphereToolInstance.updateVisibilityForSingleViewport(sagittalVp, 1);
        if (coronalVp) sphereToolInstance.updateVisibilityForSingleViewport(coronalVp, 2);
      }

      if (cuspToolInstance && typeof cuspToolInstance.updateVisibilityForSingleViewport === 'function') {
        if (axialVp) cuspToolInstance.updateVisibilityForSingleViewport(axialVp, 0);
        if (sagittalVp) cuspToolInstance.updateVisibilityForSingleViewport(sagittalVp, 1);
        if (coronalVp) cuspToolInstance.updateVisibilityForSingleViewport(coronalVp, 2);
      }

      console.log('✅ All viewports updated to centerline position', newIndex);
    };

    // Add event listener with capture=true to intercept BEFORE Cornerstone's handlers
    console.log('🔧 Setting up continuous centerline scroll handler on axial viewport (annulus definition)');
    console.log('   Number of centerline points:', numCenterlinePoints);
    console.log('   Starting at centerline index:', currentCenterlineIndexRef.current);

    axialElement.addEventListener('wheel', handleWheel, { passive: false, capture: true });

    return () => {
      console.log('🧹 Removing continuous centerline scroll handler (annulus definition)');
      axialElement.removeEventListener('wheel', handleWheel, { capture: true });
    };
  }, [currentStage, renderingEngineRef.current, centerlineDataRef.current, renderMode]);

  // ============================================================================
  // Continuous Centerline Scrolling for Measurements Stage
  // ============================================================================

  // Handle continuous scrolling along centerline during measurements stage
  useEffect(() => {
    if (currentStage !== WorkflowStage.MEASUREMENTS ||
        !centerlineDataRef.current ||
        !renderingEngineRef.current ||
        !lockedFocalPointRef.current ||
        renderMode === 'cpr') {  // Skip scroll handler in CPR mode
      return;
    }

    const renderingEngine = renderingEngineRef.current;
    const axialViewport = renderingEngine.getViewport('axial') as Types.IVolumeViewport;

    if (!axialViewport || !axialViewport.element) {
      return;
    }

    const axialElement = axialViewport.element;
    const numCenterlinePoints = centerlineDataRef.current.position.length / 3;

    // Initialize centerline index to annulus center position (if not already set)
    if (currentCenterlineIndexRef.current === 0 && lockedFocalPointRef.current) {
      const nearestIndex = findNearestCenterlineIndex(lockedFocalPointRef.current);
      currentCenterlineIndexRef.current = nearestIndex;
      console.log(`📍 Initialized centerline index to ${nearestIndex} (nearest to annulus center)`);
    }

    const handleWheel = (evt: WheelEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();

      // Use fractional scrolling for ultra-smooth navigation
      const scrollDirection = evt.deltaY > 0 ? 1 : -1;
      const fractionalStep = cprScrollStepSizeRef.current * scrollDirection;

      // Accumulate fractional position
      const newIndex = currentCenterlineIndexRef.current + fractionalStep;
      const clampedIndex = Math.max(0, Math.min(numCenterlinePoints - 1, newIndex));

      if (clampedIndex === currentCenterlineIndexRef.current) {
        return; // Already at boundary
      }

      currentCenterlineIndexRef.current = clampedIndex;

      // Get position and tangent at new centerline index (fractional supported)
      const newPosition = getCenterlinePositionAtIndex(clampedIndex);
      const tangent = getCenterlineTangentAtIndex(clampedIndex);

      if (!newPosition || !tangent) {
        console.warn('⚠️ Failed to get centerline position or tangent at index', clampedIndex);
        return;
      }

      console.log(`📜 MPR scroll to centerline index ${clampedIndex.toFixed(2)}/${numCenterlinePoints - 1}`);

      // Update axial viewport - position camera perpendicular to centerline
      const axialVp = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
      if (!axialVp) return;

      const camera = axialVp.getCamera();
      const cameraDistance = 200;

      // Position camera along the tangent (perpendicular to axial slice)
      const newCameraPos = [
        newPosition[0] + tangent[0] * cameraDistance,
        newPosition[1] + tangent[1] * cameraDistance,
        newPosition[2] + tangent[2] * cameraDistance
      ] as Types.Point3;

      // Calculate viewUp perpendicular to tangent
      let viewUp: Types.Point3;
      const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const cross = [
        tangent[1] * reference[2] - tangent[2] * reference[1],
        tangent[2] * reference[0] - tangent[0] * reference[2],
        tangent[0] * reference[1] - tangent[1] * reference[0]
      ];

      const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
      if (crossLen > 0) {
        viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
      } else {
        viewUp = [0, 0, 1] as Types.Point3;
      }

      axialVp.setCamera({
        position: newCameraPos,
        focalPoint: newPosition,
        viewUp: viewUp,
        parallelScale: camera.parallelScale,
      });

      axialVp.render();

      // Update fixed crosshair position
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      const fixedCrosshairTool = toolGroup?.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
      if (fixedCrosshairTool) {
        fixedCrosshairTool.setFixedPosition(newPosition, renderingEngineId);
      }

      // Update sagittal and coronal viewports with new screen-space directions
      const newCamera = axialVp.getCamera();
      const viewPlaneNormal = newCamera.viewPlaneNormal;
      const actualViewUp = newCamera.viewUp;

      // Calculate actualViewRight
      const actualViewRight = [
        actualViewUp[1] * viewPlaneNormal[2] - actualViewUp[2] * viewPlaneNormal[1],
        actualViewUp[2] * viewPlaneNormal[0] - actualViewUp[0] * viewPlaneNormal[2],
        actualViewUp[0] * viewPlaneNormal[1] - actualViewUp[1] * viewPlaneNormal[0]
      ];

      const rightLen = Math.sqrt(actualViewRight[0] ** 2 + actualViewRight[1] ** 2 + actualViewRight[2] ** 2);
      if (rightLen > 0) {
        actualViewRight[0] /= rightLen;
        actualViewRight[1] /= rightLen;
        actualViewRight[2] /= rightLen;
      }

      // Apply rotation if any (preserve user's rotation angle)
      const rotationAngle = fixedCrosshairTool?.getRotationAngle() || 0;
      const cos = Math.cos(rotationAngle);
      const sin = Math.sin(rotationAngle);

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

      // Update sagittal viewport
      const sagittalVp = renderingEngine.getViewport('sagittal') as Types.IVolumeViewport;
      if (sagittalVp) {
        const sagCameraPos = [
          newPosition[0] + rotatedViewRight[0] * cameraDistance,
          newPosition[1] + rotatedViewRight[1] * cameraDistance,
          newPosition[2] + rotatedViewRight[2] * cameraDistance
        ] as Types.Point3;

        sagittalVp.setCamera({
          position: sagCameraPos,
          focalPoint: newPosition,
          viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
          parallelScale: sagittalVp.getCamera().parallelScale
        });

        sagittalVp.render();
      }

      // Update coronal viewport
      const coronalVp = renderingEngine.getViewport('coronal') as Types.IVolumeViewport;
      if (coronalVp) {
        const corCameraPos = [
          newPosition[0] + rotatedViewUp[0] * cameraDistance,
          newPosition[1] + rotatedViewUp[1] * cameraDistance,
          newPosition[2] + rotatedViewUp[2] * cameraDistance
        ] as Types.Point3;

        coronalVp.setCamera({
          position: corCameraPos,
          focalPoint: newPosition,
          viewUp: [-viewPlaneNormal[0], -viewPlaneNormal[1], -viewPlaneNormal[2]] as Types.Point3,
          parallelScale: coronalVp.getCamera().parallelScale
        });

        coronalVp.render();
      }

      // CRITICAL: Manually trigger visibility updates for sphere and cusp tools
      // Since we're capturing the wheel event, the tools' visibility listeners don't run
      const tGroup = ToolGroupManager.getToolGroup(toolGroupId);
      const sphereToolInstance = tGroup?.getToolInstance(SphereMarkerTool.toolName) as SphereMarkerTool;
      const cuspToolInstance = tGroup?.getToolInstance(CuspNadirTool.toolName) as CuspNadirTool;

      if (sphereToolInstance && typeof sphereToolInstance.updateVisibilityForSingleViewport === 'function') {
        if (axialVp) sphereToolInstance.updateVisibilityForSingleViewport(axialVp, 0);
        if (sagittalVp) sphereToolInstance.updateVisibilityForSingleViewport(sagittalVp, 1);
        if (coronalVp) sphereToolInstance.updateVisibilityForSingleViewport(coronalVp, 2);
      }

      if (cuspToolInstance && typeof cuspToolInstance.updateVisibilityForSingleViewport === 'function') {
        if (axialVp) cuspToolInstance.updateVisibilityForSingleViewport(axialVp, 0);
        if (sagittalVp) cuspToolInstance.updateVisibilityForSingleViewport(sagittalVp, 1);
        if (coronalVp) cuspToolInstance.updateVisibilityForSingleViewport(coronalVp, 2);
      }

      console.log('✅ All viewports updated to centerline position', newIndex);
    };

    // Add event listener with capture=true to intercept BEFORE Cornerstone's handlers
    console.log('🔧 Setting up continuous centerline scroll handler on axial viewport');
    console.log('   Number of centerline points:', numCenterlinePoints);
    console.log('   Starting at centerline index:', currentCenterlineIndexRef.current);

    axialElement.addEventListener('wheel', handleWheel, { passive: false, capture: true });

    return () => {
      console.log('🧹 Removing continuous centerline scroll handler');
      axialElement.removeEventListener('wheel', handleWheel, { capture: true });
    };
  }, [currentStage, renderingEngineRef.current, centerlineDataRef.current, lockedFocalPointRef.current, renderMode]);

  // ============================================================================
  // CPR Mode Scroll Handler - Updates only axial cross-section
  // ============================================================================

  useEffect(() => {
    // Only enable in CPR mode with centerline data
    if (renderMode !== 'cpr' ||
        !centerlineDataRef.current ||
        !renderingEngineRef.current) {
      return;
    }

    const renderingEngine = renderingEngineRef.current;
    const numCenterlinePoints = centerlineDataRef.current.position.length / 3;

    let axialElement: HTMLElement | null = null;

    const handleWheel = (evt: WheelEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();

      // Use fractional scrolling for ultra-smooth navigation
      // Step size of 0.1 index units = ~0.024mm with 500 points over 120mm
      const scrollDirection = evt.deltaY > 0 ? 1 : -1;
      const fractionalStep = cprScrollStepSizeRef.current * scrollDirection;

      // Accumulate fractional position
      const newIndex = currentCenterlineIndexRef.current + fractionalStep;

      // Clamp to bounds
      const clampedIndex = Math.max(0, Math.min(numCenterlinePoints - 1, newIndex));

      if (clampedIndex === currentCenterlineIndexRef.current) {
        return; // Already at boundary
      }

      currentCenterlineIndexRef.current = clampedIndex;

      // Get position and tangent at new centerline index (fractional index supported)
      const newPosition = getCenterlinePositionAtIndex(clampedIndex);
      const tangent = getCenterlineTangentAtIndex(clampedIndex);

      if (!newPosition || !tangent) {
        console.warn('⚠️ Failed to get centerline position or tangent at index', clampedIndex);
        return;
      }

      console.log(`📜 CPR scroll to centerline index ${clampedIndex.toFixed(2)}/${numCenterlinePoints - 1}`);

      // Update ONLY the axial viewport (cross-section)
      // Sagittal and coronal CPR views stay STATIC showing the full straightened vessel
      const axialVp = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
      if (!axialVp) return;

      const cameraDistance = 200;

      // Position camera along the tangent (perpendicular to axial slice)
      const newCameraPos = [
        newPosition[0] + tangent[0] * cameraDistance,
        newPosition[1] + tangent[1] * cameraDistance,
        newPosition[2] + tangent[2] * cameraDistance
      ] as Types.Point3;

      // Calculate viewUp perpendicular to tangent
      let viewUp: Types.Point3;
      const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const cross = [
        tangent[1] * reference[2] - tangent[2] * reference[1],
        tangent[2] * reference[0] - tangent[0] * reference[2],
        tangent[0] * reference[1] - tangent[1] * reference[0]
      ];

      const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
      if (crossLen > 0) {
        viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
      } else {
        viewUp = [0, 0, 1] as Types.Point3;
      }

      axialVp.setCamera({
        position: newCameraPos,
        focalPoint: newPosition,
        viewUp: viewUp,
        parallelScale: axialVp.getCamera().parallelScale,
      });

      axialVp.render();

      // Update fixed crosshair position
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      const fixedCrosshairTool = toolGroup?.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
      if (fixedCrosshairTool) {
        fixedCrosshairTool.setFixedPosition(newPosition, renderingEngineId);
      }

      // Manually trigger visibility updates for sphere and cusp tools
      const tGroup = ToolGroupManager.getToolGroup(toolGroupId);
      const sphereToolInstance = tGroup?.getToolInstance(SphereMarkerTool.toolName) as SphereMarkerTool;
      const cuspToolInstance = tGroup?.getToolInstance(CuspNadirTool.toolName) as CuspNadirTool;

      if (sphereToolInstance && typeof sphereToolInstance.updateVisibilityForSingleViewport === 'function') {
        sphereToolInstance.updateVisibilityForSingleViewport(axialVp, 0);
      }

      if (cuspToolInstance && typeof cuspToolInstance.updateVisibilityForSingleViewport === 'function') {
        cuspToolInstance.updateVisibilityForSingleViewport(axialVp, 0);
      }

      // Update CPR position indicator lines on sagittal/coronal views
      updateCPRPositionLines(clampedIndex);

      console.log('✅ Axial cross-section updated to centerline position', clampedIndex.toFixed(2));
      console.log('   (Sagittal/Coronal CPR views remain static)');
    };

    // Access axial viewport element directly from ref
    const setupTimeout = setTimeout(() => {
      axialElement = elementRefs.axial.current;

      if (!axialElement) {
        console.warn('⚠️ Axial viewport element ref is null');
        return;
      }

      console.log('🔧 Setting up CPR mode scroll handler (axial cross-section only)');
      console.log('   Number of centerline points:', numCenterlinePoints);
      console.log('   Starting at centerline index:', currentCenterlineIndexRef.current);

      // Add event listener with capture=true to intercept BEFORE Cornerstone's handlers
      axialElement.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    }, 600); // 600ms delay to ensure viewports are initialized

    return () => {
      clearTimeout(setupTimeout);
      if (axialElement) {
        console.log('🧹 Removing CPR mode scroll handler');
        axialElement.removeEventListener('wheel', handleWheel, { capture: true });
      }
    };
  }, [renderMode, renderingEngineRef.current, centerlineDataRef.current]);

  // ============================================================================
  // Drag Horizontal Line to Scroll (CPR Mode)
  // ============================================================================

  useEffect(() => {
    // Only enable in CPR mode
    if (renderMode !== 'cpr' || !renderingEngineRef.current || !centerlineDataRef.current) {
      return;
    }

    const renderingEngine = renderingEngineRef.current;
    const numCenterlinePoints = centerlineDataRef.current.position.length / 3;

    let isDragging = false;
    let dragStartY = 0;
    let dragStartIndex = 0;

    const handleMouseDown = (evt: MouseEvent, viewportId: string) => {
      const viewport = renderingEngine.getViewport(viewportId);
      if (!viewport) {
        console.log('⚠️ No viewport for', viewportId);
        return;
      }

      const canvas = viewport.getCanvas() as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const mouseY = evt.clientY - rect.top;

      // Check if mouse is near the horizontal line
      const positionRatio = cprPositionRatioRef.current;
      // IMPORTANT: Use rect.height (displayed size) not canvas.height (internal resolution)
      const lineY = positionRatio * rect.height;
      const hitDistance = 30; // 30 pixels hit area (increased for easier interaction)
      const distance = Math.abs(mouseY - lineY);

      if (distance < hitDistance) {
        isDragging = true;
        dragStartY = mouseY;
        dragStartIndex = currentCenterlineIndexRef.current;
        evt.preventDefault();
        evt.stopPropagation();
        evt.stopImmediatePropagation();
        canvas.style.cursor = 'ns-resize';
      }
    };

    const handleMouseMove = (evt: MouseEvent, viewportId: string) => {
      if (!isDragging) {
        // Update cursor when hovering near line
        const viewport = renderingEngine.getViewport(viewportId);
        if (!viewport) return;
        const canvas = viewport.getCanvas() as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        const mouseY = evt.clientY - rect.top;
        const positionRatio = cprPositionRatioRef.current;

        // IMPORTANT: Use rect.height (displayed size) not canvas.height (internal resolution)
        // Canvas might have 2x or 3x resolution due to device pixel ratio
        const lineY = positionRatio * rect.height;
        const hitDistance = 30; // 30 pixels hit area (increased for easier interaction)
        const distance = Math.abs(mouseY - lineY);

        if (distance < hitDistance) {
          if (canvas.style.cursor !== 'ns-resize') {
            canvas.style.cursor = 'ns-resize';
            canvas.style.setProperty('cursor', 'ns-resize', 'important');
          }
        } else {
          if (canvas.style.cursor === 'ns-resize') {
            canvas.style.cursor = '';
            canvas.style.removeProperty('cursor');
          }
        }
        return;
      }

      const viewport = renderingEngine.getViewport(viewportId);
      if (!viewport) return;
      const canvas = viewport.getCanvas() as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const mouseY = evt.clientY - rect.top;

      // Calculate delta in pixels, convert to centerline index
      const deltaY = mouseY - dragStartY;

      // Get total centerline length
      const positions = centerlineDataRef.current.position;
      let totalLength = 0;
      for (let i = 1; i < numCenterlinePoints; i++) {
        const dx = positions[i * 3] - positions[(i - 1) * 3];
        const dy = positions[i * 3 + 1] - positions[(i - 1) * 3 + 1];
        const dz = positions[i * 3 + 2] - positions[(i - 1) * 3 + 2];
        totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }

      // Convert pixel delta to mm, then to index delta
      // IMPORTANT: Use rect.height (displayed size) not canvas.height
      const deltaRatio = deltaY / rect.height;
      const deltaMM = deltaRatio * totalLength;
      const avgSegmentLength = totalLength / (numCenterlinePoints - 1);
      const deltaIndex = deltaMM / avgSegmentLength;

      const newIndex = Math.max(0, Math.min(numCenterlinePoints - 1, dragStartIndex + deltaIndex));

      if (newIndex !== currentCenterlineIndexRef.current) {
        currentCenterlineIndexRef.current = newIndex;

        // Update axial viewport
        const newPosition = getCenterlinePositionAtIndex(newIndex);
        const tangent = getCenterlineTangentAtIndex(newIndex);

        if (newPosition && tangent) {
          const axialVp = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
          if (axialVp) {
            const cameraDistance = 200;
            const newCameraPos = [
              newPosition[0] + tangent[0] * cameraDistance,
              newPosition[1] + tangent[1] * cameraDistance,
              newPosition[2] + tangent[2] * cameraDistance
            ] as Types.Point3;

            let viewUp: Types.Point3;
            const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
            const cross = [
              tangent[1] * reference[2] - tangent[2] * reference[1],
              tangent[2] * reference[0] - tangent[0] * reference[2],
              tangent[0] * reference[1] - tangent[1] * reference[0]
            ];
            const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2);
            if (crossLen > 0) {
              viewUp = [cross[0] / crossLen, cross[1] / crossLen, cross[2] / crossLen] as Types.Point3;
            } else {
              viewUp = [0, 0, 1] as Types.Point3;
            }

            axialVp.setCamera({
              position: newCameraPos,
              focalPoint: newPosition,
              viewUp: viewUp,
              parallelScale: axialVp.getCamera().parallelScale,
            });
            axialVp.render();

            // Update crosshair position
            const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
            const fixedCrosshairTool = toolGroup?.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;
            if (fixedCrosshairTool) {
              fixedCrosshairTool.setFixedPosition(newPosition, renderingEngineId);
            }

            // Update CPR position lines
            updateCPRPositionLines(newIndex);
          }
        }
      }

      evt.preventDefault();
      evt.stopPropagation();
    };

    const handleMouseUp = (evt: MouseEvent) => {
      if (isDragging) {
        isDragging = false;

        // Reset cursor for all CPR canvases
        ['sagittal', 'coronal'].forEach(vpId => {
          const vp = renderingEngine.getViewport(vpId);
          if (vp) {
            const canvas = vp.getCanvas() as HTMLCanvasElement;
            canvas.style.cursor = '';
          }
        });

        evt.preventDefault();
        evt.stopPropagation();
      }
    };

    // Add event listeners to sagittal and coronal viewports
    const sagittalElement = elementRefs.sagittal.current;
    const coronalElement = elementRefs.coronal.current;

    if (sagittalElement && coronalElement) {
      const sagittalMouseDown = (e: MouseEvent) => handleMouseDown(e, 'sagittal');
      const sagittalMouseMove = (e: MouseEvent) => handleMouseMove(e, 'sagittal');
      const coronalMouseDown = (e: MouseEvent) => handleMouseDown(e, 'coronal');
      const coronalMouseMove = (e: MouseEvent) => handleMouseMove(e, 'coronal');

      sagittalElement.addEventListener('mousedown', sagittalMouseDown, { capture: true });
      sagittalElement.addEventListener('mousemove', sagittalMouseMove, { capture: true });
      coronalElement.addEventListener('mousedown', coronalMouseDown, { capture: true });
      coronalElement.addEventListener('mousemove', coronalMouseMove, { capture: true });
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        sagittalElement.removeEventListener('mousedown', sagittalMouseDown, { capture: true } as any);
        sagittalElement.removeEventListener('mousemove', sagittalMouseMove, { capture: true } as any);
        coronalElement.removeEventListener('mousedown', coronalMouseDown, { capture: true } as any);
        coronalElement.removeEventListener('mousemove', coronalMouseMove, { capture: true } as any);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [renderMode, renderingEngineRef.current, centerlineDataRef.current]);

  // ============================================================================
  // Continuous Redraw CPR Position Lines
  // ============================================================================

  useEffect(() => {
    // Only enable in CPR mode
    if (renderMode !== 'cpr' || !renderingEngineRef.current || !centerlineDataRef.current) {
      return;
    }

    console.log('🔧 Starting continuous CPR position line redraw loop');

    let animationFrameId: number;
    let isRunning = true;

    // Continuous redraw function
    const redrawLoop = () => {
      if (!isRunning) return;

      const positionRatio = cprPositionRatioRef.current;
      const annulusRatio = cprAnnulusRatioRef.current;

      if (positionRatio !== null && positionRatio !== undefined) {
        // Redraw lines on both CPR viewports (with annulus reference line)
        drawCPRPositionLineOnCanvas('sagittal', positionRatio, annulusRatio);
        drawCPRPositionLineOnCanvas('coronal', positionRatio, annulusRatio);
      }

      // Continue loop
      animationFrameId = requestAnimationFrame(redrawLoop);
    };

    // Start the loop
    redrawLoop();

    return () => {
      console.log('🧹 Stopping CPR position line redraw loop');
      isRunning = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [renderMode, renderingEngineRef.current, centerlineDataRef.current]);

  // ============================================================================
  // Cleanup Annulus Reference Lines when leaving Measurements Stage
  // ============================================================================

  useEffect(() => {
    // Remove annulus lines when leaving measurements stage
    if (currentStage !== WorkflowStage.MEASUREMENTS && annulusLineActorsRef.current && renderingEngineRef.current) {
      console.log('🧹 Removing annulus reference lines (left measurements stage)');

      const renderingEngine = renderingEngineRef.current;
      const sagittalVp = renderingEngine.getViewport('sagittal');
      const coronalVp = renderingEngine.getViewport('coronal');

      if (sagittalVp && annulusLineActorsRef.current.sagittal) {
        try {
          sagittalVp.removeActor({ uid: 'annulus-line-sagittal' });
          sagittalVp.render();
        } catch (e) {
          console.warn('Failed to remove sagittal annulus line:', e);
        }
      }

      if (coronalVp && annulusLineActorsRef.current.coronal) {
        try {
          coronalVp.removeActor({ uid: 'annulus-line-coronal' });
          coronalVp.render();
        } catch (e) {
          console.warn('Failed to remove coronal annulus line:', e);
        }
      }

      annulusLineActorsRef.current = null;
      console.log('✅ Annulus reference lines removed');
    }
  }, [currentStage]);

  // ============================================================================
  // Cleanup: Disable Distance Measurement when leaving Measurements Stage
  // ============================================================================
  useEffect(() => {
    // Cleanup when leaving measurements stage
    if (currentStage !== WorkflowStage.MEASUREMENTS) {
      const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
      if (toolGroup) {
        const fixedCrosshairTool = toolGroup.getToolInstance(FixedCrosshairTool.toolName) as FixedCrosshairTool;

        if (fixedCrosshairTool) {
          // Disable distance measurement
          if (typeof fixedCrosshairTool.setAnnulusReference === 'function') {
            fixedCrosshairTool.setAnnulusReference(null);
            console.log('📏 Distance measurement disabled (left measurements stage)');
          }

          // Re-enable center dragging
          if (typeof fixedCrosshairTool.setCenterDraggingDisabled === 'function') {
            fixedCrosshairTool.setCenterDraggingDisabled(false);
            console.log('🔓 Center dragging re-enabled');
          }
        }
      }
    }
  }, [currentStage]); // Run when stage changes

  // ============================================================================
  // Crosshair Focal Point Synchronization
  // ============================================================================

  // DISABLED: Focal point locking is no longer needed with continuous centerline scrolling
  // The continuous scrolling in ANNULUS_DEFINITION properly updates the focal point along the centerline
  // This enforcement mechanism was causing drift warnings and jerky scrolling
  /*
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
  */

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
      {/* Header - FIXED HEIGHT to prevent viewport shift */}
      <div className="flex items-center justify-between p-2 bg-slate-800 border-b border-slate-700 flex-shrink-0 h-14">
        <div className="flex items-center gap-4 min-w-0">
          {patientInfo && (
            <div className="text-xs truncate">
              <span className="text-slate-300">Patient: </span>
              <span className="text-white font-medium">{patientInfo.patientName || 'Unknown'}</span>
              <span className="text-slate-400 ml-2">({patientInfo.patientID || 'Unknown ID'})</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Tool Selection - NO WRAPPING */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-300">Tools:</span>
            <button
              onClick={() => handleToolChange('Crosshairs')}
              className={`p-1.5 rounded text-xs flex items-center gap-1 whitespace-nowrap ${activeTool === 'Crosshairs' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              <FaCrosshairs />
              <span className="hidden sm:inline">Cross</span>
            </button>
            <button
              onClick={() => handleToolChange('WindowLevel')}
              className={`p-1.5 rounded text-xs flex items-center gap-1 whitespace-nowrap ${activeTool === 'WindowLevel' ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              <FaAdjust />
              <span>W/L</span>
            </button>
            <button
              onClick={() => handleToolChange('SphereMarker')}
              className={`p-1.5 rounded text-xs flex items-center gap-1 whitespace-nowrap ${activeTool === 'SphereMarker' ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              <FaCircle />
              <span className="hidden sm:inline">Sphere</span>
            </button>
            {/* Show CuspNadir tool only during annulus definition stage */}
            {currentStage === WorkflowStage.ANNULUS_DEFINITION && (
              <button
                onClick={() => handleToolChange('CuspNadir')}
                className={`p-1.5 rounded text-xs flex items-center gap-1 whitespace-nowrap ${activeTool === 'CuspNadir' ? 'bg-teal-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
              >
                <FaDotCircle />
                <span>Cusp</span>
              </button>
            )}
            <button
              onClick={() => handleToolChange('Zoom')}
              className={`p-1.5 rounded text-xs flex items-center gap-1 whitespace-nowrap ${activeTool === 'Zoom' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              <FaSearchPlus />
              <span className="hidden sm:inline">Zoom</span>
            </button>
            <button
              onClick={() => handleToolChange('Pan')}
              className={`p-1.5 rounded text-xs flex items-center gap-1 whitespace-nowrap ${activeTool === 'Pan' ? 'bg-yellow-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              <FaArrowsAlt />
              <span className="hidden sm:inline">Pan</span>
            </button>
          </div>
          
          {/* Window/Level Presets - Compact */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-300">W/L:</span>
            <button
              onClick={() => handleWindowLevelChange(400, 40)}
              className="bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white text-xs whitespace-nowrap"
            >
              Soft
            </button>
            <button
              onClick={() => handleWindowLevelChange(900, 350)}
              className="bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white text-xs whitespace-nowrap"
            >
              Angio
            </button>
            <button
              onClick={() => handleWindowLevelChange(1500, 300)}
              className="bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white text-xs whitespace-nowrap"
            >
              Bone
            </button>
            <button
              onClick={() => handleWindowLevelChange(2000, 0)}
              className="bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white text-xs whitespace-nowrap"
            >
              Lung
            </button>
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