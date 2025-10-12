import { AnnotationTool } from '@cornerstonejs/tools';
import type { Types } from '@cornerstonejs/core';

/**
 * VerticalDistanceTool - Custom tool for measuring vertical distance in CPR views
 *
 * This tool is specifically designed for CPR (Curved Planar Reconstruction) views
 * to measure the vertical distance from the annulus plane (horizontal reference line).
 *
 * Usage:
 * - Only active in CPR mode
 * - Click to place a measurement point
 * - Shows vertical distance from the annulus plane
 * - Can be accessed via context menu on other annotations
 */
class VerticalDistanceTool extends AnnotationTool {
  static toolName = 'VerticalDistance';

  private annulusYPosition: number | null = null;
  private cprPositionRatio: number = 0.5; // Default to middle

  constructor(toolProps = {}, defaultToolProps = {}) {
    super(toolProps, defaultToolProps);
  }

  /**
   * Set the annulus plane Y position for distance calculations
   * @param yPosition - Y coordinate of annulus plane in viewport pixels
   */
  setAnnulusYPosition(yPosition: number) {
    this.annulusYPosition = yPosition;
  }

  /**
   * Set the CPR position ratio (0-1) representing where annulus plane is
   * @param ratio - Position ratio from top (0) to bottom (1)
   */
  setCPRPositionRatio(ratio: number) {
    this.cprPositionRatio = ratio;
  }

  /**
   * Calculate vertical distance from annulus plane
   * @param canvasPoint - Canvas coordinates [x, y]
   * @param viewport - Viewport for coordinate transformation
   * @returns Distance in mm and pixels
   */
  calculateVerticalDistance(
    canvasPoint: Types.Point2,
    viewport: Types.IViewport
  ): { distancePixels: number; distanceMM: number } {
    const canvas = viewport.getCanvas() as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();

    // Calculate annulus Y position from ratio
    const annulusY = this.cprPositionRatio * rect.height;

    // Distance in pixels (negative = above annulus, positive = below)
    const distancePixels = annulusY - canvasPoint[1];

    // Convert to mm using viewport spacing
    // Estimate: typical CPR view shows ~120mm vertically over canvas height
    const mmPerPixel = 120 / rect.height; // Approximate conversion
    const distanceMM = distancePixels * mmPerPixel;

    return { distancePixels, distanceMM };
  }

  /**
   * Add a vertical distance annotation via context menu
   * This is typically called from the context menu rather than direct click
   */
  addVerticalDistanceAnnotation = (
    viewport: Types.IViewport,
    worldPoint: Types.Point3,
    canvasPoint: Types.Point2
  ) => {
    const { distanceMM } = this.calculateVerticalDistance(canvasPoint, viewport);

    console.log(`📏 Vertical Distance from Annulus: ${distanceMM.toFixed(2)} mm`);

    // Create annotation data
    const annotation = {
      annotationUID: `vertical-distance-${Date.now()}`,
      metadata: {
        toolName: VerticalDistanceTool.toolName,
        viewportId: viewport.id,
        FrameOfReferenceUID: viewport.getFrameOfReferenceUID(),
      },
      data: {
        handles: {
          points: [worldPoint] as Types.Point3[],
        },
        cachedStats: {
          verticalDistanceMM: distanceMM,
        },
      },
      highlighted: false,
      invalidated: false,
    };

    // Add annotation to tool state
    // Note: This is a simplified version - full implementation would use
    // Cornerstone's annotation manager
    return annotation;
  };
}

export default VerticalDistanceTool;
