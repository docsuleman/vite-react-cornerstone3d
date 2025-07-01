import React, { useEffect, useRef, useState } from 'react';
import {
  RenderingEngine,
  Enums as CornerstoneEnums,
  Types,
  volumeLoader,
  cornerstoneStreamingImageVolumeLoader,
  cache,
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
import vtkImageCPRMapper from '@kitware/vtk.js/Rendering/Core/ImageCPRMapper';
import { ProjectionMode } from '@kitware/vtk.js/Rendering/Core/ImageCPRMapper/Constants';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkInteractorStyleImage from '@kitware/vtk.js/Interaction/Style/InteractorStyleImage';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import { FaSearchPlus, FaSearchMinus, FaAdjust, FaUndo, FaDotCircle } from 'react-icons/fa';

import createImageIdsAndCacheMetaData from '../lib/createImageIdsAndCacheMetaData';
import { initializeCornerstone } from '../utils/cornerstoneInit';
import { CenterlineGenerator } from '../utils/CenterlineGenerator';

// Register volume loader
volumeLoader.registerUnknownVolumeLoader(cornerstoneStreamingImageVolumeLoader);

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface TrueCPRViewportProps {
  patientInfo?: {
    patientID?: string;
    patientName?: string;
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
  };
  rootPoints: Point3D[];
  onCuspDotsUpdate?: (dots: { id: string; pos: [number, number, number]; color: string; cuspType: string }[]) => void;
  stage?: 'analysis' | 'annulus_definition';
  width?: number;
  height?: number;
  backgroundColor?: [number, number, number];
}

const TrueCPRViewport: React.FC<TrueCPRViewportProps> = ({
  patientInfo,
  rootPoints,
  onCuspDotsUpdate,
  stage = 'analysis',
  width = 800,
  height = 600,
  backgroundColor = [0, 0, 0]
}) => {
  // Refs for the three CPR views
  const cprMainRef = useRef<HTMLDivElement>(null);
  const cprLongRef = useRef<HTMLDivElement>(null);
  const cprCrossRef = useRef<HTMLDivElement>(null);
  
  // Refs for Cornerstone annotation overlays
  const overlayMainRef = useRef<HTMLDivElement>(null);
  const overlayLongRef = useRef<HTMLDivElement>(null);
  const overlayCrossRef = useRef<HTMLDivElement>(null);
  
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlacingCuspDots, setIsPlacingCuspDots] = useState(false);
  const [cuspDots, setCuspDots] = useState<Array<{
    id: string;
    worldPos: [number, number, number];
    color: string;
    cuspType: 'left' | 'right' | 'non-coronary';
  }>>([]);
  const [crossSectionPosition, setCrossSectionPosition] = useState(0.5); // 0 to 1 along centerline

  // VTK objects
  const vtkObjects = useRef<{
    main?: {
      renderWindow?: any;
      renderer?: any;
      cprMapper?: any;
      actor?: any;
      imageData?: any;
      genericRenderWindow?: any;
    };
    longitudinal?: {
      renderWindow?: any;
      renderer?: any;
      cprMapper?: any;
      actor?: any;
      imageData?: any;
      genericRenderWindow?: any;
    };
    cross?: {
      renderWindow?: any;
      renderer?: any;
      cprMapper?: any;
      actor?: any;
      imageData?: any;
      genericRenderWindow?: any;
    };
    volume?: any;
    centerlineData?: any;
  }>({});

  // Cornerstone objects for annotation overlays
  const cornerstoneObjects = useRef<{
    renderingEngine?: RenderingEngine;
    annotationRenderingEngine?: RenderingEngine;
    toolGroup?: any;
    cprToolGroup?: any;
    volumeId?: string;
    centerlineData?: any;
    crossSectionPosition?: number;
    lastViewUp?: number[];
    centerlineMetrics?: {
      totalLength: number;
      numPoints: number;
      segmentLengths: number[];
    };
  }>({});

  useEffect(() => {
    if (!patientInfo?.seriesInstanceUID || rootPoints.length < 3) return;

    console.log('🔄 Initializing True CPR Viewport with vtkImageCPRMapper...');
    
    const timer = setTimeout(() => {
      initializeTrueCPR();
    }, 100);

    return () => {
      clearTimeout(timer);
      cleanup();
    };
  }, [patientInfo, rootPoints]);

  const cleanup = () => {
    try {
      console.log('🧹 Cleaning up True CPR Viewport...');
      
      // Clean up VTK objects
      Object.values(vtkObjects.current).forEach((vtkView: any) => {
        if (vtkView?.renderWindow) {
          vtkView.renderWindow.delete();
        }
        if (vtkView?.genericRenderWindow) {
          vtkView.genericRenderWindow.delete();
        }
      });

      // Clean up Cornerstone objects
      if (cornerstoneObjects.current.toolGroup) {
        try {
          ToolGroupManager.destroyToolGroup('CPR_ANNOTATION_TOOLS');
        } catch (e) {
          console.warn('Failed to destroy tool group:', e);
        }
      }

      if (cornerstoneObjects.current.renderingEngine) {
        cornerstoneObjects.current.renderingEngine.destroy();
      }
      
      if (cornerstoneObjects.current.annotationRenderingEngine) {
        cornerstoneObjects.current.annotationRenderingEngine.destroy();
      }

      console.log('✅ True CPR Viewport cleanup complete');
    } catch (error) {
      console.warn('Cleanup error:', error);
    }
  };

  const initializeTrueCPR = async () => {
    try {
      setIsLoading(true);
      setError(null);

      console.log('🔄 Initializing Cornerstone3D and loading data...');
      await initializeCornerstone();

      // Load DICOM data
      const imageIds = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: patientInfo!.studyInstanceUID!,
        SeriesInstanceUID: patientInfo!.seriesInstanceUID!,
        wadoRsRoot: "http://127.0.0.1/orthanc/dicom-web",
      });

      if (imageIds.length === 0) {
        throw new Error('No DICOM images found for this series');
      }

      console.log(`📋 Found ${imageIds.length} DICOM images`);

      // Create volume (like working CornerstoneCPRViewport)
      const volumeName = `cprVolume_${Date.now()}`;
      const volumeId = `cornerstoneStreamingImageVolume:${volumeName}`;
      const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds });
      volume.load();

      // Wait for volume to load (like working CornerstoneCPRViewport)
      console.log('⏳ Waiting for volume to load...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      vtkObjects.current.volume = volume;
      cornerstoneObjects.current.volumeId = volumeId;

      // Generate centerline from root points
      console.log('📏 Generating centerline from root points...');
      const centerlineData = CenterlineGenerator.generateFromRootPoints(
        rootPoints.map((point, index) => ({
          id: `root-${index}`,
          position: [point.x, point.y, point.z] as [number, number, number],
          type: index === 0 ? 'lv_outflow' : index === 1 ? 'aortic_valve' : 'ascending_aorta',
          timestamp: Date.now()
        }))
      );

      // Setup Cornerstone3D viewports with CPR configuration (using discussion pattern)
      await setupCornerstoneViewportsWithCPR(volume, volumeId, centerlineData);

      // Setup interactive tools for CPR navigation
      await setupCPRInteractiveTools(volume, centerlineData);

      // Setup Cornerstone annotation overlays for cusp placement
      if (stage === 'annulus_definition') {
        await setupCornerstoneAnnotationOverlays(volume, imageIds);
      }

      setIsInitialized(true);
      setIsLoading(false);

      console.log('✅ True CPR Viewport initialized successfully!');

    } catch (err) {
      console.error('❌ Failed to initialize True CPR Viewport:', err);
      setError(`Failed to initialize: ${err}`);
      setIsLoading(false);
    }
  };

  const createCenterlinePolyData = async (centerlineData: any): Promise<any> => {
    console.log('🔧 Creating VTK PolyData from centerline with proper normals...');
    
    const polyData = vtkPolyData.newInstance();
    const points = vtkPoints.newInstance();
    const lines = vtkCellArray.newInstance();
    
    // Extract points from centerline
    const numPoints = centerlineData.position.length / 3;
    const pointsArray = new Float32Array(centerlineData.position.length);
    
    // Calculate total centerline length for proper scaling
    let totalLength = 0;
    let segmentLengths = [];
    
    for (let i = 0; i < numPoints; i++) {
      const x = centerlineData.position[i * 3];
      const y = centerlineData.position[i * 3 + 1];
      const z = centerlineData.position[i * 3 + 2];
      
      pointsArray[i * 3] = x;
      pointsArray[i * 3 + 1] = y;
      pointsArray[i * 3 + 2] = z;
      
      // Calculate segment lengths
      if (i > 0) {
        const dx = x - centerlineData.position[(i - 1) * 3];
        const dy = y - centerlineData.position[(i - 1) * 3 + 1];
        const dz = z - centerlineData.position[(i - 1) * 3 + 2];
        const segmentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
        segmentLengths.push(segmentLength);
        totalLength += segmentLength;
      }
    }
    
    // Store centerline metrics for proper scaling
    cornerstoneObjects.current.centerlineMetrics = {
      totalLength,
      numPoints,
      segmentLengths
    };
    
    console.log(`📏 Centerline metrics: length=${totalLength.toFixed(1)}mm, points=${numPoints}`);
    
    points.setData(pointsArray);
    
    // Calculate tangent vectors and normals along the centerline
    const tangents = new Float32Array(numPoints * 3);
    const normals = new Float32Array(numPoints * 3);
    
    for (let i = 0; i < numPoints; i++) {
      let tangent = [0, 0, 0];
      
      if (i === 0) {
        // First point: use direction to next point
        if (numPoints > 1) {
          tangent = [
            pointsArray[(i + 1) * 3] - pointsArray[i * 3],
            pointsArray[(i + 1) * 3 + 1] - pointsArray[i * 3 + 1],
            pointsArray[(i + 1) * 3 + 2] - pointsArray[i * 3 + 2]
          ];
        }
      } else if (i === numPoints - 1) {
        // Last point: use direction from previous point
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
      }
      
      // Calculate normal (perpendicular to tangent)
      // Use a reference vector and cross product to get consistent normals
      let normal = [0, 0, 0];
      
      // Choose reference vector that's not parallel to tangent
      let reference = [0, 1, 0]; // Y-axis
      if (Math.abs(tangent[1]) > 0.9) {
        reference = [1, 0, 0]; // X-axis if tangent is close to Y
      }
      
      // Calculate normal as cross product of tangent and reference
      normal[0] = tangent[1] * reference[2] - tangent[2] * reference[1];
      normal[1] = tangent[2] * reference[0] - tangent[0] * reference[2];
      normal[2] = tangent[0] * reference[1] - tangent[1] * reference[0];
      
      // Normalize normal
      const normalLength = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
      if (normalLength > 0) {
        normal[0] /= normalLength;
        normal[1] /= normalLength;
        normal[2] /= normalLength;
      }
      
      // Store vectors
      tangents[i * 3] = tangent[0];
      tangents[i * 3 + 1] = tangent[1];
      tangents[i * 3 + 2] = tangent[2];
      
      normals[i * 3] = normal[0];
      normals[i * 3 + 1] = normal[1];
      normals[i * 3 + 2] = normal[2];
    }
    
    // Create line connectivity
    const lineArray = new Uint32Array(numPoints + 1);
    lineArray[0] = numPoints; // Number of points in the line
    for (let i = 0; i < numPoints; i++) {
      lineArray[i + 1] = i;
    }
    
    lines.setData(lineArray);
    
    // Set up polydata
    polyData.setPoints(points);
    polyData.setLines(lines);
    
    // Add computed vectors as point data for CPR mapper
    const tangentData = vtkDataArray.newInstance({
      name: 'Tangents',
      numberOfComponents: 3,
      values: tangents,
    });
    polyData.getPointData().addArray(tangentData);
    
    const normalData = vtkDataArray.newInstance({
      name: 'Normals',
      numberOfComponents: 3,
      values: normals,
    });
    polyData.getPointData().addArray(normalData);
    polyData.getPointData().setNormals(normalData); // Set as primary normals
    
    console.log('✅ Centerline PolyData created with computed normals:', {
      points: numPoints,
      cells: polyData.getNumberOfCells(),
      hasTangents: true,
      hasNormals: true
    });
    
    return polyData;
  };

  const createModifiedCenterlineForCrossSection = async (originalCenterline: any, viewportId: string): Promise<any> => {
    console.log(`🔧 Creating modified centerline for cross-section view: ${viewportId}`);
    
    // Get original points
    const originalPoints = originalCenterline.getPoints().getData();
    const numPoints = originalPoints.length / 3;
    
    // Find middle point of centerline for cross-section
    const middleIndex = Math.floor(numPoints / 2);
    const middlePoint = [
      originalPoints[middleIndex * 3],
      originalPoints[middleIndex * 3 + 1],
      originalPoints[middleIndex * 3 + 2]
    ];
    
    // Get original tangent at middle point
    const originalTangents = originalCenterline.getPointData().getArray('Tangents');
    const tangent = originalTangents ? [
      originalTangents.getData()[middleIndex * 3],
      originalTangents.getData()[middleIndex * 3 + 1],
      originalTangents.getData()[middleIndex * 3 + 2]
    ] : [0, 0, 1];
    
    // Create a short perpendicular line for cross-section
    let perpendicular = [0, 0, 0];
    
    if (viewportId === 'cpr-main') {
      // For main view: perpendicular in XY plane
      perpendicular = [-tangent[1], tangent[0], 0];
    } else if (viewportId === 'cpr-cross') {
      // For cross view: perpendicular in XZ plane  
      perpendicular = [-tangent[2], 0, tangent[0]];
    }
    
    // Normalize perpendicular
    const perpLength = Math.sqrt(perpendicular[0] ** 2 + perpendicular[1] ** 2 + perpendicular[2] ** 2);
    if (perpLength > 0) {
      perpendicular[0] /= perpLength;
      perpendicular[1] /= perpLength;
      perpendicular[2] /= perpLength;
    }
    
    // Create short line perpendicular to centerline for cross-section
    const crossSectionLength = 5; // 5mm short line
    const crossPoints = new Float32Array(6); // 2 points
    
    crossPoints[0] = middlePoint[0] - perpendicular[0] * crossSectionLength;
    crossPoints[1] = middlePoint[1] - perpendicular[1] * crossSectionLength;
    crossPoints[2] = middlePoint[2] - perpendicular[2] * crossSectionLength;
    
    crossPoints[3] = middlePoint[0] + perpendicular[0] * crossSectionLength;
    crossPoints[4] = middlePoint[1] + perpendicular[1] * crossSectionLength;
    crossPoints[5] = middlePoint[2] + perpendicular[2] * crossSectionLength;
    
    // Create new polydata for cross-section
    const crossPolyData = vtkPolyData.newInstance();
    const crossPointsVtk = vtkPoints.newInstance();
    const crossLines = vtkCellArray.newInstance();
    
    crossPointsVtk.setData(crossPoints);
    
    // Create line connectivity for 2 points
    const lineArray = new Uint32Array(3);
    lineArray[0] = 2; // Number of points
    lineArray[1] = 0; // First point index
    lineArray[2] = 1; // Second point index
    
    crossLines.setData(lineArray);
    
    crossPolyData.setPoints(crossPointsVtk);
    crossPolyData.setLines(crossLines);
    
    // Add normals pointing along original centerline direction
    const crossNormals = new Float32Array(6); // 2 points × 3 components
    crossNormals[0] = tangent[0];
    crossNormals[1] = tangent[1];
    crossNormals[2] = tangent[2];
    crossNormals[3] = tangent[0];
    crossNormals[4] = tangent[1];
    crossNormals[5] = tangent[2];
    
    const normalData = vtkDataArray.newInstance({
      name: 'Normals',
      numberOfComponents: 3,
      values: crossNormals,
    });
    crossPolyData.getPointData().addArray(normalData);
    crossPolyData.getPointData().setNormals(normalData);
    
    console.log(`✅ Modified centerline created for ${viewportId}:`, {
      originalPoints: numPoints,
      crossSectionPoints: 2,
      middlePoint,
      perpendicular,
      tangent
    });
    
    return crossPolyData;
  };

  const createCrossSectionCenterline = async (originalCenterline: any, viewportId: string): Promise<any> => {
    console.log(`🔧 Creating cross-section centerline (crosshair approach) for: ${viewportId}`);
    
    // Get original centerline points
    const originalPoints = originalCenterline.getPoints().getData();
    const numPoints = originalPoints.length / 3;
    
    // Find multiple cross-section points along the centerline (like crosshair slices)
    const numSlices = 20; // Create 20 cross-sectional slices along the centerline
    const crossSectionPoints = [];
    
    for (let slice = 0; slice < numSlices; slice++) {
      // Position along centerline (from start to end)
      const t = slice / (numSlices - 1); // 0 to 1
      const pointIndex = Math.floor(t * (numPoints - 1));
      
      // Get centerline point at this position
      const centerPoint = [
        originalPoints[pointIndex * 3],
        originalPoints[pointIndex * 3 + 1],
        originalPoints[pointIndex * 3 + 2]
      ];
      
      // Calculate tangent direction at this point
      let tangent = [1, 0, 0]; // Default
      if (pointIndex > 0 && pointIndex < numPoints - 1) {
        const prevPoint = [
          originalPoints[(pointIndex - 1) * 3],
          originalPoints[(pointIndex - 1) * 3 + 1],
          originalPoints[(pointIndex - 1) * 3 + 2]
        ];
        const nextPoint = [
          originalPoints[(pointIndex + 1) * 3],
          originalPoints[(pointIndex + 1) * 3 + 1],
          originalPoints[(pointIndex + 1) * 3 + 2]
        ];
        
        tangent = [
          nextPoint[0] - prevPoint[0],
          nextPoint[1] - prevPoint[1],
          nextPoint[2] - prevPoint[2]
        ];
        
        // Normalize tangent
        const length = Math.sqrt(tangent[0] ** 2 + tangent[1] ** 2 + tangent[2] ** 2);
        if (length > 0) {
          tangent[0] /= length;
          tangent[1] /= length;
          tangent[2] /= length;
        }
      }
      
      // Create perpendicular vector for cross-section
      let perpendicular;
      if (viewportId === 'cpr-main') {
        // First cross-section: perpendicular in XY plane
        perpendicular = [-tangent[1], tangent[0], 0];
      } else {
        // Second cross-section: perpendicular in XZ plane
        perpendicular = [-tangent[2], 0, tangent[0]];
      }
      
      // Normalize perpendicular
      const perpLength = Math.sqrt(perpendicular[0] ** 2 + perpendicular[1] ** 2 + perpendicular[2] ** 2);
      if (perpLength > 0) {
        perpendicular[0] /= perpLength;
        perpendicular[1] /= perpLength;
        perpendicular[2] /= perpLength;
      }
      
      // Create cross-section line through this point
      const crossLength = 20; // 20mm cross-section width
      
      // Add two points: one on each side of the centerline
      crossSectionPoints.push(
        centerPoint[0] - perpendicular[0] * crossLength,
        centerPoint[1] - perpendicular[1] * crossLength,
        centerPoint[2] - perpendicular[2] * crossLength
      );
      
      crossSectionPoints.push(
        centerPoint[0] + perpendicular[0] * crossLength,
        centerPoint[1] + perpendicular[1] * crossLength,
        centerPoint[2] + perpendicular[2] * crossLength
      );
    }
    
    // Create polydata from cross-section points
    const crossPolyData = vtkPolyData.newInstance();
    const crossPoints = vtkPoints.newInstance();
    const crossLines = vtkCellArray.newInstance();
    
    const pointsArray = new Float32Array(crossSectionPoints);
    crossPoints.setData(pointsArray);
    
    // Create line connectivity (connect all cross-section lines)
    const totalPoints = crossSectionPoints.length / 3;
    const lineArray = new Uint32Array(1 + totalPoints);
    lineArray[0] = totalPoints;
    for (let i = 0; i < totalPoints; i++) {
      lineArray[i + 1] = i;
    }
    
    crossLines.setData(lineArray);
    
    crossPolyData.setPoints(crossPoints);
    crossPolyData.setLines(crossLines);
    
    // Add normals pointing along original centerline direction for each point
    const normals = new Float32Array(totalPoints * 3);
    for (let i = 0; i < totalPoints; i += 2) {
      // Calculate tangent for this slice
      const sliceIndex = Math.floor(i / 2);
      const t = sliceIndex / (numSlices - 1);
      const pointIndex = Math.floor(t * (numPoints - 1));
      
      let tangent = [1, 0, 0];
      if (pointIndex > 0 && pointIndex < numPoints - 1) {
        const prevPoint = [
          originalPoints[(pointIndex - 1) * 3],
          originalPoints[(pointIndex - 1) * 3 + 1],
          originalPoints[(pointIndex - 1) * 3 + 2]
        ];
        const nextPoint = [
          originalPoints[(pointIndex + 1) * 3],
          originalPoints[(pointIndex + 1) * 3 + 1],
          originalPoints[(pointIndex + 1) * 3 + 2]
        ];
        
        tangent = [
          nextPoint[0] - prevPoint[0],
          nextPoint[1] - prevPoint[1],
          nextPoint[2] - prevPoint[2]
        ];
        
        const length = Math.sqrt(tangent[0] ** 2 + tangent[1] ** 2 + tangent[2] ** 2);
        if (length > 0) {
          tangent[0] /= length;
          tangent[1] /= length;
          tangent[2] /= length;
        }
      }
      
      // Set normals for both points of this cross-section
      normals[i * 3] = tangent[0];
      normals[i * 3 + 1] = tangent[1];
      normals[i * 3 + 2] = tangent[2];
      
      normals[(i + 1) * 3] = tangent[0];
      normals[(i + 1) * 3 + 1] = tangent[1];
      normals[(i + 1) * 3 + 2] = tangent[2];
    }
    
    const normalData = vtkDataArray.newInstance({
      name: 'Normals',
      numberOfComponents: 3,
      values: normals,
    });
    crossPolyData.getPointData().addArray(normalData);
    crossPolyData.getPointData().setNormals(normalData);
    
    console.log(`✅ Cross-section centerline created for ${viewportId}:`, {
      originalPoints: numPoints,
      crossSectionSlices: numSlices,
      totalCrossPoints: totalPoints
    });
    
    return crossPolyData;
  };

  const convertCornerstoneVolumeToVTK = async (volume: any): Promise<any> => {
    console.log('🔧 Converting Cornerstone volume to VTK ImageData...');
    
    try {
      // Get volume data using the correct method that doesn't get stuck
      console.log('📊 Getting scalar data from voxelManager...');
      const scalarData = volume.voxelManager.getCompleteScalarDataArray();
      console.log('✅ Got scalar data successfully:', scalarData?.length);
      
      if (!scalarData || scalarData.length === 0) {
        throw new Error('Volume scalar data is empty or not available');
      }
      
      const { dimensions, spacing, origin, direction } = volume;
      
      console.log('📊 Volume info:', { 
        dimensions, 
        spacing, 
        origin, 
        scalarDataLength: scalarData.length,
        scalarDataType: scalarData.constructor.name
      });
      
      // Validate dimensions
      if (!dimensions || dimensions.length !== 3) {
        throw new Error('Invalid volume dimensions');
      }
      
      // Check that dimensions match scalar data length
      const expectedLength = dimensions[0] * dimensions[1] * dimensions[2];
      if (scalarData.length !== expectedLength) {
        console.warn(`⚠️ Scalar data length (${scalarData.length}) doesn't match dimensions (${expectedLength})`);
      }
      
      // Create VTK ImageData
      const vtkImageData = vtkImageData.newInstance();
      vtkImageData.setDimensions(dimensions);
      vtkImageData.setSpacing(spacing || [1, 1, 1]);
      vtkImageData.setOrigin(origin || [0, 0, 0]);
      
      // Set direction matrix if available
      if (direction && direction.length === 9) {
        vtkImageData.setDirection(direction);
      }
      
      // Create a copy of scalar data to avoid reference issues
      const scalarDataCopy = new scalarData.constructor(scalarData);
      
      // Set scalar data
      const scalars = vtkDataArray.newInstance({
        name: 'scalars',
        values: scalarDataCopy,
        numberOfComponents: 1
      });
      
      vtkImageData.getPointData().setScalars(scalars);
      
      // Verify the VTK ImageData was created correctly
      const vtkDimensions = vtkImageData.getDimensions();
      const vtkSpacing = vtkImageData.getSpacing();
      const vtkOrigin = vtkImageData.getOrigin();
      
      console.log('✅ VTK ImageData created:', {
        dimensions: vtkDimensions,
        spacing: vtkSpacing,
        origin: vtkOrigin,
        numberOfPoints: vtkImageData.getNumberOfPoints(),
        numberOfCells: vtkImageData.getNumberOfCells()
      });
      
      return vtkImageData;
      
    } catch (error) {
      console.error('❌ Failed to convert volume to VTK:', error);
      throw error;
    }
  };

  const setupCornerstoneViewportsWithCPR = async (volume: any, volumeId: string, centerlineData: any) => {
    console.log('🔧 Setting up Cornerstone3D viewports with CPR mapper...');
    
    // Create rendering engine
    const renderingEngineId = 'trueCPREngine';
    const renderingEngine = new RenderingEngine(renderingEngineId);
    
    // Setup viewports - mix of true cross-sections and CPR with wider coverage
    const viewports = [
      { 
        ref: cprMainRef, 
        id: 'cpr-main',
        title: 'Cross Section (Orthographic)',
        orientation: CornerstoneEnums.OrientationAxis.AXIAL,
        type: 'orthographic',  // True cross-section like before
        cprWidth: 150  // Increased width for better coverage
      },
      { 
        ref: cprLongRef, 
        id: 'cpr-longitudinal', 
        title: 'CPR Longitudinal (Stretched)',
        orientation: CornerstoneEnums.OrientationAxis.SAGITTAL,
        mode: 'stretched',  // Keep this working CPR
        type: 'cpr',
        cprWidth: 150  // Increased width to reduce cropping
      },
      { 
        ref: cprCrossRef, 
        id: 'cpr-cross',
        title: 'CPR Long Axis (Side View)',
        orientation: CornerstoneEnums.OrientationAxis.CORONAL,
        mode: 'stretched',  // Same as middle but rotated camera
        type: 'cpr',
        cprWidth: 150,  // Increased width to reduce cropping
        cprView: 'side'  // Flag for side view camera
      }
    ];
    
    // Enable viewports - different setup for CPR vs orthographic
    for (const viewport of viewports) {
      if (!viewport.ref.current) continue;
      
      console.log(`🔧 Setting up ${viewport.id} as ${viewport.type}...`);
      
      renderingEngine.enableElement({
        viewportId: viewport.id,
        type: CornerstoneEnums.ViewportType.ORTHOGRAPHIC,
        element: viewport.ref.current,
        defaultOptions: {
          orientation: viewport.orientation,
          background: backgroundColor as Types.Point3,
        },
      });
      
      // Set volume on viewport
      const csViewport = renderingEngine.getViewport(viewport.id) as Types.IVolumeViewport;
      csViewport.setVolumes([{ volumeId }]);
      
      // Wait for volume to render
      await new Promise(resolve => setTimeout(resolve, 100));
      csViewport.render();
      
      // Store centerline data first
      cornerstoneObjects.current.centerlineData = centerlineData;
      
      // For orthographic cross-sections, position camera at centerline point
      if (viewport.type === 'orthographic') {
        await setupOrthographicCrossSection(csViewport, centerlineData, viewport.id);
      }
    }
    
    // Store rendering engine reference for later use
    cornerstoneObjects.current.renderingEngine = renderingEngine;
    
    // Add CPR actors only to CPR viewports
    const cprViewports = viewports.filter(v => v.type === 'cpr');
    if (cprViewports.length > 0) {
      await addCPRActorsToViewports(renderingEngine, centerlineData, cprViewports);
    }
    
    console.log('✅ Cornerstone3D CPR viewports with CPR mappers setup complete');
  };

  const setupCPRInteractiveTools = async (volume: any, centerlineData: any) => {
    console.log('🔧 Setting up CPR interactive tools...');
    
    try {
      // Create tool group for CPR navigation
      const toolGroup = ToolGroupManager.createToolGroup('CPR_NAVIGATION_TOOLS');
      
      if (!toolGroup) {
        console.error('Failed to create CPR navigation tool group');
        return;
      }

      // Add Line tool for cross-section navigation
      addTool(ProbeTool); // We'll use this as base, can create custom later
      
      toolGroup.addTool(ProbeTool.toolName);
      toolGroup.setToolActive(ProbeTool.toolName, {
        bindings: [
          {
            mouseButton: ToolEnums.MouseBindings.Primary,
          },
        ],
      });

      // Add the longitudinal viewport to the tool group
      toolGroup.addViewport('trueCPREngine', 'cpr-longitudinal');
      
      // Store references
      cornerstoneObjects.current.cprToolGroup = toolGroup;
      cornerstoneObjects.current.centerlineData = centerlineData;

      // Set up line annotation for cross-section navigation
      await setupCrossSectionNavigationLine(centerlineData);
      
      console.log('✅ CPR interactive tools setup complete');
      
    } catch (error) {
      console.error('❌ Failed to setup CPR interactive tools:', error);
    }
  };

  const setupCrossSectionNavigationLine = async (centerlineData: any) => {
    console.log('🔧 Setting up cross-section navigation line...');
    
    // For now, we'll manually create a line annotation
    // This will be improved with a custom tool later
    
    // Calculate initial position (middle of centerline)
    const numPoints = centerlineData.position.length / 3;
    const middleIndex = Math.floor(numPoints / 2);
    
    // Initial cross-section position (use current state value)
    const initialCrossSectionPosition = 0.5;
    setCrossSectionPosition(initialCrossSectionPosition);
    
    // Store the position for cross-section updates
    cornerstoneObjects.current.crossSectionPosition = initialCrossSectionPosition;
    
    console.log('✅ Cross-section navigation line setup at position:', initialCrossSectionPosition);
    
    // Update cross-section view
    await updateCrossSectionView(centerlineData, initialCrossSectionPosition);
  };

  const updateCrossSectionView = async (centerlineData: any, position: number) => {
    console.log('🔧 Updating cross-section view at position:', position);
    
    try {
      // Store the current position
      cornerstoneObjects.current.crossSectionPosition = position;
      
      // Get the rendering engine
      const renderingEngine = cornerstoneObjects.current.renderingEngine;
      if (!renderingEngine) {
        console.warn('No rendering engine available for cross-section update');
        return;
      }

      // Get cross-section viewport
      const crossSectionViewport = renderingEngine.getViewport('cpr-main') as Types.IVolumeViewport;
      if (!crossSectionViewport) {
        console.warn('Cross-section viewport not found');
        return;
      }

      // Calculate point along centerline based on actual length
      const numPoints = centerlineData.position.length / 3;
      const metrics = cornerstoneObjects.current.centerlineMetrics;
      
      let pointIndex = Math.floor(position * (numPoints - 1));
      let centerPoint;
      
      // If we have centerline metrics, use actual length-based positioning
      if (metrics && metrics.segmentLengths) {
        const targetLength = position * metrics.totalLength;
        let accumulatedLength = 0;
        
        // Find the correct point based on accumulated length
        for (let i = 0; i < metrics.segmentLengths.length; i++) {
          accumulatedLength += metrics.segmentLengths[i];
          if (accumulatedLength >= targetLength) {
            pointIndex = i + 1;
            break;
          }
        }
      }
      
      centerPoint = [
        centerlineData.position[pointIndex * 3],
        centerlineData.position[pointIndex * 3 + 1],
        centerlineData.position[pointIndex * 3 + 2]
      ];

      console.log('📍 Cross-section update:', {
        position,
        pointIndex,
        numPoints,
        centerPoint,
        hasMetrics: !!metrics
      });
      
      // Calculate centerline direction at this point
      let tangent = [1, 0, 0]; // Default
      if (pointIndex > 0 && pointIndex < numPoints - 1) {
        const prevPoint = [
          centerlineData.position[(pointIndex - 1) * 3],
          centerlineData.position[(pointIndex - 1) * 3 + 1],
          centerlineData.position[(pointIndex - 1) * 3 + 2]
        ];
        const nextPoint = [
          centerlineData.position[(pointIndex + 1) * 3],
          centerlineData.position[(pointIndex + 1) * 3 + 1],
          centerlineData.position[(pointIndex + 1) * 3 + 2]
        ];
        
        tangent = [
          nextPoint[0] - prevPoint[0],
          nextPoint[1] - prevPoint[1],
          nextPoint[2] - prevPoint[2]
        ];
        
        // Normalize tangent
        const length = Math.sqrt(tangent[0] ** 2 + tangent[1] ** 2 + tangent[2] ** 2);
        if (length > 0) {
          tangent[0] /= length;
          tangent[1] /= length;
          tangent[2] /= length;
        }
      }

      // Use the same view up vector as the initial setup to maintain orientation
      const viewUp = cornerstoneObjects.current.lastViewUp || [0, 0, 1];
      
      // Update camera to look down centerline at this position
      const cameraDistance = 50;
      const cameraConfig = {
        position: [
          centerPoint[0] + tangent[0] * cameraDistance,
          centerPoint[1] + tangent[1] * cameraDistance,
          centerPoint[2] + tangent[2] * cameraDistance
        ] as Types.Point3,
        focalPoint: centerPoint as Types.Point3,
        viewUp: viewUp as Types.Point3,
        parallelScale: 30
      };

      // Update camera with new configuration
      crossSectionViewport.setCamera(cameraConfig);
      
      // Force render and ensure viewport updates
      crossSectionViewport.render();
      
      // Additional forced update to ensure camera changes take effect
      setTimeout(() => {
        crossSectionViewport.render();
      }, 10);
      
      console.log('✅ Cross-section view updated to position:', position, 'at point:', centerPoint, 'camera:', cameraConfig);
      
    } catch (error) {
      console.error('❌ Failed to update cross-section view:', error);
    }
  };


  const setupOrthographicCrossSection = async (csViewport: any, centerlineData: any, viewportId: string) => {
    console.log(`🔧 Setting up orthographic cross-section for ${viewportId}...`);
    
    // Get centerline points
    const numPoints = centerlineData.position.length / 3;
    
    // Use the dynamic cross-section position
    const position = cornerstoneObjects.current.crossSectionPosition || crossSectionPosition;
    const pointIndex = Math.floor(position * (numPoints - 1));
    
    const centerPoint = [
      centerlineData.position[pointIndex * 3],
      centerlineData.position[pointIndex * 3 + 1],
      centerlineData.position[pointIndex * 3 + 2]
    ];
    
    // Calculate centerline direction at this point
    let tangent = [1, 0, 0]; // Default
    if (pointIndex > 0 && pointIndex < numPoints - 1) {
      const prevPoint = [
        centerlineData.position[(pointIndex - 1) * 3],
        centerlineData.position[(pointIndex - 1) * 3 + 1],
        centerlineData.position[(pointIndex - 1) * 3 + 2]
      ];
      const nextPoint = [
        centerlineData.position[(pointIndex + 1) * 3],
        centerlineData.position[(pointIndex + 1) * 3 + 1],
        centerlineData.position[(pointIndex + 1) * 3 + 2]
      ];
      
      tangent = [
        nextPoint[0] - prevPoint[0],
        nextPoint[1] - prevPoint[1],
        nextPoint[2] - prevPoint[2]
      ];
      
      // Normalize tangent
      const length = Math.sqrt(tangent[0] ** 2 + tangent[1] ** 2 + tangent[2] ** 2);
      if (length > 0) {
        tangent[0] /= length;
        tangent[1] /= length;
        tangent[2] /= length;
      }
    }
    
    // Position camera to look along the centerline direction (for cross-section)
    const cameraDistance = 50; // Distance from the centerline point
    
    const cameraConfig = {
      position: [
        centerPoint[0] + tangent[0] * cameraDistance,
        centerPoint[1] + tangent[1] * cameraDistance,
        centerPoint[2] + tangent[2] * cameraDistance
      ] as Types.Point3,
      focalPoint: centerPoint as Types.Point3,
      viewUp: [0, 0, 1] as Types.Point3, // Z-up for cross-section
      parallelScale: 30 // Appropriate scale for cross-section
    };
    
    csViewport.setCamera(cameraConfig);
    csViewport.render();
    
    // Store initial view up vector for consistency
    if (!cornerstoneObjects.current.lastViewUp) {
      cornerstoneObjects.current.lastViewUp = [0, 0, 1];
    }
    
    console.log(`✅ Orthographic cross-section setup for ${viewportId}:`, {
      centerPoint,
      tangent,
      cameraPosition: cameraConfig.position
    });
  };

  const addCPRActorsToViewports = async (renderingEngine: any, centerlineData: any, viewports: any[]) => {
    console.log('🔧 Adding CPR actors to viewports:', viewports.map(v => v.id));
    
    // Create centerline polydata
    const centerlinePolyData = await createCenterlinePolyData(centerlineData);
    
    // Get the volume to access voxelManager (from discussion solution)
    const volume = vtkObjects.current.volume;
    if (!volume) {
      console.error('❌ Volume not available for CPR mapper');
      return;
    }
    
    for (const viewportConfig of viewports) {
      console.log(`🔧 Processing CPR viewport: ${viewportConfig.id}`);
      const csViewport = renderingEngine.getViewport(viewportConfig.id) as Types.IVolumeViewport;
      
      try {
        console.log(`🔧 Adding CPR actor to ${viewportConfig.id}...`);
        
        // Get image data from the viewport
        const imageData = csViewport.getImageData();
        console.log('📊 Got image data from viewport:', imageData);
        
        if (!imageData?.imageData) {
          console.warn(`⚠️ No image data available for ${viewportConfig.id}`);
          continue;
        }
        
        // Fix the scalars issue using the discussion solution
        console.log('🔧 Setting scalars manually using voxelManager...');
        const scalarData = volume.voxelManager.getCompleteScalarDataArray();
        console.log('📊 Got scalar data from voxelManager:', scalarData?.length);
        
        if (!scalarData || scalarData.length === 0) {
          console.warn(`⚠️ No scalar data available from voxelManager for ${viewportConfig.id}`);
          continue;
        }
        
        // Create scalar array manually (from discussion)
        const scalarArray = vtkDataArray.newInstance({
          name: 'Pixels',
          numberOfComponents: 1,
          values: scalarData,
        });
        
        // Set the scalars on the imageData
        imageData.imageData.getPointData().setScalars(scalarArray);
        console.log('✅ Scalars set manually on imageData');
        
        // Create CPR mapper
        const mapper = vtkImageCPRMapper.newInstance();
        
        // Configure mapper with different settings for each view
        if (viewportConfig.mode === 'straightened') {
          mapper.useStraightenedMode();
        } else if (viewportConfig.mode === 'stretched') {
          mapper.useStretchedMode();
        }
        
        // Use the same working centerline for all views
        mapper.setImageData(imageData.imageData);
        mapper.setCenterlineData(centerlinePolyData);
        mapper.setWidth(viewportConfig.cprWidth || 50);
        
        // Ensure proper spacing is maintained
        const spacing = volume.spacing;
        console.log(`📏 Volume spacing for ${viewportConfig.id}:`, spacing);
        
        // Set direction matrix for side view CPR
        if (viewportConfig.cprView === 'side') {
          // Rotate the CPR reconstruction itself 90 degrees for side view
          const sideDirections = new Float32Array([
            0, 1, 0,  // X becomes Y (rotate around Z)
            -1, 0, 0, // Y becomes -X
            0, 0, 1   // Z stays Z
          ]);
          mapper.setDirectionMatrix(sideDirections);
          console.log(`🔧 Set side view direction matrix for ${viewportConfig.id}`);
        } else {
          // Default direction matrix for front view
          console.log(`🔧 Using default direction matrix for ${viewportConfig.id}`);
        }
        
        // Set projection properties for better visualization (from discussion)
        mapper.setProjectionMode(ProjectionMode.AVERAGE);
        mapper.setProjectionSlabThickness(20);
        mapper.setProjectionSlabNumberOfSamples(100);
        
        
        // Debug: Check if mapper is ready
        const isReady = mapper.preRenderCheck();
        console.log(`🔍 CPR mapper ready for ${viewportConfig.id}:`, isReady);
        
        // Debug: Check centerline info
        const centerlineHeight = mapper.getHeight();
        console.log(`📏 CPR centerline height for ${viewportConfig.id}:`, centerlineHeight);
        
        // Debug: Check image data info
        const vtkImageDims = imageData.imageData.getDimensions();
        console.log(`📊 VTK ImageData dimensions for ${viewportConfig.id}:`, vtkImageDims);
        
        // Debug: Check centerline polydata
        const centerlinePoints = centerlinePolyData.getNumberOfPoints();
        const centerlineCells = centerlinePolyData.getNumberOfCells();
        console.log(`📊 Centerline polydata for ${viewportConfig.id}: ${centerlinePoints} points, ${centerlineCells} cells`);
        
        // Create actor with explicit properties for visibility
        const actor = vtkImageSlice.newInstance();
        actor.setMapper(mapper);
        
        // Ensure the CPR actor is visible
        actor.setVisibility(true);
        const property = actor.getProperty();
        property.setOpacity(1.0);
        property.setInterpolationTypeToLinear();
        
        // Set actor transformation matrix following the example (lines 187-210)
        // This is crucial for proper CPR display
        const actorWidth = mapper.getWidth();
        const actorHeight = mapper.getHeight();
        
        if (actorWidth > 0 && actorHeight > 0) {
          // Create identity matrix for now - the example computes complex transformations
          // but for our case, identity should work if camera is set correctly
          const identityMatrix = [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
          ];
          actor.setUserMatrix(identityMatrix);
          console.log('🔧 CPR actor user matrix set to identity');
        }
        
        console.log('🔧 CPR actor configured with full opacity and visibility');
        
        // Add CPR actor to viewport (CPR should render on top)
        const actorUID = `cprActor_${viewportConfig.id}`;
        csViewport.addActor({ uid: actorUID, actor });
        
        // Try to hide original volume actors after adding CPR (optional)
        try {
          console.log('🔧 Attempting to hide original volume actors...');
          const actors = csViewport.getActors();
          actors.forEach((actorEntry: any) => {
            if (actorEntry.uid !== actorUID) {
              // Try to hide the original volume actor
              const volumeActor = actorEntry.actor;
              if (volumeActor && volumeActor.setVisibility) {
                volumeActor.setVisibility(false);
                console.log(`🔧 Hidden volume actor: ${actorEntry.uid}`);
              }
            }
          });
        } catch (hideError) {
          console.log('⚠️ Could not hide original volume actors (CPR should still render on top):', hideError);
        }
        
        // Set up camera for CPR viewing - use centerline direction for cross-sections
        console.log(`🔧 Setting up camera for CPR view ${viewportConfig.id}...`);
        
        // Get bounds for basic positioning
        const bounds = actor.getBounds();
        console.log(`📊 CPR actor bounds for ${viewportConfig.id}:`, bounds);
        
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
          
          let cameraConfig;
          
          // Use same working camera for all CPR views - direction matrix handles the rotation
          cameraConfig = {
            position: [center[0], center[1], center[2] + maxDim] as Types.Point3,
            focalPoint: center as Types.Point3,
            viewUp: [0, 1, 0] as Types.Point3,
            parallelScale: maxDim / 2
          };
          
          csViewport.setCamera(cameraConfig);
          console.log(`📊 Camera set for ${viewportConfig.id}:`, cameraConfig);
        } else {
          csViewport.resetCamera();
        }
        
        csViewport.render();
        
        console.log(`✅ CPR actor added to ${viewportConfig.id}`);
        
      } catch (error) {
        console.error(`❌ Failed to add CPR actor to ${viewportConfig.id}:`, error);
      }
    }
    
    console.log('✅ All CPR actors added');
  };


  const setupCPRViews = async (imageData: any, centerlinePolyData: any) => {
    console.log('🔧 Setting up True CPR views with vtkImageCPRMapper...');
    
    const views = [
      { 
        ref: cprMainRef, 
        name: 'main',
        title: 'CPR En Face (Annulus View)',
        mode: 'straightened' // Straightened CPR for annulus view
      },
      { 
        ref: cprLongRef, 
        name: 'longitudinal',
        title: 'CPR Longitudinal (Stretched)',
        mode: 'stretched' // Stretched CPR for longitudinal view
      },
      { 
        ref: cprCrossRef, 
        name: 'cross',
        title: 'CPR Cross Section',
        mode: 'straightened' // Straightened for cross section
      }
    ];
    
    for (const view of views) {
      if (!view.ref.current) continue;
      
      console.log(`🔧 Setting up ${view.name} CPR view...`);
      
      // Create VTK rendering context
      const genericRenderWindow = vtkGenericRenderWindow.newInstance();
      genericRenderWindow.setContainer(view.ref.current);
      genericRenderWindow.resize();
      
      const renderer = genericRenderWindow.getRenderer();
      const renderWindow = genericRenderWindow.getRenderWindow();
      
      // Create CPR mapper
      const cprMapper = vtkImageCPRMapper.newInstance();
      
      console.log(`📊 Configuring CPR mapper for ${view.name}:`, {
        imageDataPoints: imageData.getNumberOfPoints(),
        centerlinePoints: centerlinePolyData.getNumberOfPoints(),
        mode: view.mode
      });
      
      // Configure CPR mapper
      try {
        cprMapper.setImageData(imageData);
        cprMapper.setCenterlineData(centerlinePolyData);
        cprMapper.setWidth(50); // 50mm width
        
        // Configure based on view type
        if (view.mode === 'straightened') {
          cprMapper.useStraightenedMode();
          console.log(`✅ ${view.name} configured in straightened mode`);
        } else if (view.mode === 'stretched') {
          cprMapper.useStretchedMode();
          console.log(`✅ ${view.name} configured in stretched mode`);
        }
        
        // Verify mapper is ready
        const isReady = cprMapper.preRenderCheck();
        console.log(`🔍 CPR mapper ${view.name} ready:`, isReady);
        
        if (!isReady) {
          console.warn(`⚠️ CPR mapper ${view.name} failed pre-render check`);
        }
        
      } catch (mapperError) {
        console.error(`❌ Failed to configure CPR mapper for ${view.name}:`, mapperError);
        throw mapperError;
      }
      
      // Create image slice actor
      const actor = vtkImageSlice.newInstance();
      actor.setMapper(cprMapper);
      
      // Add to renderer
      renderer.addActor(actor);
      renderer.resetCamera();
      
      // Set background color
      renderer.setBackground(backgroundColor[0], backgroundColor[1], backgroundColor[2]);
      
      // Store objects
      vtkObjects.current[view.name] = {
        renderWindow,
        renderer,
        cprMapper,
        actor,
        imageData,
        genericRenderWindow
      };
      
      // Initial render
      renderWindow.render();
      
      console.log(`✅ ${view.name} CPR view created`);
    }
    
    console.log('✅ All CPR views setup complete');
  };

  const setupCornerstoneAnnotationOverlays = async (volume: any, imageIds: string[]) => {
    console.log('🔧 Setting up Cornerstone annotation overlays...');
    
    try {
      // Initialize Cornerstone tools
      await toolsInit();
      addTool(ProbeTool);
      
      // Create rendering engine for overlays
      const renderingEngineId = 'cprAnnotationEngine';
      cornerstoneObjects.current.annotationRenderingEngine = new RenderingEngine(renderingEngineId);
      
      // Create transparent overlay viewports
      const overlayRefs = [
        { ref: overlayMainRef, id: 'overlay-main' },
        { ref: overlayLongRef, id: 'overlay-long' },
        { ref: overlayCrossRef, id: 'overlay-cross' }
      ];
      
      for (const overlay of overlayRefs) {
        if (overlay.ref.current) {
          cornerstoneObjects.current.annotationRenderingEngine!.enableElement({
            viewportId: overlay.id,
            type: CornerstoneEnums.ViewportType.ORTHOGRAPHIC,
            element: overlay.ref.current,
            defaultOptions: {
              background: [0, 0, 0, 0], // Transparent
            },
          });
          
          // Set volume but make it invisible
          const viewport = cornerstoneObjects.current.annotationRenderingEngine!.getViewport(overlay.id) as Types.IVolumeViewport;
          viewport.setVolumes([{ volumeId: cornerstoneObjects.current.volumeId! }]);
          
          // Make volume invisible but keep for coordinate mapping
          await new Promise(resolve => setTimeout(resolve, 100));
          viewport.render();
          
          const canvas = viewport.getCanvas();
          if (canvas) {
            canvas.style.background = 'transparent';
            canvas.style.pointerEvents = 'auto';
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.zIndex = '10';
          }
        }
      }
      
      // Setup tool group
      const toolGroupId = 'CPR_ANNOTATION_TOOLS';
      const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
      
      toolGroup.addTool(ProbeTool.toolName);
      toolGroup.setToolActive(ProbeTool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
      });
      
      // Add overlays to tool group
      overlayRefs.forEach(overlay => {
        toolGroup.addViewport(overlay.id, renderingEngineId);
      });
      
      cornerstoneObjects.current.toolGroup = toolGroup;
      
      console.log('✅ Cornerstone annotation overlays setup complete');
      
    } catch (error) {
      console.error('❌ Failed to setup annotation overlays:', error);
    }
  };

  const clearCuspDots = () => {
    console.log('🧹 Clearing cusp dots...');
    setCuspDots([]);
    
    if (onCuspDotsUpdate) {
      onCuspDotsUpdate([]);
    }
  };

  const handleCrossSectionPositionChange = async (position: number) => {
    console.log('🔧 Updating cross-section position to:', position);
    setCrossSectionPosition(position);
    
    // Update the cross-section view
    if (cornerstoneObjects.current.centerlineData) {
      await updateCrossSectionView(cornerstoneObjects.current.centerlineData, position);
    }
  };

  return (
    <div className="flex flex-col w-full h-full bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-white">
            {stage === 'annulus_definition' 
              ? 'True CPR Annulus Definition - Place 3 Cusp Nadir Points'
              : 'True CPR Analysis - Curved Planar Reconstruction'
            }
          </h3>
          {patientInfo && (
            <div className="text-sm text-slate-300">
              Patient: {patientInfo.patientName || 'Unknown'}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {/* Cusp Dot Controls - Only show during ANNULUS_DEFINITION stage */}
          {onCuspDotsUpdate && stage === 'annulus_definition' && (
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
            <span>Loading True CPR with vtkImageCPRMapper...</span>
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
                setTimeout(() => initializeTrueCPR(), 100);
              }}
              className="bg-red-700 hover:bg-red-600 px-3 py-1 rounded text-xs"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Cross-Section Navigation Control */}
      {isInitialized && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-slate-800 bg-opacity-90 text-white px-4 py-2 rounded-lg z-10 flex items-center gap-3">
          <span className="text-xs font-medium">Cross-Section Position:</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={crossSectionPosition}
            onChange={(e) => handleCrossSectionPositionChange(parseFloat(e.target.value))}
            className="w-32 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${crossSectionPosition * 100}%, #4b5563 ${crossSectionPosition * 100}%, #4b5563 100%)`
            }}
          />
          <span className="text-xs text-slate-300">{Math.round(crossSectionPosition * 100)}%</span>
        </div>
      )}

      {/* Instructions overlay */}
      {onCuspDotsUpdate && isPlacingCuspDots && stage === 'annulus_definition' && (
        <div className="absolute top-16 left-4 bg-teal-600 bg-opacity-90 text-white text-sm px-3 py-2 rounded z-10">
          Click on CPR views to place cusp nadir points ({cuspDots.length}/3)
        </div>
      )}

      {/* Three-View True CPR Layout */}
      <div className="flex-1 grid grid-cols-3 gap-1 bg-slate-900">
        {/* CPR En Face View */}
        <div className="relative bg-black border border-teal-600">
          <div className="absolute top-2 left-2 z-10 bg-teal-900 bg-opacity-90 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
            <div className="w-2 h-2 bg-teal-400 rounded-full animate-pulse"></div>
            True CPR: En Face
          </div>
          <div className="absolute bottom-2 left-2 z-10 bg-black bg-opacity-70 text-teal-300 text-[10px] px-2 py-1 rounded">
            Straightened CPR mode
          </div>
          {/* VTK CPR rendering */}
          <div ref={cprMainRef} className="w-full h-full" />
          {/* Cornerstone annotation overlay */}
          {stage === 'annulus_definition' && (
            <div 
              ref={overlayMainRef}
              className="absolute inset-0 pointer-events-auto"
              style={{
                background: 'transparent',
                zIndex: 5
              }}
            />
          )}
        </div>
        
        {/* CPR Longitudinal View */}
        <div className="relative bg-black border border-teal-600">
          <div className="absolute top-2 left-2 z-10 bg-teal-900 bg-opacity-90 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
            <div className="w-2 h-2 bg-teal-400 rounded-full animate-pulse"></div>
            True CPR: Longitudinal
          </div>
          <div className="absolute bottom-2 left-2 z-10 bg-black bg-opacity-70 text-teal-300 text-[10px] px-2 py-1 rounded">
            Stretched CPR mode
          </div>
          {/* VTK CPR rendering */}
          <div ref={cprLongRef} className="w-full h-full" />
          {/* Cross-section position line */}
          {isInitialized && (
            <div 
              className="absolute left-0 right-0 h-1 bg-yellow-500 opacity-80 cursor-ns-resize hover:h-2 transition-all"
              style={{
                // For stretched mode, position needs to be inverted
                top: `${crossSectionPosition * 100}%`,
                zIndex: 20
              }}
              onMouseDown={(e) => {
                const startY = e.clientY;
                const startPosition = crossSectionPosition;
                const rect = cprLongRef.current?.getBoundingClientRect();
                
                const handleMouseMove = (moveEvent: MouseEvent) => {
                  if (!rect) return;
                  const deltaY = moveEvent.clientY - startY;
                  const deltaPercent = deltaY / rect.height;
                  const newPosition = Math.max(0, Math.min(1, startPosition + deltaPercent));
                  handleCrossSectionPositionChange(newPosition);
                };
                
                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                };
                
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
              }}
            >
              <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-yellow-600 text-white text-xs px-2 py-1 rounded">
                {Math.round(crossSectionPosition * 100)}
              </div>
            </div>
          )}
          {/* Cornerstone annotation overlay */}
          {stage === 'annulus_definition' && (
            <div 
              ref={overlayLongRef}
              className="absolute inset-0 pointer-events-auto"
              style={{
                background: 'transparent',
                zIndex: 5
              }}
            />
          )}
        </div>
        
        {/* CPR Cross-Section View */}
        <div className="relative bg-black border border-teal-600">
          <div className="absolute top-2 left-2 z-10 bg-teal-900 bg-opacity-90 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
            <div className="w-2 h-2 bg-teal-400 rounded-full animate-pulse"></div>
            True CPR: Cross Section
          </div>
          <div className="absolute bottom-2 left-2 z-10 bg-black bg-opacity-70 text-teal-300 text-[10px] px-2 py-1 rounded">
            Straightened CPR mode
          </div>
          {/* VTK CPR rendering */}
          <div ref={cprCrossRef} className="w-full h-full" />
          {/* Cross-section position line */}
          {isInitialized && (
            <div 
              className="absolute left-0 right-0 h-1 bg-yellow-500 opacity-80 cursor-ns-resize hover:h-2 transition-all"
              style={{
                // For stretched mode, position needs to be inverted
                top: `${crossSectionPosition * 100}%`,
                zIndex: 20
              }}
              onMouseDown={(e) => {
                const startY = e.clientY;
                const startPosition = crossSectionPosition;
                const rect = cprCrossRef.current?.getBoundingClientRect();
                
                const handleMouseMove = (moveEvent: MouseEvent) => {
                  if (!rect) return;
                  const deltaY = moveEvent.clientY - startY;
                  const deltaPercent = deltaY / rect.height;
                  const newPosition = Math.max(0, Math.min(1, startPosition + deltaPercent));
                  handleCrossSectionPositionChange(newPosition);
                };
                
                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                };
                
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
              }}
            >
              <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-yellow-600 text-white text-xs px-2 py-1 rounded">
                {Math.round(crossSectionPosition * 100)}
              </div>
            </div>
          )}
          {/* Cornerstone annotation overlay */}
          {stage === 'annulus_definition' && (
            <div 
              ref={overlayCrossRef}
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
  );
};

export default TrueCPRViewport;