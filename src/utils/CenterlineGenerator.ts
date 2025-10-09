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
      const order = [
        RootPointType.LV_OUTFLOW,
        RootPointType.AORTIC_VALVE,
        RootPointType.ASCENDING_AORTA,
      ];

      return order.map(type => {
        const point = rootPoints.find(p => p.type === type);
        if (!point) {
          throw new Error(`Missing root point of type: ${type}`);
        }
        return point;
      });
    }
    
    // For more than 3 points or points without specific types,
    // sort by placement order or Z coordinate (inferior to superior)
    return [...rootPoints].sort((a, b) => {
      // Primary sort: by Z coordinate (inferior to superior)
      const zDiff = a.position[2] - b.position[2];
      if (Math.abs(zDiff) > 1) { // 1mm tolerance
        return zDiff;
      }
      // Secondary sort: by creation order if available
      return 0; // Keep original order if Z coordinates are similar
    });
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
   * Calculate orientation matrices along the spline
   */
  private static calculateOrientations(splinePoints: SplinePoint[]): Float32Array[] {
    const orientations: Float32Array[] = [];

    for (let i = 0; i < splinePoints.length; i++) {
      const tangent = splinePoints[i].tangent;
      
      // Calculate a consistent up vector using the minimum rotation method
      let upVector = vec3.fromValues(0, 0, 1); // Default up
      
      // If tangent is nearly parallel to default up, use a different reference
      if (Math.abs(vec3.dot(tangent, upVector)) > 0.9) {
        upVector = vec3.fromValues(0, 1, 0);
      }

      // Create orthogonal coordinate system
      const rightVector = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), tangent, upVector));
      const correctedUpVector = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), rightVector, tangent));

      // Create 4x4 transformation matrix
      const matrix = mat4.fromValues(
        tangent[0], tangent[1], tangent[2], 0,
        correctedUpVector[0], correctedUpVector[1], correctedUpVector[2], 0,
        rightVector[0], rightVector[1], rightVector[2], 0,
        splinePoints[i].position[0], splinePoints[i].position[1], splinePoints[i].position[2], 1
      );

      orientations.push(new Float32Array(matrix));
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