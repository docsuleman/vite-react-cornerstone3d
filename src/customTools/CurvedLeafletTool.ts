/**
 * CurvedLeafletTool - Open spline curve tool for measuring leaflet lengths
 * Based on SplineROITool but can be configured for open curves
 * Supports labeling and deletion via context menu
 */

import { SplineROITool, annotation } from '@cornerstonejs/tools';
import type { Types } from '@cornerstonejs/core';
import { vec3 } from 'gl-matrix';

class CurvedLeafletTool extends SplineROITool {
  static toolName = 'CurvedLeafletTool';

  constructor(toolProps = {}, defaultToolProps = {}) {
    super(toolProps, defaultToolProps);
  }

  /**
   * Calculate the curve length along the spline
   * @param points - Array of 3D points along the spline
   * @returns Total length in mm
   */
  public static calculateCurveLength(points: Types.Point3[]): number {
    if (points.length < 2) {
      return 0;
    }

    let totalLength = 0;

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = vec3.fromValues(points[i][0], points[i][1], points[i][2]);
      const p2 = vec3.fromValues(points[i + 1][0], points[i + 1][1], points[i + 1][2]);

      const segmentLength = vec3.distance(p1, p2);
      totalLength += segmentLength;
    }

    return totalLength;
  }
}

export default CurvedLeafletTool;
