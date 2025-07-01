import { vec3, mat4 } from 'gl-matrix';

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

/**
 * CPR Coordinate Converter - Handles coordinate transformations between
 * CPR space and original DICOM world coordinates
 */
export class CPRCoordinateConverter {
  private transformData: CPRTransformData;

  constructor(transformData: CPRTransformData) {
    this.transformData = transformData;
  }

  /**
   * Convert CPR image coordinates to original DICOM world coordinates
   * @param cprCoords [x, y, z] in CPR image space
   * @returns [x, y, z] in original DICOM world space
   */
  cprToWorld(cprCoords: [number, number, number]): Point3D {
    const worldCoords = this.transformData.cprToWorldTransform(cprCoords);
    return {
      x: worldCoords[0],
      y: worldCoords[1],
      z: worldCoords[2]
    };
  }

  /**
   * Convert original DICOM world coordinates to CPR image coordinates
   * @param worldCoords Point3D in original DICOM world space
   * @returns [x, y, z] in CPR image space
   */
  worldToCpr(worldCoords: Point3D): [number, number, number] {
    return this.transformData.worldToCprTransform([worldCoords.x, worldCoords.y, worldCoords.z]);
  }

  /**
   * Convert Cornerstone3D canvas coordinates to original DICOM world coordinates
   * This is used when user clicks on the Cornerstone3D viewport
   */
  canvasToWorld(
    canvasCoords: [number, number], 
    viewport: any, 
    cprImageBounds: number[]
  ): Point3D {
    // Get the CPR image coordinates from canvas coordinates
    const cprCoords = this.canvasToCpr(canvasCoords, viewport, cprImageBounds);
    
    // Convert CPR coordinates to world coordinates
    return this.cprToWorld(cprCoords);
  }

  /**
   * Convert canvas coordinates to CPR image coordinates
   */
  private canvasToCpr(
    canvasCoords: [number, number], 
    viewport: any, 
    cprImageBounds: number[]
  ): [number, number, number] {
    // Get viewport dimensions
    const canvas = viewport.getCanvas();
    const { width: canvasWidth, height: canvasHeight } = canvas;
    
    // Get image bounds [xMin, xMax, yMin, yMax, zMin, zMax]
    const [xMin, xMax, yMin, yMax, zMin, zMax] = cprImageBounds;
    const imageWidth = xMax - xMin;
    const imageHeight = yMax - yMin;
    
    // Convert canvas coordinates (pixels) to normalized coordinates (0-1)
    const normalizedX = canvasCoords[0] / canvasWidth;
    const normalizedY = 1.0 - (canvasCoords[1] / canvasHeight); // Flip Y axis
    
    // Convert normalized coordinates to CPR image coordinates
    const cprX = xMin + normalizedX * imageWidth;
    const cprY = yMin + normalizedY * imageHeight;
    const cprZ = (zMin + zMax) / 2; // Use middle of Z range
    
    return [cprX, cprY, cprZ];
  }

  /**
   * Convert world coordinates to canvas coordinates for display
   */
  worldToCanvas(
    worldCoords: Point3D, 
    viewport: any, 
    cprImageBounds: number[]
  ): [number, number] {
    // Convert world to CPR coordinates
    const cprCoords = this.worldToCpr(worldCoords);
    
    // Convert CPR to canvas coordinates
    return this.cprToCanvas(cprCoords, viewport, cprImageBounds);
  }

  /**
   * Convert CPR coordinates to canvas coordinates
   */
  private cprToCanvas(
    cprCoords: [number, number, number], 
    viewport: any, 
    cprImageBounds: number[]
  ): [number, number] {
    // Get viewport dimensions
    const canvas = viewport.getCanvas();
    const { width: canvasWidth, height: canvasHeight } = canvas;
    
    // Get image bounds
    const [xMin, xMax, yMin, yMax] = cprImageBounds;
    const imageWidth = xMax - xMin;
    const imageHeight = yMax - yMin;
    
    // Convert CPR coordinates to normalized coordinates (0-1)
    const normalizedX = (cprCoords[0] - xMin) / imageWidth;
    const normalizedY = (cprCoords[1] - yMin) / imageHeight;
    
    // Convert normalized coordinates to canvas coordinates (pixels)
    const canvasX = normalizedX * canvasWidth;
    const canvasY = (1.0 - normalizedY) * canvasHeight; // Flip Y axis
    
    return [canvasX, canvasY];
  }

  /**
   * Find the closest point on centerline to a given world coordinate
   * Useful for projecting points onto the centerline path
   */
  findClosestCenterlinePoint(worldCoords: Point3D): {
    point: Point3D;
    distance: number;
    index: number;
  } {
    const positions = this.transformData.centerlineData.positions;
    const numPoints = positions.length / 3;
    
    let closestPoint = { x: 0, y: 0, z: 0 };
    let minDistance = Number.MAX_VALUE;
    let closestIndex = 0;
    
    for (let i = 0; i < numPoints; i++) {
      const centerlinePoint = {
        x: positions[i * 3],
        y: positions[i * 3 + 1],
        z: positions[i * 3 + 2]
      };
      
      const distance = Math.sqrt(
        Math.pow(worldCoords.x - centerlinePoint.x, 2) +
        Math.pow(worldCoords.y - centerlinePoint.y, 2) +
        Math.pow(worldCoords.z - centerlinePoint.z, 2)
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        closestPoint = centerlinePoint;
        closestIndex = i;
      }
    }
    
    return {
      point: closestPoint,
      distance: minDistance,
      index: closestIndex
    };
  }

  /**
   * Get centerline point by index
   */
  getCenterlinePoint(index: number): Point3D | null {
    const positions = this.transformData.centerlineData.positions;
    const numPoints = positions.length / 3;
    
    if (index < 0 || index >= numPoints) {
      return null;
    }
    
    return {
      x: positions[index * 3],
      y: positions[index * 3 + 1],
      z: positions[index * 3 + 2]
    };
  }

  /**
   * Get the total number of centerline points
   */
  getCenterlinePointCount(): number {
    return this.transformData.centerlineData.positions.length / 3;
  }

  /**
   * Get transform data for external use
   */
  getTransformData(): CPRTransformData {
    return this.transformData;
  }

  /**
   * Update transform data (e.g., when CPR position or rotation changes)
   */
  updateTransformData(newTransformData: CPRTransformData): void {
    this.transformData = newTransformData;
  }

  /**
   * Validate that coordinates are within reasonable bounds
   */
  validateCoordinates(coords: Point3D): boolean {
    const isFinite = (val: number) => Number.isFinite(val) && !Number.isNaN(val);
    return isFinite(coords.x) && isFinite(coords.y) && isFinite(coords.z);
  }

  /**
   * Debug function to log coordinate transformation
   */
  debugTransformation(
    worldCoords: Point3D, 
    description: string = 'Coordinate transformation'
  ): void {
    console.log(`🔄 ${description}:`, {
      originalWorld: worldCoords,
      toCPR: this.worldToCpr(worldCoords),
      backToWorld: this.cprToWorld(this.worldToCpr(worldCoords)),
      isValid: this.validateCoordinates(worldCoords)
    });
  }
}

/**
 * Utility function to create a CPR coordinate converter from transform data
 */
export function createCPRCoordinateConverter(transformData: CPRTransformData): CPRCoordinateConverter {
  return new CPRCoordinateConverter(transformData);
}

export default CPRCoordinateConverter;