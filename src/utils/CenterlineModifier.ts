import { Vector3 } from '@kitware/vtk.js/types';
import { AnnularPlane } from '../types/WorkflowTypes';

export interface ModifiedCenterlinePoint {
  x: number;
  y: number;
  z: number;
  isAnnulusPlane?: boolean; // Mark the annulus plane location
  distanceFromStart?: number;
}

/**
 * Utility to modify centerline to be perpendicular to annular plane
 * and include the annulus plane as a navigable cross-section
 */
export class CenterlineModifier {
  
  /**
   * Modify the original 3-point centerline to use annulus plane center as AV valve point
   * and ensure perpendicularity to the annular plane
   */
  static modifyCenterlineWithAnnulusPlane(
    originalRootPoints: Array<{ x: number; y: number; z: number; type: string }>,
    annularPlane: AnnularPlane
  ): ModifiedCenterlinePoint[] {
    

    // Find the original points by type
    const lvOutflowPoint = originalRootPoints.find(p => p.type.includes('lv_outflow') || p.type.includes('LVOT'));
    const aorticValvePoint = originalRootPoints.find(p => p.type.includes('aortic_valve') || p.type.includes('AV'));
    const ascendingAortaPoint = originalRootPoints.find(p => p.type.includes('ascending_aorta') || p.type.includes('Aorta'));

    if (!lvOutflowPoint || !aorticValvePoint || !ascendingAortaPoint) {
      return originalRootPoints.map((p, i) => ({ ...p, distanceFromStart: i }));
    }

    // Use annulus plane center as the new AV valve point
    const newAVPoint = {
      x: annularPlane.center[0],
      y: annularPlane.center[1], 
      z: annularPlane.center[2]
    };


    // Calculate unit normal for perpendicular direction
    const normal = annularPlane.normal;
    const normalMagnitude = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
    const unitNormal = [
      normal[0] / normalMagnitude,
      normal[1] / normalMagnitude,
      normal[2] / normalMagnitude
    ];

    // Calculate the original distance for scaling
    const originalDirection = {
      x: ascendingAortaPoint.x - newAVPoint.x,
      y: ascendingAortaPoint.y - newAVPoint.y,
      z: ascendingAortaPoint.z - newAVPoint.z
    };
    const originalDistance = Math.sqrt(
      originalDirection.x * originalDirection.x +
      originalDirection.y * originalDirection.y +
      originalDirection.z * originalDirection.z
    );


    // ============================================================
    // CREATE 6MM PERFECTLY STRAIGHT SEGMENT AT ANNULUS PLANE
    // ============================================================

    // Point at annulus - 3mm (along negative normal direction)
    const pointMinus3mm = {
      x: newAVPoint.x - 3 * unitNormal[0],
      y: newAVPoint.y - 3 * unitNormal[1],
      z: newAVPoint.z - 3 * unitNormal[2]
    };

    // Point at annulus + 3mm (along positive normal direction)
    const pointPlus3mm = {
      x: newAVPoint.x + 3 * unitNormal[0],
      y: newAVPoint.y + 3 * unitNormal[1],
      z: newAVPoint.z + 3 * unitNormal[2]
    };

    // Create modified centerline with 3 segments
    let modifiedCenterline: ModifiedCenterlinePoint[] = [];
    let cumulativeDistance = 0;

    // ============================================================
    // SEGMENT 1: LV Outflow → (Annulus - 3mm)
    // Use Catmull-Rom spline for SMOOTH curve, not linear interpolation
    // ============================================================
    const segment1Points = 40; // Number of points in first segment

    // Create control points for Catmull-Rom: p0, p1 (start), p2 (end), p3
    // p0: virtual point before LV outflow (extrapolated)
    const lvToMinus3mmDir = {
      x: pointMinus3mm.x - lvOutflowPoint.x,
      y: pointMinus3mm.y - lvOutflowPoint.y,
      z: pointMinus3mm.z - lvOutflowPoint.z
    };
    const lvToMinus3mmLen = Math.sqrt(lvToMinus3mmDir.x ** 2 + lvToMinus3mmDir.y ** 2 + lvToMinus3mmDir.z ** 2);
    const segment1_p0 = {
      x: lvOutflowPoint.x - lvToMinus3mmDir.x * 0.3,
      y: lvOutflowPoint.y - lvToMinus3mmDir.y * 0.3,
      z: lvOutflowPoint.z - lvToMinus3mmDir.z * 0.3
    };
    const segment1_p1 = lvOutflowPoint;
    const segment1_p2 = pointMinus3mm;
    // p3: point slightly beyond -3mm (towards annulus center)
    const segment1_p3 = {
      x: pointMinus3mm.x + unitNormal[0] * 1.0, // 1mm towards annulus
      y: pointMinus3mm.y + unitNormal[1] * 1.0,
      z: pointMinus3mm.z + unitNormal[2] * 1.0
    };

    for (let i = 0; i <= segment1Points; i++) {
      const t = i / segment1Points;
      const point = this.catmullRomInterpolate(segment1_p0, segment1_p1, segment1_p2, segment1_p3, t);

      // Calculate distance from previous point
      if (modifiedCenterline.length > 0) {
        const prev = modifiedCenterline[modifiedCenterline.length - 1];
        const dist = this.calculateDistance(prev, point);
        cumulativeDistance += dist;
      }

      point.distanceFromStart = cumulativeDistance;
      point.isAnnulusPlane = false;
      modifiedCenterline.push(point);
    }

    const junctionPoint1Index = modifiedCenterline.length - 1; // Index of -3mm point (junction 1)

    // ============================================================
    // SEGMENT 2: (Annulus - 3mm) → Annulus → (Annulus + 3mm)
    // PERFECTLY STRAIGHT - 6mm segment along normal
    // ============================================================
    const segment2Length = 6.0; // Exactly 6mm
    const segment2Points = 10; // Add points for smooth scrolling


    // Add intermediate points (excluding first point which is already added)
    for (let i = 1; i <= segment2Points; i++) {
      const t = i / segment2Points;
      const point: ModifiedCenterlinePoint = {
        x: pointMinus3mm.x + t * (pointPlus3mm.x - pointMinus3mm.x),
        y: pointMinus3mm.y + t * (pointPlus3mm.y - pointMinus3mm.y),
        z: pointMinus3mm.z + t * (pointPlus3mm.z - pointMinus3mm.z),
        distanceFromStart: cumulativeDistance + t * segment2Length,
        isAnnulusPlane: (i === segment2Points / 2) // Mark the middle point (annulus)
      };
      modifiedCenterline.push(point);
    }
    cumulativeDistance += segment2Length;

    const annulusPlaneIndex = modifiedCenterline.findIndex(p => p.isAnnulusPlane);
    const junctionPoint2Index = modifiedCenterline.length - 1; // Index of +3mm point (junction 2)


    // ============================================================
    // SEGMENT 3: (Annulus + 3mm) → Ascending Aorta
    // Use Catmull-Rom spline for SMOOTH curve, not linear interpolation
    // ============================================================
    const segment3Points = 60; // Number of points in third segment

    // Calculate end point along perpendicular direction
    const segment3Length = originalDistance - 3; // Remaining distance
    const segment3EndPoint = {
      x: pointPlus3mm.x + unitNormal[0] * segment3Length,
      y: pointPlus3mm.y + unitNormal[1] * segment3Length,
      z: pointPlus3mm.z + unitNormal[2] * segment3Length
    };

    // Create control points for Catmull-Rom: p0, p1 (start), p2 (end), p3
    // p0: point slightly before +3mm (from annulus center)
    const segment3_p0 = {
      x: pointPlus3mm.x - unitNormal[0] * 1.0, // 1mm back towards annulus
      y: pointPlus3mm.y - unitNormal[1] * 1.0,
      z: pointPlus3mm.z - unitNormal[2] * 1.0
    };
    const segment3_p1 = pointPlus3mm;
    const segment3_p2 = segment3EndPoint;
    // p3: virtual point beyond end (extrapolated)
    const segment3_p3 = {
      x: segment3EndPoint.x + unitNormal[0] * segment3Length * 0.3,
      y: segment3EndPoint.y + unitNormal[1] * segment3Length * 0.3,
      z: segment3EndPoint.z + unitNormal[2] * segment3Length * 0.3
    };

    for (let i = 1; i <= segment3Points; i++) {
      const t = i / segment3Points;
      const point = this.catmullRomInterpolate(segment3_p0, segment3_p1, segment3_p2, segment3_p3, t);

      // Calculate distance from previous point
      const prev = modifiedCenterline[modifiedCenterline.length - 1];
      const dist = this.calculateDistance(prev, point);
      cumulativeDistance += dist;

      point.distanceFromStart = cumulativeDistance;
      point.isAnnulusPlane = false;
      modifiedCenterline.push(point);
    }


    // ============================================================
    // VALIDATION: Verify 6mm straight segment is PERFECTLY STRAIGHT
    // ============================================================

    // Check straightness of the 6mm segment
    if (annulusPlaneIndex >= 0) {
      const annulusPoint = modifiedCenterline[annulusPlaneIndex];
      const minus3mmPoint = modifiedCenterline[junctionPoint1Index];
      const plus3mmPoint = modifiedCenterline[junctionPoint2Index];

      // Verify annulus plane point is at exact center
      const errorFromCenter = Math.sqrt(
        Math.pow(annulusPoint.x - newAVPoint.x, 2) +
        Math.pow(annulusPoint.y - newAVPoint.y, 2) +
        Math.pow(annulusPoint.z - newAVPoint.z, 2)
      );

      // Verify distances are exactly 3mm
      const distMinus3mm = this.calculateDistance(minus3mmPoint, annulusPoint);
      const distPlus3mm = this.calculateDistance(annulusPoint, plus3mmPoint);

      // Verify perfect straightness (cross product should be near zero)
      const vec1 = {
        x: annulusPoint.x - minus3mmPoint.x,
        y: annulusPoint.y - minus3mmPoint.y,
        z: annulusPoint.z - minus3mmPoint.z
      };
      const vec2 = {
        x: plus3mmPoint.x - annulusPoint.x,
        y: plus3mmPoint.y - annulusPoint.y,
        z: plus3mmPoint.z - annulusPoint.z
      };

      // Normalize vectors
      const len1 = Math.sqrt(vec1.x * vec1.x + vec1.y * vec1.y + vec1.z * vec1.z);
      const len2 = Math.sqrt(vec2.x * vec2.x + vec2.y * vec2.y + vec2.z * vec2.z);
      const norm1 = { x: vec1.x / len1, y: vec1.y / len1, z: vec1.z / len1 };
      const norm2 = { x: vec2.x / len2, y: vec2.y / len2, z: vec2.z / len2 };

      // Dot product should be -1 (opposite directions for straight line)
      const dotProduct = norm1.x * norm2.x + norm1.y * norm2.y + norm1.z * norm2.z;

      if (Math.abs(dotProduct + 1.0) < 0.000001) {
      } else {
      }
    }

    // ============================================================
    // APPLY MINIMAL SMOOTHING AT BOTH JUNCTIONS
    // Since we're now using Catmull-Rom splines for segments 1 and 3,
    // we only need very light smoothing to ensure perfect continuity
    // ============================================================

    // Smooth at junction 1 (at -3mm point) - REDUCED window
    modifiedCenterline = this.smoothCenterlineJunction(
      modifiedCenterline,
      junctionPoint1Index,
      4, // Reduced smoothing window (was 10)
      [junctionPoint1Index, annulusPlaneIndex, junctionPoint2Index] // Protect these 3 points
    );

    // Smooth at junction 2 (at +3mm point) - REDUCED window
    modifiedCenterline = this.smoothCenterlineJunction(
      modifiedCenterline,
      junctionPoint2Index,
      4, // Reduced smoothing window (was 10)
      [junctionPoint1Index, annulusPlaneIndex, junctionPoint2Index] // Protect these 3 points
    );


    // ============================================================
    // VALIDATION: Verify positions are STILL EXACT after smoothing
    // ============================================================

    if (annulusPlaneIndex >= 0) {
      const annulusPoint = modifiedCenterline[annulusPlaneIndex];
      const minus3mmPoint = modifiedCenterline[junctionPoint1Index];
      const plus3mmPoint = modifiedCenterline[junctionPoint2Index];

      // Verify annulus center hasn't moved
      const errorFromCenter = Math.sqrt(
        Math.pow(annulusPoint.x - newAVPoint.x, 2) +
        Math.pow(annulusPoint.y - newAVPoint.y, 2) +
        Math.pow(annulusPoint.z - newAVPoint.z, 2)
      );

      if (errorFromCenter > 0.000001) {
      } else {
      }

      // Verify ±3mm points haven't moved
      const dist1 = this.calculateDistance(minus3mmPoint, annulusPoint);
      const dist2 = this.calculateDistance(annulusPoint, plus3mmPoint);
    }

    return modifiedCenterline;
  }

  /**
   * Get the annulus plane position as a ratio (0-1) along the modified centerline
   */
  static getAnnulusPlanePosition(modifiedCenterline: ModifiedCenterlinePoint[]): number {
    const annulusIndex = modifiedCenterline.findIndex(p => p.isAnnulusPlane);
    if (annulusIndex === -1) return 0.5; // Default to middle if not found
    return annulusIndex / (modifiedCenterline.length - 1);
  }

  /**
   * Check if a given position along the centerline is at or near the annulus plane
   */
  static isNearAnnulusPlane(position: number, modifiedCenterline: ModifiedCenterlinePoint[], tolerance: number = 0.02): boolean {
    const annulusPosition = this.getAnnulusPlanePosition(modifiedCenterline);
    return Math.abs(position - annulusPosition) <= tolerance;
  }

  /**
   * Get the cross-section orientation at a given position
   * Returns the annular plane normal when at the annulus, otherwise returns centerline tangent
   */
  static getCrossSectionOrientation(
    position: number, 
    modifiedCenterline: ModifiedCenterlinePoint[], 
    annularPlane: AnnularPlane
  ): { normal: Vector3; isAnnulusPlane: boolean } {
    
    if (this.isNearAnnulusPlane(position, modifiedCenterline)) {
      // At annulus plane - use the annular plane normal
      return {
        normal: annularPlane.normal,
        isAnnulusPlane: true
      };
    }

    // Otherwise, calculate tangent from centerline
    const pointIndex = Math.floor(position * (modifiedCenterline.length - 1));
    const point = modifiedCenterline[pointIndex];
    
    let tangent: Vector3 = [0, 0, 1]; // Default
    if (pointIndex < modifiedCenterline.length - 1) {
      const nextPoint = modifiedCenterline[pointIndex + 1];
      tangent = [
        nextPoint.x - point.x,
        nextPoint.y - point.y,
        nextPoint.z - point.z
      ];
      
      // Normalize
      const length = Math.sqrt(tangent[0] * tangent[0] + tangent[1] * tangent[1] + tangent[2] * tangent[2]);
      if (length > 0) {
        tangent = [tangent[0] / length, tangent[1] / length, tangent[2] / length];
      }
    }

    return {
      normal: tangent,
      isAnnulusPlane: false
    };
  }

  /**
   * Smooth the centerline junction using Catmull-Rom spline interpolation
   * to reduce stitching artifacts at the annular plane
   * @param protectedIndices Array of indices to NEVER smooth (e.g., [-3mm, annulus, +3mm] points)
   */
  public static smoothCenterlineJunction(
    centerline: ModifiedCenterlinePoint[],
    junctionIndex: number,
    smoothingWindow: number,
    protectedIndices: number[] = []
  ): ModifiedCenterlinePoint[] {

    const halfWindow = Math.floor(smoothingWindow / 2);
    const startIdx = Math.max(0, junctionIndex - halfWindow);
    const endIdx = Math.min(centerline.length - 1, junctionIndex + halfWindow);


    // Create a copy of the centerline
    const smoothed = [...centerline];

    // Get control points for Catmull-Rom spline
    const p0Idx = Math.max(0, startIdx - 1);
    const p1Idx = startIdx;
    const p2Idx = endIdx;
    const p3Idx = Math.min(centerline.length - 1, endIdx + 1);

    const p0 = centerline[p0Idx];
    const p1 = centerline[p1Idx];
    const p2 = centerline[p2Idx];
    const p3 = centerline[p3Idx];

    let smoothedCount = 0;
    let skippedCount = 0;

    // Interpolate points between startIdx and endIdx using Catmull-Rom
    // CRITICAL: NEVER smooth protected points (e.g., -3mm, annulus, +3mm)
    // User requirement: "not even a single micron error is acceptable"
    for (let i = startIdx; i <= endIdx; i++) {
      // SKIP all protected points - keep them at EXACT positions
      if (protectedIndices.includes(i)) {
        skippedCount++;
        continue; // Don't modify protected points
      }

      const t = (i - startIdx) / (endIdx - startIdx);

      // Catmull-Rom basis functions
      const t2 = t * t;
      const t3 = t2 * t;

      smoothed[i] = {
        x: 0.5 * (
          (2 * p1.x) +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
        ),
        y: 0.5 * (
          (2 * p1.y) +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
        ),
        z: 0.5 * (
          (2 * p1.z) +
          (-p0.z + p2.z) * t +
          (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
          (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3
        ),
        isAnnulusPlane: centerline[i].isAnnulusPlane,
        distanceFromStart: centerline[i].distanceFromStart
      };
      smoothedCount++;
    }


    // CRITICAL: Recalculate cumulative arc length after smoothing
    // because the 3D positions have changed
    smoothed[0].distanceFromStart = 0;
    for (let i = 1; i < smoothed.length; i++) {
      const dist = this.calculateDistance(smoothed[i - 1], smoothed[i]);
      smoothed[i].distanceFromStart = smoothed[i - 1].distanceFromStart! + dist;
    }

    return smoothed;
  }

  /**
   * Calculate distance between two 3D points
   */
  private static calculateDistance(p1: { x: number; y: number; z: number }, p2: { x: number; y: number; z: number }): number {
    return Math.sqrt(
      Math.pow(p2.x - p1.x, 2) +
      Math.pow(p2.y - p1.y, 2) +
      Math.pow(p2.z - p1.z, 2)
    );
  }

  /**
   * Catmull-Rom spline interpolation
   * Creates smooth curves through control points
   */
  private static catmullRomInterpolate(
    p0: { x: number; y: number; z: number },
    p1: { x: number; y: number; z: number },
    p2: { x: number; y: number; z: number },
    p3: { x: number; y: number; z: number },
    t: number
  ): ModifiedCenterlinePoint {
    const t2 = t * t;
    const t3 = t2 * t;

    // Catmull-Rom basis functions (same as CenterlineGenerator)
    const b0 = -0.5 * t3 + t2 - 0.5 * t;
    const b1 = 1.5 * t3 - 2.5 * t2 + 1;
    const b2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
    const b3 = 0.5 * t3 - 0.5 * t2;

    return {
      x: p0.x * b0 + p1.x * b1 + p2.x * b2 + p3.x * b3,
      y: p0.y * b0 + p1.y * b1 + p2.y * b2 + p3.y * b3,
      z: p0.z * b0 + p1.z * b1 + p2.z * b2 + p3.z * b3,
      distanceFromStart: 0, // Will be set by caller
      isAnnulusPlane: false
    };
  }

  /**
   * Convert modified centerline back to the format expected by CPR components
   */
  static convertToStandardFormat(modifiedCenterline: ModifiedCenterlinePoint[]): Array<{ x: number; y: number; z: number }> {
    return modifiedCenterline.map(point => ({
      x: point.x,
      y: point.y,
      z: point.z
    }));
  }
}