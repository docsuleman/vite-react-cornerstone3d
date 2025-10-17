import { Vector3 } from '@kitware/vtk.js/types';
import { AnnulusPoint, AnnularPlane } from '../types/WorkflowTypes';

/**
 * Calculate the annular plane from 3 cusp nadir points
 * This represents the aortic valve annulus plane in 3D space
 */
export class AnnulusCalculator {
  
  /**
   * Calculate the center point of the annulus from 3 cusp points
   * This is the EXACT geometric centroid - no approximation
   */
  static calculateAnnulusCenter(cuspPoints: AnnulusPoint[]): Vector3 {
    if (cuspPoints.length !== 3) {
      throw new Error('Exactly 3 cusp points are required to calculate annulus center');
    }

    cuspPoints.forEach((p, i) => {
    });

    // Calculate the centroid of the 3 cusp points
    // Centroid = (P1 + P2 + P3) / 3
    const center: Vector3 = [0, 0, 0];

    for (const point of cuspPoints) {
      center[0] += point.position[0];
      center[1] += point.position[1];
      center[2] += point.position[2];
    }

    center[0] /= 3;
    center[1] /= 3;
    center[2] /= 3;


    return center;
  }

  /**
   * Calculate the normal vector of the annular plane using cross product
   */
  static calculateAnnulusNormal(cuspPoints: AnnulusPoint[]): Vector3 {
    if (cuspPoints.length !== 3) {
      throw new Error('Exactly 3 cusp points are required to calculate annulus normal');
    }

    const p1 = cuspPoints[0].position;
    const p2 = cuspPoints[1].position;
    const p3 = cuspPoints[2].position;

    // Create two vectors in the plane
    const v1: Vector3 = [
      p2[0] - p1[0],
      p2[1] - p1[1],
      p2[2] - p1[2]
    ];

    const v2: Vector3 = [
      p3[0] - p1[0],
      p3[1] - p1[1],
      p3[2] - p1[2]
    ];

    // Calculate cross product to get normal vector
    const normal: Vector3 = [
      v1[1] * v2[2] - v1[2] * v2[1],
      v1[2] * v2[0] - v1[0] * v2[2],
      v1[0] * v2[1] - v1[1] * v2[0]
    ];

    // Normalize the vector
    const length = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
    if (length > 0) {
      normal[0] /= length;
      normal[1] /= length;
      normal[2] /= length;
    }

    return normal;
  }

  /**
   * Calculate confidence score based on how well the points form a plane
   */
  static calculatePlaneConfidence(cuspPoints: AnnulusPoint[]): number {
    if (cuspPoints.length !== 3) {
      return 0;
    }

    // For 3 points, we always get a perfect plane, but we can evaluate
    // the geometric quality (e.g., how well distributed the points are)
    
    const center = this.calculateAnnulusCenter(cuspPoints);
    const distances: number[] = [];
    
    // Calculate distances from center to each point
    for (const point of cuspPoints) {
      const dist = Math.sqrt(
        Math.pow(point.position[0] - center[0], 2) +
        Math.pow(point.position[1] - center[1], 2) +
        Math.pow(point.position[2] - center[2], 2)
      );
      distances.push(dist);
    }
    
    // Calculate coefficient of variation (lower is better for circular arrangement)
    const mean = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const variance = distances.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / distances.length;
    const stdDev = Math.sqrt(variance);
    const coeffVar = mean > 0 ? stdDev / mean : 1;
    
    // Convert to confidence score (0-1, where 1 is perfectly circular)
    const confidence = Math.max(0, Math.min(1, 1 - coeffVar));
    
    return confidence;
  }

  /**
   * Calculate the complete annular plane from cusp points
   */
  static calculateAnnularPlane(cuspPoints: AnnulusPoint[]): AnnularPlane {
    if (cuspPoints.length !== 3) {
      throw new Error('Exactly 3 cusp points are required to calculate annular plane');
    }

    const center = this.calculateAnnulusCenter(cuspPoints);
    const normal = this.calculateAnnulusNormal(cuspPoints);
    const confidence = this.calculatePlaneConfidence(cuspPoints);


    return {
      center,
      normal,
      points: cuspPoints,
      confidence
    };
  }

  /**
   * Calculate annulus diameter based on cusp points
   */
  static calculateAnnulusDiameter(cuspPoints: AnnulusPoint[]): number {
    if (cuspPoints.length !== 3) {
      throw new Error('Exactly 3 cusp points are required to calculate diameter');
    }

    const center = this.calculateAnnulusCenter(cuspPoints);
    const distances: number[] = [];
    
    // Calculate distances from center to each cusp point
    for (const point of cuspPoints) {
      const dist = Math.sqrt(
        Math.pow(point.position[0] - center[0], 2) +
        Math.pow(point.position[1] - center[1], 2) +
        Math.pow(point.position[2] - center[2], 2)
      );
      distances.push(dist);
    }
    
    // Average distance represents the radius
    const avgRadius = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    return avgRadius * 2; // Diameter = 2 * radius
  }

  /**
   * Calculate annulus area assuming circular shape
   */
  static calculateAnnulusArea(cuspPoints: AnnulusPoint[]): number {
    const diameter = this.calculateAnnulusDiameter(cuspPoints);
    const radius = diameter / 2;
    return Math.PI * radius * radius;
  }

  /**
   * Calculate annulus perimeter assuming circular shape
   */
  static calculateAnnulusPerimeter(cuspPoints: AnnulusPoint[]): number {
    const diameter = this.calculateAnnulusDiameter(cuspPoints);
    return Math.PI * diameter;
  }
}