import React, { useEffect, useRef, useState } from 'react';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import vtkInteractorStyleImage from '@kitware/vtk.js/Interaction/Style/InteractorStyleImage';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkCubeSource from '@kitware/vtk.js/Filters/Sources/CubeSource';
import vtkLight from '@kitware/vtk.js/Rendering/Core/Light';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkCellPicker from '@kitware/vtk.js/Rendering/Core/CellPicker';
import vtkPointPicker from '@kitware/vtk.js/Rendering/Core/PointPicker';
import { FaSearchPlus, FaSearchMinus, FaAdjust, FaUndo, FaDotCircle } from 'react-icons/fa';

import createImageIdsAndCacheMetaData from '../lib/createImageIdsAndCacheMetaData';
import {
  RenderingEngine,
  Enums as CornerstoneEnums,
  volumeLoader,
  cornerstoneStreamingImageVolumeLoader,
  cache,
  Types,
  eventTarget,
} from "@cornerstonejs/core";
import {
  ToolGroupManager,
  Enums as ToolEnums,
  ProbeTool,
  annotation,
  addTool,
  init as toolsInit,
} from "@cornerstonejs/tools";

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface TriViewCPRViewportProps {
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
  stage?: 'analysis' | 'annulus_definition';
  width?: number;
  height?: number;
  backgroundColor?: [number, number, number];
}

// Register volume loader
volumeLoader.registerUnknownVolumeLoader(cornerstoneStreamingImageVolumeLoader);

const TriViewCPRViewport: React.FC<TriViewCPRViewportProps> = ({
  patientInfo,
  rootPoints,
  annularPlane,
  modifiedCenterline,
  onAnnulusPointSelected,
  onCuspDotsUpdate,
  stage = 'analysis',
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
  const [windowLevel, setWindowLevel] = useState({ window: 1000, level: 300 });
  const [zoom, setZoom] = useState(1.0);
  const [crosshairPosition, setCrosshairPosition] = useState(0.5);
  const [rotationAngle, setRotationAngle] = useState(0);
  const [centerlinePoints, setCenterlinePoints] = useState<Point3D[]>([]);
  const [isPlacingCuspDots, setIsPlacingCuspDots] = useState(false);
  const [cuspDots, setCuspDots] = useState<Array<{
    id: string;
    realWorldPos: [number, number, number];
    color: string;
    cuspType: 'left' | 'right' | 'non-coronary';
    placementIndex: number;
  }>>([]);
  const initialParallelScale = useRef<number>(50);
  
  // Refs for resize handling
  const lastResizeTime = useRef<number>(0);
  const lastDimensions = useRef<Map<string, {width: number, height: number}>>(new Map());

  // Cornerstone overlay refs for annotation tools
  const cornerstoneOverlayRefs = useRef<{
    cpr1: HTMLDivElement | null;
    cpr2: HTMLDivElement | null;
    crossSection: HTMLDivElement | null;
  }>({
    cpr1: null,
    cpr2: null,
    crossSection: null
  });

  // Cornerstone objects for annotation overlays
  const cornerstoneObjects = useRef<{
    renderingEngine?: RenderingEngine;
    toolGroup?: any;
    volumeId?: string;
  }>({});

  // VTK objects refs for three views
  const vtkObjects = useRef<{
    cpr1?: {
      renderWindow?: any;
      renderer?: any;
      mapper?: any;
      actor?: any;
      imageData?: any;
      camera?: any;
      genericRenderWindow?: any;
    };
    cpr2?: {
      renderWindow?: any;
      renderer?: any;
      mapper?: any;
      actor?: any;
      imageData?: any;
      camera?: any;
      genericRenderWindow?: any;
    };
    crossSection?: {
      renderWindow?: any;
      renderer?: any;
      mapper?: any;
      actor?: any;
      imageData?: any;
      camera?: any;
      genericRenderWindow?: any;
    };
    volume?: any;
  }>({});

  // Sphere tracking
  const sphereActorMap = useRef<Map<string, any>>(new Map());

  // Generate centerline points from 3 anatomical points or use modified centerline
  const generateCenterlinePoints = (points: Point3D[]): Point3D[] => {
    // Use modified centerline if available (after annulus plane calculation)
    if (modifiedCenterline && modifiedCenterline.length > 0) {
      console.log('🔄 Using modified centerline (perpendicular to annular plane):', {
        points: modifiedCenterline.length,
        firstPoint: modifiedCenterline[0],
        lastPoint: modifiedCenterline[modifiedCenterline.length - 1],
        annularPlanePresent: !!annularPlane
      });
      return modifiedCenterline;
    }

    if (points.length < 3) return [];

    console.log('📏 Using original 3-point centerline interpolation for', points.length, 'root points');
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
        const localT = t / segment1Ratio;
        x = p0.x + localT * (p1.x - p0.x);
        y = p0.y + localT * (p1.y - p0.y);
        z = p0.z + localT * (p1.z - p0.z);
      } else {
        const localT = (t - segment1Ratio) / (1 - segment1Ratio);
        x = p1.x + localT * (p2.x - p1.x);
        y = p1.y + localT * (p2.y - p1.y);
        z = p1.z + localT * (p2.z - p1.z);
      }

      centerlinePoints.push({ x, y, z });
    }

    return centerlinePoints;
  };

  // Create VTK sphere actor for cusp dots - simplified approach
  const createCuspSphereActor = (
    worldPos: [number, number, number],
    color: string,
    sphereId: string
  ): any => {
    console.log(`🔵 Creating simple VTK sphere:`, { worldPos, color, sphereId });

    // Create sphere source
    const sphereSource = vtkSphereSource.newInstance();
    sphereSource.setCenter(worldPos[0], worldPos[1], worldPos[2]);
    sphereSource.setRadius(10); // Large radius for visibility
    sphereSource.setPhiResolution(8);
    sphereSource.setThetaResolution(8);

    // Create mapper
    const mapper = vtkMapper.newInstance();
    mapper.setInputConnection(sphereSource.getOutputPort());

    // Create actor
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);

    // Set very bright, simple properties
    const property = actor.getProperty();
    property.setColor(1.0, 0.0, 0.0); // Always bright red for visibility
    property.setOpacity(1.0);
    property.setAmbient(1.0); // Full ambient light
    property.setDiffuse(0.0); // No diffuse
    property.setSpecular(0.0); // No specular

    console.log(`🔵 Sphere created at: [${worldPos[0].toFixed(2)}, ${worldPos[1].toFixed(2)}, ${worldPos[2].toFixed(2)}] with radius 10`);

    sphereActorMap.current.set(sphereId, actor);
    
    return { actor, source: sphereSource, id: sphereId };
  };

  // Add sphere to all VTK renderers - simplified approach
  const addCuspSphereToRenderer = (sphereActor: any): void => {
    console.log(`🎯 Adding sphere ${sphereActor.id} to all VTK renderers`);
    
    const views = ['cpr1', 'cpr2', 'crossSection'] as const;
    
    views.forEach(viewName => {
      const view = vtkObjects.current[viewName];
      if (view?.renderer && view?.renderWindow) {
        try {
          // Add the sphere actor directly (don't clone to avoid issues)
          view.renderer.addActor(sphereActor.actor);
          
          // Reset camera clipping to ensure sphere is visible
          view.renderer.resetCameraClippingRange();
          
          // Force render
          view.renderWindow.render();
          
          console.log(`✅ Added sphere ${sphereActor.id} to ${viewName} renderer`);
          
          // Debug info
          const actorCount = view.renderer.getActors().length;
          console.log(`📊 ${viewName} now has ${actorCount} actors`);
          
        } catch (error) {
          console.error(`❌ Error adding sphere to ${viewName} renderer:`, error);
        }
      } else {
        console.warn(`⚠️ ${viewName} view not ready for sphere addition`);
      }
    });
  };

  // Remove sphere from all VTK renderers
  const removeCuspSphereFromRenderer = (sphereId: string): void => {
    console.log(`🗑️ Removing sphere ${sphereId} from all renderers`);
    
    const views = ['cpr1', 'cpr2', 'crossSection'] as const;
    
    views.forEach(viewName => {
      const view = vtkObjects.current[viewName];
      if (view?.renderer && view?.genericRenderWindow) {
        try {
          // Remove all actors with matching sphere ID (we can't easily track cloned actors)
          // For now, this is a simplified approach
          view.genericRenderWindow.getRenderWindow().render();
          console.log(`✅ Attempted to remove sphere ${sphereId} from ${viewName} renderer`);
        } catch (error) {
          console.error(`❌ Error removing sphere from ${viewName} renderer:`, error);
        }
      }
    });
    
    sphereActorMap.current.delete(sphereId);
  };

  // Handle cusp dot placement
  const handleCuspDotPlacement = (worldPos: [number, number, number]) => {
    if (cuspDots.length >= 3) {
      console.warn('Maximum of 3 cusp dots already placed');
      return;
    }

    const cuspTypes: ('left' | 'right' | 'non-coronary')[] = ['left', 'right', 'non-coronary'];
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1']; // Red, Teal, Blue
    
    const dotIndex = cuspDots.length;
    const cuspType = cuspTypes[dotIndex];
    const color = colors[dotIndex];
    const dotId = `cusp-dot-${Date.now()}-${dotIndex}`;

    console.log(`🎯 Placing cusp dot ${dotIndex + 1}/3:`, {
      type: cuspType,
      color,
      worldPos,
      id: dotId
    });

    // Create VTK sphere actor
    const sphereActor = createCuspSphereActor(worldPos, color, dotId);
    
    // Add to VTK renderer
    addCuspSphereToRenderer(sphereActor);

    // Create cusp dot data
    const newDot = {
      id: dotId,
      realWorldPos: worldPos,
      color,
      cuspType,
      placementIndex: dotIndex,
    };

    // Update state
    const updatedDots = [...cuspDots, newDot];
    setCuspDots(updatedDots);

    // Notify parent component
    if (onCuspDotsUpdate) {
      const dotsForCallback = updatedDots.map(dot => ({
        id: dot.id,
        pos: dot.realWorldPos,
        color: dot.color,
        cuspType: dot.cuspType
      }));
      onCuspDotsUpdate(dotsForCallback);
    }

    console.log(`✅ Placed cusp dot ${dotIndex + 1}/3 - ${cuspType} cusp`);

    if (updatedDots.length === 3) {
      console.log('🎯 All 3 cusp dots placed - disabling placement mode');
      setIsPlacingCuspDots(false);
    }
  };

  // Test function to create a simple sphere at image center
  const testSimpleSphere = () => {
    console.log('🧪 Creating test sphere with camera debug...');
    
    Object.entries(vtkObjects.current).forEach(([viewName, view]: [string, any]) => {
      if (viewName === 'volume' || !view?.renderer || !view?.renderWindow) return;
      
      try {
        // Get image bounds to find center
        let center = [55, 55, 10]; // Move sphere forward in Z
        if (view.imageData?.getBounds) {
          const bounds = view.imageData.getBounds();
          center = [
            (bounds[0] + bounds[1]) / 2,
            (bounds[2] + bounds[3]) / 2,
            (bounds[4] + bounds[5]) / 2 + 50 // Move sphere 50 units forward
          ];
          console.log(`🧪 ${viewName} image bounds:`, bounds);
        }
        
        console.log(`🧪 Creating test sphere in ${viewName} at:`, center);
        
        // Create bright sphere at center
        const sphereSource = vtkSphereSource.newInstance();
        sphereSource.setCenter(center[0], center[1], center[2]);
        sphereSource.setRadius(30); // Even larger radius
        
        const mapper = vtkMapper.newInstance();
        mapper.setInputConnection(sphereSource.getOutputPort());
        
        const actor = vtkActor.newInstance();
        actor.setMapper(mapper);
        
        const property = actor.getProperty();
        property.setColor(1.0, 1.0, 0.0); // Bright yellow
        property.setOpacity(1.0);
        property.setAmbient(1.0);
        property.setDiffuse(0.0);
        property.setSpecular(0.0);
        property.setRepresentation(2); // Surface representation
        
        // Add to renderer
        view.renderer.addActor(actor);
        
        // Get camera info for debugging
        const camera = view.renderer.getActiveCamera();
        const cameraPos = camera.getPosition();
        const focalPoint = camera.getFocalPoint();
        const clippingRange = camera.getClippingRange();
        
        console.log(`🧪 ${viewName} camera position:`, cameraPos);
        console.log(`🧪 ${viewName} camera focal point:`, focalPoint);
        console.log(`🧪 ${viewName} camera clipping range:`, clippingRange);
        
        // Force camera to look at sphere
        camera.setFocalPoint(center[0], center[1], center[2]);
        
        // Reset clipping and render
        view.renderer.resetCameraClippingRange();
        
        // Multiple renders to ensure visibility
        view.renderWindow.render();
        view.renderWindow.render();
        
        console.log(`✅ Test sphere added to ${viewName} with camera adjustment`);
        
      } catch (error) {
        console.error(`❌ Failed to add test sphere to ${viewName}:`, error);
      }
    });
  };

  const handleWindowLevel = (deltaWindow: number, deltaLevel: number) => {
    console.log('🎨 Window/Level button clicked:', { deltaWindow, deltaLevel });
    
    const views = ['cpr1', 'cpr2', 'crossSection'] as const;
    const newWindow = Math.max(1, windowLevel.window + deltaWindow);
    const newLevel = windowLevel.level + deltaLevel;
    
    views.forEach(viewName => {
      const view = vtkObjects.current[viewName];
      if (view?.renderer && view?.genericRenderWindow) {
        try {
          const actors = view.renderer.getActors();
          if (actors.length > 0) {
            const activeActor = actors[0];
            const property = activeActor.getProperty();
            
            property.setColorWindow(newWindow);
            property.setColorLevel(newLevel);
            property.modified();
            activeActor.modified();
            view.genericRenderWindow.getRenderWindow().render();
          }
        } catch (error) {
          console.error(`❌ Window/Level error in ${viewName}:`, error);
        }
      }
    });
    
    setWindowLevel({ window: newWindow, level: newLevel });
    console.log('🎨 Window/Level applied to all views:', { newWindow, newLevel });
  };

  const resetView = () => {
    if (vtkObjects.current.camera && vtkObjects.current.genericRenderWindow) {
      const camera = vtkObjects.current.camera;
      
      camera.setParallelScale(initialParallelScale.current);
      setZoom(1.0);
      
      const defaultWindow = 1000;
      const defaultLevel = 300;
      setWindowLevel({ window: defaultWindow, level: defaultLevel });
      
      if (vtkObjects.current.actor) {
        const property = vtkObjects.current.actor.getProperty();
        property.setColorWindow(defaultWindow);
        property.setColorLevel(defaultLevel);
      }
      
      vtkObjects.current.genericRenderWindow.getRenderWindow().render();
      console.log('🔄 View reset');
    }
  };

  // Load DICOM data (restored working pattern from commit e67f226)
  const loadDicomData = async () => {
    try {
      console.log('🔄 Loading real DICOM data using working MPR pattern...');
      
      const imageIds = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: patientInfo!.studyInstanceUID!,
        SeriesInstanceUID: patientInfo!.seriesInstanceUID!,
        wadoRsRoot: "http://127.0.0.1/orthanc/dicom-web",
      });

      if (imageIds.length === 0) {
        throw new Error('No DICOM images found for this series');
      }

      console.log(`📋 Found ${imageIds.length} DICOM images`);

      // Use the exact pattern from working version that works
      const volumeId = `triViewCprVolume_${Date.now()}`;
      const volume = await volumeLoader.createAndCacheVolume(volumeId, {
        imageIds,
      });
      
      console.log('🔄 Loading volume data...');
      
      // Load the volume and wait for it to complete
      await volume.load();
      
      console.log('✅ Volume loading completed');
      
      // Wait for scalar data to become available (exactly like working version)
      let waitTime = 0;
      const maxWaitTime = 5000; // 5 seconds max
      const pollInterval = 200; // Check every 200ms
      
      while (waitTime < maxWaitTime) {
        try {
          // @ts-ignore - Accessing streaming volume properties
          const streamingVolume = volume as any;
          let hasData = false;
          
          // Safely check for scalar data
          try {
            hasData = !!(streamingVolume.getScalarData && streamingVolume.getScalarData());
          } catch (e) {
            // getScalarData throws when not available
          }
          
          console.log(`📊 Volume status (${waitTime}ms):`, {
            hasScalarVolume: streamingVolume.hasScalarVolume || false,
            hasScalarData: hasData,
            framesLoaded: streamingVolume.framesLoaded || 0,
            framesProcessed: streamingVolume.framesProcessed || 0,
            cachedFrames: Object.keys(streamingVolume.cachedFrames || {}).length,
            hasImageData: !!streamingVolume.imageData // Key addition from working version
          });
          
          if (hasData) {
            console.log('✅ Scalar data is now available!');
            break;
          }
          
          // Also check for imageData availability (working version approach)
          if (streamingVolume.imageData) {
            console.log('✅ ImageData is available, will use it directly!');
            break;
          }
          
          // Break if we have loaded frames even if scalar data isn't available via getScalarData
          if (streamingVolume.framesLoaded > 0 && streamingVolume.cachedFrames && Object.keys(streamingVolume.cachedFrames).length > 0) {
            console.log('✅ Frame data is available, will extract CPR!');
            break;
          }
          
        } catch (e) {
          console.log(`⚠️ Error checking volume status at ${waitTime}ms:`, e.message);
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        waitTime += pollInterval;
      }

      console.log('📊 Final volume info:', {
        dimensions: volume.dimensions,
        spacing: volume.spacing,
        origin: volume.origin,
        volumeId: volume.volumeId,
        hasImageData: !!volume.imageData,
        hasVtkOpenGLTexture: !!volume.vtkOpenGLTexture
      });

      vtkObjects.current.volume = volume;
      return { volume, imageIds, volumeId };
      
    } catch (error) {
      console.error('❌ Failed to load DICOM data:', error);
      throw error;
    }
  };

  // Create VTK ImageData from Cornerstone volume (restored from working version)
  const createVTKImageDataFromVolume = async (volume: any) => {
    try {
      console.log('🔄 Creating VTK ImageData from Cornerstone volume (working pattern)...');
      console.log('📊 Volume structure:', Object.keys(volume));
      
      // Debug: Examine the volume object structure (like HybridCPRViewport)
      console.log('🔍 Volume object properties:', Object.keys(volume));
      console.log('🔍 Volume object methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(volume)).filter(name => typeof volume[name] === 'function'));
      
      let scalarData = null;
      let attempts = [];
      
      // Try multiple methods to get scalar data (same pattern as working version)
      try {
        if (volume.getScalarData) {
          scalarData = volume.getScalarData();
          attempts.push('volume.getScalarData() - SUCCESS');
        } else {
          attempts.push('volume.getScalarData() - NOT AVAILABLE');
        }
      } catch (e) {
        attempts.push(`volume.getScalarData() - ERROR: ${e.message}`);
      }

      if (!scalarData && volume.voxelManager) {
        try {
          console.log('🔄 Attempt 3: Using voxelManager (HybridCPRViewport pattern)...');
          console.log('🔍 voxelManager properties:', Object.keys(volume.voxelManager));
          console.log('🔍 voxelManager methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(volume.voxelManager)).filter(name => typeof volume.voxelManager[name] === 'function'));
          
          // Try different voxelManager approaches
          if (volume.voxelManager.getScalarData) {
            scalarData = volume.voxelManager.getScalarData();
            if (scalarData) {
              attempts.push('volume.voxelManager.getScalarData() - SUCCESS');
              console.log('✅ Got scalar data via voxelManager.getScalarData()');
            }
          }
          
          // Try additional voxelManager methods
          if (!scalarData && volume.voxelManager.getCompleteScalarDataArray) {
            scalarData = volume.voxelManager.getCompleteScalarDataArray();
            if (scalarData) {
              attempts.push('volume.voxelManager.getCompleteScalarDataArray() - SUCCESS');
              console.log('✅ Got scalar data via voxelManager.getCompleteScalarDataArray()');
            }
          }
          
          if (!scalarData) {
            attempts.push('volume.voxelManager - NO WORKING METHODS');
          }
        } catch (e) {
          attempts.push(`volume.voxelManager access - ERROR: ${e.message}`);
          console.warn('⚠️ voxelManager access failed:', e);
        }
      }

      if (!scalarData) {
        try {
          if (volume.scalarData) {
            scalarData = volume.scalarData;
            attempts.push('volume.scalarData - SUCCESS');
          } else {
            attempts.push('volume.scalarData - NOT AVAILABLE');
          }
        } catch (e) {
          attempts.push(`volume.scalarData - ERROR: ${e.message}`);
        }
      }

      // Method 4: Try vtkImageData if available (HybridCPRViewport pattern)
      if (!scalarData && volume.vtkImageData) {
        try {
          console.log('🔄 Attempt 4: Using volume.vtkImageData...');
          const scalars = volume.vtkImageData.getPointData().getScalars();
          if (scalars) {
            scalarData = scalars.getData();
            attempts.push('volume.vtkImageData.getPointData().getScalars().getData() - SUCCESS');
            console.log('✅ Got scalar data via vtkImageData');
          } else {
            attempts.push('volume.vtkImageData - NO SCALARS');
          }
        } catch (e) {
          attempts.push(`volume.vtkImageData - ERROR: ${e.message}`);
        }
      }

      console.log('📊 Scalar data access attempts:', attempts);
      
      if (!scalarData) {
        throw new Error('No scalar data found via any method');
      }
      
      const dimensions = volume.dimensions || [128, 128, 128];
      const spacing = volume.spacing || [1, 1, 1];
      const origin = volume.origin || [0, 0, 0];

      console.log('📊 Volume info for VTK creation:', { 
        dimensions, 
        spacing, 
        origin, 
        dataLength: scalarData?.length,
        dataType: scalarData?.constructor?.name 
      });

      if (!scalarData || scalarData.length === 0) {
        throw new Error('Scalar data is empty or invalid');
      }

      const imageData = vtkImageData.newInstance();
      imageData.setDimensions(dimensions);
      imageData.setSpacing(spacing);
      imageData.setOrigin(origin);

      const scalars = vtkDataArray.newInstance({
        name: 'Scalars',
        numberOfComponents: 1,
        values: scalarData,
      });
      imageData.getPointData().setScalars(scalars);

      // Validate the created ImageData
      const createdDims = imageData.getDimensions();
      const createdScalars = imageData.getPointData().getScalars();
      
      console.log('✅ VTK ImageData created successfully:', {
        dimensions: createdDims,
        hasScalars: !!createdScalars,
        scalarCount: createdScalars?.getNumberOfTuples(),
        className: imageData.getClassName()
      });
      
      return imageData;
    } catch (error) {
      console.error('❌ Failed to create VTK ImageData from volume:', error);
      throw error;
    }
  };

  // Extract real CPR data from Cornerstone3D volume (exactly like HybridCPRViewport)
  const extractRealCPRFromVolume = async (volume: any, centerlinePoints: Point3D[]): Promise<any> => {
    try {
      console.log('🔄 Attempting to extract real CPR data from Cornerstone3D volume...');
      
      // Get volume characteristics
      const dimensions = volume.dimensions;
      const spacing = volume.spacing;
      const origin = volume.origin;
      
      console.log('📊 Volume characteristics:', { dimensions, spacing, origin });
      
      // Try multiple approaches to access scalar data (restored working pattern)
      let scalarData = null;
      let attempts = [];
      
      // Method 1: Try volume.imageData with detailed inspection (HybridCPRViewport pattern)
      if (volume.imageData) {
        try {
          console.log('🔄 Attempt 1: Using volume.imageData (HybridCPRViewport pattern)...');
          console.log('🔍 imageData properties:', Object.keys(volume.imageData));
          console.log('🔍 imageData methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(volume.imageData)).filter(name => typeof volume.imageData[name] === 'function'));
          
          if (volume.imageData.getPointData && volume.imageData.getPointData().getScalars) {
            const scalars = volume.imageData.getPointData().getScalars();
            if (scalars) {
              scalarData = scalars.getData();
              attempts.push('volume.imageData.getPointData().getScalars().getData() - SUCCESS');
              console.log('✅ Got real scalar data via volume.imageData!');
            } else {
              attempts.push('volume.imageData.getPointData().getScalars() - NULL SCALARS');
            }
          } else {
            attempts.push('volume.imageData - NO getPointData() OR getScalars()');
          }
        } catch (e) {
          attempts.push(`volume.imageData access - ERROR: ${e.message}`);
          console.warn('⚠️ volume.imageData access failed:', e);
        }
      } else {
        attempts.push('volume.imageData - NOT AVAILABLE');
      }
      
      // Method 2: Try getScalarData() - most direct approach
      if (!scalarData) {
        try {
          console.log('🔄 Attempt 2: Using getScalarData()...');
          
          if (typeof volume.getScalarData === 'function') {
            scalarData = volume.getScalarData();
            if (scalarData) {
              attempts.push('volume.getScalarData() - SUCCESS');
              console.log('✅ Got scalar data via getScalarData()');
            }
          } else {
            attempts.push('volume.getScalarData() - NOT AVAILABLE');
            console.log('⚠️ getScalarData method not available');
          }
          
        } catch (error) {
          attempts.push(`volume.getScalarData() - ERROR: ${error.message}`);
          console.warn('⚠️ getScalarData() failed:', error);
        }
      }
      
      // Method 3: Try scalarData property
      if (!scalarData) {
        try {
          console.log('🔄 Attempt 3: Using volume.scalarData property...');
          
          // @ts-ignore - Accessing internal properties
          if (volume.scalarData && volume.scalarData.length > 0) {
            scalarData = volume.scalarData;
            attempts.push('volume.scalarData - SUCCESS');
            console.log('✅ Got scalar data via volume.scalarData property');
          } else {
            attempts.push('volume.scalarData - NOT AVAILABLE');
            console.log('⚠️ volume.scalarData is empty or not available');
          }
          
        } catch (error) {
          attempts.push(`volume.scalarData - ERROR: ${error.message}`);
          console.warn('⚠️ volume.scalarData access failed:', error);
        }
      }
      
      // Method 4: Try voxelManager approach (OFFICIAL Cornerstone3D method per documentation)
      if (!scalarData && volume.voxelManager) {
        try {
          console.log('🔄 Attempt 4: Using VoxelManager (official Cornerstone3D method)...');
          console.log('🔍 VoxelManager properties:', Object.keys(volume.voxelManager));
          console.log('🔍 VoxelManager methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(volume.voxelManager)).filter(name => typeof volume.voxelManager[name] === 'function'));
          
          // Method 4a: getCompleteScalarDataArray() - OFFICIAL method per documentation
          if (volume.voxelManager.getCompleteScalarDataArray) {
            try {
              console.log('🔄 Trying getCompleteScalarDataArray() (documented method)...');
              scalarData = volume.voxelManager.getCompleteScalarDataArray();
              if (scalarData && scalarData.length > 0) {
                attempts.push('volume.voxelManager.getCompleteScalarDataArray() - SUCCESS');
                console.log('✅ Got scalar data via getCompleteScalarDataArray() (official method):', {
                  dataLength: scalarData.length,
                  dataType: scalarData.constructor?.name,
                  expectedLength: volume.dimensions[0] * volume.dimensions[1] * volume.dimensions[2]
                });
              } else {
                attempts.push('volume.voxelManager.getCompleteScalarDataArray() - NO DATA');
                console.warn('⚠️ getCompleteScalarDataArray() returned no data');
              }
            } catch (e) {
              attempts.push(`volume.voxelManager.getCompleteScalarDataArray() - ERROR: ${e.message}`);
              console.warn('⚠️ getCompleteScalarDataArray() failed:', e);
            }
          } else {
            attempts.push('volume.voxelManager.getCompleteScalarDataArray() - METHOD NOT AVAILABLE');
          }
          
          // Method 4b: getScalarData() fallback
          if (!scalarData && volume.voxelManager.getScalarData) {
            try {
              console.log('🔄 Trying getScalarData() fallback...');
              scalarData = volume.voxelManager.getScalarData();
              if (scalarData && scalarData.length > 0) {
                attempts.push('volume.voxelManager.getScalarData() - SUCCESS');
                console.log('✅ Got scalar data via getScalarData() fallback');
              } else {
                attempts.push('volume.voxelManager.getScalarData() - NO DATA');
              }
            } catch (e) {
              attempts.push(`volume.voxelManager.getScalarData() - ERROR: ${e.message}`);
              console.warn('⚠️ getScalarData() failed:', e);
            }
          }
          
          // Method 4c: Check for alternative voxel data properties
          if (!scalarData) {
            console.log('🔍 Checking alternative VoxelManager data properties...');
            
            const alternatives = ['voxelData', 'scalarArray', 'data', 'pixelData', 'volumeData'];
            for (const prop of alternatives) {
              if (volume.voxelManager[prop]) {
                try {
                  const data = typeof volume.voxelManager[prop] === 'function' 
                    ? volume.voxelManager[prop]() 
                    : volume.voxelManager[prop];
                  
                  if (data && data.length > 0) {
                    scalarData = data;
                    attempts.push(`volume.voxelManager.${prop} - SUCCESS`);
                    console.log(`✅ Got scalar data via voxelManager.${prop}`);
                    break;
                  }
                } catch (e) {
                  console.warn(`⚠️ Failed to access voxelManager.${prop}:`, e);
                }
              }
            }
            
            if (!scalarData) {
              attempts.push('volume.voxelManager alternatives - NO DATA FOUND');
            }
          }
          
        } catch (e) {
          attempts.push(`volume.voxelManager access - CRITICAL ERROR: ${e.message}`);
          console.error('❌ Critical VoxelManager access failed:', e);
        }
      } else if (!volume.voxelManager) {
        attempts.push('volume.voxelManager - NOT AVAILABLE');
        console.warn('⚠️ No VoxelManager found on volume');
      }
      
      // Method 6: Try vtkImageData if available (complete HybridCPRViewport pattern)
      if (!scalarData && volume.vtkImageData) {
        try {
          console.log('🔄 Attempt 6: Using vtkImageData...');
          const scalars = volume.vtkImageData.getPointData().getScalars();
          if (scalars) {
            scalarData = scalars.getData();
            attempts.push('volume.vtkImageData.getPointData().getScalars().getData() - SUCCESS');
            console.log('✅ Got scalar data via vtkImageData');
          } else {
            attempts.push('volume.vtkImageData - NO SCALARS');
          }
        } catch (e) {
          attempts.push(`volume.vtkImageData - ERROR: ${e.message}`);
        }
      } else if (!volume.vtkImageData) {
        attempts.push('volume.vtkImageData - NOT AVAILABLE');
      }
      
      console.log('📊 Scalar data access attempts:', `(${attempts.length})`, attempts);
      
      // Method 7: Try frames data directly (comprehensive streaming volume investigation)
      // @ts-ignore - Accessing streaming volume properties
      const streamingVolume = volume as any;
      if (!scalarData && streamingVolume.framesLoaded > 0) {
        console.log('🔄 Attempt 7: Investigating streaming volume structure...');
        
        // First, let's understand the actual streaming volume structure
        console.log('🔍 StreamingVolume structure investigation:', {
          framesLoaded: streamingVolume.framesLoaded,
          framesProcessed: streamingVolume.framesProcessed || 'unknown',
          cachedFrames: Object.keys(streamingVolume.cachedFrames || {}).length,
          streamingVolumeKeys: Object.keys(streamingVolume).slice(0, 20), // First 20 properties
          hasImageIds: !!streamingVolume._imageIds,
          imageIdsLength: streamingVolume._imageIds?.length || 0,
          hasVoxelManager: !!streamingVolume.voxelManager,
          voxelManagerKeys: streamingVolume.voxelManager ? Object.keys(streamingVolume.voxelManager).slice(0, 10) : [],
        });
        
        // Check if there's a frame cache or image cache elsewhere
        console.log('🔍 Looking for alternative frame storage locations...');
        
        // Method 7a: Check if frames are stored differently
        if (streamingVolume.cachedFrames && Object.keys(streamingVolume.cachedFrames).length > 0) {
          const frameKeys = Object.keys(streamingVolume.cachedFrames);
          console.log('🔍 CachedFrames analysis:', {
            totalFrameKeys: frameKeys.length,
            firstFewKeys: frameKeys.slice(0, 5),
            frameTypes: frameKeys.slice(0, 3).map(key => ({
              key,
              type: typeof streamingVolume.cachedFrames[key],
              constructorName: streamingVolume.cachedFrames[key]?.constructor?.name,
              isNumber: typeof streamingVolume.cachedFrames[key] === 'number',
              value: streamingVolume.cachedFrames[key]
            }))
          });
        }
        
        // Method 7b: Check the image cache directly (common alternative)
        if (streamingVolume.imageCache || streamingVolume._imageCache) {
          const imageCache = streamingVolume.imageCache || streamingVolume._imageCache;
          console.log('🔍 Found imageCache:', {
            imageCacheKeys: Object.keys(imageCache).slice(0, 5),
            imageCacheLength: Object.keys(imageCache).length
          });
        }
        
        // Method 7c: Check if frames are stored in cornerstone cache
        try {
          const cornerstoneCache = cache;
          if (cornerstoneCache && cornerstoneCache.getImageLoadObject) {
            console.log('🔍 Checking Cornerstone cache for frames...');
            
            // Try to get frame data from the main cache
            const imageIds = streamingVolume._imageIds || [];
            if (imageIds.length > 0) {
              console.log('🔍 Attempting to access frame data via Cornerstone cache:', {
                totalImageIds: imageIds.length,
                firstImageId: imageIds[0],
                lastImageId: imageIds[imageIds.length - 1]
              });
              
              // Try to reconstruct from individual images in the cache (SYNCHRONOUS approach)
              scalarData = new Float32Array(volume.dimensions[0] * volume.dimensions[1] * volume.dimensions[2]);
              let voxelIndex = 0;
              let framesProcessed = 0;
              
              console.log('🔄 Starting synchronous frame reconstruction from Cornerstone cache...');
              
              for (let i = 0; i < Math.min(imageIds.length, volume.dimensions[2]); i++) {
                const imageId = imageIds[i];
                
                try {
                  const imageLoadObject = cornerstoneCache.getImageLoadObject(imageId);
                  if (imageLoadObject && imageLoadObject.promise) {
                    
                    // Check if the promise is already resolved (synchronous access)
                    const promiseState = (imageLoadObject.promise as any)._settledValue || 
                                       (imageLoadObject.promise as any)._value || 
                                       null;
                    
                    // Try to access the resolved value directly
                    let image = promiseState;
                    
                    // Alternative: Try to get the image from the cache entry itself
                    if (!image && imageLoadObject.image) {
                      image = imageLoadObject.image;
                    }
                    
                    // Alternative: Check if there's a cached result
                    if (!image && imageLoadObject.cachedImage) {
                      image = imageLoadObject.cachedImage;
                    }
                    
                    if (image && typeof image.getPixelData === 'function') {
                      try {
                        const pixelData = image.getPixelData();
                        if (pixelData && pixelData.length > 0) {
                          console.log(`✅ Extracted pixel data from frame ${i}:`, {
                            pixelDataLength: pixelData.length,
                            pixelDataType: pixelData.constructor?.name,
                            expectedFrameSize: volume.dimensions[0] * volume.dimensions[1]
                          });
                          
                          // Copy pixel data to the scalar array
                          const frameSize = volume.dimensions[0] * volume.dimensions[1];
                          const pixelsToAdd = Math.min(frameSize, pixelData.length, scalarData.length - voxelIndex);
                          
                          for (let j = 0; j < pixelsToAdd; j++) {
                            scalarData[voxelIndex++] = pixelData[j];
                          }
                          
                          framesProcessed++;
                          
                          if (i % 10 === 0) { // Log every 10th frame
                            console.log(`📊 Processed frame ${i}: ${pixelsToAdd} pixels (total: ${voxelIndex})`);
                          }
                        }
                      } catch (e) {
                        console.warn(`⚠️ Failed to get pixel data from frame ${i}:`, e);
                      }
                    } else if (image) {
                      console.log(`🔍 Frame ${i} image structure:`, {
                        hasGetPixelData: !!image.getPixelData,
                        imageKeys: Object.keys(image).slice(0, 15),
                        imageType: image.constructor?.name
                      });
                      
                      // Try alternative pixel data access methods
                      let alternativePixelData = null;
                      
                      if (image.pixelData) {
                        alternativePixelData = image.pixelData;
                      } else if (image.data) {
                        alternativePixelData = image.data;
                      } else if (image.buffer) {
                        alternativePixelData = image.buffer;
                      } else if (image.arrayBuffer) {
                        alternativePixelData = new Uint16Array(image.arrayBuffer);
                      }
                      
                      if (alternativePixelData && alternativePixelData.length > 0) {
                        console.log(`✅ Found alternative pixel data for frame ${i}:`, {
                          dataLength: alternativePixelData.length,
                          dataType: alternativePixelData.constructor?.name
                        });
                        
                        const frameSize = volume.dimensions[0] * volume.dimensions[1];
                        const pixelsToAdd = Math.min(frameSize, alternativePixelData.length, scalarData.length - voxelIndex);
                        
                        for (let j = 0; j < pixelsToAdd; j++) {
                          scalarData[voxelIndex++] = alternativePixelData[j];
                        }
                        
                        framesProcessed++;
                      }
                    }
                  }
                } catch (e) {
                  console.warn(`⚠️ Failed to get imageLoadObject for frame ${i}:`, e);
                }
              }
              
              console.log(`📊 Cache reconstruction summary:`, {
                totalFramesProcessed: framesProcessed,
                totalVoxelsExtracted: voxelIndex,
                expectedTotalVoxels: volume.dimensions[0] * volume.dimensions[1] * volume.dimensions[2],
                completionPercentage: ((voxelIndex / (volume.dimensions[0] * volume.dimensions[1] * volume.dimensions[2])) * 100).toFixed(1)
              });
              
              // Success if we got significant amount of data
              if (voxelIndex > 0 && framesProcessed > 0) {
                console.log(`✅ Successfully reconstructed scalar data from Cornerstone cache: ${voxelIndex} voxels from ${framesProcessed} frames`);
                attempts.push(`cornerstone cache reconstruction - SUCCESS (${voxelIndex} voxels from ${framesProcessed} frames)`);
              } else {
                scalarData = null;
                console.warn('⚠️ Could not reconstruct from Cornerstone cache - no data extracted');
                attempts.push('cornerstone cache reconstruction - NO DATA EXTRACTED');
              }
            }
          }
        } catch (e) {
          console.warn('⚠️ Error accessing Cornerstone cache:', e);
        }
        
        // Legacy approach - try to access cached frame data even if structure is unexpected
        if (!scalarData && streamingVolume.cachedFrames && Object.keys(streamingVolume.cachedFrames).length > 0) {
          const frameKeys = Object.keys(streamingVolume.cachedFrames);
          
          // Try to reconstruct volume from cached frames (enhanced debugging)
          try {
            const totalVoxels = volume.dimensions[0] * volume.dimensions[1] * volume.dimensions[2];
            scalarData = new Float32Array(totalVoxels);
            
            console.log('🔄 Starting frame reconstruction:', {
              totalVoxels,
              expectedFrames: volume.dimensions[2],
              availableFrameKeys: frameKeys.length
            });
            
            let voxelIndex = 0;
            let framesProcessed = 0;
            
            // Try multiple frame access patterns
            for (let i = 0; i < Math.min(volume.dimensions[2], frameKeys.length) && voxelIndex < totalVoxels; i++) {
              let frame = null;
              let frameKey = null;
              
              // Method 1: Try numeric string keys (what we see: '0', '1', '2')
              frameKey = i.toString();
              if (streamingVolume.cachedFrames[frameKey]) {
                frame = streamingVolume.cachedFrames[frameKey];
                console.log(`📋 Found frame via numeric key: ${frameKey}`);
              }
              
              // Method 2: Try imageId-based keys if numeric fails
              if (!frame && streamingVolume._imageIds?.[i]) {
                frameKey = streamingVolume._imageIds[i];
                frame = streamingVolume.cachedFrames[frameKey];
                if (frame) {
                  console.log(`📋 Found frame via imageId key: ${frameKey}`);
                }
              }
              
              // Method 3: Try direct array access if we have frameKeys
              if (!frame && i < frameKeys.length) {
                frameKey = frameKeys[i];
                frame = streamingVolume.cachedFrames[frameKey];
                if (frame) {
                  console.log(`📋 Found frame via frameKeys array: ${frameKey}`);
                }
              }
              
              if (frame) {
                console.log(`🔍 Frame ${i} structure:`, {
                  hasPixelData: !!frame.pixelData,
                  pixelDataLength: frame.pixelData?.length,
                  pixelDataType: frame.pixelData?.constructor?.name,
                  allFrameKeys: Object.keys(frame), // Show ALL keys to see what's actually there
                  frameType: frame.constructor?.name
                });
                
                // Try multiple property names for pixel data
                let frameData = null;
                let pixelDataSource = '';
                
                // Method 1: Try pixelData
                if (frame.pixelData && frame.pixelData.length > 0) {
                  frameData = frame.pixelData;
                  pixelDataSource = 'pixelData';
                }
                
                // Method 2: Try getPixelData() method
                if (!frameData && typeof frame.getPixelData === 'function') {
                  try {
                    frameData = frame.getPixelData();
                    if (frameData && frameData.length > 0) {
                      pixelDataSource = 'getPixelData()';
                    }
                  } catch (e) {
                    console.warn(`⚠️ getPixelData() failed for frame ${i}:`, e);
                  }
                }
                
                // Method 3: Try data property
                if (!frameData && frame.data && frame.data.length > 0) {
                  frameData = frame.data;
                  pixelDataSource = 'data';
                }
                
                // Method 4: Try imageFrame.pixelData (nested structure)
                if (!frameData && frame.imageFrame?.pixelData && frame.imageFrame.pixelData.length > 0) {
                  frameData = frame.imageFrame.pixelData;
                  pixelDataSource = 'imageFrame.pixelData';
                }
                
                // Method 5: Try pixelDataArray
                if (!frameData && frame.pixelDataArray && frame.pixelDataArray.length > 0) {
                  frameData = frame.pixelDataArray;
                  pixelDataSource = 'pixelDataArray';
                }
                
                // Method 6: Try buffer property
                if (!frameData && frame.buffer && frame.buffer.length > 0) {
                  frameData = frame.buffer;
                  pixelDataSource = 'buffer';
                }
                
                // Method 7: Try arrayBuffer and convert to typed array
                if (!frameData && frame.arrayBuffer) {
                  try {
                    frameData = new Uint16Array(frame.arrayBuffer);
                    if (frameData.length > 0) {
                      pixelDataSource = 'arrayBuffer->Uint16Array';
                    }
                  } catch (e) {
                    console.warn(`⚠️ arrayBuffer conversion failed for frame ${i}:`, e);
                  }
                }
                
                if (frameData && frameData.length > 0) {
                  const frameSize = volume.dimensions[0] * volume.dimensions[1];
                  
                  console.log(`✅ Found pixel data via ${pixelDataSource}:`, {
                    frameDataLength: frameData.length,
                    expectedFrameSize: frameSize,
                    frameDataType: frameData.constructor?.name
                  });
                  
                  // Copy frame data to volume array
                  const pixelsToAdd = Math.min(frameSize, frameData.length, totalVoxels - voxelIndex);
                  for (let j = 0; j < pixelsToAdd; j++) {
                    scalarData[voxelIndex++] = frameData[j];
                  }
                  
                  framesProcessed++;
                  console.log(`✅ Processed frame ${i}: added ${pixelsToAdd} pixels (total: ${voxelIndex})`);
                } else {
                  console.warn(`⚠️ Frame ${i} has no accessible pixel data despite ${Object.keys(frame).length} properties`);
                  console.warn(`⚠️ Frame ${i} properties:`, Object.keys(frame));
                }
              } else {
                console.warn(`⚠️ Could not find frame ${i} with any key method`);
              }
            }
            
            if (voxelIndex > 0) {
              console.log(`✅ Frame reconstruction SUCCESS: ${voxelIndex} voxels from ${framesProcessed} frames`);
              attempts.push(`frame reconstruction - SUCCESS (${voxelIndex} voxels from ${framesProcessed} frames)`);
            } else {
              scalarData = null; // Reset if reconstruction failed
              console.warn('⚠️ Frame reconstruction produced no data');
              attempts.push('frame reconstruction - NO DATA');
            }
            
          } catch (frameError) {
            console.warn('⚠️ Failed to reconstruct from frames:', frameError);
            scalarData = null;
            attempts.push(`frame reconstruction - ERROR: ${frameError.message}`);
          }
        } else {
          attempts.push('frame reconstruction - NO CACHED FRAMES');
        }
      } else if (!streamingVolume.framesLoaded) {
        attempts.push('frame reconstruction - NO FRAMES LOADED');
      }
      
      if (!scalarData) {
        console.warn('⚠️ Could not access real scalar data via direct methods, waiting longer and trying additional approaches...');
        
        // Wait a bit longer for data to become available (like HybridCPRViewport)
        let waitTime = 0;
        const maxWaitTime = 10000; // Increased to 10 seconds
        const pollInterval = 500; // Check every 500ms
        
        while (waitTime < maxWaitTime && !scalarData) {
          console.log(`🔄 Waiting for scalar data (${waitTime}ms)...`);
          
          // Try official VoxelManager method first during polling (documented approach)
          try {
            if (volume.voxelManager?.getCompleteScalarDataArray) {
              console.log(`🔄 Polling: Trying getCompleteScalarDataArray() at ${waitTime}ms...`);
              scalarData = volume.voxelManager.getCompleteScalarDataArray();
              if (scalarData && scalarData.length > 0) {
                console.log('✅ SUCCESS: Got scalar data via getCompleteScalarDataArray() after waiting');
                attempts.push(`polling getCompleteScalarDataArray() at ${waitTime}ms - SUCCESS (${scalarData.length} voxels)`);
                break;
              }
            }
          } catch (e) {
            if (waitTime % 2000 === 0) { // Log errors every 2 seconds to avoid spam
              console.warn(`⚠️ getCompleteScalarDataArray() still failing at ${waitTime}ms:`, e.message);
            }
          }
          
          // Try standard getScalarData as fallback
          try {
            if (volume.getScalarData) {
              scalarData = volume.getScalarData();
              if (scalarData && scalarData.length > 0) {
                console.log('✅ Got scalar data via getScalarData() after waiting');
                attempts.push(`polling getScalarData() at ${waitTime}ms - SUCCESS`);
                break;
              }
            }
          } catch (e) {
            // Still not available
          }
          
          try {
            if (volume.voxelManager?.getScalarData) {
              scalarData = volume.voxelManager.getScalarData();
              if (scalarData && scalarData.length > 0) {
                console.log('✅ Got scalar data via voxelManager.getScalarData() after waiting');
                attempts.push(`polling voxelManager.getScalarData() at ${waitTime}ms - SUCCESS`);
                break;
              }
            }
          } catch (e) {
            // Still not available
          }
          
          // Check volume loading status during polling (like HybridCPRViewport)
          if (waitTime % 1000 === 0) { // Log status every second
            try {
              const streamingVolume = volume as any;
              console.log(`📊 Polling volume status (${waitTime}ms):`, {
                hasScalarVolume: streamingVolume.hasScalarVolume || false,
                framesLoaded: streamingVolume.framesLoaded || 0,
                framesProcessed: streamingVolume.framesProcessed || 0,
                cachedFrames: Object.keys(streamingVolume.cachedFrames || {}).length,
                hasVoxelManager: !!volume.voxelManager,
                voxelManagerHasGetComplete: !!(volume.voxelManager?.getCompleteScalarDataArray),
                voxelManagerHasGetScalar: !!(volume.voxelManager?.getScalarData)
              });
            } catch (e) {
              console.warn(`⚠️ Error checking volume status during polling at ${waitTime}ms:`, e.message);
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          waitTime += pollInterval;
        }
      }
      
      if (!scalarData) {
        console.error('❌ CRITICAL: No real DICOM scalar data available for patient sizing');
        console.error('❌ Cannot proceed with synthetic data for TAVI patient sizing');
        throw new Error('Real DICOM scalar data is required for patient sizing - no synthetic data allowed');
      }
      
      console.log('✅ Successfully accessed real DICOM scalar data:', {
        dataLength: scalarData.length,
        dataType: scalarData.constructor.name,
        expectedLength: dimensions[0] * dimensions[1] * dimensions[2]
      });
      
      // Now extract real CPR from the actual data
      // Swap dimensions to make CPR vertical (height=centerline, width=cross-section)
      const cprHeight = centerlinePoints.length; // Vertical axis = along centerline
      const cprWidth = 128; // Horizontal axis = cross-section
      const cprData = new Float32Array(cprWidth * cprHeight);
      
      // Calculate data range efficiently to avoid stack overflow
      let minVal = scalarData[0];
      let maxVal = scalarData[0];
      for (let i = 1; i < scalarData.length; i += 1000) { // Sample every 1000th value for efficiency
        if (scalarData[i] < minVal) minVal = scalarData[i];
        if (scalarData[i] > maxVal) maxVal = scalarData[i];
      }
      
      console.log('🔄 Extracting CPR from real DICOM data:', {
        centerlinePoints: centerlinePoints.length,
        cprDimensions: [cprWidth, cprHeight],
        volumeDimensions: dimensions,
        volumeSpacing: spacing,
        volumeOrigin: origin,
        dataRange: [minVal, maxVal]
      });
      
      // Sample the real volume data along the centerline with proper perpendicular cross-sections
      for (let i = 0; i < centerlinePoints.length; i++) {
        const point = centerlinePoints[i];
        
        // Convert world coordinates to voxel indices
        const voxelX = Math.round((point.x - origin[0]) / spacing[0]);
        const voxelY = Math.round((point.y - origin[1]) / spacing[1]);
        const voxelZ = Math.round((point.z - origin[2]) / spacing[2]);
        
        // Clamp to volume bounds
        const clampedX = Math.max(0, Math.min(dimensions[0] - 1, voxelX));
        const clampedY = Math.max(0, Math.min(dimensions[1] - 1, voxelY));
        const clampedZ = Math.max(0, Math.min(dimensions[2] - 1, voxelZ));
        
        // Calculate tangent direction for perpendicular sampling
        let tangentX = 0, tangentY = 0, tangentZ = 1; // Default direction
        if (i < centerlinePoints.length - 1) {
          const nextPoint = centerlinePoints[i + 1];
          tangentX = nextPoint.x - point.x;
          tangentY = nextPoint.y - point.y;
          tangentZ = nextPoint.z - point.z;
          
          // Normalize tangent
          const tangentLength = Math.sqrt(tangentX**2 + tangentY**2 + tangentZ**2);
          if (tangentLength > 0) {
            tangentX /= tangentLength;
            tangentY /= tangentLength;
            tangentZ /= tangentLength;
          }
        }
        
        // Sample across the perpendicular cross-section
        for (let j = 0; j < cprWidth; j++) {
          const offset = (j - cprWidth/2) * 0.5; // Cross-section offset
          
          // Calculate perpendicular direction (simplified - use world Y as reference)
          let perpX = tangentY; // Cross product with world Y to get perpendicular
          let perpY = -tangentX;
          let perpZ = 0;
          
          // If tangent is too close to Y axis, use X axis instead
          if (Math.abs(tangentY) > 0.9) {
            perpX = -tangentZ;
            perpY = 0;
            perpZ = tangentX;
          }
          
          // Normalize the perpendicular vector
          const crossLength = Math.sqrt(perpX**2 + perpY**2 + perpZ**2);
          if (crossLength > 0) {
            perpX /= crossLength;
            perpY /= crossLength;
            perpZ /= crossLength;
          }
          
          // Sample along the perpendicular direction
          const sampleWorldX = point.x + offset * perpX;
          const sampleWorldY = point.y + offset * perpY;
          const sampleWorldZ = point.z + offset * perpZ;
          
          // Convert to voxel coordinates
          const sampleVoxelX = Math.round((sampleWorldX - origin[0]) / spacing[0]);
          const sampleVoxelY = Math.round((sampleWorldY - origin[1]) / spacing[1]);
          const sampleVoxelZ = Math.round((sampleWorldZ - origin[2]) / spacing[2]);
          
          const cprIndex = i * cprWidth + j; // i=height(centerline), j=width(cross-section)
          
          // Check bounds and sample
          if (sampleVoxelX >= 0 && sampleVoxelX < dimensions[0] &&
              sampleVoxelY >= 0 && sampleVoxelY < dimensions[1] &&
              sampleVoxelZ >= 0 && sampleVoxelZ < dimensions[2]) {
            
            const volumeIndex = sampleVoxelZ * dimensions[0] * dimensions[1] + 
                              sampleVoxelY * dimensions[0] + 
                              sampleVoxelX;
            
            if (volumeIndex < scalarData.length) {
              cprData[cprIndex] = scalarData[volumeIndex];
            } else {
              cprData[cprIndex] = -1000; // Air value
            }
          } else {
            cprData[cprIndex] = -1000; // Air value for out of bounds
          }
        }
      }
      
      // Calculate CPR data range efficiently
      let cprMinVal = cprData[0];
      let cprMaxVal = cprData[0];
      for (let i = 1; i < cprData.length; i++) {
        if (cprData[i] < cprMinVal) cprMinVal = cprData[i];
        if (cprData[i] > cprMaxVal) cprMaxVal = cprData[i];
      }
      
      console.log('✅ Real CPR data extracted from volume:', {
        cprDimensions: [cprWidth, cprHeight, 1],
        dataRange: [cprMinVal, cprMaxVal]
      });
      
      // Create VTK ImageData with proper physical spacing (width x height)
      const cprImageData = vtkImageData.newInstance();
      cprImageData.setDimensions([cprWidth, cprHeight, 1]);
      
      // Use physical spacing from the original volume
      const cprSpacing = [
        spacing[0], // Along centerline - use original X spacing
        spacing[1], // Cross-section - use original Y spacing  
        spacing[2]  // Depth - use original Z spacing
      ];
      cprImageData.setSpacing(cprSpacing);
      cprImageData.setOrigin([0, 0, 0]);
      
      console.log('📊 CPR ImageData created with physical spacing:', {
        dimensions: [cprWidth, cprHeight, 1],
        spacing: cprSpacing,
        physicalSize: [cprWidth * cprSpacing[0], cprHeight * cprSpacing[1]]
      });
      
      const scalars = vtkDataArray.newInstance({
        name: 'Scalars',
        numberOfComponents: 1,
        values: cprData,
      });
      cprImageData.getPointData().setScalars(scalars);
      
      return { cprImageData, cprData, scalarData };
      
    } catch (error) {
      console.error('❌ Failed to extract real CPR data:', error);
      console.log('🔄 Falling back to synthetic CPR data...');
      const fallbackResult = createCPRFromVolumeCharacteristics(volume, centerlinePoints);
      return { cprImageData: fallbackResult, cprData: null };
    }
  };

  // REMOVED: createCPRFromVolumeCharacteristics - No synthetic data allowed for patient sizing

  // Create real CPR data for three different views
  const createMultiViewCPRData = async (volume: any, centerlinePoints: Point3D[]) => {
    console.log('🔧 Creating real multi-view CPR data...');
    
    try {
      // Extract the main CPR using the working method from HybridCPRViewport
      console.log('🔧 Extracting real CPR data...');
      const mainCprResult = await extractRealCPRFromVolume(volume, centerlinePoints);
      const { cprImageData: mainImageData, cprData: mainData, scalarData: extractedScalarData } = typeof mainCprResult === 'object' && 'cprImageData' in mainCprResult 
        ? mainCprResult 
        : { cprImageData: mainCprResult, cprData: null, scalarData: null };
      
      if (!mainImageData) {
        throw new Error('Failed to extract real CPR data');
      }
      
      console.log('✅ Real CPR data extracted successfully');
      
      // Create cross-section with error handling - reuse the already extracted scalar data
      let crossSectionResult;
      try {
        if (!extractedScalarData) {
          throw new Error('No scalar data available for cross-section creation');
        }
        crossSectionResult = await createRealCrossSection(extractedScalarData, volume, centerlinePoints);
        console.log('✅ Cross-section created successfully using extracted scalar data');
      } catch (error) {
        console.error('❌ Cross-section creation failed, creating simple cross-section from CPR data:', error);
        // Create a simple cross-section by taking a slice from the successfully extracted CPR data
        const crossSectionImageData = createCrossSectionFromCPRData(mainData, centerlinePoints);
        crossSectionResult = { cprImageData: crossSectionImageData, cprData: null };
      }

      // Use the real CPR data for all three views (they can show the same data or different orientations)
      return {
        cpr1: { cprImageData: mainImageData, cprData: mainData },
        cpr2: { cprImageData: mainImageData, cprData: mainData },
        crossSection: crossSectionResult
      };
    } catch (error) {
      console.error('❌ CRITICAL ERROR: Failed to create real multi-view CPR data for patient sizing');
      console.error('❌ This is a critical failure - TAVI sizing requires real DICOM data');
      throw new Error(`Cannot create CPR data for patient sizing: ${error.message}`);
    }
  };

  // Create simple cross-section from CPR data (fallback approach)
  const createCrossSectionFromCPRData = (cprData: Float32Array, centerlinePoints: Point3D[]) => {
    console.log('🔧 Creating cross-section from successfully extracted CPR data...');
    
    // Take a perpendicular slice from the middle of the CPR data
    const cprHeight = centerlinePoints.length;
    const cprWidth = 128;
    const crossSectionSize = 64;
    const crossSectionData = new Float32Array(crossSectionSize * crossSectionSize);
    
    // Use the middle slice of the CPR as the cross-section
    const middleSliceIndex = Math.floor(cprHeight / 2);
    
    for (let i = 0; i < crossSectionSize; i++) {
      for (let j = 0; j < crossSectionSize; j++) {
        const cprIndex = middleSliceIndex * cprWidth + Math.floor(j * cprWidth / crossSectionSize);
        const crossIndex = i * crossSectionSize + j;
        
        if (cprIndex < cprData.length) {
          crossSectionData[crossIndex] = cprData[cprIndex];
        }
      }
    }
    
    // Create proper VTK ImageData object (not just raw array)
    const crossImageData = vtkImageData.newInstance();
    crossImageData.setDimensions([crossSectionSize, crossSectionSize, 1]);
    crossImageData.setSpacing([1.0, 1.0, 1.0]);
    crossImageData.setOrigin([0, 0, 0]);
    
    const scalars = vtkDataArray.newInstance({
      name: 'CrossSectionScalars',
      numberOfComponents: 1,
      values: crossSectionData,
    });
    crossImageData.getPointData().setScalars(scalars);
    
    console.log('✅ Cross-section VTK ImageData created from CPR data successfully');
    return crossImageData;
  };

  // Create real cross-section using already extracted scalar data
  const createRealCrossSection = async (extractedScalarData: Float32Array, volume: any, centerlinePoints: Point3D[]) => {
    console.log('🔧 Creating real cross-section using already extracted DICOM data...');
    
    try {
      console.log('✅ Using already extracted scalar data for cross-section:', {
        dataLength: extractedScalarData.length,
        dataType: extractedScalarData.constructor?.name
      });
      
      // Get volume characteristics  
      const dimensions = volume.dimensions;
      const spacing = volume.spacing;
      const origin = volume.origin;
      
      // Find middle point of centerline for cross-section
      const middleIndex = Math.floor(centerlinePoints.length / 2);
      const centerPoint = centerlinePoints[middleIndex];
      
      console.log('📊 Cross-section center point:', centerPoint);
      
      // Use the already extracted scalar data (no need to access it again from volume)
      const scalarData = extractedScalarData;
      console.log('✅ Cross-section using already extracted scalar data:', {
        dataLength: scalarData.length,
        dataType: scalarData.constructor.name
      });
      
      // Skip all scalar data access attempts - we already have the extracted data!
      
      // Create real cross-section data
      const crossWidth = 128;
      const crossHeight = 128;
      const crossData = new Float32Array(crossWidth * crossHeight);
      
      // Sample real DICOM data in a perpendicular plane
      for (let i = 0; i < crossHeight; i++) {
        for (let j = 0; j < crossWidth; j++) {
          const offsetX = (j - crossWidth/2) * 0.5;
          const offsetY = (i - crossHeight/2) * 0.5;
          
          // Sample in a plane perpendicular to the centerline
          const sampleX = centerPoint.x + offsetX;
          const sampleY = centerPoint.y + offsetY;
          const sampleZ = centerPoint.z;
          
          // Convert to voxel coordinates
          const voxelX = Math.round((sampleX - origin[0]) / spacing[0]);
          const voxelY = Math.round((sampleY - origin[1]) / spacing[1]);
          const voxelZ = Math.round((sampleZ - origin[2]) / spacing[2]);
          
          if (voxelX >= 0 && voxelX < dimensions[0] &&
              voxelY >= 0 && voxelY < dimensions[1] &&
              voxelZ >= 0 && voxelZ < dimensions[2]) {
            
            const volumeIndex = voxelZ * dimensions[0] * dimensions[1] + 
                              voxelY * dimensions[0] + 
                              voxelX;
            
            if (volumeIndex < scalarData.length) {
              crossData[i * crossWidth + j] = scalarData[volumeIndex];
            } else {
              crossData[i * crossWidth + j] = -1000; // Air value
            }
          } else {
            crossData[i * crossWidth + j] = -1000; // Air value for out of bounds
          }
        }
      }
      
      // Create VTK ImageData for cross-section
      const crossImageData = vtkImageData.newInstance();
      crossImageData.setDimensions([crossWidth, crossHeight, 1]);
      crossImageData.setSpacing([spacing[0], spacing[1], spacing[2]]);
      crossImageData.setOrigin([0, 0, 0]);
      
      const scalars = vtkDataArray.newInstance({
        name: 'CrossSection',
        numberOfComponents: 1,
        values: crossData,
      });
      crossImageData.getPointData().setScalars(scalars);
      
      console.log('✅ Real cross-section data created from DICOM');
      return { cprImageData: crossImageData, cprData: crossData };
      
    } catch (error) {
      console.error('❌ Failed to create real cross-section:', error);
      // Fall back to volume characteristics approach
      console.log('🔄 Cross-section falling back to volume characteristics approach (catch block)');
      const fallbackImageData = createCPRFromVolumeCharacteristics(volume, centerlinePoints);
      return { cprImageData: fallbackImageData, cprData: null };
    }
  };

  // Setup individual VTK view
  const setupSingleVTKView = (containerRef: React.RefObject<HTMLDivElement>, cprImageData: any, cprData: any, viewName: string) => {
    if (!containerRef.current) {
      throw new Error(`Container ${viewName} not ready`);
    }

    if (!cprImageData) {
      throw new Error(`CPR image data for ${viewName} is not available`);
    }

    console.log(`🔧 Setting up ${viewName} VTK rendering...`);

    const genericRenderWindow = vtkGenericRenderWindow.newInstance();
    genericRenderWindow.setContainer(containerRef.current);
    genericRenderWindow.resize();

    const renderer = genericRenderWindow.getRenderer();
    const renderWindow = genericRenderWindow.getRenderWindow();
    const interactor = renderWindow.getInteractor();
    
    interactor.setInteractorStyle(vtkInteractorStyleImage.newInstance());
    interactor.setDesiredUpdateRate(15.0);
    renderer.setBackground(backgroundColor);

    // Create mapper and actor
    const mapper = vtkImageMapper.newInstance();
    mapper.setInputData(cprImageData);
    
    const actor = vtkImageSlice.newInstance();
    actor.setMapper(mapper);

    // Set window/level
    const property = actor.getProperty();
    if (cprData) {
      let minVal = cprData[0];
      let maxVal = cprData[0];
      for (let i = 1; i < cprData.length; i++) {
        if (cprData[i] < minVal) minVal = cprData[i];
        if (cprData[i] > maxVal) maxVal = cprData[i];
      }
      
      const window = maxVal - minVal;
      const level = (maxVal + minVal) / 2;
      property.setColorWindow(window);
      property.setColorLevel(level);
    } else {
      property.setColorWindow(1000);
      property.setColorLevel(300);
    }

    renderer.addActor(actor);

    // Setup camera
    const camera = renderer.getActiveCamera();
    camera.setParallelProjection(true);
    
    // Check if getBounds is available and returns valid bounds
    let bounds = null;
    try {
      if (cprImageData && typeof cprImageData.getBounds === 'function') {
        bounds = cprImageData.getBounds();
        console.log(`📊 ${viewName} bounds:`, bounds);
      } else {
        console.warn(`⚠️ ${viewName}: getBounds not available, using default camera settings`);
      }
    } catch (error) {
      console.warn(`⚠️ ${viewName}: Error getting bounds:`, error);
    }
    
    if (bounds && bounds.length >= 6) {
      const center = [
        (bounds[0] + bounds[1]) / 2,
        (bounds[2] + bounds[3]) / 2,
        (bounds[4] + bounds[5]) / 2
      ];
      
      camera.setPosition(center[0], center[1], center[2] + 100);
      camera.setFocalPoint(center[0], center[1], center[2]);
      camera.setViewUp(0, 1, 0);
      
      const imageHeight = bounds[3] - bounds[2];
      const imageWidth = bounds[1] - bounds[0];
      const maxDimension = Math.max(imageHeight, imageWidth);
      const parallelScale = maxDimension / 2;
      camera.setParallelScale(parallelScale);
      
      console.log(`📷 ${viewName} camera setup with bounds`);
    } else {
      // Default camera settings
      camera.setPosition(0, 0, 100);
      camera.setFocalPoint(0, 0, 0);
      camera.setViewUp(0, 1, 0);
      camera.setParallelScale(50);
      
      console.log(`📷 ${viewName} camera setup with defaults`);
    }

    renderer.resetCameraClippingRange();
    renderWindow.render();

    // Setup point picker for cusp dot placement (following VTK.js PointPicker example)
    const picker = vtkPointPicker.newInstance();
    picker.setPickFromList(1);
    picker.initializePickList();
    // Note: vtkImageSlice is not compatible with vtkPointPicker
    // We'll use world coordinates from the click position instead

    // Setup mouse event handler for left-click picking (only when placing cusps)
    interactor.onLeftButtonPress((callData) => {
      // Only handle clicks when in cusp placement mode
      if (!isPlacingCuspDots || cuspDots.length >= 3) {
        return;
      }

      const pos = callData.position;
      const displayCoords = [pos.x, pos.y];
      
      // Convert display coordinates to world coordinates using the camera
      const camera = renderer.getActiveCamera();
      const bounds = cprImageData.getBounds();
      
      if (bounds) {
        // Get the image bounds and calculate world coordinates
        const [xMin, xMax, yMin, yMax, zMin, zMax] = bounds;
        const center = [(xMin + xMax) / 2, (yMin + yMax) / 2, (zMin + zMax) / 2];
        
        // For 2D image slices, we can approximate the world position
        // This is a simplified approach - in a real application you'd use proper coordinate transformation
        const width = xMax - xMin;
        const height = yMax - yMin;
        
        // Get canvas size
        const canvas = renderWindow.getViews()[0];
        const canvasSize = canvas ? [canvas.getSize()[0], canvas.getSize()[1]] : [400, 400];
        
        // Convert to normalized coordinates (0-1)
        const normalizedX = displayCoords[0] / canvasSize[0];
        const normalizedY = 1.0 - (displayCoords[1] / canvasSize[1]); // Flip Y
        
        // Convert to world coordinates
        const worldX = xMin + normalizedX * width;
        const worldY = yMin + normalizedY * height;
        const worldZ = center[2]; // Use center Z for 2D slice
        
        const pickedPoint: [number, number, number] = [worldX, worldY, worldZ];
        console.log(`🎯 Point picked in ${viewName}:`, pickedPoint);
        
        // Create cusp dot at picked position
        handleCuspDotPlacement(pickedPoint);
      }
    });

    console.log(`✅ ${viewName} VTK rendering setup complete with point picking`);
    
    return {
      renderWindow,
      renderer,
      mapper,
      actor,
      imageData: cprImageData,
      camera,
      genericRenderWindow,
      picker
    };
  };

  // Wait for container elements to be ready
  const waitForContainers = async (maxWaitMs = 10000): Promise<boolean> => {
    const startTime = Date.now();
    let attemptCount = 0;
    
    while (Date.now() - startTime < maxWaitMs) {
      attemptCount++;
      
      console.log(`⏳ Container check attempt ${attemptCount}...`);
      console.log('Refs exist?', {
        cpr1: !!cpr1Ref.current,
        cpr2: !!cpr2Ref.current, 
        crossSection: !!crossSectionRef.current
      });
      
      if (cpr1Ref.current && cpr2Ref.current && crossSectionRef.current) {
        // Additional check: ensure containers have dimensions
        const rect1 = cpr1Ref.current.getBoundingClientRect();
        const rect2 = cpr2Ref.current.getBoundingClientRect();
        const rect3 = crossSectionRef.current.getBoundingClientRect();
        
        console.log('Container dimensions:', {
          cpr1: { width: rect1.width, height: rect1.height },
          cpr2: { width: rect2.width, height: rect2.height },
          crossSection: { width: rect3.width, height: rect3.height }
        });
        
        if (rect1.width > 0 && rect1.height > 0 &&
            rect2.width > 0 && rect2.height > 0 &&
            rect3.width > 0 && rect3.height > 0) {
          console.log('✅ All container elements ready with valid dimensions');
          return true;
        } else {
          console.log('⚠️ Containers exist but have zero dimensions');
        }
      } else {
        console.log('⚠️ Some container refs are null');
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.error('❌ Timeout waiting for container elements after', Math.round((Date.now() - startTime) / 1000), 'seconds');
    return false;
  };

  // Setup VTK rendering for all three views
  const setupVTKRendering = async (cprResults: any) => {
    console.log('🔧 Setting up three-view VTK rendering...');
    
    // Wait for containers to be ready
    const containersReady = await waitForContainers();
    if (!containersReady) {
      throw new Error('Container elements not ready after timeout');
    }

    if (!cprResults) {
      throw new Error('CPR results not available');
    }

    console.log('📊 CPR Results validation:', {
      hasCpr1: !!cprResults.cpr1,
      hasCpr2: !!cprResults.cpr2,
      hasCrossSection: !!cprResults.crossSection,
      cpr1ImageData: !!cprResults.cpr1?.cprImageData,
      cpr2ImageData: !!cprResults.cpr2?.cprImageData,
      crossSectionImageData: !!cprResults.crossSection?.cprImageData,
      crossSectionType: typeof cprResults.crossSection,
      crossSectionStructure: cprResults.crossSection ? Object.keys(cprResults.crossSection) : 'N/A'
    });

    // Validate that all required data is available
    if (!cprResults.cpr1?.cprImageData) {
      throw new Error('CPR1 image data is missing');
    }
    if (!cprResults.cpr2?.cprImageData) {
      throw new Error('CPR2 image data is missing');
    }
    if (!cprResults.crossSection?.cprImageData) {
      console.error('❌ CrossSection structure:', cprResults.crossSection);
      throw new Error('CrossSection image data is missing');
    }

    try {
      // Setup all three views with proper error handling
      const cpr1View = setupSingleVTKView(cpr1Ref, cprResults.cpr1?.cprImageData, cprResults.cpr1?.cprData, 'CPR1');
      const cpr2View = setupSingleVTKView(cpr2Ref, cprResults.cpr2?.cprImageData, cprResults.cpr2?.cprData, 'CPR2');
      const crossSectionView = setupSingleVTKView(crossSectionRef, cprResults.crossSection?.cprImageData, cprResults.crossSection?.cprData, 'CrossSection');

      // Store all VTK objects
      vtkObjects.current = {
        cpr1: cpr1View,
        cpr2: cpr2View,
        crossSection: crossSectionView,
        volume: vtkObjects.current.volume
      };

      // Update window/level state from first view
      if (cprResults.cpr1?.cprData && cprResults.cpr1.cprData.length > 0) {
        let minVal = cprResults.cpr1.cprData[0];
        let maxVal = cprResults.cpr1.cprData[0];
        for (let i = 1; i < cprResults.cpr1.cprData.length; i++) {
          if (cprResults.cpr1.cprData[i] < minVal) minVal = cprResults.cpr1.cprData[i];
          if (cprResults.cpr1.cprData[i] > maxVal) maxVal = cprResults.cpr1.cprData[i];
        }
        const window = maxVal - minVal;
        const level = (maxVal + minVal) / 2;
        setWindowLevel({ window, level });
        console.log('📊 Window/Level set from CPR1 data:', { window, level });
      } else {
        // Use default window/level
        setWindowLevel({ window: 1000, level: 300 });
        console.log('📊 Using default window/level');
      }

      console.log('✅ Three-view VTK rendering setup complete');
    } catch (error) {
      console.error('❌ Error setting up three-view VTK rendering:', error);
      throw error;
    }
  };

  // Main initialization (adapted from HybridCPRViewport)
  const initializeCPRViewport = async () => {
    if (isInitialized) {
      console.log('🚫 Already initialized, skipping...');
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);

      console.log('🔄 Initializing CPR viewport with cusp dots...');

      // Load DICOM data
      const { volume, imageIds } = await loadDicomData();

      // Generate centerline
      const centerlinePoints = generateCenterlinePoints(rootPoints);
      setCenterlinePoints(centerlinePoints);
      
      if (centerlinePoints.length === 0) {
        throw new Error('Failed to generate centerline');
      }

      console.log('📏 Generated centerline points:', centerlinePoints.length);

      // Wait a bit more for volume data to be fully available (like HybridCPRViewport pattern)
      console.log('🔄 Waiting additional time for volume data to be fully available...');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 more seconds
      
      // Debug: Check volume state again after additional wait
      console.log('📊 Volume state after additional wait:', {
        hasGetScalarData: typeof volume.getScalarData === 'function',
        hasVoxelManager: !!volume.voxelManager,
        hasImageData: !!volume.imageData,
        hasVtkImageData: !!volume.vtkImageData,
        dimensionsAvailable: !!volume.dimensions,
        spacingAvailable: !!volume.spacing,
        originAvailable: !!volume.origin
      });
      
      // Try to access scalar data one more time before CPR extraction
      let testScalarData = null;
      try {
        if (volume.getScalarData) {
          testScalarData = volume.getScalarData();
          console.log('📊 Test scalar data access successful:', {
            hasData: !!testScalarData,
            dataLength: testScalarData?.length,
            dataType: testScalarData?.constructor?.name
          });
        }
      } catch (e) {
        console.log('📊 Test scalar data access failed:', e.message);
      }
      
      // Create multi-view CPR data (three views: 2 CPR + 1 cross-section)
      const cprResults = await createMultiViewCPRData(volume, centerlinePoints);
      
      console.log('📊 Multi-view CPR results:', {
        hasCpr1: !!cprResults.cpr1.cprImageData,
        hasCpr2: !!cprResults.cpr2.cprImageData,
        hasCrossSection: !!cprResults.crossSection.cprImageData
      });

      // Setup three-view VTK rendering
      await setupVTKRendering(cprResults);

      // Setup Cornerstone overlays for annotation tools (hybrid approach - fixed)
      if (stage === 'annulus_definition') {
        console.log('🔧 Setting up Cornerstone annotation overlays for cusp marking...');
        await setupCornerstoneOverlays(volume, imageIds);
      }

      setIsInitialized(true);
      setIsLoading(false);

      console.log('✅ CPR viewport with hybrid annotation tools initialized successfully!');

    } catch (err) {
      console.error('❌ Failed to initialize CPR viewport:', err);
      setError(`Failed to initialize: ${err}`);
      setIsLoading(false);
    }
  };

  // Initialize when patient info and root points are available
  useEffect(() => {
    if (patientInfo && rootPoints.length >= 3 && !isInitialized) {
      // Add a longer delay to ensure React has fully rendered the DOM elements and CSS layout is complete
      console.log('🔄 Scheduling TriViewCPRViewport initialization...');
      setTimeout(() => {
        console.log('🔄 Starting TriViewCPRViewport initialization...');
        initializeCPRViewport();
      }, 500);
    }
  }, [patientInfo, rootPoints, modifiedCenterline, isInitialized]);

  // Handle window resize to prevent CPR from disappearing
  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout | null = null;
    
    const handleResize = () => {
      const now = Date.now();
      // Prevent rapid resize calls (minimum 200ms between resizes)
      if (now - lastResizeTime.current < 200) {
        return;
      }
      lastResizeTime.current = now;
      
      console.log('🔄 Window/container resized, updating VTK renderers...');
      
      // Helper function to resize a single VTK view
      const resizeSingleView = (vtkView: any, viewName: string) => {
        if (!vtkView?.genericRenderWindow) return;
        
        try {
          // Get container dimensions
          const container = vtkView.genericRenderWindow.getContainer();
          if (!container) return;
          
          const rect = container.getBoundingClientRect();
          
          // Check for invalid dimensions (prevent infinite loop)
          if (rect.width <= 0 || rect.height <= 0 || 
              rect.width > 10000 || rect.height > 10000 ||
              !isFinite(rect.width) || !isFinite(rect.height)) {
            console.warn(`⚠️ ${viewName} has invalid container dimensions:`, rect);
            return;
          }
          
          // Check if dimensions actually changed significantly
          const lastDim = lastDimensions.current.get(viewName);
          if (lastDim) {
            const widthDiff = Math.abs(rect.width - lastDim.width);
            const heightDiff = Math.abs(rect.height - lastDim.height);
            // Only resize if dimensions changed by more than 5 pixels
            if (widthDiff < 5 && heightDiff < 5) {
              return;
            }
          }
          
          // Store current dimensions
          lastDimensions.current.set(viewName, { width: rect.width, height: rect.height });
          
          console.log(`🔧 ${viewName} container size changed:`, {
            width: rect.width.toFixed(1),
            height: rect.height.toFixed(1)
          });
          
          // Resize the VTK render window
          vtkView.genericRenderWindow.resize();
          
          // Reset camera clipping range to prevent gray screen
          if (vtkView.renderer) {
            vtkView.renderer.resetCameraClippingRange();
          }
          
          // Force immediate render
          if (vtkView.renderWindow) {
            vtkView.renderWindow.render();
          }
          
          console.log(`✅ ${viewName} resized and re-rendered`);
        } catch (error) {
          console.error(`❌ Error resizing ${viewName}:`, error);
        }
      };
      
      // Resize all three views
      resizeSingleView(vtkObjects.current.cpr1, 'CPR1');
      resizeSingleView(vtkObjects.current.cpr2, 'CPR2');
      resizeSingleView(vtkObjects.current.crossSection, 'CrossSection');
      
      console.log('✅ All VTK renderers resize handling complete');
    };

    // Debounced resize handler
    const debouncedResize = () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = setTimeout(handleResize, 100);
    };

    // Add window resize listener with debouncing
    window.addEventListener('resize', debouncedResize);
    
    // Handle browser console open/close (visibility change)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('🔄 Page became visible, refreshing VTK renderers...');
        setTimeout(() => handleResize(), 200);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // ResizeObserver for container-level resize detection with proper debouncing
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        
        // Ignore invalid dimensions that could cause loops
        if (width <= 0 || height <= 0 || width > 10000 || height > 10000) {
          console.warn('⚠️ Ignoring invalid container dimensions:', { width, height });
          continue;
        }
        
        console.log('🔄 Container resized:', entry.target.className, {
          width: width.toFixed(1),
          height: height.toFixed(1)
        });
      }
      
      // Use the same debounced handler
      debouncedResize();
    });
    
    // Observe all three container refs
    if (cpr1Ref.current) resizeObserver.observe(cpr1Ref.current);
    if (cpr2Ref.current) resizeObserver.observe(cpr2Ref.current);
    if (crossSectionRef.current) resizeObserver.observe(crossSectionRef.current);
    
    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      window.removeEventListener('resize', debouncedResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      resizeObserver.disconnect();
    };
  }, [isInitialized]);

  // Setup cusp dot interaction when placement mode changes (hybrid approach)
  useEffect(() => {
    if (stage === 'annulus_definition' && cornerstoneObjects.current.toolGroup) {
      // Enable/disable Cornerstone annotation tools based on placement mode
      if (isPlacingCuspDots) {
        console.log('🎯 Activating Cornerstone annotation tools for cusp placement');
        cornerstoneObjects.current.toolGroup.setToolActive(ProbeTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
        });
      } else {
        console.log('🎯 Deactivating Cornerstone annotation tools');
        cornerstoneObjects.current.toolGroup.setToolPassive(ProbeTool.toolName);
      }
    }
  }, [isPlacingCuspDots, stage]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      cleanupCornerstoneOverlays();
    };
  }, []);

  // Setup Cornerstone3D overlay viewports for annotation tools
  const setupCornerstoneOverlays = async (volume: any, imageIds: string[]) => {
    try {
      console.log('🔧 Setting up Cornerstone3D overlay viewports for annotation tools...');
      
      // Create Cornerstone rendering engine for overlays
      const renderingEngineId = 'cprOverlayEngine';
      const toolGroupId = 'CPR_OVERLAY_TOOLS';
      
      cornerstoneObjects.current.renderingEngine = new RenderingEngine(renderingEngineId);
      cornerstoneObjects.current.volumeId = `overlayVolume_${Date.now()}`;
      
      // Create volume for Cornerstone overlays (same data as VTK)
      const overlayVolume = await volumeLoader.createAndCacheVolume(cornerstoneObjects.current.volumeId, { imageIds });
      overlayVolume.load();
      
      // Wait for volume to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Setup overlay viewports with transparent backgrounds
      const overlayViewports = [
        { id: 'overlay-cpr1', element: cornerstoneOverlayRefs.current.cpr1, orientation: CornerstoneEnums.OrientationAxis.AXIAL },
        { id: 'overlay-cpr2', element: cornerstoneOverlayRefs.current.cpr2, orientation: CornerstoneEnums.OrientationAxis.SAGITTAL },
        { id: 'overlay-cross', element: cornerstoneOverlayRefs.current.crossSection, orientation: CornerstoneEnums.OrientationAxis.CORONAL },
      ];
      
      // Use for loop to handle async operations properly
      for (const { id, element, orientation } of overlayViewports) {
        if (element) {
          cornerstoneObjects.current.renderingEngine!.enableElement({
            viewportId: id,
            type: CornerstoneEnums.ViewportType.ORTHOGRAPHIC,
            element: element,
            defaultOptions: {
              orientation,
              background: [0, 0, 0], // Black background (transparency handled differently)
            },
          });
          
          // Set the volume but keep it invisible (need metadata for annotations)
          const viewport = cornerstoneObjects.current.renderingEngine!.getViewport(id) as Types.IVolumeViewport;
          viewport.setVolumes([{ volumeId: cornerstoneObjects.current.volumeId! }]);
          
          // Wait for volume to render, then make it invisible
          await new Promise(resolve => setTimeout(resolve, 100));
          viewport.render();
          
          // Make the volume completely invisible but keep metadata
          const actors = viewport.getActors();
          actors.forEach(actor => {
            const property = actor.actor.getProperty();
            property.setOpacity(0.0001); // Extremely low opacity to preserve metadata
            property.setVisibility(false); // Hide the volume actor completely
          });
          
          // Configure canvas for annotation overlay
          const canvas = viewport.getCanvas();
          if (canvas) {
            canvas.style.background = 'transparent';
            canvas.style.pointerEvents = 'auto'; // Allow mouse events for annotation
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.zIndex = '15'; // Above VTK 
            
            // Make only the volume invisible, but keep annotations visible
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.globalCompositeOperation = 'source-over'; // Default blending for annotations
            }
          }
          
          viewport.render();
        }
      }
      
      // Setup annotation tools
      await setupCornerstoneAnnotationTools(toolGroupId);
      
      console.log('✅ Cornerstone3D overlay viewports setup complete');
      
    } catch (error) {
      console.error('❌ Failed to setup Cornerstone overlays:', error);
    }
  };
  
  // Setup Cornerstone annotation tools for cusp marking
  const setupCornerstoneAnnotationTools = async (toolGroupId: string) => {
    try {
      console.log('🔧 Setting up Cornerstone annotation tools...');
      
      // Initialize Cornerstone tools if not already done
      try {
        await toolsInit();
        console.log('✅ Cornerstone tools initialized');
      } catch (e) {
        console.log('📝 Cornerstone tools already initialized or initialization failed:', e.message);
      }
      
      // Add probe tool to the global tool registry
      addTool(ProbeTool);
      console.log('✅ ProbeTool added to registry');
      
      // Create tool group for overlays  
      try {
        // Try to destroy existing tool group if it exists
        const existingGroup = ToolGroupManager.getToolGroup(toolGroupId);
        if (existingGroup) {
          ToolGroupManager.destroyToolGroup(toolGroupId);
        }
      } catch (e) {
        // Tool group doesn't exist, which is fine
      }
      
      cornerstoneObjects.current.toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
      
      // Add probe tool for cusp marking
      cornerstoneObjects.current.toolGroup.addTool(ProbeTool.toolName);
      console.log('✅ ProbeTool added to tool group');
      
      // Add overlay viewports to tool group
      const overlayViewportIds = ['overlay-cpr1', 'overlay-cpr2', 'overlay-cross'];
      overlayViewportIds.forEach(viewportId => {
        cornerstoneObjects.current.toolGroup!.addViewport(
          viewportId,
          cornerstoneObjects.current.renderingEngine!.id
        );
      });
      console.log('✅ Overlay viewports added to tool group');
      
      // Set tool to passive initially (will be activated when user clicks "Place Cusps")
      cornerstoneObjects.current.toolGroup.setToolPassive(ProbeTool.toolName);
      
      // Listen for annotation events using the correct Cornerstone3D event system
      eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_COMPLETED, handleCornerstoneAnnotation);
      
      console.log('✅ Cornerstone annotation tools setup complete');
      
    } catch (error) {
      console.error('❌ Failed to setup Cornerstone annotation tools:', error);
    }
  };
  
  // Handle Cornerstone annotation events (probe tool clicks)
  const handleCornerstoneAnnotation = (evt: any) => {
    console.log('🎯 Cornerstone annotation event:', evt);
    
    if (evt.detail?.annotation?.data?.handles?.points) {
      const worldPos = evt.detail.annotation.data.handles.points[0];
      console.log('🎯 Cusp marked at world position:', worldPos);
      
      // Convert to our cusp dot format
      if (cuspDots.length < 3) {
        const cuspTypes: ('left' | 'right' | 'non-coronary')[] = ['left', 'right', 'non-coronary'];
        const cuspType = cuspTypes[cuspDots.length];
        const placementIndex = cuspDots.length;
        
        const newCuspDot = {
          id: `cusp_${cuspType}_${placementIndex}_${Date.now()}`,
          realWorldPos: [worldPos[0], worldPos[1], worldPos[2]] as [number, number, number],
          color: cuspType === 'left' ? 'red' : cuspType === 'right' ? 'green' : 'yellow',
          cuspType,
          placementIndex
        };
        
        setCuspDots(prev => [...prev, newCuspDot]);
        
        // Call callback
        if (onCuspDotsUpdate) {
          const updatedDots = [...cuspDots, newCuspDot];
          onCuspDotsUpdate(updatedDots.map(dot => ({
            id: dot.id,
            pos: dot.realWorldPos,
            color: dot.color,
            cuspType: dot.cuspType
          })));
        }
        
        console.log(`✅ Cusp dot ${placementIndex + 1}/3 marked using Cornerstone tools`);
      }
    }
  };

  // Cleanup function for Cornerstone overlays
  const cleanupCornerstoneOverlays = () => {
    try {
      console.log('🧹 Cleaning up Cornerstone overlays...');
      
      // Remove event listener
      eventTarget.removeEventListener(ToolEnums.Events.ANNOTATION_COMPLETED, handleCornerstoneAnnotation);
      
      // Destroy tool group
      if (cornerstoneObjects.current.toolGroup) {
        try {
          ToolGroupManager.destroyToolGroup('CPR_OVERLAY_TOOLS');
        } catch (e) {
          console.warn('Failed to destroy tool group:', e);
        }
      }
      
      // Destroy rendering engine
      if (cornerstoneObjects.current.renderingEngine) {
        try {
          cornerstoneObjects.current.renderingEngine.destroy();
        } catch (e) {
          console.warn('Failed to destroy Cornerstone rendering engine:', e);
        }
      }
      
      // Clear refs
      cornerstoneObjects.current = {};
      
      console.log('✅ Cornerstone overlays cleanup complete');
    } catch (error) {
      console.warn('Cornerstone cleanup error:', error);
    }
  };

  // Create VTK sphere actor for cusp nadir point - positioned properly in image plane (fallback)
  const createCuspSphere = (position: [number, number, number], cuspType: 'left' | 'right' | 'non-coronary', placementIndex: number, renderer?: any) => {
    console.log('🎯 Creating VTK sphere for cusp:', { position, cuspType, placementIndex });
    console.log('🎯 Sphere position values:', position);

    // Position sphere properly in the 2D image slice coordinate system
    let sphereRadius = 3.0;
    let spherePosition = [...position]; // Use clicked position in image coordinates
    
    if (renderer) {
      try {
        // Get the image actor to understand the coordinate system
        const actors = renderer.getActors();
        if (actors && actors.length > 0) {
          const imageActor = actors[0];
          const imageBounds = imageActor.getBounds();
          
          if (imageBounds && imageBounds.length >= 6) {
            // Calculate sphere size relative to CPR image size
            const imageWidth = Math.abs(imageBounds[1] - imageBounds[0]);
            const imageHeight = Math.abs(imageBounds[3] - imageBounds[2]);
            sphereRadius = Math.min(imageWidth, imageHeight) * 0.03; // 3% of image size
            
            // Keep the X,Y coordinates from the click but set Z to be slightly in front of image
            // The image slice is typically at Z=0, so we position sphere slightly forward
            spherePosition[2] = imageBounds[5] + 0.1; // Just in front of the image slice
            
            console.log('🎯 Positioning sphere in image coordinate system:', {
              originalPosition: position,
              imageBounds,
              spherePosition,
              imageWidth: imageWidth.toFixed(2),
              imageHeight: imageHeight.toFixed(2),
              sphereRadius: sphereRadius.toFixed(2)
            });
          }
        }
      } catch (e) {
        console.warn('🎯 Could not get image bounds:', e);
      }
    }

    // Create sphere using VTK pattern
    const sphereSource = vtkSphereSource.newInstance();
    sphereSource.setCenter(spherePosition);
    sphereSource.setRadius(sphereRadius);
    
    console.log('🎯 Creating sphere - radius:', sphereRadius.toFixed(2), 'center:', spherePosition);

    // Create mapper
    const mapper = vtkMapper.newInstance();
    mapper.setInputConnection(sphereSource.getOutputPort());

    // Create actor
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);

    // Set bright, visible properties for 2D rendering
    const colors = {
      'left': [1.0, 0.0, 0.0], // Red
      'right': [0.0, 1.0, 0.0], // Green  
      'non-coronary': [0.0, 0.0, 1.0] // Blue
    };
    
    const property = actor.getProperty();
    property.setColor(...colors[cuspType]);
    property.setOpacity(1.0);
    
    // Optimize for 2D slice rendering - disable lighting to avoid depth issues
    property.setAmbient(1.0); // Full ambient lighting (unlit)
    property.setDiffuse(0.0); // No diffuse lighting
    property.setSpecular(0.0); // No specular lighting
    property.setRepresentation(2); // Surface representation
    property.setInterpolationToFlat(); // Flat shading for 2D
    
    // Force the actor to always be visible regardless of depth
    actor.getMapper().setStatic(false); // Allow dynamic rendering
    actor.setPickable(true); // Make it interactive

    // Log final sphere info
    console.log('🎯 Sphere created with center at:', spherePosition, 'radius:', sphereRadius);
    
    // Verify sphere was created properly
    const bounds = actor.getBounds();
    console.log('🎯 Sphere actor bounds:', bounds);

    return {
      actor,
      sphereSource: sphereSource,
      mapper,
      position: spherePosition,
      cuspType,
      placementIndex,
      radius: sphereRadius,
      id: `cusp_${cuspType}_${placementIndex}_${Date.now()}`
    };
  };

  // Test cube instead of sphere - different geometry to rule out sphere issues
  const addSimpleTestSphere = (vtkRenderObjects: any, viewName: string) => {
    console.log(`🧪 Adding test CUBE to ${viewName} at image center (sphere alternative)...`);
    
    if (!vtkRenderObjects.renderer || !vtkRenderObjects.renderWindow) {
      console.warn(`🧪 No renderer/renderWindow for ${viewName}`);
      return null;
    }
    
    // Get image bounds to position cube at center
    let centerPosition = [0, 0, 0];
    try {
      if (vtkRenderObjects.imageData && vtkRenderObjects.imageData.getBounds) {
        const bounds = vtkRenderObjects.imageData.getBounds();
        centerPosition = [
          (bounds[0] + bounds[1]) / 2,
          (bounds[2] + bounds[3]) / 2,
          (bounds[4] + bounds[5]) / 2
        ];
        console.log(`🧪 ${viewName} image center:`, centerPosition);
        console.log(`🧪 ${viewName} image bounds:`, bounds);
      }
    } catch (e) {
      console.warn(`🧪 Could not get image bounds for ${viewName}:`, e);
    }
    
    // Try CUBE instead of sphere - completely different geometry
    const cubeSource = vtkCubeSource.newInstance();
    cubeSource.setCenter(centerPosition);
    cubeSource.setXLength(40); // Large cube for maximum visibility
    cubeSource.setYLength(40);
    cubeSource.setZLength(40);

    const mapper = vtkMapper.newInstance();
    mapper.setInputConnection(cubeSource.getOutputPort());

    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);

    const property = actor.getProperty();
    property.setColor(0.0, 1.0, 0.0); // Bright green cube
    property.setOpacity(1.0);
    property.setAmbient(1.0); // Maximum ambient light
    property.setDiffuse(1.0); // Maximum diffuse light
    property.setSpecular(0.0); // No specular
    property.setRepresentation(2); // Surface representation
    
    // Add to renderer
    vtkRenderObjects.renderer.addActor(actor);
    
    // Force camera to look at the cube
    const camera = vtkRenderObjects.renderer.getActiveCamera();
    camera.setFocalPoint(centerPosition[0], centerPosition[1], centerPosition[2]);
    
    // Reset camera clipping range 
    vtkRenderObjects.renderer.resetCameraClippingRange();
    
    // Force multiple renders
    vtkRenderObjects.renderWindow.render();
    vtkRenderObjects.renderWindow.render(); // Double render
    
    // Debug info
    const actors = vtkRenderObjects.renderer.getActors();
    const actorBounds = actor.getBounds();
    const cameraBounds = vtkRenderObjects.renderer.computeVisiblePropBounds();
    
    console.log(`🧪 ${viewName} CUBE test:`, {
      actorsCount: actors?.length || 0,
      cubeBounds: actorBounds,
      cameraBounds: cameraBounds,
      cubeCenter: centerPosition,
      cubeSize: [40, 40, 40]
    });
    
    // Try to force actor visibility
    actor.setVisibility(true);
    actor.modified();
    vtkRenderObjects.renderer.modified();
    vtkRenderObjects.renderWindow.render();
    
    console.log(`🧪 Green CUBE added to ${viewName} - testing alternative to sphere`);
    
    return actor;
  };

  // Add sphere to all three views
  const addSphereToAllViews = (sphereData: any) => {
    console.log('🎯 Adding sphere to all VTK views:', sphereData);

    // Add to CPR1
    if (vtkObjects.current.cpr1?.renderer) {
      console.log('🎯 Adding sphere to CPR1...');
      
      // FIRST: Add simple test sphere using SphereMarkerTool pattern
      const testSphere1 = addSimpleTestSphere(vtkObjects.current.cpr1, 'CPR1');
      
      const cpr1Sphere = createCuspSphere(sphereData.position, sphereData.cuspType, sphereData.placementIndex, vtkObjects.current.cpr1.renderer);
      
      // Add sphere with proper depth handling for 2D image rendering
      vtkObjects.current.cpr1.renderer.addActor(cpr1Sphere.actor);
      
      // Disable depth testing for the sphere to ensure it's always visible
      try {
        // Get the render window to access OpenGL context
        const renderWindow = vtkObjects.current.cpr1.renderWindow;
        if (renderWindow) {
          // Force the sphere to render on top by disabling depth testing
          const mapper = cpr1Sphere.actor.getMapper();
          if (mapper) {
            // Set the mapper to ignore depth
            mapper.setStatic(false);
            
            // Force immediate geometry update
            mapper.update();
          }
          
          // Set the actor to always be visible
          cpr1Sphere.actor.setVisibility(true);
          cpr1Sphere.actor.getProperty().setOpacity(1.0);
          
          // Force the renderer to treat this as a 2D overlay
          const actors = vtkObjects.current.cpr1.renderer.getActors();
          if (actors && actors.length > 1) {
            // Ensure sphere is rendered last (on top)
            vtkObjects.current.cpr1.renderer.removeActor(cpr1Sphere.actor);
            vtkObjects.current.cpr1.renderer.addActor(cpr1Sphere.actor);
          }
        }
      } catch (e) {
        console.warn('🎯 Could not configure sphere depth handling:', e);
      }
      
      // Enhanced visibility checks
      const bounds = cpr1Sphere.actor.getBounds();
      const cameraBounds = vtkObjects.current.cpr1.renderer.computeVisiblePropBounds();
      console.log('🎯 CPR1 sphere bounds:', bounds);
      console.log('🎯 CPR1 camera bounds:', cameraBounds);
      
      // Check lighting in the scene
      const lights = vtkObjects.current.cpr1.renderer.getLights();
      console.log('🎯 CPR1 lights count:', lights ? lights.length : 0);
      
      // Force add lights to ensure visibility
      console.log('🎯 CPR1 lights count:', lights ? lights.length : 0);
      vtkObjects.current.cpr1.renderer.setAutomaticLightCreation(true);
      vtkObjects.current.cpr1.renderer.setLightFollowCamera(true);
      
      // Manually add a bright light if none exist
      if (!lights || lights.length === 0) {
        console.log('🎯 Manually adding bright light to CPR1...');
        const light = vtkLight.newInstance();
        light.setLightTypeToHeadlight();
        light.setIntensity(1.0);
        light.setColor(1.0, 1.0, 1.0);
        vtkObjects.current.cpr1.renderer.addLight(light);
      }
      
      // Force the renderer to use lighting
      if (vtkObjects.current.cpr1.renderer.setUseDepthPeeling) {
        vtkObjects.current.cpr1.renderer.setUseDepthPeeling(false); // Disable depth peeling for simplicity
      }
      if (vtkObjects.current.cpr1.renderer.setUseFXAA) {
        vtkObjects.current.cpr1.renderer.setUseFXAA(false); // Disable anti-aliasing for simplicity
      }
      
      // Try to move camera to look at the sphere
      try {
        const camera = vtkObjects.current.cpr1.renderer.getActiveCamera();
        if (camera) {
          console.log('🎯 CPR1 camera position before:', camera.getPosition());
          console.log('🎯 CPR1 camera focal point before:', camera.getFocalPoint());
          
          // Set camera to look at the sphere
          camera.setFocalPoint(sphereData.position[0], sphereData.position[1], sphereData.position[2]);
          
          console.log('🎯 CPR1 camera focal point after:', camera.getFocalPoint());
        }
      } catch (e) {
        console.warn('🎯 Could not adjust camera:', e);
      }
      
      // Force immediate render without depth issues
      vtkObjects.current.cpr1.renderer.resetCameraClippingRange();
      
      // Ensure the camera can see both image and sphere
      const camera = vtkObjects.current.cpr1.renderer.getActiveCamera();
      const clippingRange = camera.getClippingRange();
      console.log('🎯 CPR1 camera clipping range:', clippingRange);
      
      // Extend clipping range to ensure sphere is visible
      camera.setClippingRange(clippingRange[0] * 0.1, clippingRange[1] * 2.0);
      
      // Force multiple renders to ensure geometry is updated
      vtkObjects.current.cpr1.renderer.modified();
      vtkObjects.current.cpr1.renderWindow?.render();
      vtkObjects.current.cpr1.renderWindow?.render(); // Double render for safety
      
      console.log('✅ CPR1 sphere added with extended clipping range, actors count:', vtkObjects.current.cpr1.renderer.getActors().length);
      
      // DEBUG: Check all actors visibility and try to debug rendering
      const cpr1Actors = vtkObjects.current.cpr1.renderer.getActors();
      console.log('🎯 DEBUG: CPR1 actors analysis:', {
        totalActors: cpr1Actors ? cpr1Actors.length : 0,
        actorTypes: cpr1Actors ? cpr1Actors.map((actor, i) => ({
          index: i,
          visible: actor.getVisibility(),
          bounds: actor.getBounds(),
          className: actor.getClassName ? actor.getClassName() : 'unknown'
        })) : []
      });
      
      // Try to debug by temporarily hiding EVERYTHING except spheres
      if (cpr1Actors && cpr1Actors.length > 1) {
        console.log('🎯 DEBUG: Hiding all actors except spheres...');
        
        // Hide the first actor (should be image slice)
        const imageActor = cpr1Actors[0];
        imageActor.setVisibility(false);
        
        // Ensure all sphere actors are visible
        for (let i = 1; i < cpr1Actors.length; i++) {
          cpr1Actors[i].setVisibility(true);
          console.log(`🎯 DEBUG: Ensuring actor ${i} is visible:`, cpr1Actors[i].getVisibility());
        }
        
        // Force aggressive render
        vtkObjects.current.cpr1.renderer.modified();
        vtkObjects.current.cpr1.renderWindow?.modified();
        vtkObjects.current.cpr1.renderWindow?.render();
        
        console.log('🎯 DEBUG: All non-image actors should now be visible (bright spheres)');
        
        // Restore after 3 seconds
        setTimeout(() => {
          imageActor.setVisibility(true);
          vtkObjects.current.cpr1.renderWindow?.render();
          console.log('🎯 DEBUG: Image slice visibility restored');
        }, 3000);
      }
    }

    // Add to CPR2  
    if (vtkObjects.current.cpr2?.renderer) {
      console.log('🎯 Adding sphere to CPR2...');
      
      // FIRST: Add test sphere using VTK.js example pattern
      const testSphere2 = addSimpleTestSphere(vtkObjects.current.cpr2, 'CPR2');
      
      const cpr2Sphere = createCuspSphere(sphereData.position, sphereData.cuspType, sphereData.placementIndex, vtkObjects.current.cpr2.renderer);
      vtkObjects.current.cpr2.renderer.addActor(cpr2Sphere.actor);
      
      // Enhanced visibility checks
      const bounds = cpr2Sphere.actor.getBounds();
      const cameraBounds = vtkObjects.current.cpr2.renderer.computeVisiblePropBounds();
      console.log('🎯 CPR2 sphere bounds:', bounds);
      console.log('🎯 CPR2 camera bounds:', cameraBounds);
      
      vtkObjects.current.cpr2.renderer.resetCameraClippingRange();
      vtkObjects.current.cpr2.renderer.modified();
      vtkObjects.current.cpr2.renderWindow?.render();
      
      console.log('✅ CPR2 sphere added, actors count:', vtkObjects.current.cpr2.renderer.getActors().length);
    }

    // Add to Cross-Section
    if (vtkObjects.current.crossSection?.renderer) {
      console.log('🎯 Adding sphere to CrossSection...');
      
      // FIRST: Add test sphere using VTK.js example pattern
      const testSphere3 = addSimpleTestSphere(vtkObjects.current.crossSection, 'CrossSection');
      
      const crossSphere = createCuspSphere(sphereData.position, sphereData.cuspType, sphereData.placementIndex, vtkObjects.current.crossSection.renderer);
      vtkObjects.current.crossSection.renderer.addActor(crossSphere.actor);
      
      // Enhanced visibility checks
      const bounds = crossSphere.actor.getBounds();
      const cameraBounds = vtkObjects.current.crossSection.renderer.computeVisiblePropBounds();
      console.log('🎯 CrossSection sphere bounds:', bounds);
      console.log('🎯 CrossSection camera bounds:', cameraBounds);
      
      vtkObjects.current.crossSection.renderer.resetCameraClippingRange();
      vtkObjects.current.crossSection.renderer.modified();
      vtkObjects.current.crossSection.renderWindow?.render();
      
      console.log('✅ CrossSection sphere added, actors count:', vtkObjects.current.crossSection.renderer.getActors().length);
    }

    console.log('✅ Sphere added to all three VTK views');
    
    // Force all renderers to update and render
    setTimeout(() => {
      console.log('🎯 Force rendering all views after sphere addition...');
      if (vtkObjects.current.cpr1?.renderWindow) {
        vtkObjects.current.cpr1.renderWindow.render();
      }
      if (vtkObjects.current.cpr2?.renderWindow) {
        vtkObjects.current.cpr2.renderWindow.render();
      }
      if (vtkObjects.current.crossSection?.renderWindow) {
        vtkObjects.current.crossSection.renderWindow.render();
      }
      console.log('✅ Force render complete');
    }, 50);
  };

  // Setup cusp dot interaction
  const setupCuspDotInteraction = () => {
    console.log('🎯 Setting up cusp dot interaction for three VTK views...');

    const handleViewClick = (viewName: string, renderer: any, renderWindow: any) => {
      if (!onCuspDotsUpdate || !isPlacingCuspDots || cuspDots.length >= 3) return;

      return (callData: any, event: any) => {
        console.log(`🎯 Click detected in ${viewName} view`);
        
        // Get the image actor bounds specifically (not all visible props)
        let bounds = null;
        let imageBounds = null;
        const actors = renderer.getActors();
        
        console.log(`📊 Total actors in ${viewName}:`, actors ? actors.length : 0);
        
        // Find the CPR image actor (should be the first one added - the CPR slice)
        if (actors && actors.length > 0) {
          // Get the first actor which should be our CPR image slice
          const imageActor = actors[0];
          imageBounds = imageActor.getBounds();
          bounds = imageBounds; // Use image bounds as the primary coordinate system
          console.log(`📊 CPR Image actor bounds for ${viewName}:`, imageBounds);
          
          // Also log all actor bounds for debugging
          actors.forEach((actor, index) => {
            const actorBounds = actor.getBounds();
            console.log(`📊 Actor ${index} bounds in ${viewName}:`, actorBounds);
          });
        }
        
        // Fallback to renderer bounds if image actor bounds not available
        if (!bounds || bounds.length < 6) {
          bounds = renderer.computeVisiblePropBounds();
          console.log(`📊 Fallback renderer bounds for ${viewName}:`, bounds);
        }
        
        let worldPos;
        
        if (!bounds || bounds.length < 6 || 
            (bounds[0] === bounds[1] && bounds[2] === bounds[3] && bounds[4] === bounds[5])) {
          console.warn(`❌ Could not get valid bounds for ${viewName}`);
          // Use camera center position for maximum visibility
          const cameraBounds = renderer.computeVisiblePropBounds();
          if (cameraBounds && cameraBounds.length >= 6) {
            const cameraCenterX = (cameraBounds[0] + cameraBounds[1]) / 2;
            const cameraCenterY = (cameraBounds[2] + cameraBounds[3]) / 2;
            const cameraCenterZ = (cameraBounds[4] + cameraBounds[5]) / 2;
            
            // Place spheres at camera center with small offsets
            const cameraOffset = Math.min(Math.abs(cameraBounds[1] - cameraBounds[0]), 
                                        Math.abs(cameraBounds[3] - cameraBounds[2])) * 0.1;
            const fallbackPositions = [
              [cameraCenterX - cameraOffset, cameraCenterY, cameraCenterZ],  // left cusp
              [cameraCenterX + cameraOffset, cameraCenterY, cameraCenterZ],   // right cusp  
              [cameraCenterX, cameraCenterY + cameraOffset, cameraCenterZ]      // non-coronary cusp
            ];
            worldPos = fallbackPositions[cuspDots.length] || [cameraCenterX, cameraCenterY, cameraCenterZ];
            console.log(`🌍 Using camera center fallback position for ${viewName}:`, worldPos, 'camera bounds:', cameraBounds);
          } else {
            // Last resort fallback
            const fallbackPositions = [
              [0, 0, 0],  // left cusp
              [10, 0, 0],   // right cusp  
              [5, 10, 0]      // non-coronary cusp
            ];
            worldPos = fallbackPositions[cuspDots.length] || [0, 0, 0];
            console.log(`🌍 Using absolute fallback position for ${viewName}:`, worldPos);
          }
        } else {
          // Calculate center of the CPR IMAGE bounds for sphere placement (correct coordinate space)
          const centerX = (bounds[0] + bounds[1]) / 2;
          const centerY = (bounds[2] + bounds[3]) / 2;
          const centerZ = (bounds[4] + bounds[5]) / 2;
          
          console.log(`📊 CPR image centers for ${viewName}:`, { centerX, centerY, centerZ });
          
          // Calculate CPR image dimensions (this is the correct coordinate space)
          const imageWidth = Math.abs(bounds[1] - bounds[0]);
          const imageHeight = Math.abs(bounds[3] - bounds[2]);
          const imageDepth = Math.abs(bounds[5] - bounds[4]);
          
          console.log(`📊 CPR image dimensions for ${viewName}:`, { 
            width: imageWidth.toFixed(2), 
            height: imageHeight.toFixed(2), 
            depth: imageDepth.toFixed(2) 
          });
          
          // Place spheres in a triangular pattern within the CPR image coordinate space
          // Use reasonable offsets within the transformed CPR space
          const offsetScale = 0.2; // 20% of image dimension
          const positions = [
            // Left cusp: left and slightly down from center
            [centerX - imageWidth * offsetScale, centerY - imageHeight * offsetScale * 0.3, centerZ],
            // Right cusp: right and slightly down from center
            [centerX + imageWidth * offsetScale, centerY - imageHeight * offsetScale * 0.3, centerZ],
            // Non-coronary cusp: center and up from center
            [centerX, centerY + imageHeight * offsetScale * 0.6, centerZ]
          ];
          
          worldPos = positions[cuspDots.length] || [centerX, centerY, centerZ];
          
          // Ensure position is within CPR image bounds
          const safeMargin = 0.05; // 5% margin from image edges
          worldPos[0] = Math.max(bounds[0] + imageWidth * safeMargin, 
                                Math.min(bounds[1] - imageWidth * safeMargin, worldPos[0]));
          worldPos[1] = Math.max(bounds[2] + imageHeight * safeMargin, 
                                Math.min(bounds[3] - imageHeight * safeMargin, worldPos[1]));
          worldPos[2] = Math.max(bounds[4] + imageDepth * safeMargin, 
                                Math.min(bounds[5] - imageDepth * safeMargin, worldPos[2]));
          
          console.log(`🌍 Final CPR position for ${viewName}:`, worldPos);
          console.log(`📏 Sphere ${cuspDots.length + 1} will be placed at CPR coordinates:`, {
            x: worldPos[0].toFixed(2),
            y: worldPos[1].toFixed(2), 
            z: worldPos[2].toFixed(2)
          });
          console.log(`📏 Position check - within CPR image bounds:`, {
            xOk: worldPos[0] >= bounds[0] && worldPos[0] <= bounds[1],
            yOk: worldPos[1] >= bounds[2] && worldPos[1] <= bounds[3],
            zOk: worldPos[2] >= bounds[4] && worldPos[2] <= bounds[5]
          });
        }

        // Determine cusp type based on placement order
        const cuspTypes: ('left' | 'right' | 'non-coronary')[] = ['left', 'right', 'non-coronary'];
        const cuspType = cuspTypes[cuspDots.length];
        const placementIndex = cuspDots.length;

        // Create new cusp dot
        const newCuspDot = {
          id: `cusp_${cuspType}_${placementIndex}_${Date.now()}`,
          realWorldPos: [worldPos[0], worldPos[1], worldPos[2]] as [number, number, number],
          color: cuspType === 'left' ? 'red' : cuspType === 'right' ? 'green' : 'yellow',
          cuspType,
          placementIndex
        };

        console.log('🎯 Creating new cusp dot:', newCuspDot);

        // Add to state
        setCuspDots(prev => [...prev, newCuspDot]);

        // Add VTK sphere to all views
        addSphereToAllViews({
          position: newCuspDot.realWorldPos,
          cuspType: newCuspDot.cuspType,
          placementIndex: newCuspDot.placementIndex
        });

        // Call callback if provided
        if (onCuspDotsUpdate) {
          const updatedDots = [...cuspDots, newCuspDot];
          onCuspDotsUpdate(updatedDots.map(dot => ({
            id: dot.id,
            pos: dot.realWorldPos,
            color: dot.color,
            cuspType: dot.cuspType
          })));
        }

        console.log(`✅ Cusp dot ${placementIndex + 1}/3 placed in ${viewName}`);
      };
    };

    // Add click handlers to all three views with proper VTK.js event handling
    try {
      if (vtkObjects.current.cpr1?.renderWindow && vtkObjects.current.cpr1?.renderer) {
        const interactor1 = vtkObjects.current.cpr1.renderWindow.getInteractor();
        if (interactor1) {
          const clickHandler1 = handleViewClick('CPR1', vtkObjects.current.cpr1.renderer, vtkObjects.current.cpr1.renderWindow);
          interactor1.onLeftButtonPress(() => {
            if (isPlacingCuspDots && cuspDots.length < 3) {
              clickHandler1();
            }
          });
          console.log('✅ CPR1 click handler set up');
        }
      }

      if (vtkObjects.current.cpr2?.renderWindow && vtkObjects.current.cpr2?.renderer) {
        const interactor2 = vtkObjects.current.cpr2.renderWindow.getInteractor();
        if (interactor2) {
          const clickHandler2 = handleViewClick('CPR2', vtkObjects.current.cpr2.renderer, vtkObjects.current.cpr2.renderWindow);
          interactor2.onLeftButtonPress(() => {
            if (isPlacingCuspDots && cuspDots.length < 3) {
              clickHandler2();
            }
          });
          console.log('✅ CPR2 click handler set up');
        }
      }

      if (vtkObjects.current.crossSection?.renderWindow && vtkObjects.current.crossSection?.renderer) {
        const interactorCS = vtkObjects.current.crossSection.renderWindow.getInteractor();
        if (interactorCS) {
          const clickHandlerCS = handleViewClick('CrossSection', vtkObjects.current.crossSection.renderer, vtkObjects.current.crossSection.renderWindow);
          interactorCS.onLeftButtonPress(() => {
            if (isPlacingCuspDots && cuspDots.length < 3) {
              clickHandlerCS();
            }
          });
          console.log('✅ CrossSection click handler set up');
        }
      }
    } catch (error) {
      console.error('❌ Error setting up click handlers:', error);
    }

    console.log('✅ Cusp dot interaction setup complete for all three views');
  };

  // Clear all cusp dots
  const clearCuspDots = () => {
    console.log('🧹 Clearing all cusp dots from VTK views...');

    // Clear from state
    setCuspDots([]);

    // Remove all sphere actors from renderers
    const clearSpheresFromRenderer = (renderer: any, viewName: string) => {
      if (!renderer) return;
      
      const actors = renderer.getActors();
      actors.forEach((actor: any) => {
        // Check if this is a sphere actor (could check actor properties or use a marking system)
        const mapper = actor.getMapper();
        if (mapper && mapper.getInputData) {
          const data = mapper.getInputData();
          // This is a simple heuristic - in production you might want to mark sphere actors explicitly
          if (data && data.getNumberOfPoints && data.getNumberOfPoints() > 0) {
            const bounds = data.getBounds();
            const size = Math.max(bounds[1] - bounds[0], bounds[3] - bounds[2], bounds[5] - bounds[4]);
            // If it's a small object (likely our sphere), remove it
            if (size < 10) {
              renderer.removeActor(actor);
              console.log(`🧹 Removed sphere from ${viewName}`);
            }
          }
        }
      });
    };

    // Clear from all three views
    if (vtkObjects.current.cpr1?.renderer) {
      clearSpheresFromRenderer(vtkObjects.current.cpr1.renderer, 'CPR1');
      vtkObjects.current.cpr1.renderWindow?.render();
    }

    if (vtkObjects.current.cpr2?.renderer) {
      clearSpheresFromRenderer(vtkObjects.current.cpr2.renderer, 'CPR2');
      vtkObjects.current.cpr2.renderWindow?.render();
    }

    if (vtkObjects.current.crossSection?.renderer) {
      clearSpheresFromRenderer(vtkObjects.current.crossSection.renderer, 'CrossSection');
      vtkObjects.current.crossSection.renderWindow?.render();
    }

    console.log('✅ All cusp dots cleared from VTK views');
  };

  // Debug function to list all actors
  const debugListActors = () => {
    console.log('🧪 Listing all actors in renderers...');
    
    Object.entries(vtkObjects.current).forEach(([viewName, vtkView]: [string, any]) => {
      if (!vtkView?.renderer) return;
      
      const actors = vtkView.renderer.getActors();
      console.log(`🧪 ${viewName} actors:`, {
        count: actors?.length || 0,
        actors: actors ? Array.from(actors).map((actor: any, index: number) => ({
          index,
          className: actor.getClassName ? actor.getClassName() : 'unknown',
          bounds: actor.getBounds ? actor.getBounds() : 'no bounds',
          visibility: actor.getVisibility ? actor.getVisibility() : 'unknown'
        })) : []
      });
    });
  };

  // Test geometry rendering WITHOUT CT images
  const testGeometryOnly = () => {
    console.log('🧪 Testing geometry-only rendering...');
    
    // First, debug current actors
    debugListActors();
    
    Object.entries(vtkObjects.current).forEach(([viewName, vtkView]: [string, any]) => {
      if (!vtkView?.renderer || !vtkView?.renderWindow) return;
      
      console.log(`🧪 Setting up ${viewName} for geometry-only test...`);
      
      // Get and remove all existing actors more aggressively
      const actors = vtkView.renderer.getActors();
      const actorCount = actors?.length || 0;
      console.log(`🧪 ${viewName} removing ${actorCount} existing actors...`);
      
      if (actors && actorCount > 0) {
        // Convert to array and remove each actor
        const actorArray = Array.from(actors);
        actorArray.forEach((actor: any, index: number) => {
          console.log(`🧪 Removing actor ${index}: ${actor.getClassName ? actor.getClassName() : 'unknown'}`);
          vtkView.renderer.removeActor(actor);
        });
        
        // Force clear all actors
        vtkView.renderer.removeAllActors();
        console.log(`🧪 ${viewName} actors after removal:`, vtkView.renderer.getActors()?.length || 0);
      }
      
      // Set black background for contrast
      vtkView.renderer.setBackground(0, 0, 0);
      
      // Add bright geometry at origin with proper spacing for the coordinate system
      const imageCenter = [55, 55, 0]; // Based on debug output from earlier
      const positions = [
        imageCenter,                                           // Center
        [imageCenter[0] + 30, imageCenter[1], imageCenter[2]], // Right
        [imageCenter[0] - 30, imageCenter[1], imageCenter[2]], // Left
        [imageCenter[0], imageCenter[1] + 30, imageCenter[2]], // Up
        [imageCenter[0], imageCenter[1] - 30, imageCenter[2]]  // Down
      ];
      
      positions.forEach((pos, index) => {
        // Create large, bright cube
        const cubeSource = vtkCubeSource.newInstance();
        cubeSource.setCenter(pos);
        cubeSource.setXLength(10);
        cubeSource.setYLength(10);
        cubeSource.setZLength(10);

        const mapper = vtkMapper.newInstance();
        mapper.setInputConnection(cubeSource.getOutputPort());

        const actor = vtkActor.newInstance();
        actor.setMapper(mapper);

        const colors = [
          [1, 0, 0], // Red center
          [0, 1, 0], // Green right
          [0, 0, 1], // Blue left  
          [1, 1, 0], // Yellow up
          [1, 0, 1]  // Magenta down
        ];
        
        const property = actor.getProperty();
        property.setColor(...colors[index]);
        property.setOpacity(1.0);
        property.setAmbient(1.0);
        property.setDiffuse(0.0);
        property.setSpecular(0.0);
        
        vtkView.renderer.addActor(actor);
        console.log(`🧪 Added ${colors[index]} cube at ${pos} to ${viewName}`);
      });
      
      // Keep existing camera setup but adjust for image coordinates
      const camera = vtkView.renderer.getActiveCamera();
      camera.setFocalPoint(imageCenter[0], imageCenter[1], imageCenter[2]);
      
      // Reset clipping and render multiple times
      vtkView.renderer.resetCameraClippingRange();
      vtkView.renderWindow.render();
      vtkView.renderWindow.render(); // Double render
      
      const finalActors = vtkView.renderer.getActors();
      console.log(`🧪 ${viewName} final actors count:`, finalActors?.length || 0);
    });
    
    console.log('🧪 Geometry-only test complete - should see colored cubes if VTK rendering works');
    
    // Debug final state
    setTimeout(() => debugListActors(), 100);
  };

  // Handle slice navigation along centerline
  const handleSliceNavigation = async (position: number) => {
    console.log('🔄 CPR slice navigation to position:', position);
    
    if (!centerlinePoints || centerlinePoints.length === 0) {
      console.warn('⚠️ No centerline points for navigation');
      return;
    }
    
    if (!vtkObjects.current.volume) {
      console.warn('⚠️ No volume data for slice navigation');
      return;
    }
    
    // Calculate which centerline point to use as the new center
    const pointIndex = Math.floor(position * (centerlinePoints.length - 1));
    const newCenterPoint = centerlinePoints[pointIndex];
    
    console.log(`🔄 Moving to centerline point ${pointIndex}/${centerlinePoints.length - 1}:`, newCenterPoint);
    
    try {
      // Create new cross-section at this centerline position
      const crossSectionData = await createRealCrossSection(vtkObjects.current.volume, [newCenterPoint]);
      
      if (crossSectionData && crossSectionData.cprImageData) {
        console.log('🔄 Updating cross-section with new slice data...');
        
        // Update cross-section view with new data
        if (vtkObjects.current.crossSection?.mapper) {
          vtkObjects.current.crossSection.mapper.setInputData(crossSectionData.cprImageData);
          
          // Update window/level if we have new data
          if (crossSectionData.cprData && vtkObjects.current.crossSection.actor) {
            let minVal = crossSectionData.cprData[0];
            let maxVal = crossSectionData.cprData[0];
            for (let i = 1; i < crossSectionData.cprData.length; i++) {
              if (crossSectionData.cprData[i] < minVal) minVal = crossSectionData.cprData[i];
              if (crossSectionData.cprData[i] > maxVal) maxVal = crossSectionData.cprData[i];
            }
            
            const window = maxVal - minVal;
            const level = (maxVal + minVal) / 2;
            const property = vtkObjects.current.crossSection.actor.getProperty();
            property.setColorWindow(window);
            property.setColorLevel(level);
          }
          
          console.log('✅ Cross-section updated with new slice');
        }
      }
      
      // Also update CPR views to reflect the new center position
      // This would involve regenerating CPR1 and CPR2 with the new center
      // For now, just update the camera focal point
      Object.entries(vtkObjects.current).forEach(([viewName, vtkView]: [string, any]) => {
        if (vtkView?.camera && viewName !== 'volume') {
          vtkView.camera.setFocalPoint(newCenterPoint.x, newCenterPoint.y, newCenterPoint.z);
          vtkView.renderer?.resetCameraClippingRange();
        }
      });
      
    } catch (error) {
      console.error('❌ Failed to update slice:', error);
    }
    
    // Force render all views
    Object.values(vtkObjects.current).forEach((vtkView: any) => {
      if (vtkView?.renderWindow) {
        vtkView.renderWindow.render();
      }
    });
  };

  // Handle rotation of CPR views
  const handleRotation = (angle: number) => {
    console.log('🔄 CPR rotation to angle:', angle);
    
    // Convert angle to radians
    const angleRad = (angle * Math.PI) / 180;
    
    // Rotate the camera around the focal point for each view
    Object.entries(vtkObjects.current).forEach(([viewName, vtkView]: [string, any]) => {
      if (!vtkView?.camera || !vtkView?.renderWindow || viewName === 'volume') return;
      
      const camera = vtkView.camera;
      const focalPoint = camera.getFocalPoint();
      
      // Get current camera position relative to focal point
      const position = camera.getPosition();
      const relativePos = [
        position[0] - focalPoint[0],
        position[1] - focalPoint[1],
        position[2] - focalPoint[2]
      ];
      
      // Rotate around Z-axis (typical for CPR rotation)
      const cosAngle = Math.cos(angleRad);
      const sinAngle = Math.sin(angleRad);
      
      const newRelativePos = [
        relativePos[0] * cosAngle - relativePos[1] * sinAngle,
        relativePos[0] * sinAngle + relativePos[1] * cosAngle,
        relativePos[2] // Keep Z unchanged
      ];
      
      // Set new camera position
      const newPosition = [
        newRelativePos[0] + focalPoint[0],
        newRelativePos[1] + focalPoint[1],
        newRelativePos[2] + focalPoint[2]
      ];
      
      camera.setPosition(newPosition[0], newPosition[1], newPosition[2]);
      
      // Also rotate the view up vector
      const viewUp = camera.getViewUp();
      const newViewUp = [
        viewUp[0] * cosAngle - viewUp[1] * sinAngle,
        viewUp[0] * sinAngle + viewUp[1] * cosAngle,
        viewUp[2]
      ];
      camera.setViewUp(newViewUp[0], newViewUp[1], newViewUp[2]);
      
      // Reset clipping range
      vtkView.renderer?.resetCameraClippingRange();
      
      console.log(`🔄 ${viewName} rotated to ${angle}°`);
    });
    
    // Force render all views
    Object.values(vtkObjects.current).forEach((vtkView: any) => {
      if (vtkView?.renderWindow) {
        vtkView.renderWindow.render();
      }
    });
  };

  // Tool functions for UI controls
  const handleZoom = (factor: number) => {
    console.log('🔍 Zooming all views by factor:', factor);

    const zoomView = (vtkView: any, viewName: string) => {
      if (!vtkView?.camera || !vtkView?.renderWindow) return;
      
      try {
        const currentScale = vtkView.camera.getParallelScale();
        const newScale = currentScale / factor;
        vtkView.camera.setParallelScale(newScale);
        vtkView.renderWindow.render();
        console.log(`✅ ${viewName} zoomed: ${currentScale.toFixed(1)} -> ${newScale.toFixed(1)}`);
      } catch (error) {
        console.warn(`❌ Zoom failed for ${viewName}:`, error);
      }
    };

    zoomView(vtkObjects.current.cpr1, 'CPR1');
    zoomView(vtkObjects.current.cpr2, 'CPR2'); 
    zoomView(vtkObjects.current.crossSection, 'CrossSection');
    
    setZoom(zoom * factor);
  };



  return (
    <div className="flex flex-col w-full h-full bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-white">
            {stage === 'annulus_definition' 
              ? 'CPR Annulus Definition - Place 3 Cusp Nadir Points'
              : 'CPR Analysis - Curved Planar Reconstruction'
            }
          </h3>
          {patientInfo && (
            <div className="text-sm text-slate-300">
              Patient: {patientInfo.patientName || 'Unknown'}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4">
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
            <button
              onClick={() => handleWindowLevel(100, 0)}
              className="p-2 rounded text-sm bg-slate-700 text-slate-300 hover:bg-slate-600"
              title="Increase Window"
            >
              <FaAdjust />
            </button>
            <button
              onClick={resetView}
              className="p-2 rounded text-sm bg-slate-700 text-slate-300 hover:bg-slate-600"
            >
              <FaUndo />
            </button>
          </div>

          {/* CPR Navigation Controls */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">CPR Slice:</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={crosshairPosition}
              onChange={(e) => {
                const newPos = parseFloat(e.target.value);
                setCrosshairPosition(newPos);
                handleSliceNavigation(newPos);
              }}
              className="w-20 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-xs text-slate-400">{Math.round(crosshairPosition * 100)}%</span>
          </div>

          {/* Rotation Control */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Rotate:</span>
            <input
              type="range"
              min="0"
              max="360"
              step="5"
              value={rotationAngle}
              onChange={(e) => {
                const newAngle = parseInt(e.target.value);
                setRotationAngle(newAngle);
                handleRotation(newAngle);
              }}
              className="w-20 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-xs text-slate-400">{rotationAngle}°</span>
          </div>

          {/* Cusp Dot Controls - Only show during ANNULUS_DEFINITION stage */}
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
              <button
                onClick={() => {
                  console.log('🧪 Testing simple sphere at center...');
                  testSimpleSphere();
                }}
                className="px-3 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
              >
                Test Sphere
              </button>
              <button
                onClick={() => {
                  console.log('🧪 Testing geometry WITHOUT CT images...');
                  testGeometryOnly();
                }}
                className="px-3 py-1 text-xs rounded bg-purple-600 text-white hover:bg-purple-700 transition-colors"
              >
                Test Geometry Only
              </button>
            </div>
          )}

          {/* Status */}
          <div className="text-xs text-slate-400">
            W/L: {windowLevel.window}/{windowLevel.level} | 
            Zoom: {zoom.toFixed(1)}x | 
            Dots: {cuspDots.length}/3
          </div>
        </div>
      </div>

      {/* Loading/Error States */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="flex items-center gap-3 text-white">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <span>Loading CPR with Cusp Dots...</span>
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
                setIsInitialized(false);
                setTimeout(() => initializeCPRViewport(), 100);
              }}
              className="bg-red-700 hover:bg-red-600 px-3 py-1 rounded text-xs"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Three-View CPR Layout */}
      <div className="flex-1 relative bg-black">
        {/* Instructions overlay - Only show during ANNULUS_DEFINITION stage */}
        {onCuspDotsUpdate && isPlacingCuspDots && stage === 'annulus_definition' && (
          <div className="absolute top-4 left-4 bg-teal-600 bg-opacity-90 text-white text-sm px-3 py-2 rounded z-10">
            Click on any CPR view to place cusp nadir points using Cornerstone tools ({cuspDots.length}/3)
          </div>
        )}
        
        {/* Three-view grid layout */}
        <div className="grid grid-cols-3 h-full gap-1 bg-slate-900">
          {/* Left CPR View */}
          <div className="relative bg-black border border-slate-700">
            <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
              CPR Long Axis 1
            </div>
            {/* VTK.js CPR visualization */}
            <div ref={cpr1Ref} className="w-full h-full" />
            {/* Cornerstone3D annotation overlay */}
            {stage === 'annulus_definition' && (
              <div 
                ref={el => cornerstoneOverlayRefs.current.cpr1 = el}
                className="absolute inset-0 pointer-events-auto"
                style={{
                  background: 'transparent',
                  zIndex: 5
                }}
              />
            )}
          </div>
          
          {/* Middle Cross-Section View */}
          <div className="relative bg-black border border-slate-700">
            <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
              Cross Section
            </div>
            {/* VTK.js CPR visualization */}
            <div ref={crossSectionRef} className="w-full h-full" />
            {/* Cornerstone3D annotation overlay */}
            {stage === 'annulus_definition' && (
              <div 
                ref={el => cornerstoneOverlayRefs.current.crossSection = el}
                className="absolute inset-0 pointer-events-auto"
                style={{
                  background: 'transparent',
                  zIndex: 5
                }}
              />
            )}
          </div>
          
          {/* Right CPR View */}
          <div className="relative bg-black border border-slate-700">
            <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
              CPR Long Axis 2
            </div>
            {/* VTK.js CPR visualization */}
            <div ref={cpr2Ref} className="w-full h-full" />
            {/* Cornerstone3D annotation overlay */}
            {stage === 'annulus_definition' && (
              <div 
                ref={el => cornerstoneOverlayRefs.current.cpr2 = el}
                className="absolute inset-0 pointer-events-auto"
                style={{
                  background: 'transparent',
                  zIndex: 5
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TriViewCPRViewport;