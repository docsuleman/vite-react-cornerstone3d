import vtkImageCPRMapper from '@kitware/vtk.js/Rendering/Core/ImageCPRMapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkCubeSource from '@kitware/vtk.js/Filters/Sources/CubeSource';
import { vec3, mat3, mat4 } from 'gl-matrix';

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface CPRTransformData {
  worldActorTransform: Float32Array;
  directionMatrix: Float32Array;
  centerlineData: {
    positions: Float32Array;
    orientations: Float32Array;
  };
  cprToWorldTransform: (cprCoords: [number, number, number]) => [number, number, number];
  worldToCprTransform: (worldCoords: [number, number, number]) => [number, number, number];
}

interface CPRResult {
  cprImageData: any; // VTK ImageData
  transformData: CPRTransformData;
  width: number;
  height: number;
}

/**
 * VTK CPR Generator - Extracts CPR functionality from ImageCPRMapper.js
 * Generates CPR images while preserving coordinate transformation data
 */
export class VTKCPRGenerator {
  private mapper: any;
  private centerline: any;

  constructor() {
    this.mapper = vtkImageCPRMapper.newInstance();
    this.mapper.setBackgroundColor(0, 0, 0, 0);
    
    this.centerline = vtkPolyData.newInstance();
  }

  /**
   * Generate CPR from volume and centerline points
   * Based on ImageCPRMapper.js setCenterlineKey function
   */
  async generateCPR(
    volumeData: any, 
    centerlinePoints: Point3D[], 
    width: number = 400,
    height?: number
  ): Promise<CPRResult> {
    
    // Set input volume and width
    this.mapper.setInputData(volumeData, 0);
    this.mapper.setInputData(this.centerline, 1);
    this.mapper.setWidth(width);
    
    // Note: ImageCPRMapper calculates height automatically based on centerline length
    // We don't need to (and can't) set height manually

    // Convert centerline points to VTK format
    const centerlinePositions = new Float32Array(centerlinePoints.length * 3);
    for (let i = 0; i < centerlinePoints.length; i++) {
      centerlinePositions[i * 3] = centerlinePoints[i].x;
      centerlinePositions[i * 3 + 1] = centerlinePoints[i].y;
      centerlinePositions[i * 3 + 2] = centerlinePoints[i].z;
    }
    
    // Set positions of the centerline (model coordinates)
    const nPoints = centerlinePoints.length;
    this.centerline.getPoints().setData(centerlinePositions, 3);

    // Set polylines of the centerline
    const centerlineLines = new Uint16Array(1 + nPoints);
    centerlineLines[0] = nPoints;
    for (let i = 0; i < nPoints; ++i) {
      centerlineLines[i + 1] = i;
    }
    this.centerline.getLines().setData(centerlineLines);

    // Generate orientations along the centerline
    const orientations = this.generateCenterlineOrientations(centerlinePoints);
    
    // Create a rotated basis data array to orient the CPR
    this.centerline.getPointData().setTensors(
      vtkDataArray.newInstance({
        name: 'Orientation',
        numberOfComponents: 16,
        values: orientations,
      })
    );
    this.centerline.modified();

    // Get transform data from the mapper
    const midPointDistance = this.mapper.getHeight() / 2;
    const transformData = this.extractTransformData(midPointDistance);

    // Get the CPR image data
    const cprImageData = this.mapper.getOutputData();
    

    return {
      cprImageData,
      transformData,
      width: this.mapper.getWidth(),
      height: this.mapper.getHeight()
    };
  }

  /**
   * Generate orientations along centerline
   * Simplified version for smooth orientation interpolation
   */
  private generateCenterlineOrientations(points: Point3D[]): Float32Array {
    const orientations = new Float32Array(points.length * 16);
    
    for (let i = 0; i < points.length; i++) {
      // Calculate tangent vector
      let tangent: [number, number, number];
      if (i === 0) {
        // First point - use direction to next point
        tangent = [
          points[i + 1].x - points[i].x,
          points[i + 1].y - points[i].y,
          points[i + 1].z - points[i].z
        ];
      } else if (i === points.length - 1) {
        // Last point - use direction from previous point
        tangent = [
          points[i].x - points[i - 1].x,
          points[i].y - points[i - 1].y,
          points[i].z - points[i - 1].z
        ];
      } else {
        // Middle points - average of both directions
        const dir1 = [
          points[i].x - points[i - 1].x,
          points[i].y - points[i - 1].y,
          points[i].z - points[i - 1].z
        ];
        const dir2 = [
          points[i + 1].x - points[i].x,
          points[i + 1].y - points[i].y,
          points[i + 1].z - points[i].z
        ];
        tangent = [
          (dir1[0] + dir2[0]) / 2,
          (dir1[1] + dir2[1]) / 2,
          (dir1[2] + dir2[2]) / 2
        ];
      }
      
      // Normalize tangent
      vec3.normalize(tangent, tangent);
      
      // Create a simple orthonormal basis
      // Normal vector (try Z-axis first, then Y-axis if parallel)
      let normal: [number, number, number] = [0, 0, 1];
      if (Math.abs(vec3.dot(tangent, normal)) > 0.9) {
        normal = [0, 1, 0];
      }
      
      // Bitangent = tangent × normal
      const bitangent = vec3.cross([], tangent, normal);
      vec3.normalize(bitangent, bitangent);
      
      // Recalculate normal = bitangent × tangent
      vec3.cross(normal, bitangent, tangent);
      vec3.normalize(normal, normal);
      
      // Create 4x4 transformation matrix
      const matrix = mat4.fromValues(
        tangent[0], tangent[1], tangent[2], 0,
        bitangent[0], bitangent[1], bitangent[2], 0,
        normal[0], normal[1], normal[2], 0,
        points[i].x, points[i].y, points[i].z, 1
      );
      
      // Store in orientations array
      for (let j = 0; j < 16; j++) {
        orientations[i * 16 + j] = matrix[j];
      }
    }
    
    return orientations;
  }

  /**
   * Extract transformation data from the CPR mapper
   * Based on updateDistanceAndDirection function from ImageCPRMapper.js
   */
  private extractTransformData(distance: number): CPRTransformData {
    // Get orientation from distance
    const { position, orientation } = this.mapper.getCenterlinePositionAndOrientation(distance);
    const modelDirections = mat3.fromQuat([], orientation);
    
    // Create default world directions (identity for now)
    const worldTangent: [number, number, number] = [1, 0, 0];
    const worldBitangent: [number, number, number] = [0, 1, 0];
    const worldNormal: [number, number, number] = [0, 0, 1];
    
    // Calculate direction matrix
    const worldDirections = mat3.fromValues(
      ...worldTangent,
      ...worldBitangent,
      ...worldNormal
    );
    const inverseModelDirections = mat3.invert([], modelDirections);
    const baseDirections = mat3.mul([], inverseModelDirections, worldDirections);
    
    // Calculate world actor transform
    const width = this.mapper.getWidth();
    const height = this.mapper.getHeight();
    const worldWidgetCenter = position;
    
    const worldActorTranslation = vec3.scaleAndAdd(
      [],
      worldWidgetCenter,
      worldTangent,
      -0.5 * width
    );
    vec3.scaleAndAdd(
      worldActorTranslation,
      worldActorTranslation,
      worldNormal,
      distance - height
    );
    
    const worldActorTransform = mat4.fromValues(
      ...worldTangent, 0,
      ...worldNormal, 0,
      ...vec3.scale([], worldBitangent, -1), 0,
      ...worldActorTranslation, 1
    );

    // Create coordinate conversion functions
    const cprToWorldTransform = (cprCoords: [number, number, number]): [number, number, number] => {
      const result = vec3.transformMat4([], cprCoords, worldActorTransform);
      return [result[0], result[1], result[2]];
    };

    const worldToCprTransform = (worldCoords: [number, number, number]): [number, number, number] => {
      const inverseTransform = mat4.invert([], worldActorTransform);
      const result = vec3.transformMat4([], worldCoords, inverseTransform);
      return [result[0], result[1], result[2]];
    };

    return {
      worldActorTransform: new Float32Array(worldActorTransform),
      directionMatrix: new Float32Array(baseDirections),
      centerlineData: {
        positions: new Float32Array(this.centerline.getPoints().getData()),
        orientations: new Float32Array(this.centerline.getPointData().getTensors().getData())
      },
      cprToWorldTransform,
      worldToCprTransform
    };
  }

  /**
   * Update CPR with new distance/position along centerline
   */
  updateCPRPosition(distance: number): CPRTransformData {
    return this.extractTransformData(distance);
  }

  /**
   * Set CPR rotation angle
   */
  setCPRRotation(angleInDegrees: number): void {
    const radAngle = (angleInDegrees * Math.PI) / 180;
    
    // Compute normal and bitangent directions from angle
    const origin: [number, number, number] = [0, 0, 0];
    const normalDir: [number, number, number] = [0, 0, 1];
    const bitangentDir: [number, number, number] = [0, 1, 0];
    vec3.rotateZ(bitangentDir, bitangentDir, origin, radAngle);

    // Get current distance and orientation
    const distance = this.mapper.getHeight() / 2; // Default to middle
    const { orientation } = this.mapper.getCenterlinePositionAndOrientation(distance);
    const modelDirections = mat3.fromQuat([], orientation);

    // Transform directions to world space
    const worldBitangent = vec3.transformMat3([], bitangentDir, modelDirections);
    const worldNormal = vec3.transformMat3([], normalDir, modelDirections);

    // Update direction matrix
    const worldTangent = vec3.cross([], worldBitangent, worldNormal);
    const worldDirections = mat3.fromValues(
      ...worldTangent,
      ...worldBitangent,
      ...worldNormal
    );
    const inverseModelDirections = mat3.invert([], modelDirections);
    const baseDirections = mat3.mul([], inverseModelDirections, worldDirections);
    
    this.mapper.setDirectionMatrix(baseDirections);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.mapper) {
      this.mapper.delete();
    }
    if (this.centerline) {
      this.centerline.delete();
    }
  }
}

export default VTKCPRGenerator;