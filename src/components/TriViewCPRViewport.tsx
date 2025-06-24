import React, { useEffect, useRef, useState } from 'react';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import vtkImageReslice from '@kitware/vtk.js/Imaging/Core/ImageReslice';
import vtkInteractorStyleImage from '@kitware/vtk.js/Interaction/Style/InteractorStyleImage';
import vtkMath from '@kitware/vtk.js/Common/Core/Math';
import vtkCubeSource from '@kitware/vtk.js/Filters/Sources/CubeSource';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import { FaCrosshairs, FaSearchPlus, FaSearchMinus } from 'react-icons/fa';

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

interface TriViewCPRViewportProps {
  patientInfo?: {
    patientID?: string;
    patientName?: string;
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
  };
  rootPoints: Point3D[];
  onAnnulusPointSelected?: (point: Point3D, crossSectionIndex: number) => void;
}

// Register volume loader
volumeLoader.registerUnknownVolumeLoader(cornerstoneStreamingImageVolumeLoader);

const TriViewCPRViewport: React.FC<TriViewCPRViewportProps> = ({
  patientInfo,
  rootPoints,
  onAnnulusPointSelected
}) => {
  const cpr1Ref = useRef<HTMLDivElement>(null);
  const cpr2Ref = useRef<HTMLDivElement>(null);
  const crossSectionRef = useRef<HTMLDivElement>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [crosshairPosition, setCrosshairPosition] = useState(0.5); // 0-1 along centerline
  const [rotationAngle, setRotationAngle] = useState(0); // Rotation angle in degrees
  const [isCurvedCPR, setIsCurvedCPR] = useState(false); // Toggle between straight and curved CPR
  const [centerlinePoints, setCenterlinePoints] = useState<Point3D[]>([]);
  
  // VTK objects refs
  const vtkObjects = useRef<{
    volume?: any;
    scalarData?: any; // Cache scalar data for slider updates
    centerline?: Point3D[];
    views?: Array<{
      renderWindow: any;
      renderer: any;
      reslice: any;
      resliceMapper: any;
      resliceActor: any;
      genericRenderWindow: any;
    }>;
  }>({});

  // Generate centerline points from 3 anatomical points
  const generateCenterlinePoints = (points: Point3D[]): Point3D[] => {
    if (points.length < 3) return [];

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

    return centerlinePoints;
  };
  // Create VTK ImageData from array
  const createVTKImageData = (data: Float32Array, width: number, height: number) => {
    const imageData = vtkImageData.newInstance();
    imageData.setDimensions([width, height, 1]);
    imageData.setSpacing([1.0, 1.0, 1.0]);
    imageData.setOrigin([0, 0, 0]);
    
    const scalars = vtkDataArray.newInstance({
      name: 'Scalars',
      numberOfComponents: 1,
      values: data,
    });
    imageData.getPointData().setScalars(scalars);
    
    return imageData;
  };

  // Create VTK ImageData from Cornerstone volume
  const createVTKImageDataFromVolume = (volume: any) => {
    try {
      
      
      
      let scalarData = null;
      let attempts = [];
      
      // Try multiple methods to get scalar data
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

      if (!scalarData) {
        try {
          if (volume.voxelManager?.getScalarData) {
            scalarData = volume.voxelManager.getScalarData();
            attempts.push('volume.voxelManager.getScalarData() - SUCCESS');
          } else {
            attempts.push('volume.voxelManager.getScalarData() - NOT AVAILABLE');
          }
        } catch (e) {
          attempts.push(`volume.voxelManager.getScalarData() - ERROR: ${e.message}`);
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

      
      
      if (!scalarData) {
        // Create synthetic data as fallback
        console.warn('No scalar data found, creating synthetic data for testing');
        const dimensions = volume.dimensions || [128, 128, 128];
        const totalVoxels = dimensions[0] * dimensions[1] * dimensions[2];
        scalarData = new Float32Array(totalVoxels);
        
        // Create some synthetic gradient data
        for (let i = 0; i < totalVoxels; i++) {
          scalarData[i] = Math.sin(i / 1000) * 1000;
        }
        
        
      }
      
      const dimensions = volume.dimensions || [128, 128, 128];
      const spacing = volume.spacing || [1, 1, 1];
      const origin = volume.origin || [0, 0, 0];


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
      
      
      return imageData;
    } catch (error) {
      console.error('Failed to create VTK ImageData from volume:', error);
      throw error;
    }
  };

  // Setup tri-view reslicing using VTK.js pattern from MPRVTK.js
  const setupTriViewReslicing = async (vtkImageData: any, centerlinePoints: Point3D[]) => {
    
    
    // Validate inputs
    if (!vtkImageData) {
      throw new Error('VTK ImageData is null or undefined');
    }
    
    if (!centerlinePoints || centerlinePoints.length === 0) {
      throw new Error('Centerline points are empty');
    }
    

    const views = [];
    const containers = [cpr1Ref.current!, crossSectionRef.current!, cpr2Ref.current!];
    const labels = ['CPR View 1 (0°)', 'Cross Section', 'CPR View 2 (90°)'];

    for (let i = 0; i < 3; i++) {
      try {
        const container = containers[i];
        const label = labels[i];
        
        

        if (!container) {
          throw new Error(`Container ${i} is null`);
        }

        // Create render window
        const genericRenderWindow = vtkGenericRenderWindow.newInstance();
        genericRenderWindow.setContainer(container);
        genericRenderWindow.resize();

        const renderWindow = genericRenderWindow.getRenderWindow();
        const renderer = genericRenderWindow.getRenderer();
        const interactor = renderWindow.getInteractor();

        interactor.setInteractorStyle(vtkInteractorStyleImage.newInstance());
        renderer.setBackground([0, 0, 0]);
        renderer.getActiveCamera().setParallelProjection(true);

        // Create reslice object (key for proper crosshair navigation)
        const reslice = vtkImageReslice.newInstance();
        
        
        
        reslice.setInputData(vtkImageData);
        reslice.setOutputDimensionality(2);
        reslice.setAutoCropOutput(true);
        reslice.setTransformInputSampling(false);

        // Set initial reslice plane based on view type BEFORE creating mapper
        
        setInitialReslicePlane(reslice, centerlinePoints, i, crosshairPosition);

        // Force reslice to update and check if it produces valid output
        reslice.update();
        const resliceOutput = reslice.getOutputData();
        

        if (!resliceOutput) {
          throw new Error(`Reslice produced null output for ${label}`);
        }

        // Create mapper and actor
        const resliceMapper = vtkImageMapper.newInstance();
        resliceMapper.setInputConnection(reslice.getOutputPort());

        const resliceActor = vtkImageSlice.newInstance();
        resliceActor.setMapper(resliceMapper);

        renderer.addActor(resliceActor);
        
        // Don't call resetCamera() here - it's causing the error
        // Instead, set a manual camera
        const camera = renderer.getActiveCamera();
        camera.setParallelProjection(true);
        camera.setPosition(0, 0, 100);
        camera.setFocalPoint(0, 0, 0);
        camera.setViewUp(0, 1, 0);
        camera.setParallelScale(50);
        
        renderWindow.render();

        views.push({
          renderWindow,
          renderer,
          reslice,
          resliceMapper,
          resliceActor,
          genericRenderWindow
        });

        
        
      } catch (viewError) {
        console.error(`Failed to setup view ${i}:`, viewError);
        throw new Error(`Failed to setup ${labels[i]}: ${viewError.message}`);
      }
    }

    
    return views;
  };

  // Setup simple tri-view without complex reslicing
  const setupSimpleTriView = async (cpr1ImageData: any, cpr2ImageData: any, crossSectionImageData: any) => {
    
    
    const views = [];
    // Fix the order: CPR1, Cross Section in middle, CPR2
    const containers = [cpr1Ref.current!, crossSectionRef.current!, cpr2Ref.current!];
    const imageDatas = [cpr1ImageData, crossSectionImageData, cpr2ImageData]; // Cross section in middle
    const labels = ['CPR View 1 (0°)', 'Cross Section', 'CPR View 2 (90°)'];

    for (let i = 0; i < 3; i++) {
      const container = containers[i];
      const imageData = imageDatas[i];
      const label = labels[i];
      
      

      // Create render window
      const genericRenderWindow = vtkGenericRenderWindow.newInstance();
      genericRenderWindow.setContainer(container);
      genericRenderWindow.resize();

      const renderWindow = genericRenderWindow.getRenderWindow();
      const renderer = genericRenderWindow.getRenderer();
      const interactor = renderWindow.getInteractor();

      interactor.setInteractorStyle(vtkInteractorStyleImage.newInstance());
      renderer.setBackground([0, 0, 0]);

      // Create mapper and actor directly with the image data
      const mapper = vtkImageMapper.newInstance();
      mapper.setInputData(imageData);
      
      const actor = vtkImageSlice.newInstance();
      actor.setMapper(mapper);

      // Set window/level
      const property = actor.getProperty();
      property.setColorWindow(1000);
      property.setColorLevel(300);
      

      renderer.addActor(actor);
      
      // Add a simple test actor to verify VTK is working
      if (i === 1) { // Only for middle view
        
        
        // Create a simple test cube
        const cubeSource = vtkCubeSource.newInstance();
        cubeSource.setXLength(20);
        cubeSource.setYLength(20);
        cubeSource.setZLength(20);
        
        const cubeMapper = vtkMapper.newInstance();
        cubeMapper.setInputConnection(cubeSource.getOutputPort());
        
        const cubeActor = vtkActor.newInstance();
        cubeActor.setMapper(cubeMapper);
        cubeActor.getProperty().setColor(1, 0, 0); // Red color
        
        renderer.addActor(cubeActor);
        
      }

      // Set up camera
      const camera = renderer.getActiveCamera();
      camera.setParallelProjection(true);
      
      const bounds = imageData.getBounds();
      if (bounds) {
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
        camera.setParallelScale(maxDimension / 2);
      }

      renderer.resetCameraClippingRange();
      renderWindow.render();

      views.push({
        renderWindow,
        renderer,
        mapper,
        actor,
        genericRenderWindow
      });

      
    }

    
    return views;
  };

  // Create actual CPR (Curved Planar Reconstruction) data with rotation support
  const createCPRData = async (volume: any, centerlinePoints: Point3D[], rotation: number = 0) => {
    
    
    try {
      // Use the exact working pattern from HybridCPRViewport
      let scalarData = null;
      
      // Step 1: Wait for scalar data to become available with polling (like HybridCPRViewport)
      let waitTime = 0;
      const maxWaitTime = 5000; // 5 seconds max
      const pollInterval = 200; // Check every 200ms

      while (waitTime < maxWaitTime) {
        try {
          const streamingVolume = volume as any;
          let hasData = false;
          
          // Safely check for scalar data (like HybridCPRViewport)
          try {
            hasData = !!(streamingVolume.getScalarData && streamingVolume.getScalarData());
            if (hasData) {
              
              break;
            }
          } catch (e) {
            // getScalarData throws when not available
          }
          
          // Also check for frames data as backup (like HybridCPRViewport)
          if (streamingVolume.framesLoaded > 0 && streamingVolume.cachedFrames && Object.keys(streamingVolume.cachedFrames).length > 0) {
            
            break;
          }
          
        } catch (e) {
          
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        waitTime += pollInterval;
      }

      // Step 2: Try multiple methods to access scalar data (like HybridCPRViewport)
      const streamingVolume = volume as any;
      
      // Method 1: Direct getScalarData() - most direct approach
      try {
        if (typeof volume.getScalarData === 'function') {
          scalarData = volume.getScalarData();
          if (scalarData) {
            
          }
        }
      } catch (error) {
        console.warn('getScalarData() failed:', error);
      }

      // Method 2: scalarData property
      if (!scalarData && volume.scalarData) {
        scalarData = volume.scalarData;
        
      }

      // Method 3: vtkImageData approach
      if (!scalarData && volume.vtkImageData) {
        try {
          const scalars = volume.vtkImageData.getPointData().getScalars();
          if (scalars) {
            scalarData = scalars.getData();
            
          }
        } catch (e) {
          console.warn('vtkImageData access failed:', e);
        }
      }

      // Method 4: imageData approach
      if (!scalarData && volume.imageData) {
        try {
          if (volume.imageData.getPointData && volume.imageData.getPointData().getScalars) {
            const scalars = volume.imageData.getPointData().getScalars();
            if (scalars) {
              scalarData = scalars.getData();
              
            }
          }
        } catch (e) {
          console.warn('imageData access failed:', e);
        }
      }

      // Method 5: voxelManager approach
      if (!scalarData && volume.voxelManager) {
        try {
          if (volume.voxelManager.getScalarData) {
            scalarData = volume.voxelManager.getScalarData();
            
          }
        } catch (e) {
          console.warn('voxelManager.getScalarData() failed:', e);
        }
        
        // Try getCompleteScalarDataArray
        if (!scalarData) {
          try {
            if (volume.voxelManager.getCompleteScalarDataArray) {
              scalarData = volume.voxelManager.getCompleteScalarDataArray();
              
            }
          } catch (e) {
            console.warn('voxelManager.getCompleteScalarDataArray() failed:', e);
          }
        }
      }

      // Method 6: Frame reconstruction approach (like HybridCPRViewport)
      if (!scalarData && streamingVolume.framesLoaded > 0) {
        if (streamingVolume.cachedFrames && Object.keys(streamingVolume.cachedFrames).length > 0) {
          try {
            
            const totalVoxels = volume.dimensions[0] * volume.dimensions[1] * volume.dimensions[2];
            scalarData = new Float32Array(totalVoxels);
            
            let voxelIndex = 0;
            for (let i = 0; i < volume.dimensions[2] && voxelIndex < totalVoxels; i++) {
              const frameKey = streamingVolume._imageIds?.[i];
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
              
            } else {
              scalarData = null; // Reset if no data was actually copied
            }
          } catch (e) {
            console.warn('Frame reconstruction failed:', e);
            scalarData = null;
          }
        }
      }
      
      if (!scalarData || scalarData.length === 0) {
        throw new Error('No real scalar data available - cannot create CPR without DICOM data');
      }

      // Cache the scalar data for slider updates
      vtkObjects.current.scalarData = scalarData;
      
      
      
      const dimensions = volume.dimensions;
      const spacing = volume.spacing;
      const origin = volume.origin;
      
      
      
      // CPR parameters
      const cprLength = centerlinePoints.length;
      const cprWidth = 128; // Cross-section width in pixels
      const cprHeight = 128; // For cross-sections
      
      // Create two CPR views (0° and 90° orientations)
      const cpr1Data = new Float32Array(cprWidth * cprLength);
      const cpr2Data = new Float32Array(cprWidth * cprLength);
      const crossSectionData = new Float32Array(cprWidth * cprHeight);
      
      // Generate CPR data by sampling along centerline
      for (let i = 0; i < centerlinePoints.length; i++) {
        const point = centerlinePoints[i];
        
        // Convert world coordinates to voxel coordinates
        const voxelX = (point.x - origin[0]) / spacing[0];
        const voxelY = (point.y - origin[1]) / spacing[1];
        const voxelZ = (point.z - origin[2]) / spacing[2];
        
        // Calculate direction vectors for this point on centerline
        let tangent = [1, 0, 0]; // Default
        if (i < centerlinePoints.length - 1) {
          const nextPoint = centerlinePoints[i + 1];
          tangent = [
            nextPoint.x - point.x,
            nextPoint.y - point.y,
            nextPoint.z - point.z
          ];
          const length = Math.sqrt(tangent[0] * tangent[0] + tangent[1] * tangent[1] + tangent[2] * tangent[2]);
          if (length > 0) {
            tangent = [tangent[0] / length, tangent[1] / length, tangent[2] / length];
          }
        }
        
        // Create perpendicular vectors for cross-sections based on tangent direction with rotation
        let normal1 = [1, 0, 0]; // Default first perpendicular
        let normal2 = [0, 1, 0]; // Default second perpendicular
        
        // Calculate proper perpendicular vectors based on tangent
        if (tangent && (Math.abs(tangent[0]) > 0.01 || Math.abs(tangent[1]) > 0.01 || Math.abs(tangent[2]) > 0.01)) {
          // First perpendicular: cross product of tangent with [0,0,1]
          const up = [0, 0, 1];
          let baseNormal1 = [
            tangent[1] * up[2] - tangent[2] * up[1],
            tangent[2] * up[0] - tangent[0] * up[2],  
            tangent[0] * up[1] - tangent[1] * up[0]
          ];
          const norm1 = Math.sqrt(baseNormal1[0] * baseNormal1[0] + baseNormal1[1] * baseNormal1[1] + baseNormal1[2] * baseNormal1[2]);
          if (norm1 > 0.01) {
            baseNormal1 = [baseNormal1[0] / norm1, baseNormal1[1] / norm1, baseNormal1[2] / norm1];
          } else {
            baseNormal1 = [1, 0, 0]; // fallback
          }
          
          // Second perpendicular: cross product of tangent with first normal
          let baseNormal2 = [
            tangent[1] * baseNormal1[2] - tangent[2] * baseNormal1[1],
            tangent[2] * baseNormal1[0] - tangent[0] * baseNormal1[2],
            tangent[0] * baseNormal1[1] - tangent[1] * baseNormal1[0]
          ];
          const norm2 = Math.sqrt(baseNormal2[0] * baseNormal2[0] + baseNormal2[1] * baseNormal2[1] + baseNormal2[2] * baseNormal2[2]);
          if (norm2 > 0.01) {
            baseNormal2 = [baseNormal2[0] / norm2, baseNormal2[1] / norm2, baseNormal2[2] / norm2];
          } else {
            baseNormal2 = [0, 1, 0]; // fallback
          }
          
          // Apply rotation around centerline (like 3Mensio)
          const rotRad = (rotation * Math.PI) / 180; // Convert to radians
          const cosRot = Math.cos(rotRad);
          const sinRot = Math.sin(rotRad);
          
          // Rotate normal vectors around tangent axis using Rodrigues' rotation formula
          normal1 = [
            baseNormal1[0] * cosRot + baseNormal2[0] * sinRot,
            baseNormal1[1] * cosRot + baseNormal2[1] * sinRot,
            baseNormal1[2] * cosRot + baseNormal2[2] * sinRot
          ];
          
          // CPR View 2 is 90° rotated from CPR View 1 around the centerline
          normal2 = [
            baseNormal1[0] * cosRot + baseNormal2[0] * sinRot,
            baseNormal1[1] * cosRot + baseNormal2[1] * sinRot,
            baseNormal1[2] * cosRot + baseNormal2[2] * sinRot
          ];
          
          // For the second view, add 90° rotation
          const cos90 = Math.cos(rotRad + Math.PI/2);
          const sin90 = Math.sin(rotRad + Math.PI/2);
          normal2 = [
            baseNormal1[0] * cos90 + baseNormal2[0] * sin90,
            baseNormal1[1] * cos90 + baseNormal2[1] * sin90,
            baseNormal1[2] * cos90 + baseNormal2[2] * sin90
          ];
        }
        
        // Sample CPR View 1 (0° orientation)
        for (let j = 0; j < cprWidth; j++) {
          const offset = (j - cprWidth / 2) * 0.5; // Sampling step size
          
          const sampleX = Math.round(voxelX + offset * normal1[0] / spacing[0]);
          const sampleY = Math.round(voxelY + offset * normal1[1] / spacing[1]);
          const sampleZ = Math.round(voxelZ + offset * normal1[2] / spacing[2]);
          
          if (sampleX >= 0 && sampleX < dimensions[0] &&
              sampleY >= 0 && sampleY < dimensions[1] &&
              sampleZ >= 0 && sampleZ < dimensions[2]) {
            const voxelIndex = sampleZ * dimensions[0] * dimensions[1] + 
                              sampleY * dimensions[0] + 
                              sampleX;
            if (voxelIndex < scalarData.length) {
              cpr1Data[i * cprWidth + j] = scalarData[voxelIndex];
            }
          }
        }
        
        // Sample CPR View 2 (90° orientation)
        for (let j = 0; j < cprWidth; j++) {
          const offset = (j - cprWidth / 2) * 0.5;
          
          const sampleX = Math.round(voxelX + offset * normal2[0] / spacing[0]);
          const sampleY = Math.round(voxelY + offset * normal2[1] / spacing[1]);
          const sampleZ = Math.round(voxelZ + offset * normal2[2] / spacing[2]);
          
          if (sampleX >= 0 && sampleX < dimensions[0] &&
              sampleY >= 0 && sampleY < dimensions[1] &&
              sampleZ >= 0 && sampleZ < dimensions[2]) {
            const voxelIndex = sampleZ * dimensions[0] * dimensions[1] + 
                              sampleY * dimensions[0] + 
                              sampleX;
            if (voxelIndex < scalarData.length) {
              cpr2Data[i * cprWidth + j] = scalarData[voxelIndex];
            }
          }
        }
      }
      
      // Create cross-section data at current position (will be updated by slider)
      const midPoint = centerlinePoints[Math.floor(centerlinePoints.length / 2)];
      const midVoxelX = (midPoint.x - origin[0]) / spacing[0];
      const midVoxelY = (midPoint.y - origin[1]) / spacing[1];
      const midVoxelZ = (midPoint.z - origin[2]) / spacing[2];
      
      for (let i = 0; i < cprHeight; i++) {
        for (let j = 0; j < cprWidth; j++) {
          const offsetX = (j - cprWidth / 2) * 0.5;
          const offsetY = (i - cprHeight / 2) * 0.5;
          
          const sampleX = Math.round(midVoxelX + offsetX / spacing[0]);
          const sampleY = Math.round(midVoxelY + offsetY / spacing[1]);
          const sampleZ = Math.round(midVoxelZ);
          
          if (sampleX >= 0 && sampleX < dimensions[0] &&
              sampleY >= 0 && sampleY < dimensions[1] &&
              sampleZ >= 0 && sampleZ < dimensions[2]) {
            const voxelIndex = sampleZ * dimensions[0] * dimensions[1] + 
                              sampleY * dimensions[0] + 
                              sampleX;
            if (voxelIndex < scalarData.length) {
              crossSectionData[i * cprWidth + j] = scalarData[voxelIndex];
            }
          }
        }
      }
      
      
      
      return {
        cpr1: { data: cpr1Data, width: cprWidth, height: cprLength },
        cpr2: { data: cpr2Data, width: cprWidth, height: cprLength },
        crossSection: { data: crossSectionData, width: cprWidth, height: cprHeight }
      };
      
    } catch (error) {
      console.error('Failed to create CPR data:', error);
      throw error; // Don't fall back to synthetic data
    }
  };

  // Create curved CPR data with enhanced curvature representation
  const createCurvedCPRData = async (volume: any, centerlinePoints: Point3D[], rotation: number = 0) => {
    try {
      // Use the same data access pattern as createCPRData
      let scalarData = vtkObjects.current.scalarData;
      
      if (!scalarData) {
        // Wait for scalar data to become available
        let waitTime = 0;
        const maxWaitTime = 5000;
        const pollInterval = 200;

        while (waitTime < maxWaitTime) {
          try {
            const streamingVolume = volume as any;
            let hasData = false;
            
            try {
              hasData = !!(streamingVolume.getScalarData && streamingVolume.getScalarData());
              if (hasData) break;
            } catch (e) {
              // getScalarData throws when not available
            }
            
            if (streamingVolume.framesLoaded > 0 && streamingVolume.cachedFrames && Object.keys(streamingVolume.cachedFrames).length > 0) {
              break;
            }
          } catch (e) {
            // Continue polling
          }
          
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          waitTime += pollInterval;
        }

        // Try multiple methods to access scalar data
        const streamingVolume = volume as any;
        
        try {
          if (typeof volume.getScalarData === 'function') {
            scalarData = volume.getScalarData();
          }
        } catch (error) {
          // Ignore
        }

        if (!scalarData && volume.scalarData) {
          scalarData = volume.scalarData;
        }

        // Reconstruct from cached frames if needed
        if (!scalarData && streamingVolume.cachedFrames && Object.keys(streamingVolume.cachedFrames).length > 0) {
          const dimensions = volume.dimensions || [512, 512, streamingVolume.framesLoaded];
          const totalSize = dimensions[0] * dimensions[1] * dimensions[2];
          scalarData = new Float32Array(totalSize);
          
          Object.keys(streamingVolume.cachedFrames).forEach((frameKey, frameIndex) => {
            const frameData = streamingVolume.cachedFrames[frameKey];
            if (frameData && frameData.pixelData) {
              const sliceSize = dimensions[0] * dimensions[1];
              const startIndex = frameIndex * sliceSize;
              
              if (startIndex + sliceSize <= totalSize) {
                scalarData.set(frameData.pixelData, startIndex);
              }
            }
          });
        }
        
        if (scalarData) {
          vtkObjects.current.scalarData = scalarData;
        }
      }
      
      if (!scalarData || scalarData.length === 0) {
        throw new Error('No scalar data available for curved CPR');
      }

      const dimensions = volume.dimensions || [128, 128, 128];
      const spacing = volume.spacing || [1, 1, 1];
      const origin = volume.origin || [0, 0, 0];

      const cprLength = centerlinePoints.length;
      const cprWidth = 128; // Match straight mode dimensions
      const cprHeight = 128;
      
      const cpr1Data = new Float32Array(cprWidth * cprLength);
      const cpr2Data = new Float32Array(cprWidth * cprLength);
      const crossSectionData = new Float32Array(cprWidth * cprHeight);

      // Sample along the curved centerline with enhanced curvature
      for (let i = 0; i < cprLength; i++) {
        const point = centerlinePoints[i];
        
        // Convert to voxel coordinates
        const voxelX = (point.x - origin[0]) / spacing[0];
        const voxelY = (point.y - origin[1]) / spacing[1];
        const voxelZ = (point.z - origin[2]) / spacing[2];
        
        // Calculate enhanced curvature-based sampling directions
        let tangent = [1, 0, 0];
        if (i < centerlinePoints.length - 1) {
          const nextPoint = centerlinePoints[i + 1];
          tangent = [
            nextPoint.x - point.x,
            nextPoint.y - point.y,
            nextPoint.z - point.z
          ];
          const tangentLength = Math.sqrt(tangent[0] * tangent[0] + tangent[1] * tangent[1] + tangent[2] * tangent[2]);
          if (tangentLength > 0) {
            tangent[0] /= tangentLength;
            tangent[1] /= tangentLength;
            tangent[2] /= tangentLength;
          }
        }
        
        // Create base perpendicular vectors
        let baseNormal1 = [0, 0, 1];
        if (Math.abs(tangent[2]) > 0.9) {
          baseNormal1 = [1, 0, 0];
        }
        
        baseNormal1 = [
          tangent[1] * baseNormal1[2] - tangent[2] * baseNormal1[1],
          tangent[2] * baseNormal1[0] - tangent[0] * baseNormal1[2],  
          tangent[0] * baseNormal1[1] - tangent[1] * baseNormal1[0]
        ];
        const norm1 = Math.sqrt(baseNormal1[0] * baseNormal1[0] + baseNormal1[1] * baseNormal1[1] + baseNormal1[2] * baseNormal1[2]);
        if (norm1 > 0.01) {
          baseNormal1 = [baseNormal1[0] / norm1, baseNormal1[1] / norm1, baseNormal1[2] / norm1];
        }
        
        let baseNormal2 = [
          tangent[1] * baseNormal1[2] - tangent[2] * baseNormal1[1],
          tangent[2] * baseNormal1[0] - tangent[0] * baseNormal1[2],
          tangent[0] * baseNormal1[1] - tangent[1] * baseNormal1[0]
        ];
        const norm2 = Math.sqrt(baseNormal2[0] * baseNormal2[0] + baseNormal2[1] * baseNormal2[1] + baseNormal2[2] * baseNormal2[2]);
        if (norm2 > 0.01) {
          baseNormal2 = [baseNormal2[0] / norm2, baseNormal2[1] / norm2, baseNormal2[2] / norm2];
        }
        
        // For curved CPR, add enhanced curvature effect
        const curveProgress = i / (cprLength - 1);
        const curveIntensity = Math.sin(curveProgress * Math.PI * 3) * 0.3; // Varying curvature
        const enhancedRotation = rotation + curveIntensity * 60; // Add curvature-based rotation
        
        const rotRad = (enhancedRotation * Math.PI) / 180;
        const cosRot = Math.cos(rotRad);
        const sinRot = Math.sin(rotRad);
        
        // Apply enhanced rotation
        const normal1 = [
          baseNormal1[0] * cosRot + baseNormal2[0] * sinRot,
          baseNormal1[1] * cosRot + baseNormal2[1] * sinRot,
          baseNormal1[2] * cosRot + baseNormal2[2] * sinRot
        ];
        
        const cos90 = Math.cos(rotRad + Math.PI/2);
        const sin90 = Math.sin(rotRad + Math.PI/2);
        const normal2 = [
          baseNormal1[0] * cos90 + baseNormal2[0] * sin90,
          baseNormal1[1] * cos90 + baseNormal2[1] * sin90,
          baseNormal1[2] * cos90 + baseNormal2[2] * sin90
        ];
        
        // Sample with enhanced curvature
        for (let j = 0; j < cprWidth; j++) {
          const offset = (j - cprWidth / 2) * 0.5; // Same sampling as straight mode for consistent zoom
          
          // CPR View 1 with curvature enhancement
          const sampleX1 = Math.round(voxelX + offset * normal1[0] / spacing[0]);
          const sampleY1 = Math.round(voxelY + offset * normal1[1] / spacing[1]);
          const sampleZ1 = Math.round(voxelZ + offset * normal1[2] / spacing[2]);
          
          if (sampleX1 >= 0 && sampleX1 < dimensions[0] &&
              sampleY1 >= 0 && sampleY1 < dimensions[1] &&
              sampleZ1 >= 0 && sampleZ1 < dimensions[2]) {
            const voxelIndex1 = sampleZ1 * dimensions[0] * dimensions[1] + 
                              sampleY1 * dimensions[0] + 
                              sampleX1;
            if (voxelIndex1 < scalarData.length) {
              cpr1Data[i * cprWidth + j] = scalarData[voxelIndex1];
            }
          }
          
          // CPR View 2 with curvature enhancement  
          const sampleX2 = Math.round(voxelX + offset * normal2[0] / spacing[0]);
          const sampleY2 = Math.round(voxelY + offset * normal2[1] / spacing[1]);
          const sampleZ2 = Math.round(voxelZ + offset * normal2[2] / spacing[2]);
          
          if (sampleX2 >= 0 && sampleX2 < dimensions[0] &&
              sampleY2 >= 0 && sampleY2 < dimensions[1] &&
              sampleZ2 >= 0 && sampleZ2 < dimensions[2]) {
            const voxelIndex2 = sampleZ2 * dimensions[0] * dimensions[1] + 
                              sampleY2 * dimensions[0] + 
                              sampleX2;
            if (voxelIndex2 < scalarData.length) {
              cpr2Data[i * cprWidth + j] = scalarData[voxelIndex2];
            }
          }
        }
      }
      
      // Create enhanced curved cross-section
      const midPoint = centerlinePoints[Math.floor(centerlinePoints.length / 2)];
      const midVoxelX = (midPoint.x - origin[0]) / spacing[0];
      const midVoxelY = (midPoint.y - origin[1]) / spacing[1];
      const midVoxelZ = (midPoint.z - origin[2]) / spacing[2];
      
      for (let i = 0; i < cprHeight; i++) {
        for (let j = 0; j < cprWidth; j++) {
          const y = (i - cprHeight / 2) * 0.5; // Same sampling as straight mode
          const x = (j - cprWidth / 2) * 0.5;
          
          const sampleX = Math.round(midVoxelX + x / spacing[0]);
          const sampleY = Math.round(midVoxelY + y / spacing[1]);
          const sampleZ = Math.round(midVoxelZ);
          
          if (sampleX >= 0 && sampleX < dimensions[0] &&
              sampleY >= 0 && sampleY < dimensions[1] &&
              sampleZ >= 0 && sampleZ < dimensions[2]) {
            const voxelIndex = sampleZ * dimensions[0] * dimensions[1] + 
                              sampleY * dimensions[0] + 
                              sampleX;
            if (voxelIndex < scalarData.length) {
              crossSectionData[i * cprWidth + j] = scalarData[voxelIndex];
            }
          }
        }
      }
      
      return {
        cpr1: { data: cpr1Data, width: cprWidth, height: cprLength },
        cpr2: { data: cpr2Data, width: cprWidth, height: cprLength },
        crossSection: { data: crossSectionData, width: cprWidth, height: cprHeight }
      };
      
    } catch (error) {
      console.error('Failed to create curved CPR data:', error);
      throw error;
    }
  };

  // Setup canvas-based CPR views
  const setupCanvasCPRViews = async (cprData: any, centerlinePoints: Point3D[]) => {
    
    
    const views = [];
    const containers = [cpr1Ref.current!, crossSectionRef.current!, cpr2Ref.current!];
    const cprImages = [cprData.cpr1, cprData.crossSection, cprData.cpr2];
    const labels = ['CPR View 1 (0°)', 'Cross Section', 'CPR View 2 (90°)'];

    for (let i = 0; i < 3; i++) {
      const container = containers[i];
      const imageData = cprImages[i];
      const label = labels[i];
      
      

      // Create canvas element
      const canvas = document.createElement('canvas');
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.objectFit = 'fill';
      canvas.style.background = 'black';
      
      // Clear container and add canvas
      container.innerHTML = '';
      container.appendChild(canvas);
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error(`Failed to get 2D context for ${label}`);
      }
      
      // Create ImageData and render
      const imageDataObj = ctx.createImageData(imageData.width, imageData.height);
      
      // Convert float data to RGB
      for (let j = 0; j < imageData.data.length; j++) {
        const intensity = Math.max(0, Math.min(255, (imageData.data[j] + 1000) / 8)); // Simple windowing
        const pixelIndex = j * 4;
        imageDataObj.data[pixelIndex] = intensity;     // R
        imageDataObj.data[pixelIndex + 1] = intensity; // G
        imageDataObj.data[pixelIndex + 2] = intensity; // B
        imageDataObj.data[pixelIndex + 3] = 255;       // A
      }
      
      ctx.putImageData(imageDataObj, 0, 0);
      
      views.push({
        canvas,
        ctx,
        imageData,
        label,
        container
      });

      
    }

    
    return views;
  };

  // Update reslice plane like MPRVTK.js updateReslice function
  const updateReslicePlane = (reslice: any, actor: any, centerlinePoints: Point3D[], viewType: number, position: number) => {
    try {
      
      
      // Get point along centerline
      const pointIndex = Math.floor(position * (centerlinePoints.length - 1));
      const point = centerlinePoints[pointIndex];
      
      // Create reslice axes matrix based on view type
      const resliceAxes = [
        1, 0, 0, point.x,
        0, 1, 0, point.y,
        0, 0, 1, point.z,
        0, 0, 0, 1
      ];
      
      if (viewType === 0) { // CPR View 1 (Sagittal-like)
        resliceAxes[0] = 0; resliceAxes[1] = 0; resliceAxes[2] = 1; // X-axis
        resliceAxes[4] = 0; resliceAxes[5] = 1; resliceAxes[6] = 0; // Y-axis
        resliceAxes[8] = 1; resliceAxes[9] = 0; resliceAxes[10] = 0; // Z-axis (normal)
      } else if (viewType === 1) { // Cross Section (perpendicular to centerline)
        // Calculate direction along centerline
        let direction = [0, 0, 1];
        if (pointIndex < centerlinePoints.length - 1) {
          const nextPoint = centerlinePoints[pointIndex + 1];
          direction = [
            nextPoint.x - point.x,
            nextPoint.y - point.y,
            nextPoint.z - point.z
          ];
          const length = Math.sqrt(direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2]);
          if (length > 0) {
            direction = [direction[0] / length, direction[1] / length, direction[2] / length];
          }
        }
        
        // Normal is along centerline direction
        resliceAxes[8] = direction[0]; resliceAxes[9] = direction[1]; resliceAxes[10] = direction[2];
        // Create perpendicular axes
        const up = [0, 1, 0];
        const right = [0, 0, 0];
        vtkMath.cross(direction, up, right);
        vtkMath.normalize(right);
        vtkMath.cross(right, direction, up);
        vtkMath.normalize(up);
        
        resliceAxes[0] = right[0]; resliceAxes[1] = right[1]; resliceAxes[2] = right[2];
        resliceAxes[4] = up[0]; resliceAxes[5] = up[1]; resliceAxes[6] = up[2];
      } else { // CPR View 2 (Coronal-like)
        resliceAxes[0] = 1; resliceAxes[1] = 0; resliceAxes[2] = 0; // X-axis
        resliceAxes[4] = 0; resliceAxes[5] = 0; resliceAxes[6] = 1; // Y-axis
        resliceAxes[8] = 0; resliceAxes[9] = 1; resliceAxes[10] = 0; // Z-axis (normal)
      }
      
      // Set reslice axes (key step from MPRVTK.js)
      reslice.setResliceAxes(resliceAxes);
      
      // Apply matrix to actor (key step from MPRVTK.js)
      actor.setUserMatrix(resliceAxes);
      
      
      
    } catch (error) {
      console.error(`Error updating reslice plane for viewType ${viewType}:`, error);
    }
  };

  // Set initial reslice plane (mimicking MPRVTK.js approach)
  const setInitialReslicePlane = (reslice: any, centerlinePoints: Point3D[], viewType: number, position: number) => {
    try {
      // Get point along centerline
      const pointIndex = Math.floor(position * (centerlinePoints.length - 1));
      const point = centerlinePoints[pointIndex];
      
      // Get direction vectors
      let normal, viewUp;
      
      if (viewType === 0) { // CPR View 1 (0°)
        normal = [1, 0, 0]; // X direction
        viewUp = [0, 0, 1];  // Z up
      } else if (viewType === 1) { // Cross Section
        // Perpendicular to centerline
        if (pointIndex < centerlinePoints.length - 1) {
          const nextPoint = centerlinePoints[pointIndex + 1];
          normal = [
            nextPoint.x - point.x,
            nextPoint.y - point.y,
            nextPoint.z - point.z
          ];
          // Normalize
          const length = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
          if (length > 0) {
            normal = [normal[0] / length, normal[1] / length, normal[2] / length];
          } else {
            normal = [0, 0, 1]; // fallback
          }
        } else {
          normal = [0, 0, 1];
        }
        viewUp = [0, 1, 0];
      } else { // CPR View 2 (90°)
        normal = [0, 1, 0]; // Y direction  
        viewUp = [0, 0, 1]; // Z up
      }

      // Calculate right vector (cross product of normal and viewUp)
      const right = [0, 0, 0];
      try {
        vtkMath.cross(normal, viewUp, right);
        if (vtkMath.norm(right) > 0) {
          vtkMath.normalize(right);
        } else {
          right[0] = 1; right[1] = 0; right[2] = 0; // fallback
        }
        vtkMath.normalize(viewUp);
        vtkMath.normalize(normal);
      } catch (mathError) {
        console.warn('Math operation failed, using defaults:', mathError);
        right[0] = 1; right[1] = 0; right[2] = 0;
        viewUp = [0, 1, 0];
        normal = [0, 0, 1];
      }

      // Create reslice axes matrix properly (4x4 matrix)
      const resliceAxes = [
        right[0],  right[1],  right[2],  point.x,
        viewUp[0], viewUp[1], viewUp[2], point.y,
        normal[0], normal[1], normal[2], point.z,
        0,         0,         0,         1
      ];
      
      // Set center point and axes
      reslice.setResliceAxes(resliceAxes);
      reslice.setOutputOrigin([point.x, point.y, point.z]);
      
    } catch (error) {
      console.error('Error setting reslice plane:', error);
      // Set identity matrix as fallback
      reslice.setResliceAxes([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ]);
    }
  };

  // Load real DICOM data using the exact working pattern from HybridCPRViewport
  const loadDicomData = async () => {
    try {
      
      
      const imageIds = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: patientInfo!.studyInstanceUID!,
        SeriesInstanceUID: patientInfo!.seriesInstanceUID!,
        wadoRsRoot: "http://192.168.2.52/orthanc/dicom-web",
      });

      if (imageIds.length === 0) {
        throw new Error('No DICOM images found for this series');
      }

      

      // Use the exact pattern from HybridCPRViewport that works
      const volumeId = `triViewCprVolume_${Date.now()}`;
      const volume = await volumeLoader.createAndCacheVolume(volumeId, {
        imageIds,
      });
      
      
      
      // Load the volume and wait for it to complete
      await volume.load();
      
      
      
      // Wait for scalar data to become available (exactly like HybridCPRViewport)
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
          
          
          if (hasData) {
            
            break;
          }
          
          // Break if we have loaded frames even if scalar data isn't available via getScalarData
          if (streamingVolume.framesLoaded > 0 && streamingVolume.cachedFrames && Object.keys(streamingVolume.cachedFrames).length > 0) {
            
            break;
          }
          
        } catch (e) {
          
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        waitTime += pollInterval;
      }
      

      return { volume, imageIds };

    } catch (error) {
      console.error('Failed to load DICOM data:', error);
      throw error;
    }
  };

  // Initialize tri-view CPR using proper VTK.js reslicing pattern
  const initializeTriViewCPR = async () => {
    try {
      setIsLoading(true);
      setError(null);

      

      // Load DICOM data using the working pattern
      const { volume, imageIds } = await loadDicomData();

      // Get the actual VTK image data from the volume
      let vtkImageData = null;
      try {

        // Try different ways to get VTK image data from Cornerstone volume
        if (volume.imageData) {
          
          vtkImageData = volume.imageData;
        } else if (volume.vtkOpenGLTexture?.getImage) {
          
          vtkImageData = volume.vtkOpenGLTexture.getImage();
        } else {
          
          vtkImageData = createVTKImageDataFromVolume(volume);
        }
        
        // Verify the VTK ImageData has basic properties
        if (vtkImageData) {
        }
        
        if (!vtkImageData) {
          throw new Error('VTK ImageData is null after all attempts');
        }
        
        
      } catch (e) {
        console.warn('Primary VTK image access failed:', e);
        
        try {
          vtkImageData = createVTKImageDataFromVolume(volume);
          if (!vtkImageData) {
            throw new Error('Fallback VTK ImageData creation also returned null');
          }
        } catch (fallbackError) {
          console.error('Fallback VTK ImageData creation failed:', fallbackError);
          throw new Error(`Failed to create VTK ImageData: ${fallbackError.message}`);
        }
      }

      // Generate centerline
      const centerlinePoints = generateCenterlinePoints(rootPoints);
      setCenterlinePoints(centerlinePoints);
      
      if (centerlinePoints.length === 0) {
        throw new Error('Failed to generate centerline');
      }

      // Create proper CPR data from the centerline
      
      const cprData = await createCPRData(volume, centerlinePoints, rotationAngle);
      
      // Setup canvas-based CPR views
      
      const views = await setupCanvasCPRViews(cprData, centerlinePoints);

      // Store references including CPR data for slice updates
      vtkObjects.current = {
        volume,
        centerline: centerlinePoints,
        views,
        cprData
      };

      // If we're using synthetic data, try to reload with real data after some time
      if (cprData.cpr1.data.constructor === Float32Array && cprData.cpr1.data.length === 128 * centerlinePoints.length) {
        
        
        setTimeout(async () => {
          try {
            
            const realCprData = await createCPRData(volume, centerlinePoints, rotationAngle);
            
            // Check if we got real data this time
            if (realCprData && realCprData !== cprData) {
              
              
              // Update the stored CPR data
              vtkObjects.current.cprData = realCprData;
              
              // Recreate the views with real data
              const newViews = await setupCanvasCPRViews(realCprData, centerlinePoints);
              vtkObjects.current.views = newViews;
              
              
            }
          } catch (error) {
            console.warn('Still unable to load real DICOM data, keeping synthetic data');
          }
        }, 3000); // Try again after 3 seconds
      }

      setIsLoading(false);
      

    } catch (error) {
      console.error('Tri-View CPR initialization failed:', error);
      setError(`Failed to initialize tri-view CPR: ${error}`);
      setIsLoading(false);
    }
  };
  // Handle rotation change - only update side CPR views, not the cross-section  
  const updateRotation = async (newRotation: number) => {
    
    
    try {
      const volume = vtkObjects.current.volume;
      
      if (volume && centerlinePoints.length > 0) {
        
        
        // Regenerate CPR data with new rotation - respect current mode
        const newCprData = isCurvedCPR 
          ? await createCurvedCPRData(volume, centerlinePoints, newRotation)
          : await createCPRData(volume, centerlinePoints, newRotation);
        
        // Update only the side views (CPR1 and CPR2), keep cross-section unchanged
        const views = vtkObjects.current.views;
        if (views && views.length >= 3) {
          // Update CPR View 1 (index 0)
          const cpr1View = views[0];
          if (cpr1View && cpr1View.ctx && cpr1View.canvas) {
            // Ensure we have the right canvas size
            cpr1View.canvas.width = newCprData.cpr1.width;
            cpr1View.canvas.height = newCprData.cpr1.height;
            
            const imageDataObj = cpr1View.ctx.createImageData(newCprData.cpr1.width, newCprData.cpr1.height);
            
            // Convert float data to RGB
            for (let j = 0; j < newCprData.cpr1.data.length; j++) {
              const intensity = Math.max(0, Math.min(255, (newCprData.cpr1.data[j] + 1000) / 8));
              const pixelIndex = j * 4;
              imageDataObj.data[pixelIndex] = intensity;     // R
              imageDataObj.data[pixelIndex + 1] = intensity; // G
              imageDataObj.data[pixelIndex + 2] = intensity; // B
              imageDataObj.data[pixelIndex + 3] = 255;       // A
            }
            
            // Clear entire canvas first
            cpr1View.ctx.clearRect(0, 0, cpr1View.canvas.width, cpr1View.canvas.height);
            cpr1View.ctx.putImageData(imageDataObj, 0, 0);
          }
          
          // Update CPR View 2 (index 2)
          const cpr2View = views[2];
          if (cpr2View && cpr2View.ctx && cpr2View.canvas) {
            // Ensure we have the right canvas size
            cpr2View.canvas.width = newCprData.cpr2.width;
            cpr2View.canvas.height = newCprData.cpr2.height;
            
            const imageDataObj = cpr2View.ctx.createImageData(newCprData.cpr2.width, newCprData.cpr2.height);
            
            // Convert float data to RGB
            for (let j = 0; j < newCprData.cpr2.data.length; j++) {
              const intensity = Math.max(0, Math.min(255, (newCprData.cpr2.data[j] + 1000) / 8));
              const pixelIndex = j * 4;
              imageDataObj.data[pixelIndex] = intensity;     // R
              imageDataObj.data[pixelIndex + 1] = intensity; // G
              imageDataObj.data[pixelIndex + 2] = intensity; // B
              imageDataObj.data[pixelIndex + 3] = 255;       // A
            }
            
            // Clear entire canvas first
            cpr2View.ctx.clearRect(0, 0, cpr2View.canvas.width, cpr2View.canvas.height);
            cpr2View.ctx.putImageData(imageDataObj, 0, 0);
          }
          
          // Keep the cross-section (middle view, index 1) unchanged - only crosshair rotates
        }
        
        // Update the stored CPR data
        vtkObjects.current.cprData = newCprData;
        
        
      }
    } catch (error) {
      console.error('Failed to update rotation:', error);
    }
  };

  // Handle CPR mode change between straight and curved
  const updateCPRMode = async (curved: boolean) => {
    try {
      const volume = vtkObjects.current.volume;
      
      if (volume && centerlinePoints.length > 0) {
        setIsCurvedCPR(curved);
        
        // Clean up existing views first to prevent duplicates
        if (vtkObjects.current.views) {
          vtkObjects.current.views.forEach(view => {
            if (view.canvas) {
              // Clear the canvas
              const ctx = view.canvas.getContext('2d');
              if (ctx) {
                ctx.clearRect(0, 0, view.canvas.width, view.canvas.height);
              }
              // Remove the canvas from DOM
              if (view.canvas.parentNode) {
                view.canvas.parentNode.removeChild(view.canvas);
              }
            }
          });
          // Clear the views array
          vtkObjects.current.views = [];
        }
        
        // Thoroughly clear the container elements
        const containers = [cpr1Ref.current, crossSectionRef.current, cpr2Ref.current];
        containers.forEach(container => {
          if (container) {
            // Remove all children (not just canvas)
            while (container.firstChild) {
              container.removeChild(container.firstChild);
            }
            
            // Ensure clean slate
            container.innerHTML = '';
            container.style.background = 'black';
          }
        });
        
        // Small delay to ensure cleanup is complete
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Regenerate all CPR data with new mode
        const newCprData = curved 
          ? await createCurvedCPRData(volume, centerlinePoints, rotationAngle)
          : await createCPRData(volume, centerlinePoints, rotationAngle);
        
        // Update the stored CPR data
        vtkObjects.current.cprData = newCprData;
        
        // Recreate all views with new mode
        const newViews = await setupCanvasCPRViews(newCprData, centerlinePoints);
        vtkObjects.current.views = newViews;
      }
    } catch (error) {
      console.error('Failed to update CPR mode:', error);
    }
  };

  // Handle crosshair position change and update CPR cross-section
  const updateCrosshairPosition = async (newPosition: number) => {
    
    
    if (vtkObjects.current.views && centerlinePoints.length > 0) {
      try {
        
        
        // Calculate which point on centerline we're at
        const pointIndex = Math.floor(newPosition * (centerlinePoints.length - 1));
        const currentPoint = centerlinePoints[pointIndex];
        
        
        // Use cached scalar data from initial load
        let newCrossSectionData = null;
        const volume = vtkObjects.current.volume;
        const cachedScalarData = vtkObjects.current.scalarData;
        
        if (volume && cachedScalarData) {
          try {
            
            
            if (cachedScalarData.length > 0 && volume.dimensions && volume.spacing && volume.origin) {
              
              const dimensions = volume.dimensions;
              const spacing = volume.spacing;
              const origin = volume.origin;
              
              // Convert current point to voxel coordinates
              const voxelX = (currentPoint.x - origin[0]) / spacing[0];
              const voxelY = (currentPoint.y - origin[1]) / spacing[1];
              const voxelZ = (currentPoint.z - origin[2]) / spacing[2];
              
              // Create new cross-section data with proper CPR sampling
              const cprWidth = 128;
              const cprHeight = 128;
              newCrossSectionData = new Float32Array(cprWidth * cprHeight);
              
              // Calculate tangent direction at current point
              let tangent = [0, 0, 1]; // Default direction
              if (pointIndex < centerlinePoints.length - 1) {
                const nextPoint = centerlinePoints[pointIndex + 1];
                tangent = [
                  nextPoint.x - currentPoint.x,
                  nextPoint.y - currentPoint.y,
                  nextPoint.z - currentPoint.z
                ];
                const length = Math.sqrt(tangent[0] * tangent[0] + tangent[1] * tangent[1] + tangent[2] * tangent[2]);
                if (length > 0) {
                  tangent = [tangent[0] / length, tangent[1] / length, tangent[2] / length];
                }
              }
              
              // Calculate perpendicular vectors for cross-section with rotation
              let normal1 = [1, 0, 0]; // Default first perpendicular
              let normal2 = [0, 1, 0]; // Default second perpendicular
              
              if (Math.abs(tangent[0]) > 0.01 || Math.abs(tangent[1]) > 0.01 || Math.abs(tangent[2]) > 0.01) {
                // First perpendicular: cross product of tangent with [0,0,1]
                const up = [0, 0, 1];
                let baseNormal1 = [
                  tangent[1] * up[2] - tangent[2] * up[1],
                  tangent[2] * up[0] - tangent[0] * up[2],  
                  tangent[0] * up[1] - tangent[1] * up[0]
                ];
                const norm1 = Math.sqrt(baseNormal1[0] * baseNormal1[0] + baseNormal1[1] * baseNormal1[1] + baseNormal1[2] * baseNormal1[2]);
                if (norm1 > 0.01) {
                  baseNormal1 = [baseNormal1[0] / norm1, baseNormal1[1] / norm1, baseNormal1[2] / norm1];
                } else {
                  baseNormal1 = [1, 0, 0]; // fallback
                }
                
                // Second perpendicular: cross product of tangent with first normal
                let baseNormal2 = [
                  tangent[1] * baseNormal1[2] - tangent[2] * baseNormal1[1],
                  tangent[2] * baseNormal1[0] - tangent[0] * baseNormal1[2],
                  tangent[0] * baseNormal1[1] - tangent[1] * baseNormal1[0]
                ];
                const norm2 = Math.sqrt(baseNormal2[0] * baseNormal2[0] + baseNormal2[1] * baseNormal2[1] + baseNormal2[2] * baseNormal2[2]);
                if (norm2 > 0.01) {
                  baseNormal2 = [baseNormal2[0] / norm2, baseNormal2[1] / norm2, baseNormal2[2] / norm2];
                } else {
                  baseNormal2 = [0, 1, 0]; // fallback
                }
                
                // Keep cross-section orientation fixed - don't apply rotation to CT data
                // Only the crosshair rotates, not the actual CT image
                normal1 = baseNormal1;
                normal2 = baseNormal2;
              }
              
              // Sample cross-section using perpendicular vectors
              for (let i = 0; i < cprHeight; i++) {
                for (let j = 0; j < cprWidth; j++) {
                  const offsetU = (j - cprWidth / 2) * 0.5;   // Offset along normal1
                  const offsetV = (i - cprHeight / 2) * 0.5;  // Offset along normal2
                  
                  const sampleX = Math.round(voxelX + (offsetU * normal1[0] + offsetV * normal2[0]) / spacing[0]);
                  const sampleY = Math.round(voxelY + (offsetU * normal1[1] + offsetV * normal2[1]) / spacing[1]);
                  const sampleZ = Math.round(voxelZ + (offsetU * normal1[2] + offsetV * normal2[2]) / spacing[2]);
                  
                  if (sampleX >= 0 && sampleX < dimensions[0] &&
                      sampleY >= 0 && sampleY < dimensions[1] &&
                      sampleZ >= 0 && sampleZ < dimensions[2]) {
                    const voxelIndex = sampleZ * dimensions[0] * dimensions[1] + 
                                      sampleY * dimensions[0] + 
                                      sampleX;
                    if (voxelIndex < cachedScalarData.length) {
                      newCrossSectionData[i * cprWidth + j] = cachedScalarData[voxelIndex];
                    }
                  }
                }
              }
              
              
            }
          } catch (e) {
            console.warn('Failed to use real volume data, using synthetic:', e.message);
          }
        }
        
        // If we couldn't get real data, throw an error instead of using synthetic data
        if (!newCrossSectionData) {
          const errorMessage = !cachedScalarData 
            ? 'No cached scalar data available - volume may not be fully loaded'
            : 'Failed to generate cross-section from cached data';
          throw new Error(errorMessage);
        }
        
        // Update the cross-section view (middle view, index 1)
        const crossSectionView = vtkObjects.current.views[1];
        if (crossSectionView && crossSectionView.ctx && crossSectionView.canvas && newCrossSectionData) {
          const cprWidth = 128;
          const cprHeight = 128;
          
          // Ensure canvas size is correct
          crossSectionView.canvas.width = cprWidth;
          crossSectionView.canvas.height = cprHeight;
          
          const imageDataObj = crossSectionView.ctx.createImageData(cprWidth, cprHeight);
          
          // Convert float data to RGB
          for (let j = 0; j < newCrossSectionData.length; j++) {
            const intensity = Math.max(0, Math.min(255, (newCrossSectionData[j] + 1000) / 8));
            const pixelIndex = j * 4;
            imageDataObj.data[pixelIndex] = intensity;     // R
            imageDataObj.data[pixelIndex + 1] = intensity; // G
            imageDataObj.data[pixelIndex + 2] = intensity; // B
            imageDataObj.data[pixelIndex + 3] = 255;       // A
          }
          
          // Clear entire canvas first
          crossSectionView.ctx.clearRect(0, 0, crossSectionView.canvas.width, crossSectionView.canvas.height);
          crossSectionView.ctx.putImageData(imageDataObj, 0, 0);
          
          
        }
        
        // Notify parent component of annulus point selection
        if (onAnnulusPointSelected) {
          const selectedPoint = centerlinePoints[pointIndex];
          onAnnulusPointSelected(selectedPoint, pointIndex);
        }
        
      } catch (error) {
        console.error('Failed to update crosshair position:', error);
      }
    } else {
      console.warn('Cannot update - missing dependencies:', {
        hasViews: !!vtkObjects.current.views,
        centerlineLength: centerlinePoints.length
      });
    }
  };

  useEffect(() => {
    if (patientInfo && rootPoints.length >= 3) {
      initializeTriViewCPR();
    }
  }, [patientInfo, rootPoints]);


  return (
    <div className="w-full h-full relative">
      {/* Header */}
      <div className="absolute top-4 left-4 bg-purple-600/90 backdrop-blur-sm p-2 rounded-lg z-20">
        <div className="flex items-center gap-2 text-white text-sm">
          <FaCrosshairs />
          <span className="font-medium">CPR Analysis</span>
        </div>
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="flex items-center gap-3 text-white">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500"></div>
            <span>Loading Tri-View CPR...</span>
          </div>
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="bg-red-900 border border-red-700 rounded-lg p-6 text-white max-w-lg">
            <h3 className="font-semibold mb-2">⚠️ Tri-View CPR Error</h3>
            <p className="text-sm whitespace-pre-line">{error}</p>
          </div>
        </div>
      )}

      {/* Control Panel */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-slate-800 border-b border-slate-700 p-3">
        <div className="grid grid-cols-3 gap-6">
          {/* Crosshair Position Control */}
          <div className="flex items-center gap-4">
            <div className="text-white text-sm min-w-0">
              <span>Position: {Math.round(crosshairPosition * 100)}%</span>
            </div>
            <div className="flex items-center gap-2 flex-1">
              <span className="text-slate-300 text-xs">Root</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={crosshairPosition}
                onChange={(e) => {
                  const newValue = parseFloat(e.target.value);
                  setCrosshairPosition(newValue);
                  updateCrosshairPosition(newValue);
                }}
                className="flex-1 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-slate-300 text-xs">Aorta</span>
            </div>
            <div className="text-slate-300 text-xs min-w-0">
              {Math.floor(crosshairPosition * (centerlinePoints.length - 1)) + 1}/{centerlinePoints.length}
            </div>
          </div>
          
          {/* Rotation Control */}
          <div className="flex items-center gap-4">
            <div className="text-white text-sm min-w-0">
              <span>Rotation: {Math.round(rotationAngle)}°</span>
            </div>
            <div className="flex items-center gap-2 flex-1">
              <span className="text-slate-300 text-xs">0°</span>
              <input
                type="range"
                min="0"
                max="360"
                step="1"
                value={rotationAngle}
                onChange={(e) => {
                  const newRotation = parseFloat(e.target.value);
                  setRotationAngle(newRotation);
                  updateRotation(newRotation);
                }}
                className="flex-1 h-2 bg-blue-600 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-slate-300 text-xs">360°</span>
            </div>
            <button
              onClick={() => {
                setRotationAngle(0);
                updateRotation(0);
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2 py-1 rounded"
            >
              Reset
            </button>
          </div>

          {/* CPR Mode Control */}
          <div className="flex items-center gap-3">
            <div className="text-white text-sm">CPR Mode:</div>
            <div className="flex gap-2">
              <button
                onClick={() => updateCPRMode(false)}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  !isCurvedCPR 
                    ? 'bg-green-600 text-white' 
                    : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                }`}
              >
                Straight
              </button>
              <button
                onClick={() => updateCPRMode(true)}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  isCurvedCPR 
                    ? 'bg-purple-600 text-white' 
                    : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                }`}
              >
                Curved
              </button>
            </div>
            <div className="text-slate-400 text-xs">
              {isCurvedCPR ? 'Curved vessel path' : 'Straightened vessel path'}
            </div>
          </div>
        </div>
      </div>

      {/* Tri-View Layout */}
      <div className="grid grid-cols-3 h-full gap-1 bg-slate-900" style={{ marginTop: '60px' }}>
        {/* CPR View 1 */}
        <div className="relative bg-black border border-slate-700">
          <div className="absolute bottom-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
            CPR View 1
          </div>
          <div 
            ref={cpr1Ref} 
            className="w-full h-full"
          />
          
          {/* Horizontal crosshair showing current slice position */}
          <div className="absolute inset-0 pointer-events-none" style={{zIndex: 9998}}>
            <div 
              className="absolute left-0 right-0 h-px bg-red-500 opacity-75"
              style={{
                top: `${crosshairPosition * 100}%`,
                boxShadow: '0 0 3px rgba(255, 0, 0, 0.8)'
              }}
            ></div>
            <div 
              className="absolute left-0 right-0 h-0.5 bg-red-300 opacity-50"
              style={{
                top: `${crosshairPosition * 100}%`,
              }}
            ></div>
          </div>
          
        </div>
        
        {/* Cross Section View */}
        <div className="relative bg-black border border-slate-700">
          <div 
            ref={crossSectionRef} 
            className="w-full h-full"
          />
          
          {/* View label */}
          <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded" style={{zIndex: 9999}}>
            Cross Section
          </div>
          
          {/* Rotating crosshair indicator */}
          <div className="absolute inset-0 pointer-events-none" style={{zIndex: 9998}}>
            <div 
              className="absolute inset-0"
              style={{
                transform: `rotate(${rotationAngle}deg)`,
                transformOrigin: 'center center'
              }}
            >
              <div className="absolute top-1/2 left-0 right-0 h-px bg-red-500 opacity-75"></div>
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-red-500 opacity-75"></div>
            </div>
          </div>
          
        </div>
        
        {/* CPR View 2 */}
        <div className="relative bg-black border border-slate-700">
          <div className="absolute bottom-2 left-2 z-10 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
            CPR View 2
          </div>
          <div 
            ref={cpr2Ref} 
            className="w-full h-full"
          />
          
          {/* Horizontal crosshair showing current slice position */}
          <div className="absolute inset-0 pointer-events-none" style={{zIndex: 9998}}>
            <div 
              className="absolute left-0 right-0 h-px bg-red-500 opacity-75"
              style={{
                top: `${crosshairPosition * 100}%`,
                boxShadow: '0 0 3px rgba(255, 0, 0, 0.8)'
              }}
            ></div>
            <div 
              className="absolute left-0 right-0 h-0.5 bg-red-300 opacity-50"
              style={{
                top: `${crosshairPosition * 100}%`,
              }}
            ></div>
          </div>
          
        </div>
      </div>

    </div>
  );
};

export default TriViewCPRViewport;