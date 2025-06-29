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
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import { FaCrosshairs, FaSearchPlus, FaSearchMinus, FaDotCircle } from 'react-icons/fa';

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
  annularPlane?: {
    center: [number, number, number];
    normal: [number, number, number];
    points: Array<{ id: string; position: [number, number, number]; type: string }>;
    confidence: number;
  };
  modifiedCenterline?: Point3D[];
  onAnnulusPointSelected?: (point: Point3D, crossSectionIndex: number) => void;
  onCuspDotsUpdate?: (dots: { id: string; pos: [number, number, number]; color: string; cuspType: string }[]) => void;
}

// Register volume loader
volumeLoader.registerUnknownVolumeLoader(cornerstoneStreamingImageVolumeLoader);

const TriViewCPRViewport: React.FC<TriViewCPRViewportProps> = ({
  patientInfo,
  rootPoints,
  annularPlane,
  modifiedCenterline,
  onAnnulusPointSelected,
  onCuspDotsUpdate
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
  const [cuspDots, setCuspDots] = useState<Array<{
    id: string;
    realWorldPos: [number, number, number]; // Real 3D CT coordinates in mm
    cprTransformedPos?: [number, number, number]; // Transformed coordinates in CPR space
    color: string;
    cuspType: 'left' | 'right' | 'non-coronary';
    placementIndex: number;
    sphereActors?: {
      cpr1?: any; // VTK sphere actor for CPR view 1
      crossSection?: any; // VTK sphere actor for cross-section view
      cpr2?: any; // VTK sphere actor for CPR view 2
    };
  }>>([]);
  const [isPlacingCuspDots, setIsPlacingCuspDots] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  
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
    transformationMatrices?: {
      cpr1ToWorld?: number[]; // 4x4 transformation matrix from CPR1 to world coordinates
      cpr2ToWorld?: number[]; // 4x4 transformation matrix from CPR2 to world coordinates
      crossSectionToWorld?: number[]; // 4x4 transformation matrix from cross-section to world coordinates
      worldToCpr1?: number[]; // Inverse transformation matrices
      worldToCpr2?: number[];
      worldToCrossSection?: number[];
    };
  }>({});

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

    // Fallback to original 3-point interpolation
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

  // Transform real world coordinates to CPR coordinate system
  const transformWorldToCPR = (
    worldPos: [number, number, number],
    viewIndex: number, // 0=CPR1, 1=CrossSection, 2=CPR2
    currentCrosshairPosition: number
  ): [number, number, number] => {
    const centerline = centerlinePoints;
    
    if (!centerline || centerline.length === 0) {
      return [0, 0, 0];
    }

    // For now, use a simple approach based on centerline position and perpendicular distance
    // This will be enhanced once we have the proper CPR transformation matrices
    
    // Find closest point on centerline
    let closestIndex = 0;
    let closestDistance = Infinity;
    
    for (let i = 0; i < centerline.length; i++) {
      const dist = Math.sqrt(
        Math.pow(worldPos[0] - centerline[i].x, 2) +
        Math.pow(worldPos[1] - centerline[i].y, 2) +
        Math.pow(worldPos[2] - centerline[i].z, 2)
      );
      if (dist < closestDistance) {
        closestDistance = dist;
        closestIndex = i;
      }
    }

    const closestPoint = centerline[closestIndex];
    const centerlineProgress = closestIndex / (centerline.length - 1);
    
    // Calculate offset from centerline
    const offset = [
      worldPos[0] - closestPoint.x,
      worldPos[1] - closestPoint.y,
      worldPos[2] - closestPoint.z
    ];
    
    // Calculate perpendicular distance (this will be refined with proper transformation matrices)
    const radialDistance = Math.sqrt(offset[0] * offset[0] + offset[1] * offset[1] + offset[2] * offset[2]);
    
    if (viewIndex === 1) {
      // Cross-section: return position on cross-section plane
      return [offset[0], offset[1], 0]; // Z=0 for cross-section plane
    } else {
      // CPR views: return position along centerline + perpendicular offset
      const alongCenterline = centerlineProgress * 100; // Scale to CPR length
      
      // Calculate view-specific perpendicular component
      let perpendicularOffset = 0;
      if (viewIndex === 0) {
        // CPR1: project onto one perpendicular direction
        perpendicularOffset = Math.sqrt(offset[0] * offset[0] + offset[2] * offset[2]);
        if (offset[0] < 0) perpendicularOffset = -perpendicularOffset;
      } else if (viewIndex === 2) {
        // CPR2: project onto perpendicular direction 90° rotated from CPR1
        perpendicularOffset = Math.sqrt(offset[1] * offset[1] + offset[2] * offset[2]);
        if (offset[1] < 0) perpendicularOffset = -perpendicularOffset;
      }
      
      return [alongCenterline, perpendicularOffset, 0];
    }
  };

  // Convert viewport click to real world coordinates
  const convertViewportToWorld = (
    viewportPos: [number, number], // Percentage coordinates (0-100)
    viewIndex: number, // 0=CPR1, 1=CrossSection, 2=CPR2
    currentCrosshairPosition: number // Current position along centerline (0-1)
  ): [number, number, number] => {
    const centerline = centerlinePoints;
    
    if (!centerline || centerline.length === 0) {
      console.warn('Cannot convert viewport to world: missing centerline');
      return [0, 0, 0];
    }

    // Get current point along centerline
    const pointIndex = Math.floor(currentCrosshairPosition * (centerline.length - 1));
    const currentPoint = centerline[pointIndex];

    if (viewIndex === 1) {
      // Cross-section view: convert to 3D coordinates on the cross-section plane
      const centerX = viewportPos[0] / 100 - 0.5; // Convert to -0.5 to 0.5 range
      const centerY = viewportPos[1] / 100 - 0.5;

      // Calculate cross-section plane vectors
      let tangent = [0, 0, 1];
      if (pointIndex < centerline.length - 1) {
        const nextPoint = centerline[pointIndex + 1];
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

      // Create perpendicular vectors
      const absX = Math.abs(tangent[0]);
      const absY = Math.abs(tangent[1]);
      const absZ = Math.abs(tangent[2]);
      
      let baseVector = [0, 0, 1];
      if (absZ > absX && absZ > absY) {
        baseVector = [1, 0, 0];
      }
      
      let normal1 = [
        tangent[1] * baseVector[2] - tangent[2] * baseVector[1],
        tangent[2] * baseVector[0] - tangent[0] * baseVector[2],
        tangent[0] * baseVector[1] - tangent[1] * baseVector[0]
      ];
      const norm1 = Math.sqrt(normal1[0] * normal1[0] + normal1[1] * normal1[1] + normal1[2] * normal1[2]);
      if (norm1 > 0.001) {
        normal1 = [normal1[0] / norm1, normal1[1] / norm1, normal1[2] / norm1];
      }
      
      let normal2 = [
        tangent[1] * normal1[2] - tangent[2] * normal1[1],
        tangent[2] * normal1[0] - tangent[0] * normal1[2],
        tangent[0] * normal1[1] - tangent[1] * normal1[0]
      ];
      const norm2 = Math.sqrt(normal2[0] * normal2[0] + normal2[1] * normal2[1] + normal2[2] * normal2[2]);
      if (norm2 > 0.001) {
        normal2 = [normal2[0] / norm2, normal2[1] / norm2, normal2[2] / norm2];
      }

      // Map viewport coordinates to 3D world coordinates
      const crossSectionSize = 32;
      const offsetX = centerX * crossSectionSize;
      const offsetY = centerY * crossSectionSize;

      const worldPos: [number, number, number] = [
        currentPoint.x + offsetX * normal1[0] + offsetY * normal2[0],
        currentPoint.y + offsetX * normal1[1] + offsetY * normal2[1],
        currentPoint.z + offsetX * normal1[2] + offsetY * normal2[2]
      ];

      console.log(`🎯 Cross-section (${viewportPos[0].toFixed(1)}, ${viewportPos[1].toFixed(1)}) -> World (${worldPos[0].toFixed(1)}, ${worldPos[1].toFixed(1)}, ${worldPos[2].toFixed(1)})`);
      return worldPos;

    } else {
      // CPR views: convert long-axis click to world coordinates
      const alongCenterline = viewportPos[0] / 100; // X position as fraction along centerline
      const radialOffset = (viewportPos[1] / 100 - 0.5) * 32; // Y position as radial distance

      // Get point along centerline
      const cprPointIndex = Math.floor(alongCenterline * (centerline.length - 1));
      const cprPoint = centerline[cprPointIndex];

      // Calculate direction perpendicular to centerline for this view
      let tangent = [0, 0, 1];
      if (cprPointIndex < centerline.length - 1) {
        const nextPoint = centerline[cprPointIndex + 1];
        tangent = [
          nextPoint.x - cprPoint.x,
          nextPoint.y - cprPoint.y,
          nextPoint.z - cprPoint.z
        ];
        const length = Math.sqrt(tangent[0] * tangent[0] + tangent[1] * tangent[1] + tangent[2] * tangent[2]);
        if (length > 0) {
          tangent = [tangent[0] / length, tangent[1] / length, tangent[2] / length];
        }
      }

      // Calculate perpendicular direction based on view
      const absX = Math.abs(tangent[0]);
      const absY = Math.abs(tangent[1]);
      const absZ = Math.abs(tangent[2]);
      
      let baseVector = [0, 0, 1];
      if (absZ > absX && absZ > absY) {
        baseVector = [1, 0, 0];
      }
      
      let normal1 = [
        tangent[1] * baseVector[2] - tangent[2] * baseVector[1],
        tangent[2] * baseVector[0] - tangent[0] * baseVector[2],
        tangent[0] * baseVector[1] - tangent[1] * baseVector[0]
      ];
      const norm1 = Math.sqrt(normal1[0] * normal1[0] + normal1[1] * normal1[1] + normal1[2] * normal1[2]);
      if (norm1 > 0.001) {
        normal1 = [normal1[0] / norm1, normal1[1] / norm1, normal1[2] / norm1];
      }
      
      let normal2 = [
        tangent[1] * normal1[2] - tangent[2] * normal1[1],
        tangent[2] * normal1[0] - tangent[0] * normal1[2],
        tangent[0] * normal1[1] - tangent[1] * normal1[0]
      ];
      const norm2 = Math.sqrt(normal2[0] * normal2[0] + normal2[1] * normal2[1] + normal2[2] * normal2[2]);
      if (norm2 > 0.001) {
        normal2 = [normal2[0] / norm2, normal2[1] / norm2, normal2[2] / norm2];
      }

      // Apply view-specific rotation for perpendicular direction
      const rotRad = (viewIndex === 0 ? 0 : Math.PI/2);
      const cosRot = Math.cos(rotRad);
      const sinRot = Math.sin(rotRad);
      
      const viewNormal = [
        normal1[0] * cosRot + normal2[0] * sinRot,
        normal1[1] * cosRot + normal2[1] * sinRot,
        normal1[2] * cosRot + normal2[2] * sinRot
      ];

      const worldPos: [number, number, number] = [
        cprPoint.x + radialOffset * viewNormal[0],
        cprPoint.y + radialOffset * viewNormal[1],
        cprPoint.z + radialOffset * viewNormal[2]
      ];

      console.log(`🎯 CPR view ${viewIndex} (${viewportPos[0].toFixed(1)}, ${viewportPos[1].toFixed(1)}) -> World (${worldPos[0].toFixed(1)}, ${worldPos[1].toFixed(1)}, ${worldPos[2].toFixed(1)})`);
      return worldPos;
    }
  };

  // Convert 3D world coordinates to 2D canvas coordinates for drawing
  const worldToCanvasCoords = (
    worldPos: [number, number, number],
    viewIndex: number,
    canvasWidth: number,
    canvasHeight: number
  ): [number, number] | null => {
    const centerline = centerlinePoints;
    
    if (!centerline || centerline.length === 0) {
      return null;
    }

    if (viewIndex === 1) {
      // Cross-section view: project 3D point onto current cross-section plane
      const pointIndex = Math.floor(crosshairPosition * (centerline.length - 1));
      const currentPoint = centerline[pointIndex];
      
      // Check if point is near current cross-section plane
      const distance = Math.sqrt(
        Math.pow(worldPos[0] - currentPoint.x, 2) +
        Math.pow(worldPos[1] - currentPoint.y, 2) +
        Math.pow(worldPos[2] - currentPoint.z, 2)
      );
      
      const distanceThreshold = 100; // 100mm tolerance for testing
      if (distance > distanceThreshold) {
        return null; // Not visible
      }

      // Simple projection: use the offset from current point scaled to canvas
      const offset = [
        worldPos[0] - currentPoint.x,
        worldPos[1] - currentPoint.y,
        worldPos[2] - currentPoint.z
      ];

      // Project to 2D canvas coordinates (simplified)
      const scale = 4; // Adjust scale as needed
      const x = canvasWidth / 2 + offset[0] * scale;
      const y = canvasHeight / 2 + offset[1] * scale;

      return [x, y];

    } else {
      // CPR views: project based on position along centerline
      let closestIndex = 0;
      let closestDistance = Infinity;
      
      for (let i = 0; i < centerline.length; i++) {
        const dist = Math.sqrt(
          Math.pow(worldPos[0] - centerline[i].x, 2) +
          Math.pow(worldPos[1] - centerline[i].y, 2) +
          Math.pow(worldPos[2] - centerline[i].z, 2)
        );
        if (dist < closestDistance) {
          closestDistance = dist;
          closestIndex = i;
        }
      }

      const dotCenterlinePos = closestIndex / (centerline.length - 1);
      const currentCenterlinePos = crosshairPosition;
      
      // Only show if near current crosshair position (generous threshold for testing)
      const proximityThreshold = 1.0; // Show in all positions for now
      const centerlineProximity = Math.abs(currentCenterlinePos - dotCenterlinePos);
      
      if (centerlineProximity > proximityThreshold) {
        return null;
      }

      // Calculate position along CPR
      const closestCenterlinePoint = centerline[closestIndex];
      
      const offset = [
        worldPos[0] - closestCenterlinePoint.x,
        worldPos[1] - closestCenterlinePoint.y,
        worldPos[2] - closestCenterlinePoint.z
      ];

      // Simple radial distance calculation
      const radialDistance = Math.sqrt(offset[0] * offset[0] + offset[1] * offset[1] + offset[2] * offset[2]);
      
      // Position along CPR - use dot's position on centerline
      const xPos = dotCenterlinePos * canvasWidth;
      const yPos = canvasHeight / 2 + (radialDistance / 20) * (canvasHeight / 4); // Scale for visibility
      
      return [xPos, yPos];
    }
  };

  // Draw sphere on canvas as a simple circle
  const drawSphereOnCanvas = (
    ctx: CanvasRenderingContext2D,
    canvasPos: [number, number],
    color: string,
    radius: number = 8
  ): void => {
    ctx.save();
    
    // Draw filled circle
    ctx.beginPath();
    ctx.arc(canvasPos[0], canvasPos[1], radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    
    // Draw border
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.restore();
  };

  // Add sphere actor to specific view renderer
  const addSphereToView = (sphereData: any, viewIndex: number): void => {
    // Spheres will be drawn during the redraw cycle
    console.log(`🎯 Sphere data added for view ${viewIndex} (will be drawn on canvas)`);
  };

  // Remove sphere actor from specific view renderer

  // Transform world coordinates to CPR coordinates for sphere positioning
  const transformWorldToCPRForSphere = (
    worldPos: [number, number, number],
    viewIndex: number
  ): [number, number, number] => {
    // For now, use simplified transformation
    // This will be enhanced once we extract the actual CPR transformation matrices from VTK
    
    const centerline = centerlinePoints;
    if (!centerline || centerline.length === 0) {
      return worldPos; // Return as-is if no centerline
    }

    // Find closest point on centerline
    let closestIndex = 0;
    let closestDistance = Infinity;
    
    for (let i = 0; i < centerline.length; i++) {
      const dist = Math.sqrt(
        Math.pow(worldPos[0] - centerline[i].x, 2) +
        Math.pow(worldPos[1] - centerline[i].y, 2) +
        Math.pow(worldPos[2] - centerline[i].z, 2)
      );
      if (dist < closestDistance) {
        closestDistance = dist;
        closestIndex = i;
      }
    }

    const closestPoint = centerline[closestIndex];
    const centerlineProgress = closestIndex / (centerline.length - 1);
    
    // Calculate offset from centerline
    const offset = [
      worldPos[0] - closestPoint.x,
      worldPos[1] - closestPoint.y,
      worldPos[2] - closestPoint.z
    ];
    
    if (viewIndex === 1) {
      // Cross-section: keep the original world coordinates but adjust for cross-section plane
      return worldPos;
    } else {
      // CPR views: transform to straightened vessel coordinates
      const cprLength = 100; // Assumption: CPR is 100mm long
      const alongCenterline = centerlineProgress * cprLength;
      
      // Calculate perpendicular offset based on view orientation
      let perpendicularOffset = 0;
      if (viewIndex === 0) {
        // CPR1: use X-Z plane offset
        perpendicularOffset = Math.sqrt(offset[0] * offset[0] + offset[2] * offset[2]);
        if (offset[0] < 0) perpendicularOffset = -perpendicularOffset;
      } else if (viewIndex === 2) {
        // CPR2: use Y-Z plane offset (90° rotated)
        perpendicularOffset = Math.sqrt(offset[1] * offset[1] + offset[2] * offset[2]);
        if (offset[1] < 0) perpendicularOffset = -perpendicularOffset;
      }
      
      // Return transformed CPR coordinates
      return [alongCenterline, perpendicularOffset, 0];
    }
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

  // Draw centerline overlay on CPR views
  const drawCenterlineOverlay = (ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number, centerlineLength: number) => {
    ctx.save();
    
    // Draw centerline as a thin line down the middle
    ctx.strokeStyle = '#00FF00'; // Bright green
    ctx.lineWidth = 1; // Thinner line
    ctx.setLineDash([]);
    
    // Centerline runs vertically down the middle of CPR views
    const centerX = canvasWidth / 2;
    
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, canvasHeight);
    ctx.stroke();
    
    // Add only 3 markers for the original anatomical points
    ctx.fillStyle = '#00FF00';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 0.5;
    
    // Three anatomical points: LV Outflow (0%), Aortic Valve (50%), Ascending Aorta (100%)
    const anatomicalPositions = [0, 0.5, 1.0];
    
    for (let i = 0; i < anatomicalPositions.length; i++) {
      const y = anatomicalPositions[i] * canvasHeight;
      
      // Draw small circle markers (smaller size)
      ctx.beginPath();
      ctx.arc(centerX, y, 2, 0, 2 * Math.PI); // Smaller radius
      ctx.fill();
      ctx.stroke();
    }
    
    ctx.restore();
  };

  // Setup canvas-based CPR views
  const setupCanvasCPRViews = async (cprData: any, centerlinePoints: Point3D[]) => {
    // Check if all container refs are available with detailed logging
    console.log('🔍 Checking container refs:', {
      cpr1Ref: !!cpr1Ref.current,
      crossSectionRef: !!crossSectionRef.current,
      cpr2Ref: !!cpr2Ref.current
    });
    
    if (!cpr1Ref.current || !crossSectionRef.current || !cpr2Ref.current) {
      console.warn('Container refs not ready:', {
        cpr1: cpr1Ref.current,
        crossSection: crossSectionRef.current,
        cpr2: cpr2Ref.current
      });
      throw new Error('Container elements not ready');
    }
    
    const views = [];
    const containers = [cpr1Ref.current, crossSectionRef.current, cpr2Ref.current];
    const cprImages = [cprData.cpr1, cprData.crossSection, cprData.cpr2];
    const labels = ['CPR View 1 (0°)', 'Cross Section', 'CPR View 2 (90°)'];
    
    console.log('🔍 CPR data structure:', {
      hasCpr1: !!cprData.cpr1,
      hasCrossSection: !!cprData.crossSection,
      hasCpr2: !!cprData.cpr2,
      cpr1Dimensions: cprData.cpr1 ? `${cprData.cpr1.width}x${cprData.cpr1.height}` : 'null',
      crossSectionDimensions: cprData.crossSection ? `${cprData.crossSection.width}x${cprData.crossSection.height}` : 'null',
      cpr2Dimensions: cprData.cpr2 ? `${cprData.cpr2.width}x${cprData.cpr2.height}` : 'null',
    });

    for (let i = 0; i < 3; i++) {
      const container = containers[i];
      const imageData = cprImages[i];
      const label = labels[i];
      
      if (!container) {
        throw new Error(`Container ${i} (${label}) is not available`);
      }
      
      if (!imageData || !imageData.width || !imageData.height) {
        throw new Error(`Image data for ${label} is invalid: ${JSON.stringify(imageData)}`);
      }
      
      console.log(`🔍 Setting up ${label} with container:`, container, 'imageData:', imageData);

      // Create canvas element
      const canvas = document.createElement('canvas');
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.objectFit = 'fill';
      canvas.style.background = 'black';
      
      // Clear container and add canvas with safety checks
      try {
        if (container.innerHTML === undefined) {
          throw new Error(`Container ${label} does not have innerHTML property`);
        }
        console.log(`🔍 Clearing container ${label}...`);
        container.innerHTML = '';
        console.log(`🔍 Adding canvas to container ${label}...`);
        container.appendChild(canvas);
      } catch (error) {
        console.error(`Failed to manipulate container ${label}:`, error);
        throw new Error(`Container manipulation failed for ${label}: ${error.message}`);
      }
      
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
      
      // Draw centerline overlay for CPR views (views 0 and 2)
      if (i === 0 || i === 2) {
        drawCenterlineOverlay(ctx, imageData.width, imageData.height, centerlinePoints.length);
      }
      
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
      // Check if we already have a loaded volume
      if (vtkObjects.current.volume) {
        console.log('🔄 Reusing existing volume for modified centerline');
        return { volume: vtkObjects.current.volume, imageIds: [] };
      }
      
      console.log('📥 Loading DICOM data...');
      const imageIds = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: patientInfo!.studyInstanceUID!,
        SeriesInstanceUID: patientInfo!.seriesInstanceUID!,
        wadoRsRoot: "http://127.0.0.1/orthanc/dicom-web",
      });

      if (imageIds.length === 0) {
        throw new Error('No DICOM images found for this series');
      }

      // Use a consistent volume ID to avoid creating multiple volumes
      const volumeId = `triViewCprVolume_${patientInfo!.seriesInstanceUID}`;
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
    // Prevent multiple simultaneous initializations
    if (isInitializing) {
      console.log('🚫 Initialization already in progress, skipping...');
      return;
    }
    
    try {
      setIsInitializing(true);
      setIsLoading(true);
      setError(null);

      console.log('🔄 Initializing TriView CPR with:', {
        hasModifiedCenterline: !!(modifiedCenterline && modifiedCenterline.length > 0),
        modifiedCenterlineLength: modifiedCenterline?.length,
        hasAnnularPlane: !!annularPlane,
        rootPointsLength: rootPoints.length
      });

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
      
      console.log('📏 Generated centerline points:', {
        length: centerlinePoints.length,
        isModified: !!(modifiedCenterline && modifiedCenterline.length > 0),
        firstPoint: centerlinePoints[0],
        lastPoint: centerlinePoints[centerlinePoints.length - 1]
      });
      
      if (centerlinePoints.length === 0) {
        throw new Error('Failed to generate centerline');
      }

      // Create proper CPR data from the centerline
      
      const cprData = await createCPRData(volume, centerlinePoints, rotationAngle);
      
      // Setup canvas-based CPR views with retry mechanism
      let views;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          views = await setupCanvasCPRViews(cprData, centerlinePoints);
          break; // Success, exit retry loop
        } catch (error) {
          retryCount++;
          if (error.message.includes('Container elements not ready') && retryCount < maxRetries) {
            console.log(`CPR setup retry ${retryCount}/${maxRetries}, waiting for containers...`);
            await new Promise(resolve => setTimeout(resolve, 200)); // Wait 200ms before retry
          } else {
            throw error; // Re-throw if it's a different error or max retries reached
          }
        }
      }
      
      if (!views) {
        throw new Error('Failed to setup CPR views after retries');
      }

      // Cache scalar data for fast re-initialization
      let scalarData = null;
      try {
        if (volume.getScalarData) {
          scalarData = volume.getScalarData();
        } else if (volume.scalarData) {
          scalarData = volume.scalarData;
        } else if (volume.voxelManager?.getScalarData) {
          scalarData = volume.voxelManager.getScalarData();
        }
      } catch (e) {
        console.warn('Could not cache scalar data:', e);
      }

      // Store references including CPR data for slice updates
      vtkObjects.current = {
        volume,
        scalarData, // Cache scalar data for re-initialization
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
              
              // Also cache scalar data if we got real data
              try {
                let newScalarData = null;
                if (volume.getScalarData) {
                  newScalarData = volume.getScalarData();
                } else if (volume.scalarData) {
                  newScalarData = volume.scalarData;
                } else if (volume.voxelManager?.getScalarData) {
                  newScalarData = volume.voxelManager.getScalarData();
                }
                if (newScalarData) {
                  vtkObjects.current.scalarData = newScalarData;
                  console.log('📦 Cached scalar data for future re-initialization');
                }
              } catch (e) {
                console.warn('Could not cache scalar data during retry:', e);
              }
              
              // Recreate the views with real data
              const newViews = await setupCanvasCPRViews(realCprData, centerlinePoints);
              vtkObjects.current.views = newViews;
              
              // Cusp dot interaction will be set up by useEffect
              
              
            }
          } catch (error) {
            console.warn('Still unable to load real DICOM data, keeping synthetic data');
          }
        }, 3000); // Try again after 3 seconds
      }

      setIsLoading(false);
      setIsInitializing(false);
      

    } catch (error) {
      console.error('Tri-View CPR initialization failed:', error);
      setError(`Failed to initialize tri-view CPR: ${error}`);
      setIsLoading(false);
      setIsInitializing(false);
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
            
            // Draw centerline overlay
            drawCenterlineOverlay(cpr1View.ctx, cpr1View.canvas.width, cpr1View.canvas.height, centerlinePoints.length);
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
            
            // Draw centerline overlay
            drawCenterlineOverlay(cpr2View.ctx, cpr2View.canvas.width, cpr2View.canvas.height, centerlinePoints.length);
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

  // Check if current crosshair position is at or near the annulus plane
  const isAtAnnulusPlane = (position: number): boolean => {
    if (!annularPlane || !modifiedCenterline) return false;
    
    // Find the annulus plane position in the modified centerline
    const annulusPlaneIndex = modifiedCenterline.findIndex(point => 
      point.x === annularPlane.center[0] && 
      point.y === annularPlane.center[1] && 
      point.z === annularPlane.center[2]
    );
    
    if (annulusPlaneIndex === -1) return false;
    
    const annulusPosition = annulusPlaneIndex / (modifiedCenterline.length - 1);
    const tolerance = 0.02; // 2% tolerance
    
    return Math.abs(position - annulusPosition) <= tolerance;
  };

  // Draw annulus plane indicators and cusp dots in cross-section view
  const drawAnnulusPlaneIndicators = (ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
    if (!annularPlane) return;
    
    // Draw annulus plane indicator (circle or ring)
    ctx.save();
    ctx.strokeStyle = '#00ff00'; // Green for annulus plane
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]); // Dashed line
    
    // Draw a circle to represent the annulus plane
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    const radius = Math.min(canvasWidth, canvasHeight) * 0.3; // 30% of viewport size
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Note: Cusp dots are now handled by the redrawCuspDots function using proper 3D projection
    // This prevents duplicate drawing and ensures consistent positioning
    
    // Add text label
    ctx.fillStyle = '#00ff00';
    ctx.font = '12px Arial';
    ctx.fillText('Annulus Plane', 10, 20);
    
    ctx.restore();
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
        
        // Cusp dot interaction will be set up by useEffect
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
          
          // Draw annulus plane indicators if we're at the annulus plane position
          if (isAtAnnulusPlane(newPosition)) {
            console.log('🎯 At annulus plane position, drawing indicators');
            drawAnnulusPlaneIndicators(crossSectionView.ctx, crossSectionView.canvas.width, crossSectionView.canvas.height);
          }
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

  // Clear all cusp dots
  const clearCuspDots = () => {
    // Remove DOM overlay elements
    const containers = [cpr1Ref.current, crossSectionRef.current, cpr2Ref.current];
    containers.forEach(container => {
      if (container) {
        const existingDots = container.querySelectorAll('.cusp-dot-overlay');
        existingDots.forEach(dot => dot.remove());
      }
    });

    // Clear state
    setCuspDots([]);

    console.log('🧹 Cleared all cusp dots in CPR view');
  };

  // Add cusp dot at specified position
  const addCuspDot = (viewportPos: [number, number], viewIndex: number) => {
    console.log(`🎯 addCuspDot called - current dots: ${cuspDots.length}, max: 3`);
    
    if (cuspDots.length >= 3) {
      console.warn('Maximum of 3 cusp dots already placed');
      return;
    }

    const cuspTypes: ('left' | 'right' | 'non-coronary')[] = ['left', 'right', 'non-coronary'];
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1']; // Red, Teal, Blue
    
    setCuspDots(currentDots => {
      const nextCuspIndex = currentDots.length;
      
      if (nextCuspIndex >= 3) {
        console.warn('Maximum of 3 cusp dots already placed');
        return currentDots;
      }
      
      const cuspType = cuspTypes[nextCuspIndex];
      const color = colors[nextCuspIndex];
      
      const dotId = `cusp-dot-${Date.now()}-${nextCuspIndex}`;
      
      console.log(`🎯 Creating cusp ${nextCuspIndex + 1}/3: ${cuspType} (${color})`);
      console.log(`🎯 Dot placement debug:`, {
        viewIndex,
        viewName: viewIndex === 0 ? 'CPR View 1' : viewIndex === 1 ? 'Cross Section' : 'CPR View 2',
        viewportPos,
        crosshairPosition
      });
      
      // Convert viewport click to real world coordinates
      const realWorldPos = convertViewportToWorld(viewportPos, viewIndex, crosshairPosition);
      
      // Debug: For testing, use centerline points as reference positions
      if (centerlinePoints.length > 0) {
        const debugIndex = Math.min(nextCuspIndex, centerlinePoints.length - 1);
        const debugPoint = centerlinePoints[debugIndex * Math.floor(centerlinePoints.length / 3)];
        console.log(`🎯 DEBUG: Using centerline point ${debugIndex} as reference:`, debugPoint);
        console.log(`🎯 DEBUG: Original realWorldPos:`, realWorldPos);
        console.log(`🎯 DEBUG: Viewport pos:`, viewportPos, 'View:', viewIndex);
      }
      
      // Transform to CPR coordinates for all views
      const cprTransformedPos = transformWorldToCPR(realWorldPos, viewIndex, crosshairPosition);
      
      // Create sphere data for all three views (to be drawn on canvas)
      const sphereActors = {
        cpr1: { worldPos: realWorldPos, color: color },
        crossSection: { worldPos: realWorldPos, color: color },
        cpr2: { worldPos: realWorldPos, color: color }
      };
      
      console.log(`🎯 Creating sphere data at world position (${realWorldPos[0].toFixed(1)}, ${realWorldPos[1].toFixed(1)}, ${realWorldPos[2].toFixed(1)})`);
      
      const newDot = {
        id: dotId,
        realWorldPos: realWorldPos, // Store real 3D CT coordinates
        cprTransformedPos: cprTransformedPos, // Store transformed CPR coordinates
        color: color,
        cuspType: cuspType,
        placementIndex: nextCuspIndex,
        sphereActors: sphereActors
      };
      
      // Debug: Check if views are initialized
      const views = vtkObjects.current.views;
      console.log(`🎯 Views initialized:`, {
        viewsExist: !!views,
        viewCount: views?.length || 0,
        view0: !!views?.[0]?.renderer,
        view1: !!views?.[1]?.renderer,
        view2: !!views?.[2]?.renderer
      });
      
      // Add sphere actors to all views
      addSphereToView(sphereActors.cpr1, 0);
      addSphereToView(sphereActors.crossSection, 1);
      addSphereToView(sphereActors.cpr2, 2);
      
      // Draw spheres at correct positions using coordinate transformation
      if (views) {
        views.forEach((view, viewIndex) => {
          if (view.ctx && view.canvas) {
            const canvasPos = worldToCanvasCoords(
              realWorldPos,
              viewIndex,
              view.canvas.width,
              view.canvas.height
            );
            
            if (canvasPos) {
              drawSphereOnCanvas(view.ctx, canvasPos, color, 4); // Even smaller radius
              console.log(`🎯 Drew sphere on view ${viewIndex} at position (${canvasPos[0].toFixed(1)}, ${canvasPos[1].toFixed(1)})`);
            } else {
              console.log(`🎯 Sphere not visible in view ${viewIndex} (outside proximity threshold)`);
            }
          }
        });
      }
      
      const updatedDots = [...currentDots, newDot];
      
      console.log(`🎯 Placed ${cuspType} cusp dot (${nextCuspIndex + 1}/3)`);
      console.log(`🎯 Real world position:`, realWorldPos);
      console.log(`🎯 CPR transformed position:`, cprTransformedPos);
      console.log(`🎯 Sphere actors created for all views`);
      
      // Notify parent component asynchronously
      setTimeout(() => {
        if (onCuspDotsUpdate) {
          const dotsForParent = updatedDots.map(dot => ({
            id: dot.id,
            pos: dot.realWorldPos, // Use real world coordinates
            color: dot.color,
            cuspType: dot.cuspType
          }));
          onCuspDotsUpdate(dotsForParent);
        }
      }, 0);
      
      return updatedDots;
    });
  };

  // Update sphere visibility based on crosshair position (Canvas-based)
  const updateSphereVisibility = (dots: typeof cuspDots) => {
    // Get canvases directly from DOM refs instead of VTK views
    const canvases = [
      cpr1Ref.current?.querySelector('canvas'),
      crossSectionRef.current?.querySelector('canvas'), 
      cpr2Ref.current?.querySelector('canvas')
    ];

    canvases.forEach((canvas, viewIndex) => {
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Clear entire canvas - we'll redraw everything including spheres
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Note: For a complete implementation, we would need to redraw the medical image here
      // For now, we'll just draw the spheres on a clear canvas as a demonstration
      
      // Draw visible spheres
      dots.forEach((dot) => {
        if (!dot.sphereActors) return;

        let isVisible = false;
        let sphereData = null;

        if (viewIndex === 1) {
          // Cross-section view: show/hide based on proximity to crosshair
          sphereData = dot.sphereActors.crossSection;
          if (sphereData) {
            const pointIndex = Math.floor(crosshairPosition * (centerlinePoints.length - 1));
            const currentPoint = centerlinePoints[pointIndex];
            
            if (currentPoint && dot.realWorldPos) {
              const distance = Math.sqrt(
                Math.pow(dot.realWorldPos[0] - currentPoint.x, 2) +
                Math.pow(dot.realWorldPos[1] - currentPoint.y, 2) +
                Math.pow(dot.realWorldPos[2] - currentPoint.z, 2)
              );
              
              const distanceThreshold = 50; // 50mm tolerance
              isVisible = distance <= distanceThreshold;
              console.log(`🎯 ${dot.cuspType} dot in cross-section: ${isVisible ? 'visible' : 'hidden'} (distance: ${distance.toFixed(1)}mm)`);
            }
          }
        } else if (viewIndex === 0 || viewIndex === 2) {
          // CPR views: show/hide based on proximity to current crosshair position along centerline
          sphereData = viewIndex === 0 ? dot.sphereActors.cpr1 : dot.sphereActors.cpr2;
          if (sphereData) {
            // Find closest point on centerline to this dot
            let closestIndex = 0;
            let closestDistance = Infinity;
            
            for (let i = 0; i < centerlinePoints.length; i++) {
              const dist = Math.sqrt(
                Math.pow(dot.realWorldPos[0] - centerlinePoints[i].x, 2) +
                Math.pow(dot.realWorldPos[1] - centerlinePoints[i].y, 2) +
                Math.pow(dot.realWorldPos[2] - centerlinePoints[i].z, 2)
              );
              if (dist < closestDistance) {
                closestDistance = dist;
                closestIndex = i;
              }
            }

            const dotCenterlinePos = closestIndex / (centerlinePoints.length - 1);
            const currentCenterlinePos = crosshairPosition;
            const centerlineProximity = Math.abs(currentCenterlinePos - dotCenterlinePos);
            const proximityThreshold = 0.8; // 80% of centerline length
            
            isVisible = centerlineProximity <= proximityThreshold;
            const viewName = viewIndex === 0 ? 'CPR1' : 'CPR2';
            console.log(`🎯 ${dot.cuspType} dot in ${viewName}: ${isVisible ? 'visible' : 'hidden'} (proximity: ${(centerlineProximity * 100).toFixed(1)}%)`);
          }
        }

        // Draw sphere if visible
        if (isVisible && sphereData) {
          const canvasPos = worldToCanvasCoords(
            dot.realWorldPos,
            viewIndex,
            canvas.width,
            canvas.height
          );
          
          if (canvasPos) {
            drawSphereOnCanvas(ctx, canvasPos, sphereData.color, 4); // Small radius
          }
        }
      });
    });
  };

  // Clean up sphere actors when dots are removed (Canvas-based)
  const cleanupSphereActors = (dots: typeof cuspDots) => {
    // For Canvas-based approach, we just need to redraw the canvases without the removed dots
    // This is handled by the next render cycle, so no specific cleanup is needed
    console.log(`🧹 Cleaned up ${dots.length} sphere actors (Canvas-based)`);
  };

  // Store click handlers to avoid memory leaks
  const clickHandlers = useRef<Array<(event: MouseEvent) => void>>([]);

  // Set up click handlers for cusp dot placement
  const setupCuspDotInteraction = () => {
    if (!cpr1Ref.current || !crossSectionRef.current || !cpr2Ref.current) {
      console.log('🎯 Container refs not ready for cusp dot interaction');
      return;
    }

    const containers = [cpr1Ref.current, crossSectionRef.current, cpr2Ref.current];
    const labels = ['CPR View 1', 'Cross Section', 'CPR View 2'];

    // Remove existing click handlers
    containers.forEach((container, index) => {
      if (container && clickHandlers.current[index]) {
        container.removeEventListener('click', clickHandlers.current[index]);
      }
    });

    // Clear handlers array
    clickHandlers.current = [];

    // Add new click handlers
    containers.forEach((container, index) => {
      if (!container) return;

      const clickHandler = (event: MouseEvent) => {
        // Check current state dynamically to avoid stale closure
        setCuspDots(currentDots => {
          if (!isPlacingCuspDots || currentDots.length >= 3) {
            console.log(`🎯 Click ignored - placing: ${isPlacingCuspDots}, dots: ${currentDots.length}/3`);
            return currentDots;
          }

          const rect = container.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          
          console.log(`🎯 Clicked in ${labels[index]} at (${x}, ${y}), current dots: ${currentDots.length}`);
          
          // For CPR views, use normalized screen coordinates instead of world coordinates
          // This makes more sense for CPR where we're placing dots on the 2D projection
          const normalizedX = x / rect.width;  // 0-1
          const normalizedY = y / rect.height; // 0-1
          
          // Use normalized screen coordinates (0-100 percentage)
          const viewportPos: [number, number] = [
            normalizedX * 100,  // Scale to 0-100 for easier positioning
            normalizedY * 100   // Scale to 0-100 for easier positioning
          ];
          
          console.log(`🎯 Placing cusp dot at viewport position:`, viewportPos);
          
          // Call addCuspDot with viewport coordinates
          addCuspDot(viewportPos, index);
          return currentDots;
        });
      };

      container.addEventListener('click', clickHandler);
      clickHandlers.current[index] = clickHandler;
    });
  };

  // Update interactors when cusp dot mode changes (only when placing mode changes)
  useEffect(() => {
    // Small delay to ensure CPR views are rendered
    const timer = setTimeout(() => {
      setupCuspDotInteraction();
    }, 100);
    
    return () => clearTimeout(timer);
  }, [isPlacingCuspDots]);

  // Update sphere visibility when crosshair position changes
  // TODO: Temporarily disabled to avoid clearing medical images during development
  // useEffect(() => {
  //   updateSphereVisibility(cuspDots);
  // }, [cuspDots, crosshairPosition]);

  // Cleanup sphere actors on unmount or when dots are cleared
  useEffect(() => {
    return () => {
      cleanupSphereActors(cuspDots);
    };
  }, []);

  // Clear dots when max count is reached (for testing)
  useEffect(() => {
    if (cuspDots.length >= 3) {
      console.log('🎯 Three cusp dots placed - sphere actors ready for visibility updates');
    }
  }, [cuspDots.length]);

  useEffect(() => {
    if (patientInfo && rootPoints.length >= 3 && !isInitializing) {
      // Skip if modified centerline is available - let the other useEffect handle it
      if (modifiedCenterline && modifiedCenterline.length > 0) {
        console.log('🔄 Skipping root points initialization - modified centerline will be used');
        return;
      }
      
      // Add a more robust delay and check for DOM readiness
      const initializeWithDelay = async () => {
        let attempts = 0;
        const maxAttempts = 10;
        
        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 200));
          
          // Check if refs are actually connected to DOM
          if (cpr1Ref.current?.parentElement && 
              crossSectionRef.current?.parentElement && 
              cpr2Ref.current?.parentElement) {
            console.log('🔍 DOM elements ready, initializing CPR...');
            initializeTriViewCPR();
            return;
          }
          
          attempts++;
          console.log(`🔍 Waiting for DOM elements... attempt ${attempts}/${maxAttempts}`);
        }
        
        console.error('❌ Failed to find DOM elements after maximum attempts');
      };
      
      initializeWithDelay();
    }
  }, [patientInfo, rootPoints, isInitializing]);

  // Re-initialize CPR when modified centerline changes (after annulus plane calculation)
  useEffect(() => {
    if (modifiedCenterline && modifiedCenterline.length > 0 && patientInfo && !isInitializing) {
      console.log('🔄 Modified centerline detected, re-initializing CPR with new centerline...');
      
      // Check if we already have volume and scalar data cached
      const hasExistingData = vtkObjects.current.volume && vtkObjects.current.scalarData;
      
      if (hasExistingData) {
        console.log('📦 Reusing existing volume and scalar data for modified centerline');
        
        // Fast re-initialization path using cached data
        const reinitializeWithCachedData = async () => {
          // Prevent multiple simultaneous re-initializations
          if (isInitializing) {
            console.log('🚫 Re-initialization already in progress, skipping...');
            return;
          }
          
          try {
            setIsInitializing(true);
            setIsLoading(true);
            setError(null);

            const { volume, scalarData } = vtkObjects.current;
            
            // Generate new centerline points
            const centerlinePoints = generateCenterlinePoints(rootPoints);
            setCenterlinePoints(centerlinePoints);
            
            if (centerlinePoints.length === 0) {
              throw new Error('Failed to generate modified centerline');
            }

            // Create CPR data using cached scalar data
            console.log('🏗️ Creating CPR data with cached volume and scalar data');
            const cprData = await createCPRData(volume, centerlinePoints, rotationAngle);
            console.log('✅ CPR data created successfully with modified centerline');
            
            // Clean up existing views
            console.log('🧹 Cleaning up existing views for fast re-initialization...');
            if (vtkObjects.current.views) {
              vtkObjects.current.views.forEach((view, index) => {
                if (view.canvas?.parentNode) {
                  console.log(`🧹 Removing canvas from view ${index}`);
                  view.canvas.parentNode.removeChild(view.canvas);
                }
              });
            }

            // Clear containers
            console.log('🧹 Clearing containers for fast re-initialization...');
            const containers = [cpr1Ref.current, crossSectionRef.current, cpr2Ref.current];
            containers.forEach((container, index) => {
              if (container) {
                console.log(`🧹 Clearing container ${index}`);
                container.innerHTML = '';
                container.style.background = 'black';
              }
            });

            // Setup new views with cached data
            const views = await setupCanvasCPRViews(cprData, centerlinePoints);

            // Update stored references
            vtkObjects.current = {
              volume,
              scalarData, // Keep cached scalar data
              centerline: centerlinePoints,
              views,
              cprData
            };

            setIsLoading(false);
            setIsInitializing(false);
            console.log('✅ CPR re-initialized successfully with modified centerline');
            
          } catch (error) {
            console.error('Failed to re-initialize with cached data:', error);
            setError(`Failed to update CPR view: ${error.message}`);
            setIsLoading(false);
            setIsInitializing(false);
          }
        };
        
        // Small delay to ensure the previous render cycle is complete
        const timer = setTimeout(reinitializeWithCachedData, 100);
        return () => clearTimeout(timer);
        
      } else {
        console.log('🔄 No cached data available, performing full re-initialization');
        
        // Full re-initialization path
        const timer = setTimeout(() => {
          initializeTriViewCPR();
        }, 100);
        
        return () => clearTimeout(timer);
      }
    }
  }, [modifiedCenterline, patientInfo, isInitializing]);

  // Cleanup function to remove event listeners
  useEffect(() => {
    return () => {
      // Remove click handlers on unmount
      const containers = [cpr1Ref.current, crossSectionRef.current, cpr2Ref.current];
      containers.forEach((container, index) => {
        if (container && clickHandlers.current[index]) {
          container.removeEventListener('click', clickHandlers.current[index]);
        }
      });
    };
  }, []);

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
        <div className="grid grid-cols-4 gap-6">
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

          {/* Cusp Dots Tool */}
          <div className="flex items-center gap-3">
            <div className="text-white text-sm">Cusp Dots:</div>
            <div className="flex gap-2">
              <button
                onClick={() => setIsPlacingCuspDots(!isPlacingCuspDots)}
                className={`px-3 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
                  isPlacingCuspDots 
                    ? 'bg-teal-600 text-white' 
                    : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                }`}
              >
                <FaDotCircle />
                {isPlacingCuspDots ? 'Active' : 'Place'}
              </button>
              <button
                onClick={() => clearCuspDots()}
                className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
                disabled={cuspDots.length === 0}
              >
                Clear ({cuspDots.length}/3)
              </button>
            </div>
            <div className="text-slate-400 text-xs">
              {cuspDots.length === 0 ? 'Click to place cusp nadir points' : `${cuspDots.length}/3 cusp dots placed`}
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
            
            {/* Annulus plane reference line */}
            {annularPlane && modifiedCenterline && (
              (() => {
                const annulusPlaneIndex = modifiedCenterline.findIndex(point => 
                  Math.abs(point.x - annularPlane.center[0]) < 0.1 && 
                  Math.abs(point.y - annularPlane.center[1]) < 0.1 && 
                  Math.abs(point.z - annularPlane.center[2]) < 0.1
                );
                const annulusPosition = annulusPlaneIndex !== -1 ? 
                  (annulusPlaneIndex / (modifiedCenterline.length - 1)) * 100 : null;
                
                return annulusPosition !== null ? (
                  <div 
                    className="absolute left-0 right-0 h-px bg-green-400 opacity-90"
                    style={{
                      top: `${annulusPosition}%`,
                      boxShadow: '0 0 3px rgba(74, 222, 128, 0.8)'
                    }}
                    title="Annulus Plane"
                  ></div>
                ) : null;
              })()
            )}
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
            
            {/* Annulus plane reference line */}
            {annularPlane && modifiedCenterline && (
              (() => {
                const annulusPlaneIndex = modifiedCenterline.findIndex(point => 
                  Math.abs(point.x - annularPlane.center[0]) < 0.1 && 
                  Math.abs(point.y - annularPlane.center[1]) < 0.1 && 
                  Math.abs(point.z - annularPlane.center[2]) < 0.1
                );
                const annulusPosition = annulusPlaneIndex !== -1 ? 
                  (annulusPlaneIndex / (modifiedCenterline.length - 1)) * 100 : null;
                
                return annulusPosition !== null ? (
                  <div 
                    className="absolute left-0 right-0 h-px bg-green-400 opacity-90"
                    style={{
                      top: `${annulusPosition}%`,
                      boxShadow: '0 0 3px rgba(74, 222, 128, 0.8)'
                    }}
                    title="Annulus Plane"
                  ></div>
                ) : null;
              })()
            )}
          </div>
          
        </div>
      </div>

    </div>
  );
};

export default TriViewCPRViewport;