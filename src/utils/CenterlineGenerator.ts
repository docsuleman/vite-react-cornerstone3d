import { Vector3 } from '@kitware/vtk.js/types';
import { vec3, mat3, mat4, quat } from 'gl-matrix';
import { RootPoint, RootPointType, CenterlineData } from '../types/WorkflowTypes';

interface SplinePoint {
  position: Vector3;
  tangent: Vector3;
  distance: number;
}

export class CenterlineGenerator {
  /**
   * Generate a smooth centerline from 3 or more root points
   */
  static generateFromRootPoints(rootPoints: RootPoint[]): CenterlineData {
    if (rootPoints.length < 3) {
      throw new Error('At least 3 root points are required for centerline generation');
    }
    
    console.log(`🔧 Generating centerline from ${rootPoints.length} root points...`);

    // Sort points by anatomical order: LV -> Valve -> Ascending Aorta
    const sortedPoints = this.sortRootPointsByOrder(rootPoints);
    const positions = sortedPoints.map(p => p.position);

    // Generate smooth spline through the points
    const splinePoints = this.generateCatmullRomSpline(positions, 50);
    
    // Calculate orientations along the spline
    const orientations = this.calculateOrientations(splinePoints);
    
    // Convert to the format expected by VTK ImageCPRMapper
    const centerlinePosition = new Float32Array(splinePoints.length * 3);
    const centerlineOrientation = new Float32Array(splinePoints.length * 16);

    for (let i = 0; i < splinePoints.length; i++) {
      // Position (x, y, z)
      centerlinePosition[i * 3] = splinePoints[i].position[0];
      centerlinePosition[i * 3 + 1] = splinePoints[i].position[1];
      centerlinePosition[i * 3 + 2] = splinePoints[i].position[2];

      // Orientation as 4x4 matrix (16 elements)
      const matrix = orientations[i];
      for (let j = 0; j < 16; j++) {
        centerlineOrientation[i * 16 + j] = matrix[j];
      }
    }

    const totalLength = splinePoints[splinePoints.length - 1].distance;

    return {
      position: centerlinePosition,
      orientation: centerlineOrientation,
      length: totalLength,
      generatedFrom: rootPoints,
    };
  }

  /**
   * Sort root points in anatomical order
   */
  private static sortRootPointsByOrder(rootPoints: RootPoint[]): RootPoint[] {
    // If we have exactly 3 points with anatomical types, use the original sorting
    if (rootPoints.length === 3 && rootPoints.every(p => p.type)) {
      console.log('🔍 DEBUG: Sorting 3 root points by anatomical order');
      console.log('   Root points received:', rootPoints.map(p => ({ id: p.id, type: p.type, typeOf: typeof p.type })));

      const order = [
        RootPointType.LV_OUTFLOW,
        RootPointType.AORTIC_VALVE,
        RootPointType.ASCENDING_AORTA,
      ];

      console.log('   Looking for types:', order);

      return order.map(type => {
        console.log(`   Searching for type: "${type}" (${typeof type})`);
        const point = rootPoints.find(p => {
          console.log(`     Checking point: type="${p.type}" (${typeof p.type}), match=${p.type === type}`);
          return p.type === type;
        });
        if (!point) {
          console.error(`   ❌ Could not find point with type: "${type}"`);
          console.error('   Available types:', rootPoints.map(p => p.type));
          throw new Error(`Missing root point of type: ${type}`);
        }
        console.log(`   ✅ Found point for type "${type}"`);
        return point;
      });
    }

    // For more than 3 points (refinement points added), PRESERVE the array order
    // The spheres are already in the correct order from the insertion logic
    // DO NOT re-sort by Z-coordinate as this can reverse the centerline direction
    console.log(`📍 Using ${rootPoints.length} points in original placement order (no re-sorting)`);
    return [...rootPoints];
  }

  /**
   * Generate a smooth Catmull-Rom spline through the control points
   */
  private static generateCatmullRomSpline(controlPoints: Vector3[], numSegments: number): SplinePoint[] {
    if (controlPoints.length < 3) {
      throw new Error('At least 3 control points are required');
    }

    const splinePoints: SplinePoint[] = [];
    let cumulativeDistance = 0;

    // For Catmull-Rom spline with 3 points, we need to create virtual points
    const extendedPoints = this.extendControlPoints(controlPoints);

    for (let segment = 0; segment < controlPoints.length - 1; segment++) {
      const p0 = extendedPoints[segment];
      const p1 = extendedPoints[segment + 1];
      const p2 = extendedPoints[segment + 2];
      const p3 = extendedPoints[segment + 3];

      const segmentSteps = Math.floor(numSegments / (controlPoints.length - 1));

      for (let i = 0; i <= segmentSteps; i++) {
        const t = i / segmentSteps;
        const position = this.catmullRomInterpolation(p0, p1, p2, p3, t);
        const tangent = this.catmullRomTangent(p0, p1, p2, p3, t);

        // Calculate distance from previous point
        if (splinePoints.length > 0) {
          const prevPos = splinePoints[splinePoints.length - 1].position;
          const distance = vec3.distance(position, prevPos);
          cumulativeDistance += distance;
        }

        splinePoints.push({
          position: position as Vector3,
          tangent: vec3.normalize(vec3.create(), tangent) as Vector3,
          distance: cumulativeDistance,
        });
      }
    }

    return splinePoints;
  }

  /**
   * Extend control points for Catmull-Rom spline
   */
  private static extendControlPoints(points: Vector3[]): Vector3[] {
    const extended: Vector3[] = [];

    // Add virtual start point
    const dir1 = vec3.subtract(vec3.create(), points[1], points[0]);
    const startPoint = vec3.subtract(vec3.create(), points[0], dir1) as Vector3;
    extended.push(startPoint);

    // Add actual points
    extended.push(...points);

    // Add virtual end point
    const dir2 = vec3.subtract(vec3.create(), points[points.length - 1], points[points.length - 2]);
    const endPoint = vec3.add(vec3.create(), points[points.length - 1], dir2) as Vector3;
    extended.push(endPoint);

    return extended;
  }

  /**
   * Catmull-Rom spline interpolation
   */
  private static catmullRomInterpolation(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number): vec3 {
    const t2 = t * t;
    const t3 = t2 * t;

    const result = vec3.create();

    // Catmull-Rom basis functions
    const b0 = -0.5 * t3 + t2 - 0.5 * t;
    const b1 = 1.5 * t3 - 2.5 * t2 + 1;
    const b2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
    const b3 = 0.5 * t3 - 0.5 * t2;

    vec3.scale(result, p0, b0);
    vec3.scaleAndAdd(result, result, p1, b1);
    vec3.scaleAndAdd(result, result, p2, b2);
    vec3.scaleAndAdd(result, result, p3, b3);

    return result;
  }

  /**
   * Catmull-Rom spline tangent calculation
   */
  private static catmullRomTangent(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number): vec3 {
    const t2 = t * t;

    const result = vec3.create();

    // Derivatives of Catmull-Rom basis functions
    const db0 = -1.5 * t2 + 2 * t - 0.5;
    const db1 = 4.5 * t2 - 5 * t;
    const db2 = -4.5 * t2 + 4 * t + 0.5;
    const db3 = 1.5 * t2 - t;

    vec3.scale(result, p0, db0);
    vec3.scaleAndAdd(result, result, p1, db1);
    vec3.scaleAndAdd(result, result, p2, db2);
    vec3.scaleAndAdd(result, result, p3, db3);

    return result;
  }

  /**
   * Calculate orientation matrices along the spline using rotation-minimizing frame
   * This prevents the CPR image from flipping when adding more centerline points
   */
  private static calculateOrientations(splinePoints: SplinePoint[]): Float32Array[] {
    const orientations: Float32Array[] = [];

    if (splinePoints.length === 0) {
      return orientations;
    }

    // Initialize the first frame with a consistent reference orientation
    const firstTangent = vec3.clone(splinePoints[0].tangent);

    // Choose an initial up vector that's not parallel to the first tangent
    let initialUp = vec3.fromValues(0, 0, 1); // Z-up (standard for CT)

    // If tangent is nearly parallel to Z, use Y-up instead
    if (Math.abs(vec3.dot(firstTangent, initialUp)) > 0.9) {
      initialUp = vec3.fromValues(0, 1, 0);
    }

    // Create the initial orthogonal frame
    let prevRight = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), firstTangent, initialUp));
    let prevUp = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), prevRight, firstTangent));

    // Store first orientation
    const firstMatrix = mat4.fromValues(
      firstTangent[0], firstTangent[1], firstTangent[2], 0,
      prevUp[0], prevUp[1], prevUp[2], 0,
      prevRight[0], prevRight[1], prevRight[2], 0,
      splinePoints[0].position[0], splinePoints[0].position[1], splinePoints[0].position[2], 1
    );
    orientations.push(new Float32Array(firstMatrix));

    // Use rotation-minimizing frame (parallel transport) for subsequent frames
    // This ensures smooth, flip-free transitions along the centerline
    for (let i = 1; i < splinePoints.length; i++) {
      const currTangent = vec3.clone(splinePoints[i].tangent);
      const prevTangent = vec3.clone(splinePoints[i - 1].tangent);

      // Calculate the rotation axis between consecutive tangents
      const rotationAxis = vec3.cross(vec3.create(), prevTangent, currTangent);
      const rotationAxisLength = vec3.length(rotationAxis);

      // If tangents are nearly parallel, no rotation needed
      if (rotationAxisLength < 0.001) {
        // Tangents are parallel, just use previous frame
        const matrix = mat4.fromValues(
          currTangent[0], currTangent[1], currTangent[2], 0,
          prevUp[0], prevUp[1], prevUp[2], 0,
          prevRight[0], prevRight[1], prevRight[2], 0,
          splinePoints[i].position[0], splinePoints[i].position[1], splinePoints[i].position[2], 1
        );
        orientations.push(new Float32Array(matrix));
        continue;
      }

      // Normalize rotation axis
      vec3.normalize(rotationAxis, rotationAxis);

      // Calculate rotation angle
      const cosAngle = vec3.dot(prevTangent, currTangent);
      const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));

      // Create rotation quaternion
      const halfAngle = angle / 2;
      const sinHalfAngle = Math.sin(halfAngle);
      const rotation = quat.fromValues(
        rotationAxis[0] * sinHalfAngle,
        rotationAxis[1] * sinHalfAngle,
        rotationAxis[2] * sinHalfAngle,
        Math.cos(halfAngle)
      );

      // Rotate the previous frame vectors
      const currRight = vec3.transformQuat(vec3.create(), prevRight, rotation);
      const currUp = vec3.transformQuat(vec3.create(), prevUp, rotation);

      // Normalize to prevent accumulated errors
      vec3.normalize(currRight, currRight);
      vec3.normalize(currUp, currUp);

      // Create orientation matrix
      const matrix = mat4.fromValues(
        currTangent[0], currTangent[1], currTangent[2], 0,
        currUp[0], currUp[1], currUp[2], 0,
        currRight[0], currRight[1], currRight[2], 0,
        splinePoints[i].position[0], splinePoints[i].position[1], splinePoints[i].position[2], 1
      );

      orientations.push(new Float32Array(matrix));

      // Update previous frame for next iteration
      prevRight = currRight;
      prevUp = currUp;
    }

    return orientations;
  }

  /**
   * Validate that root points form a reasonable anatomical path
   */
  static validateRootPoints(rootPoints: RootPoint[]): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (rootPoints.length < 3) {
      errors.push('At least 3 root points are required');
      return { isValid: false, errors };
    }

    if (rootPoints.length > 10) {
      errors.push('Maximum of 10 root points allowed');
      return { isValid: false, errors };
    }

    // If we have exactly 3 points, check for required anatomical types
    if (rootPoints.length === 3 && rootPoints.every(p => p.type)) {
      const requiredTypes = [
        RootPointType.LV_OUTFLOW,
        RootPointType.AORTIC_VALVE,
        RootPointType.ASCENDING_AORTA,
      ];

      for (const type of requiredTypes) {
        if (!rootPoints.some(p => p.type === type)) {
          errors.push(`Missing required point type: ${type}`);
        }
      }
    }

    // Check distances between consecutive points
    const sortedPoints = this.sortRootPointsByOrder(rootPoints);
    for (let i = 0; i < sortedPoints.length - 1; i++) {
      const dist = vec3.distance(sortedPoints[i].position, sortedPoints[i + 1].position);
      
      if (dist < 5) {
        errors.push(`Points ${i + 1} and ${i + 2} are too close together (minimum 5mm separation)`);
      }
      
      if (dist > 200) {
        errors.push(`Points ${i + 1} and ${i + 2} are too far apart (maximum 200mm separation)`);
      }
    }

    // Check that the overall path is generally ascending (Z-direction for typical CT orientation)
    const firstZ = sortedPoints[0].position[2];
    const lastZ = sortedPoints[sortedPoints.length - 1].position[2];
    
    if (lastZ <= firstZ) {
      errors.push('Last point should be superior to first point (ascending path expected)');
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Calculate centerline statistics
   */
  static getCenterlineStatistics(centerline: CenterlineData): {
    totalLength: number;
    averageCurvature: number;
    maxCurvature: number;
    pointCount: number;
  } {
    const pointCount = centerline.position.length / 3;
    const positions: Vector3[] = [];

    // Extract positions
    for (let i = 0; i < pointCount; i++) {
      positions.push([
        centerline.position[i * 3],
        centerline.position[i * 3 + 1],
        centerline.position[i * 3 + 2],
      ]);
    }

    // Calculate curvatures
    const curvatures: number[] = [];
    for (let i = 1; i < positions.length - 1; i++) {
      const curvature = this.calculateLocalCurvature(
        positions[i - 1],
        positions[i],
        positions[i + 1]
      );
      curvatures.push(curvature);
    }

    const averageCurvature = curvatures.reduce((sum, c) => sum + c, 0) / curvatures.length;
    const maxCurvature = Math.max(...curvatures);

    return {
      totalLength: centerline.length,
      averageCurvature,
      maxCurvature,
      pointCount,
    };
  }

  /**
   * Calculate local curvature at a point
   */
  private static calculateLocalCurvature(p1: Vector3, p2: Vector3, p3: Vector3): number {
    const v1 = vec3.subtract(vec3.create(), p2, p1);
    const v2 = vec3.subtract(vec3.create(), p3, p2);
    
    const cross = vec3.cross(vec3.create(), v1, v2);
    const crossMag = vec3.length(cross);
    
    const v1Mag = vec3.length(v1);
    const v2Mag = vec3.length(v2);
    
    if (v1Mag === 0 || v2Mag === 0) return 0;
    
    // Curvature = |v1 × v2| / (|v1| * |v2| * |v1 + v2|)
    const sumVec = vec3.add(vec3.create(), v1, v2);
    const sumMag = vec3.length(sumVec);
    
    if (sumMag === 0) return 0;
    
    return crossMag / (v1Mag * v2Mag * sumMag);
  }
}