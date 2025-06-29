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

    // Create modified centerline that ensures perpendicularity to annular plane
    const modifiedCenterline: ModifiedCenterlinePoint[] = [];

    // Segment 1: LV Outflow to Annulus Center
    const segment1Length = this.calculateDistance(lvOutflowPoint, newAVPoint);
    const segment1Points = 40; // Number of points in first segment

    for (let i = 0; i <= segment1Points; i++) {
      const t = i / segment1Points;
      const point: ModifiedCenterlinePoint = {
        x: lvOutflowPoint.x + t * (newAVPoint.x - lvOutflowPoint.x),
        y: lvOutflowPoint.y + t * (newAVPoint.y - lvOutflowPoint.y),
        z: lvOutflowPoint.z + t * (newAVPoint.z - lvOutflowPoint.z),
        distanceFromStart: t * segment1Length,
        isAnnulusPlane: i === segment1Points // Mark the annulus plane point
      };
      modifiedCenterline.push(point);
    }

    // Segment 2: Annulus Center to Ascending Aorta (perpendicular to annular plane)
    // Calculate the direction from annulus center to ascending aorta
    const originalDirection = {
      x: ascendingAortaPoint.x - newAVPoint.x,
      y: ascendingAortaPoint.y - newAVPoint.y,
      z: ascendingAortaPoint.z - newAVPoint.z
    };

    // Project this direction onto the annular plane normal to ensure perpendicularity
    const normal = annularPlane.normal;
    const normalMagnitude = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
    
    // Ensure normal is unit vector
    const unitNormal = [
      normal[0] / normalMagnitude,
      normal[1] / normalMagnitude,
      normal[2] / normalMagnitude
    ];

    // Calculate the component of original direction along the normal
    const dotProduct = originalDirection.x * unitNormal[0] + 
                     originalDirection.y * unitNormal[1] + 
                     originalDirection.z * unitNormal[2];

    // Create perpendicular direction by taking only the normal component
    // and scaling it to reach approximately the same distance as original
    const originalDistance = Math.sqrt(
      originalDirection.x * originalDirection.x + 
      originalDirection.y * originalDirection.y + 
      originalDirection.z * originalDirection.z
    );

    // Use the normal direction, scaled to maintain reasonable distance
    const perpendicularDirection = {
      x: unitNormal[0] * originalDistance,
      y: unitNormal[1] * originalDistance,
      z: unitNormal[2] * originalDistance
    };

    console.log('📐 Direction analysis:', {
      originalDirection,
      unitNormal,
      dotProduct,
      perpendicularDirection,
      originalDistance
    });

    // Segment 2: Points from annulus center along perpendicular direction
    const segment2Points = 60; // Number of points in second segment
    const segment2Length = originalDistance;

    for (let i = 1; i <= segment2Points; i++) {
      const t = i / segment2Points;
      const point: ModifiedCenterlinePoint = {
        x: newAVPoint.x + t * perpendicularDirection.x,
        y: newAVPoint.y + t * perpendicularDirection.y,
        z: newAVPoint.z + t * perpendicularDirection.z,
        distanceFromStart: segment1Length + t * segment2Length,
        isAnnulusPlane: false
      };
      modifiedCenterline.push(point);
    }

    console.log('✅ Modified centerline created:', {
      totalPoints: modifiedCenterline.length,
      segment1Points: segment1Points + 1,
      segment2Points,
      annulusPlaneIndex: modifiedCenterline.findIndex(p => p.isAnnulusPlane),
      totalLength: segment1Length + segment2Length
    });

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