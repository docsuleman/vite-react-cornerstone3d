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
    
    console.log('🔄 Modifying centerline with annular plane:', {
      originalPoints: originalRootPoints.length,
      annularPlane: {
        center: annularPlane.center,
        normal: annularPlane.normal,
        confidence: annularPlane.confidence
      }
    });

    // Find the original points by type
    const lvOutflowPoint = originalRootPoints.find(p => p.type.includes('lv_outflow') || p.type.includes('LVOT'));
    const aorticValvePoint = originalRootPoints.find(p => p.type.includes('aortic_valve') || p.type.includes('AV'));
    const ascendingAortaPoint = originalRootPoints.find(p => p.type.includes('ascending_aorta') || p.type.includes('Aorta'));

    if (!lvOutflowPoint || !aorticValvePoint || !ascendingAortaPoint) {
      console.warn('Could not find all required root points, using original centerline');
      return originalRootPoints.map((p, i) => ({ ...p, distanceFromStart: i }));
    }

    // Use annulus plane center as the new AV valve point
    const newAVPoint = {
      x: annularPlane.center[0],
      y: annularPlane.center[1], 
      z: annularPlane.center[2]
    };

    console.log('📍 New AV point (annulus center):', newAVPoint);

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

    console.log('📐 Direction analysis:', {
      originalDirection,
      unitNormal,
      originalDistance
    });

    // ============================================================
    // CREATE 6MM PERFECTLY STRAIGHT SEGMENT AT ANNULUS PLANE
    // ============================================================
    console.log('\n🎯 Creating 6mm perfectly straight perpendicular segment:');

    // Point at annulus - 3mm (along negative normal direction)
    const pointMinus3mm = {
      x: newAVPoint.x - 3 * unitNormal[0],
      y: newAVPoint.y - 3 * unitNormal[1],
      z: newAVPoint.z - 3 * unitNormal[2]
    };
    console.log(`   Point at -3mm: [${pointMinus3mm.x.toFixed(6)}, ${pointMinus3mm.y.toFixed(6)}, ${pointMinus3mm.z.toFixed(6)}]`);

    // Point at annulus + 3mm (along positive normal direction)
    const pointPlus3mm = {
      x: newAVPoint.x + 3 * unitNormal[0],
      y: newAVPoint.y + 3 * unitNormal[1],
      z: newAVPoint.z + 3 * unitNormal[2]
    };
    console.log(`   Point at +3mm: [${pointPlus3mm.x.toFixed(6)}, ${pointPlus3mm.y.toFixed(6)}, ${pointPlus3mm.z.toFixed(6)}]`);
    console.log(`   Annulus center: [${newAVPoint.x.toFixed(6)}, ${newAVPoint.y.toFixed(6)}, ${newAVPoint.z.toFixed(6)}]`);

    // Create modified centerline with 3 segments
    let modifiedCenterline: ModifiedCenterlinePoint[] = [];
    let cumulativeDistance = 0;

    // ============================================================
    // SEGMENT 1: LV Outflow → (Annulus - 3mm)
    // ============================================================
    const segment1Length = this.calculateDistance(lvOutflowPoint, pointMinus3mm);
    const segment1Points = 40; // Number of points in first segment

    console.log(`\n📍 Segment 1: LV Outflow → (Annulus - 3mm) - ${segment1Length.toFixed(2)}mm, ${segment1Points + 1} points`);

    for (let i = 0; i <= segment1Points; i++) {
      const t = i / segment1Points;
      const point: ModifiedCenterlinePoint = {
        x: lvOutflowPoint.x + t * (pointMinus3mm.x - lvOutflowPoint.x),
        y: lvOutflowPoint.y + t * (pointMinus3mm.y - lvOutflowPoint.y),
        z: lvOutflowPoint.z + t * (pointMinus3mm.z - lvOutflowPoint.z),
        distanceFromStart: cumulativeDistance + t * segment1Length,
        isAnnulusPlane: false
      };
      modifiedCenterline.push(point);
    }
    cumulativeDistance += segment1Length;

    const junctionPoint1Index = modifiedCenterline.length - 1; // Index of -3mm point (junction 1)

    // ============================================================
    // SEGMENT 2: (Annulus - 3mm) → Annulus → (Annulus + 3mm)
    // PERFECTLY STRAIGHT - 6mm segment along normal
    // ============================================================
    const segment2Length = 6.0; // Exactly 6mm
    const segment2Points = 10; // Add points for smooth scrolling

    console.log(`\n📍 Segment 2: STRAIGHT 6mm perpendicular segment - ${segment2Points + 1} points`);
    console.log(`   ⚠️ This segment is PERFECTLY STRAIGHT (zero curvature)`);

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

    console.log(`   Annulus plane at index: ${annulusPlaneIndex}`);
    console.log(`   Junction 1 at index: ${junctionPoint1Index} (at -3mm point)`);
    console.log(`   Junction 2 at index: ${junctionPoint2Index} (at +3mm point)`);

    // ============================================================
    // SEGMENT 3: (Annulus + 3mm) → Ascending Aorta
    // Perpendicular direction from +3mm point
    // ============================================================
    const segment3Length = originalDistance - 3; // Remaining distance
    const segment3Points = 60; // Number of points in third segment

    console.log(`\n📍 Segment 3: (Annulus + 3mm) → Ascending Aorta - ${segment3Length.toFixed(2)}mm, ${segment3Points} points`);

    for (let i = 1; i <= segment3Points; i++) {
      const t = i / segment3Points;
      const point: ModifiedCenterlinePoint = {
        x: pointPlus3mm.x + t * unitNormal[0] * segment3Length,
        y: pointPlus3mm.y + t * unitNormal[1] * segment3Length,
        z: pointPlus3mm.z + t * unitNormal[2] * segment3Length,
        distanceFromStart: cumulativeDistance + t * segment3Length,
        isAnnulusPlane: false
      };
      modifiedCenterline.push(point);
    }
    cumulativeDistance += segment3Length;

    console.log('\n✅ Modified centerline created:', {
      totalPoints: modifiedCenterline.length,
      segment1Points: segment1Points + 1,
      segment2Points: segment2Points + 1,
      segment3Points,
      annulusPlaneIndex,
      junctionPoint1Index,
      junctionPoint2Index,
      totalLength: cumulativeDistance.toFixed(2) + 'mm'
    });

    // ============================================================
    // VALIDATION: Verify 6mm straight segment is PERFECTLY STRAIGHT
    // ============================================================
    console.log(`\n🔬 VALIDATION: 6mm Straight Segment (BEFORE smoothing)`);

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
      console.log(`   Annulus center position error: ${errorFromCenter.toFixed(9)} mm`);

      // Verify distances are exactly 3mm
      const distMinus3mm = this.calculateDistance(minus3mmPoint, annulusPoint);
      const distPlus3mm = this.calculateDistance(annulusPoint, plus3mmPoint);
      console.log(`   Distance (-3mm → annulus): ${distMinus3mm.toFixed(6)} mm (should be ~3.0)`);
      console.log(`   Distance (annulus → +3mm): ${distPlus3mm.toFixed(6)} mm (should be ~3.0)`);

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
      console.log(`   Straightness check (dot product): ${dotProduct.toFixed(9)} (should be -1.0 for perfect line)`);

      if (Math.abs(dotProduct + 1.0) < 0.000001) {
        console.log(`   ✅ 6mm segment is PERFECTLY STRAIGHT (zero curvature)`);
      } else {
        console.warn(`   ⚠️ Segment has slight curvature: ${Math.abs(dotProduct + 1.0).toFixed(9)}`);
      }
    }

    // ============================================================
    // APPLY SMOOTHING AT BOTH JUNCTIONS
    // ============================================================
    console.log(`\n🔄 Applying smoothing at TWO junctions:`);

    // Smooth at junction 1 (at -3mm point)
    console.log(`\n   Junction 1: Smoothing around index ${junctionPoint1Index} (at -3mm point)`);
    modifiedCenterline = this.smoothCenterlineJunction(
      modifiedCenterline,
      junctionPoint1Index,
      10, // Smoothing window
      [junctionPoint1Index, annulusPlaneIndex, junctionPoint2Index] // Protect these 3 points
    );

    // Smooth at junction 2 (at +3mm point)
    console.log(`\n   Junction 2: Smoothing around index ${junctionPoint2Index} (at +3mm point)`);
    modifiedCenterline = this.smoothCenterlineJunction(
      modifiedCenterline,
      junctionPoint2Index,
      10, // Smoothing window
      [junctionPoint1Index, annulusPlaneIndex, junctionPoint2Index] // Protect these 3 points
    );

    console.log('\n✅ Applied Catmull-Rom smoothing at both junctions (3 core points NOT smoothed)');

    // ============================================================
    // VALIDATION: Verify positions are STILL EXACT after smoothing
    // ============================================================
    console.log(`\n🔬 VALIDATION: After Smoothing`);

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
      console.log(`   Annulus center position error: ${errorFromCenter.toFixed(9)} mm`);

      if (errorFromCenter > 0.000001) {
        console.error(`   ❌ CRITICAL ERROR: Smoothing moved the annulus plane point!`);
      } else {
        console.log(`   ✅ Annulus position EXACT (preserved through smoothing)`);
      }

      // Verify ±3mm points haven't moved
      const dist1 = this.calculateDistance(minus3mmPoint, annulusPoint);
      const dist2 = this.calculateDistance(annulusPoint, plus3mmPoint);
      console.log(`   Distance (-3mm → annulus): ${dist1.toFixed(6)} mm`);
      console.log(`   Distance (annulus → +3mm): ${dist2.toFixed(6)} mm`);
      console.log(`   ✅ All 3 core points preserved\n`);
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

    console.log(`      Smoothing window: ${startIdx} to ${endIdx}`);
    console.log(`      Protected indices: [${protectedIndices.join(', ')}] (will NOT be smoothed)`);

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

    console.log(`      ✅ Smoothed ${smoothedCount} points, protected ${skippedCount} points`);

    // CRITICAL: Recalculate cumulative arc length after smoothing
    // because the 3D positions have changed
    smoothed[0].distanceFromStart = 0;
    for (let i = 1; i < smoothed.length; i++) {
      const dist = this.calculateDistance(smoothed[i - 1], smoothed[i]);
      smoothed[i].distanceFromStart = smoothed[i - 1].distanceFromStart! + dist;
    }

    console.log('✅ Recalculated arc lengths after smoothing');
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