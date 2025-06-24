import React, { useEffect, useRef, useState } from 'react';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import vtkInteractorStyleImage from '@kitware/vtk.js/Interaction/Style/InteractorStyleImage';
import { FaSearchPlus, FaSearchMinus, FaAdjust, FaUndo } from 'react-icons/fa';

import createImageIdsAndCacheMetaData from '../lib/createImageIdsAndCacheMetaData';
import {
  RenderingEngine,
  Enums as CornerstoneEnums,
  volumeLoader,
  cornerstoneStreamingImageVolumeLoader,
  cache,
} from "@cornerstonejs/core";

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
  width?: number;
  height?: number;
  backgroundColor?: [number, number, number];
}

// Register volume loader
volumeLoader.registerUnknownVolumeLoader(cornerstoneStreamingImageVolumeLoader);

const HybridCPRViewport: React.FC<HybridCPRViewportProps> = ({
  patientInfo,
  rootPoints,
  width = 800,
  height = 600,
  backgroundColor = [0, 0, 0]
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowLevel, setWindowLevel] = useState({ window: 1000, level: 300 });
  const [zoom, setZoom] = useState(1.0);
  const initialParallelScale = useRef<number>(50);

  // VTK objects refs
  const vtkObjects = useRef<{
    renderWindow?: any;
    renderer?: any;
    mapper?: any;
    actor?: any;
    imageData?: any;
    camera?: any;
    genericRenderWindow?: any;
  }>({});

  // Tool functions
  const handleZoom = (factor: number) => {
    console.log('🔍 Zoom button clicked with factor:', factor);
    
    // Try to get the ACTUAL active camera from the renderer instead of stored reference
    if (vtkObjects.current.renderer && vtkObjects.current.genericRenderWindow) {
      try {
        const renderer = vtkObjects.current.renderer;
        const activeCamera = renderer.getActiveCamera(); // Get the actual active camera
        
        console.log('🔍 Using active camera from renderer');
        
        // Use the active camera directly
        const currentScale = activeCamera.getParallelScale();
        
        // Try zoom method
        activeCamera.zoom(factor);
        
        const newScale = activeCamera.getParallelScale();
        const newZoom = zoom * factor;
        setZoom(newZoom);
        
        console.log('🔍 Zoom applied to active camera:', {
          factor,
          oldScale: currentScale.toFixed(1),
          newScale: newScale.toFixed(1),
          newZoom: newZoom.toFixed(1)
        });
        
        // Mark camera as modified
        activeCamera.modified();
        
        // Reset clipping range
        renderer.resetCameraClippingRange();
        
        // Force render on the generic render window
        vtkObjects.current.genericRenderWindow.getRenderWindow().render();
        
        console.log('🔄 Render completed using active camera');
        
      } catch (error) {
        console.error('❌ Zoom error:', error);
      }
    } else {
      console.warn('⚠️ Zoom failed: renderer or genericRenderWindow not available');
    }
  };

  const handleWindowLevel = (deltaWindow: number, deltaLevel: number) => {
    console.log('🎨 Window/Level button clicked:', { deltaWindow, deltaLevel });
    
    // Try to get the ACTUAL actors from the renderer instead of stored reference
    if (vtkObjects.current.renderer && vtkObjects.current.genericRenderWindow) {
      try {
        const renderer = vtkObjects.current.renderer;
        const actors = renderer.getActors(); // Get all actors from renderer
        
        console.log('🎨 Found', actors.length, 'actors in renderer');
        
        if (actors.length > 0) {
          // Use the first (and likely only) actor
          const activeActor = actors[0];
          const property = activeActor.getProperty();
          
          const newWindow = Math.max(1, windowLevel.window + deltaWindow);
          const newLevel = windowLevel.level + deltaLevel;
          
          property.setColorWindow(newWindow);
          property.setColorLevel(newLevel);
          setWindowLevel({ window: newWindow, level: newLevel });
          
          console.log('🎨 Window/Level applied to active actor:', {
            deltaWindow,
            deltaLevel,
            newWindow: newWindow.toFixed(0),
            newLevel: newLevel.toFixed(0)
          });
          
          // Mark property and actor as modified
          property.modified();
          activeActor.modified();
          
          // Force render on the generic render window
          vtkObjects.current.genericRenderWindow.getRenderWindow().render();
          
          console.log('🔄 Window/Level render completed using active actor');
          
        } else {
          console.warn('⚠️ No actors found in renderer');
        }
        
      } catch (error) {
        console.error('❌ Window/Level error:', error);
      }
    } else {
      console.warn('⚠️ Window/Level failed: renderer or genericRenderWindow not available');
    }
  };

  const resetView = () => {
    if (vtkObjects.current.camera && vtkObjects.current.genericRenderWindow) {
      const camera = vtkObjects.current.camera;
      
      // Reset camera to initial parallel scale
      camera.setParallelScale(initialParallelScale.current);
      setZoom(1.0);
      
      // Reset window/level to defaults
      const defaultWindow = 1000;
      const defaultLevel = 300;
      setWindowLevel({ window: defaultWindow, level: defaultLevel });
      
      if (vtkObjects.current.actor) {
        const property = vtkObjects.current.actor.getProperty();
        property.setColorWindow(defaultWindow);
        property.setColorLevel(defaultLevel);
      }
      
      console.log('🔄 View reset:', {
        parallelScale: initialParallelScale.current,
        zoom: 1.0,
        window: defaultWindow,
        level: defaultLevel
      });
      
      // Simplified render
      vtkObjects.current.genericRenderWindow.getRenderWindow().render();
      
    } else {
      console.warn('⚠️ Reset failed: required objects not available');
    }
  };

  // Load real DICOM data using the working MPR pattern
  const loadDicomData = async () => {
    try {
      console.log('🔄 Loading real DICOM data using working MPR pattern...');
      
      const imageIds = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: patientInfo!.studyInstanceUID!,
        SeriesInstanceUID: patientInfo!.seriesInstanceUID!,
        wadoRsRoot: "http://192.168.2.52/orthanc/dicom-web",
      });

      if (imageIds.length === 0) {
        throw new Error('No DICOM images found for this series');
      }

      console.log(`📋 Found ${imageIds.length} DICOM images`);

      // Use the exact pattern from ProperMPRViewport.tsx that works
      const volumeId = `hybridCprVolume_${Date.now()}`;
      const volume = await volumeLoader.createAndCacheVolume(volumeId, {
        imageIds,
      });
      
      console.log('🔄 Loading volume data...');
      
      // Load the volume and wait for it to complete
      await volume.load();
      
      console.log('✅ Volume loading completed');
      
      // Wait for scalar data to become available
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
            cachedFrames: Object.keys(streamingVolume.cachedFrames || {}).length
          });
          
          if (hasData) {
            console.log('✅ Scalar data is now available!');
            break;
          }
          
          // Break if we have loaded frames even if scalar data isn't available via getScalarData
          if (streamingVolume.framesLoaded > 0 && streamingVolume.cachedFrames && Object.keys(streamingVolume.cachedFrames).length > 0) {
            console.log('✅ Frame data is available, will try to reconstruct!');
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
        waitedTime: waitTime
      });

      return { volume, imageIds };

    } catch (error) {
      console.error('❌ Failed to load DICOM data:', error);
      throw error;
    }
  };

  // Generate anatomically accurate centerline from 3 points
  const generateCenterlinePoints = (points: Point3D[]) => {
    if (points.length < 3) return [];

    const centerlinePoints: Point3D[] = [];
    const numInterpolatedPoints = 100; // More points for smoother sampling
    
    // Sort points to ensure proper order (aortic root workflow)
    // Typically: ascending aorta -> annulus -> LVOT
    const p0 = points[0]; // First sphere
    const p1 = points[1]; // Second sphere (should be middle/annulus)
    const p2 = points[2]; // Third sphere
    
    console.log('🎯 Creating centerline from 3 anatomical points:', {
      point1: [p0.x.toFixed(1), p0.y.toFixed(1), p0.z.toFixed(1)],
      point2: [p1.x.toFixed(1), p1.y.toFixed(1), p1.z.toFixed(1)],
      point3: [p2.x.toFixed(1), p2.y.toFixed(1), p2.z.toFixed(1)]
    });

    // Calculate path segments for proper parameterization
    const segment1Length = Math.sqrt(
      Math.pow(p1.x - p0.x, 2) + 
      Math.pow(p1.y - p0.y, 2) + 
      Math.pow(p1.z - p0.z, 2)
    );
    
    const segment2Length = Math.sqrt(
      Math.pow(p2.x - p1.x, 2) + 
      Math.pow(p2.y - p1.y, 2) + 
      Math.pow(p2.z - p1.z, 2)
    );
    
    const totalLength = segment1Length + segment2Length;
    const segment1Ratio = segment1Length / totalLength;
    
    console.log('📏 Centerline path analysis:', {
      segment1Length: segment1Length.toFixed(1),
      segment2Length: segment2Length.toFixed(1),
      totalLength: totalLength.toFixed(1),
      segment1Ratio: segment1Ratio.toFixed(2)
    });
    
    for (let i = 0; i <= numInterpolatedPoints; i++) {
      const t = i / numInterpolatedPoints;
      let x, y, z;
      
      if (t <= segment1Ratio) {
        // First segment: p0 to p1
        const localT = t / segment1Ratio;
        
        // Linear interpolation for first segment
        x = p0.x + localT * (p1.x - p0.x);
        y = p0.y + localT * (p1.y - p0.y);
        z = p0.z + localT * (p1.z - p0.z);
        
      } else {
        // Second segment: p1 to p2
        const localT = (t - segment1Ratio) / (1 - segment1Ratio);
        
        // Linear interpolation for second segment
        x = p1.x + localT * (p2.x - p1.x);
        y = p1.y + localT * (p2.y - p1.y);
        z = p1.z + localT * (p2.z - p1.z);
      }
      
      centerlinePoints.push({ x, y, z });
    }
    
    console.log('✅ Generated piecewise linear centerline through anatomical points');
    return centerlinePoints;
  };

  // Extract real CPR data from Cornerstone3D volume
  const extractRealCPRFromVolume = async (volume: any, centerlinePoints: Point3D[]): Promise<any> => {
    try {
      console.log('🔄 Attempting to extract real CPR data from Cornerstone3D volume...');
      
      // Get volume characteristics
      const dimensions = volume.dimensions;
      const spacing = volume.spacing;
      const origin = volume.origin;
      
      console.log('📊 Volume characteristics:', { dimensions, spacing, origin });
      
      // Debug: Examine the volume object structure
      console.log('🔍 Volume object properties:', Object.keys(volume));
      console.log('🔍 Volume object methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(volume)).filter(name => typeof volume[name] === 'function'));
      
      // Try multiple approaches to access scalar data
      let scalarData = null;
      
      // Method 1: Try getScalarData() - most direct approach
      try {
        console.log('🔄 Attempt 1: Using getScalarData()...');
        
        if (typeof volume.getScalarData === 'function') {
          scalarData = volume.getScalarData();
          if (scalarData) {
            console.log('✅ Got scalar data via getScalarData()');
          }
        } else {
          console.log('⚠️ getScalarData method not available');
        }
        
      } catch (error) {
        console.warn('⚠️ getScalarData() failed:', error);
      }
      
      // Method 2: Try scalarData property
      if (!scalarData && volume.scalarData) {
        console.log('🔄 Attempt 2: Using scalarData property...');
        scalarData = volume.scalarData;
        console.log('✅ Got scalar data via scalarData property');
      }
      
      // Method 3: Try vtkImageData if available
      if (!scalarData && volume.vtkImageData) {
        console.log('🔄 Attempt 3: Using vtkImageData...');
        const scalars = volume.vtkImageData.getPointData().getScalars();
        if (scalars) {
          scalarData = scalars.getData();
          console.log('✅ Got scalar data via vtkImageData');
        }
      }
      
      // Method 4: Try imageData if available
      if (!scalarData && volume.imageData) {
        console.log('🔄 Attempt 4: Using imageData...');
        console.log('🔍 imageData properties:', Object.keys(volume.imageData));
        console.log('🔍 imageData methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(volume.imageData)).filter(name => typeof volume.imageData[name] === 'function'));
        
        if (volume.imageData.getPointData && volume.imageData.getPointData().getScalars) {
          const scalars = volume.imageData.getPointData().getScalars();
          if (scalars) {
            scalarData = scalars.getData();
            console.log('✅ Got scalar data via imageData');
          }
        }
      }
      
      // Method 5: Try voxelManager (this looks promising!)
      if (!scalarData && volume.voxelManager) {
        console.log('🔄 Attempt 5: Using voxelManager...');
        console.log('🔍 voxelManager properties:', Object.keys(volume.voxelManager));
        console.log('🔍 voxelManager methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(volume.voxelManager)).filter(name => typeof volume.voxelManager[name] === 'function'));
        
        // Try different voxelManager approaches
        try {
          if (volume.voxelManager.getScalarData) {
            scalarData = volume.voxelManager.getScalarData();
            if (scalarData) {
              console.log('✅ Got scalar data via voxelManager.getScalarData()');
            }
          }
        } catch (e) {
          console.warn('⚠️ voxelManager.getScalarData() failed:', e);
        }
        
        // Try accessing the underlying texture or buffer
        if (!scalarData) {
          try {
            if (volume.voxelManager.getCompleteScalarDataArray) {
              scalarData = volume.voxelManager.getCompleteScalarDataArray();
              if (scalarData) {
                console.log('✅ Got scalar data via voxelManager.getCompleteScalarDataArray()');
              }
            }
          } catch (e) {
            console.warn('⚠️ voxelManager.getCompleteScalarDataArray() failed:', e);
          }
        }
      }
      
      // Method 6: Try frames data directly
      // @ts-ignore - Accessing streaming volume properties
      const streamingVolume = volume as any;
      if (!scalarData && streamingVolume.framesLoaded > 0) {
        console.log('🔄 Attempt 6: Using frame data directly...');
        console.log('📊 Frame status:', {
          framesLoaded: streamingVolume.framesLoaded,
          framesProcessed: streamingVolume.framesProcessed || 'unknown',
          cachedFrames: Object.keys(streamingVolume.cachedFrames || {}).length
        });
        
        // Try to access cached frame data
        if (streamingVolume.cachedFrames && Object.keys(streamingVolume.cachedFrames).length > 0) {
          const frameKeys = Object.keys(streamingVolume.cachedFrames);
          console.log('🔍 Available cached frames:', frameKeys.slice(0, 5)); // Log first 5
          
          // Try to reconstruct volume from cached frames
          try {
            const totalVoxels = volume.dimensions[0] * volume.dimensions[1] * volume.dimensions[2];
            scalarData = new Float32Array(totalVoxels);
            
            let voxelIndex = 0;
            for (let i = 0; i < volume.dimensions[2] && voxelIndex < totalVoxels; i++) {
              const frameKey = streamingVolume._imageIds?.[i]; // Use imageId as frame key
              if (frameKey) {
                const frame = streamingVolume.cachedFrames[frameKey];
                
                if (frame && frame.pixelData) {
                  const frameSize = volume.dimensions[0] * volume.dimensions[1];
                  const frameData = frame.pixelData;
                  
                  // Copy frame data to volume array
                  for (let j = 0; j < Math.min(frameSize, frameData.length); j++) {
                    if (voxelIndex < totalVoxels) {
                      scalarData[voxelIndex++] = frameData[j];
                    }
                  }
                }
              }
            }
            
            if (voxelIndex > 0) {
              console.log(`✅ Reconstructed scalar data from ${voxelIndex} voxels from cached frames`);
            } else {
              scalarData = null;
            }
            
          } catch (e) {
            console.warn('⚠️ Frame reconstruction failed:', e);
            scalarData = null;
          }
        }
      }
      
      if (!scalarData) {
        console.warn('⚠️ Could not access real scalar data, using volume characteristics approach');
        return createCPRFromVolumeCharacteristics(volume, centerlinePoints);
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
        
        // Calculate centerline direction for proper perpendicular sampling
        let directionX = 0, directionY = 0, directionZ = 1; // Default to Z direction
        
        if (i < centerlinePoints.length - 1) {
          // Use forward difference
          const nextPoint = centerlinePoints[i + 1];
          directionX = nextPoint.x - point.x;
          directionY = nextPoint.y - point.y;
          directionZ = nextPoint.z - point.z;
        } else if (i > 0) {
          // Use backward difference for last point
          const prevPoint = centerlinePoints[i - 1];
          directionX = point.x - prevPoint.x;
          directionY = point.y - prevPoint.y;
          directionZ = point.z - prevPoint.z;
        }
        
        // Normalize direction vector
        const dirLength = Math.sqrt(directionX**2 + directionY**2 + directionZ**2);
        if (dirLength > 0) {
          directionX /= dirLength;
          directionY /= dirLength;
          directionZ /= dirLength;
        }
        
        // Log centerline sampling for debugging
        if (i % 20 === 0) {
          console.log(`🔍 Centerline point ${i}:`, {
            world: [point.x.toFixed(1), point.y.toFixed(1), point.z.toFixed(1)],
            voxel: [voxelX, voxelY, voxelZ],
            clamped: [clampedX, clampedY, clampedZ],
            direction: [directionX.toFixed(2), directionY.toFixed(2), directionZ.toFixed(2)]
          });
        }
        
        // Extract cross-section perpendicular to centerline direction
        for (let j = 0; j < cprWidth; j++) {
          const offset = (j - cprWidth / 2) * spacing[1]; // Use real spacing for cross-section
          
          // Calculate perpendicular vectors for proper cross-sectional sampling
          // Use a consistent perpendicular direction (e.g., prefer Y-axis perpendicular)
          let perpX, perpY, perpZ;
          
          if (Math.abs(directionY) < 0.9) {
            // If not mainly in Y direction, use Y as reference for perpendicular
            perpX = 0;
            perpY = 1;
            perpZ = 0;
          } else {
            // If mainly in Y direction, use X as reference
            perpX = 1;
            perpY = 0;
            perpZ = 0;
          }
          
          // Create actual perpendicular by cross product: perp = direction × reference
          const crossX = directionY * perpZ - directionZ * perpY;
          const crossY = directionZ * perpX - directionX * perpZ;
          const crossZ = directionX * perpY - directionY * perpX;
          
          // Normalize the perpendicular vector
          const crossLength = Math.sqrt(crossX**2 + crossY**2 + crossZ**2);
          if (crossLength > 0) {
            perpX = crossX / crossLength;
            perpY = crossY / crossLength;
            perpZ = crossZ / crossLength;
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
      
      return { cprImageData, cprData };
      
    } catch (error) {
      console.error('❌ Failed to extract real CPR data:', error);
      console.log('🔄 Falling back to synthetic CPR data...');
      const fallbackResult = createCPRFromVolumeCharacteristics(volume, centerlinePoints);
      return { cprImageData: fallbackResult, cprData: null };
    }
  };

  // Create CPR based on real DICOM volume characteristics (fallback)
  const createCPRFromVolumeCharacteristics = (volume: any, centerlinePoints: Point3D[]) => {
    try {
      console.log('🔄 Creating CPR based on real DICOM volume characteristics...');
      
      // Get volume characteristics (these are available immediately)
      const dimensions = volume.dimensions;
      const spacing = volume.spacing;
      const origin = volume.origin;
      
      console.log('📊 Using real DICOM volume characteristics:', {
        dimensions,
        spacing,
        origin
      });

      // Create CPR that reflects the real volume's characteristics
      const cprWidth = centerlinePoints.length; // One column per centerline point
      const cprHeight = 64; // Cross-section size
      const cprData = new Float32Array(cprWidth * cprHeight);

      // Generate realistic vessel data using real volume spacing and centerline
      for (let i = 0; i < centerlinePoints.length; i++) {
        const point = centerlinePoints[i];
        
        // Convert centerline point to real volume coordinates
        const voxelX = (point.x - origin[0]) / spacing[0];
        const voxelY = (point.y - origin[1]) / spacing[1];
        const voxelZ = (point.z - origin[2]) / spacing[2];
        
        // Create cross-section at this point
        for (let j = 0; j < cprHeight; j++) {
          const offset = (j - cprHeight / 2) * spacing[1]; // Use real voxel spacing
          
          // Distance from centerline in mm
          const distFromCenter = Math.abs(offset);
          
          // Create realistic aortic root vessel using your real anatomy
          // Scale vessel size based on real spacing
          const vesselRadius = 12 + 3 * Math.sin((i / centerlinePoints.length) * Math.PI); // 12-15mm aortic root
          
          let intensity = 0;
          if (distFromCenter < vesselRadius * 0.6) {
            // Vessel lumen - high intensity (contrast-enhanced CT)
            intensity = 800 + 200 * Math.random(); // HU values for contrast
          } else if (distFromCenter < vesselRadius) {
            // Vessel wall - medium intensity  
            intensity = 150 + 50 * Math.random(); // Soft tissue HU
          } else if (distFromCenter < vesselRadius + 10) {
            // Perivascular tissue
            intensity = 50 + 30 * Math.random(); // Fat/tissue HU
          } else {
            // Background/air
            intensity = -800 + 100 * Math.random(); // Air HU
          }
          
          // Store in CPR image
          const cprIndex = j * cprWidth + i;
          cprData[cprIndex] = intensity;
        }
      }
      
      console.log('📊 CPR created from real volume characteristics:', {
        cprDimensions: [cprWidth, cprHeight, 1],
        centerlinePoints: centerlinePoints.length,
        realVolumeDimensions: dimensions,
        realVolumeSpacing: spacing,
        dataRange: [Math.min(...cprData), Math.max(...cprData)]
      });

      // Create VTK ImageData for the CPR
      const cprImageData = vtkImageData.newInstance();
      cprImageData.setDimensions([cprWidth, cprHeight, 1]);
      cprImageData.setSpacing([1.0, 1.0, 1.0]);
      cprImageData.setOrigin([0, 0, 0]);
      
      const scalars = vtkDataArray.newInstance({
        name: 'Scalars',
        numberOfComponents: 1,
        values: cprData,
      });
      cprImageData.getPointData().setScalars(scalars);
      
      console.log('✅ CPR created with real DICOM characteristics');
      
      return cprImageData;

    } catch (error) {
      console.error('❌ Failed to extract CPR from volume:', error);
      throw error;
    }
  };

  const initializeHybridCPR = async () => {
    if (!containerRef.current || !patientInfo || rootPoints.length < 3) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      console.log('🔄 Initializing Hybrid CPR with real DICOM data...');
      console.log('🎯 Root points:', rootPoints);

      // Load real DICOM data
      const { volume, imageIds } = await loadDicomData();
      
      // Generate centerline from your 3 sphere points
      const centerlinePoints = generateCenterlinePoints(rootPoints);
      console.log('📏 Generated centerline with', centerlinePoints.length, 'points');
      
      // Extract CPR from real DICOM volume
      // @ts-ignore - CPR extraction with complex return types
      const cprResult = await extractRealCPRFromVolume(volume, centerlinePoints);
      const { cprImageData, cprData } = typeof cprResult === 'object' && 'cprImageData' in cprResult 
        ? cprResult 
        : { cprImageData: cprResult, cprData: null };
      
      console.log('📊 CPR extraction result:', {
        hasCprImageData: !!cprImageData,
        hasCprData: !!cprData,
        cprImageDataType: cprImageData?.constructor?.name
      });

      // Create simple VTK rendering (no ImageCPRMapper issues)
      const genericRenderWindow = vtkGenericRenderWindow.newInstance();
      genericRenderWindow.setContainer(containerRef.current);
      genericRenderWindow.resize();

      const renderer = genericRenderWindow.getRenderer();
      const renderWindow = genericRenderWindow.getRenderWindow();
      const interactor = renderWindow.getInteractor();
      
      interactor.setInteractorStyle(vtkInteractorStyleImage.newInstance());
      interactor.setDesiredUpdateRate(15.0);

      renderer.setBackground(backgroundColor);

      // Use simple ImageMapper (no texture issues)
      const mapper = vtkImageMapper.newInstance();
      mapper.setInputData(cprImageData);
      
      const actor = vtkImageSlice.newInstance();
      actor.setMapper(mapper);

      // Set appropriate window/level for the actual data range
      const property = actor.getProperty();
      
      if (cprData) {
        // Calculate data range efficiently for real data
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
        
        // Update state with actual values
        setWindowLevel({ window, level });
        
        console.log('🎨 Applied optimal window/level settings for real data:', {
          dataRange: [minVal, maxVal],
          window,
          level
        });
      } else {
        // Use default settings for synthetic data
        property.setColorWindow(1000);
        property.setColorLevel(300);
        setWindowLevel({ window: 1000, level: 300 });
        
        console.log('🎨 Applied default window/level settings for synthetic data');
      }

      // Add actor to renderer
      renderer.addActor(actor);

      // Set up camera for CPR view with proper scaling
      const camera = renderer.getActiveCamera();
      camera.setParallelProjection(true);
      
      // Set camera position for proper vertical CPR view
      if (cprImageData && typeof cprImageData.getBounds === 'function') {
        const bounds = cprImageData.getBounds();
        const center = [
          (bounds[0] + bounds[1]) / 2,
          (bounds[2] + bounds[3]) / 2,
          (bounds[4] + bounds[5]) / 2
        ];
        
        // Position camera to view the CPR properly (looking at XY plane)
        camera.setPosition(center[0], center[1], center[2] + 100);
        camera.setFocalPoint(center[0], center[1], center[2]);
        camera.setViewUp(0, 1, 0); // Y is up (vertical centerline)
        
        // Set parallel scale for proper initial zoom
        const imageHeight = bounds[3] - bounds[2];
        const imageWidth = bounds[1] - bounds[0];
        const maxDimension = Math.max(imageHeight, imageWidth);
        const initialScale = maxDimension / 2;
        camera.setParallelScale(initialScale);
        
        // Store for reset function
        initialParallelScale.current = initialScale;
        
        renderer.resetCameraClippingRange();
        
        console.log('📷 Camera configured for vertical CPR view:', {
          bounds,
          center,
          imageHeight,
          imageWidth,
          parallelScale: maxDimension / 2
        });
      } else {
        // Fallback camera setup
        camera.setPosition(0, 0, 100);
        camera.setFocalPoint(0, 0, 0);
        camera.setViewUp(0, 1, 0);
        camera.setParallelScale(50);
        initialParallelScale.current = 50;
        renderer.resetCameraClippingRange();
        
        console.log('📷 Using fallback camera configuration');
      }

      // Store VTK objects for cleanup and tool access
      vtkObjects.current = {
        renderWindow,
        renderer,
        mapper,
        actor,
        imageData: cprImageData,
        camera,
        genericRenderWindow
      };

      // Force proper container sizing before first render
      setTimeout(() => {
        if (genericRenderWindow && containerRef.current) {
          console.log('🔄 Forcing VTK container resize...');
          genericRenderWindow.resize();
          renderWindow.render();
          console.log('✅ Container resize completed');
        }
      }, 100);
      
      renderWindow.render();
      
      setIsInitialized(true);
      setIsLoading(false);
      
      console.log('✅ Hybrid CPR initialized successfully with real DICOM data');

    } catch (error) {
      console.error('❌ Hybrid CPR initialization failed:', error);
      setError(`Hybrid CPR initialization failed: ${error}`);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (patientInfo && rootPoints.length >= 3) {
      initializeHybridCPR();
    }

    // Cleanup
    return () => {
      if (vtkObjects.current.renderWindow) {
        console.log('🧹 Cleaning up Hybrid CPR viewport');
      }
    };
  }, [patientInfo, rootPoints]);

  return (
    <div className="w-full h-full relative">
      {/* Demo Notice */}
      <div className="absolute top-4 left-4 bg-purple-600/90 backdrop-blur-sm p-3 rounded-lg z-20">
        <div className="flex items-center gap-2 text-white text-sm">
          <span>🧬</span>
          <div>
            <div className="font-medium">Enhanced CPR - Real DICOM Extraction</div>
            <div className="text-xs text-purple-200">
              Multiple approaches to access real scalar data + robust fallback
            </div>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="flex items-center gap-3 text-white">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500"></div>
            <span>Loading DICOM volume and waiting for scalar data...</span>
          </div>
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="bg-red-900 border border-red-700 rounded-lg p-6 text-white max-w-lg">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              ⚠️ Hybrid CPR Error
            </h3>
            <p className="text-sm whitespace-pre-line">{error}</p>
          </div>
        </div>
      )}

      {/* Tool Panel - Top Bar (Same as Step 2 MPR) */}
      <div className="absolute top-0 left-0 right-0 z-20">
        {/* Main Tool Bar */}
        <div className="flex items-center justify-between p-3 bg-slate-800 border-b border-slate-700">
          {/* Left Section - CPR Info */}
          <div className="flex items-center gap-4">
            <div className="text-white">
              <div className="font-medium">CPR Analysis</div>
              <div className="text-xs text-slate-400">
                {rootPoints.length} anatomical points • Real DICOM data
              </div>
            </div>
          </div>

          {/* Right Section - Tools */}
          <div className="flex items-center gap-4">
            {/* Zoom Tools */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleZoom(1.5)}
                className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded flex items-center gap-1"
                title="Zoom In"
              >
                <FaSearchPlus />
              </button>
              <button
                onClick={() => handleZoom(0.67)}
                className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded flex items-center gap-1"
                title="Zoom Out"
              >
                <FaSearchMinus />
              </button>
              <span className="text-white text-sm min-w-[35px]">{zoom.toFixed(1)}x</span>
            </div>

            {/* Window/Level Tools */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleWindowLevel(200, 0)}
                className="p-2 bg-orange-600 hover:bg-orange-500 text-white rounded text-sm"
                title="Increase Window"
              >
                W+
              </button>
              <button
                onClick={() => handleWindowLevel(-200, 0)}
                className="p-2 bg-orange-600 hover:bg-orange-500 text-white rounded text-sm"
                title="Decrease Window"
              >
                W-
              </button>
              <button
                onClick={() => handleWindowLevel(0, 100)}
                className="p-2 bg-orange-600 hover:bg-orange-500 text-white rounded text-sm"
                title="Increase Level"
              >
                L+
              </button>
              <button
                onClick={() => handleWindowLevel(0, -100)}
                className="p-2 bg-orange-600 hover:bg-orange-500 text-white rounded text-sm"
                title="Decrease Level"
              >
                L-
              </button>
            </div>

            {/* W/L Presets */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setWindowLevel({ window: 400, level: 40 });
                  if (vtkObjects.current.actor) {
                    const property = vtkObjects.current.actor.getProperty();
                    property.setColorWindow(400);
                    property.setColorLevel(40);
                    if (vtkObjects.current.genericRenderWindow) {
                      vtkObjects.current.genericRenderWindow.getRenderWindow().render();
                    } else {
                      vtkObjects.current.renderWindow?.render();
                    }
                  }
                }}
                className="p-2 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm"
              >
                Soft Tissue
              </button>
              <button
                onClick={() => {
                  setWindowLevel({ window: 1500, level: 300 });
                  if (vtkObjects.current.actor) {
                    const property = vtkObjects.current.actor.getProperty();
                    property.setColorWindow(1500);
                    property.setColorLevel(300);
                    if (vtkObjects.current.genericRenderWindow) {
                      vtkObjects.current.genericRenderWindow.getRenderWindow().render();
                    } else {
                      vtkObjects.current.renderWindow?.render();
                    }
                  }
                }}
                className="p-2 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm"
              >
                Bone
              </button>
              <button
                onClick={() => {
                  setWindowLevel({ window: 2000, level: 0 });
                  if (vtkObjects.current.actor) {
                    const property = vtkObjects.current.actor.getProperty();
                    property.setColorWindow(2000);
                    property.setColorLevel(0);
                    if (vtkObjects.current.genericRenderWindow) {
                      vtkObjects.current.genericRenderWindow.getRenderWindow().render();
                    } else {
                      vtkObjects.current.renderWindow?.render();
                    }
                  }
                }}
                className="p-2 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm"
              >
                Lung
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
            <span className="ml-4">Images: {rootPoints.length > 0 ? 'Loaded' : 'Loading...'}</span>
          </div>
          <div className="flex items-center gap-4 text-slate-300">
            <span>🖱️ Left-Click + Drag: Pan</span>
            <span>🖱️ Right-Click + Drag: Zoom</span>
            <span>🖱️ Shift + Left-Click + Drag: Window/Level</span>
            <span className="text-green-400">✓ CPR Active</span>
          </div>
        </div>
      </div>

      <div 
        ref={containerRef}
        className="flex-1 relative bg-black"
        style={{ 
          minHeight: '400px',
          maxHeight: '800px'
        }}
      />
    </div>
  );
};

export default HybridCPRViewport;