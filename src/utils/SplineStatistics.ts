/**
 * Extended statistics calculations for SplineROI annotations
 * Adds long axis, short axis, and perimeter-derived diameter calculations
 */

export interface SplineAxisMeasurements {
  longAxisLength: number;
  shortAxisLength: number;
  longAxisP1: [number, number, number];
  longAxisP2: [number, number, number];
  shortAxisP1: [number, number, number];
  shortAxisP2: [number, number, number];
  perimeterDerivedDiameter: number;
}

/**
 * Calculate the Euclidean distance between two 3D points
 */
function distance3D(p1: [number, number, number], p2: [number, number, number]): number {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const dz = p2[2] - p1[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Calculate the perpendicular distance from a point to a line defined by two points
 */
function perpendicularDistance(
  point: [number, number, number],
  lineP1: [number, number, number],
  lineP2: [number, number, number]
): number {
  // Vector from lineP1 to lineP2
  const dx = lineP2[0] - lineP1[0];
  const dy = lineP2[1] - lineP1[1];
  const dz = lineP2[2] - lineP1[2];

  // Vector from lineP1 to point
  const px = point[0] - lineP1[0];
  const py = point[1] - lineP1[1];
  const pz = point[2] - lineP1[2];

  // Calculate the projection scalar
  const lineLengthSquared = dx * dx + dy * dy + dz * dz;
  if (lineLengthSquared === 0) return distance3D(point, lineP1);

  const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / lineLengthSquared));

  // Calculate the closest point on the line
  const closestX = lineP1[0] + t * dx;
  const closestY = lineP1[1] + t * dy;
  const closestZ = lineP1[2] + t * dz;

  // Return distance from point to closest point
  return distance3D(point, [closestX, closestY, closestZ]);
}

/**
 * Calculate long axis and short axis for a closed spline contour
 *
 * Long axis: The two points on the contour with maximum distance
 * Short axis: The maximum perpendicular distance to the long axis
 *
 * @param points Array of 3D points from the interpolated spline
 * @param perimeter Optional perimeter value to calculate perimeter-derived diameter
 * @returns SplineAxisMeasurements with long/short axis endpoints and lengths
 */
export function calculateSplineAxes(
  points: [number, number, number][],
  perimeter?: number
): SplineAxisMeasurements {
  if (points.length < 3) {
    throw new Error('Need at least 3 points to calculate axes');
  }

  // 1. Find long axis (maximum distance between any two points)
  let maxDistance = 0;
  let longAxisP1: [number, number, number] = points[0];
  let longAxisP2: [number, number, number] = points[1];

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dist = distance3D(points[i], points[j]);
      if (dist > maxDistance) {
        maxDistance = dist;
        longAxisP1 = points[i];
        longAxisP2 = points[j];
      }
    }
  }

  // 2. Find short axis (maximum distance perpendicular to long axis)
  // We need to find the two points on opposite sides of the long axis that maximize the distance

  // First, calculate the long axis direction vector
  const dx = longAxisP2[0] - longAxisP1[0];
  const dy = longAxisP2[1] - longAxisP1[1];
  const dz = longAxisP2[2] - longAxisP1[2];
  const longAxisLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Normalize the long axis vector
  const nx = dx / longAxisLength;
  const ny = dy / longAxisLength;
  const nz = dz / longAxisLength;

  // Find the point on each side of the long axis with maximum perpendicular distance
  let maxDistSide1 = 0;
  let maxDistSide2 = 0;
  let shortAxisPointSide1: [number, number, number] = points[0];
  let shortAxisPointSide2: [number, number, number] = points[0];
  let projectionSide1 = 0;
  let projectionSide2 = 0;

  for (const point of points) {
    const perpDist = perpendicularDistance(point, longAxisP1, longAxisP2);

    // Calculate which side of the long axis this point is on using cross product
    const px = point[0] - longAxisP1[0];
    const py = point[1] - longAxisP1[1];
    const pz = point[2] - longAxisP1[2];

    // Project point onto long axis to find position along the axis
    const projection = px * nx + py * ny + pz * nz;

    // Calculate signed distance (which side of the line)
    // Using cross product to determine side
    const crossX = ny * pz - nz * py;
    const crossY = nz * px - nx * pz;
    const crossZ = nx * py - ny * px;
    const side = crossX + crossY + crossZ; // Simple sum to determine side

    if (side >= 0) {
      if (perpDist > maxDistSide1) {
        maxDistSide1 = perpDist;
        shortAxisPointSide1 = point;
        projectionSide1 = projection;
      }
    } else {
      if (perpDist > maxDistSide2) {
        maxDistSide2 = perpDist;
        shortAxisPointSide2 = point;
        projectionSide2 = projection;
      }
    }
  }

  // Short axis endpoints are the two points on opposite sides
  const shortAxisP1 = shortAxisPointSide1;
  const shortAxisP2 = shortAxisPointSide2;

  // Calculate short axis length as the distance between the two points
  const shortAxisLength = distance3D(shortAxisP1, shortAxisP2);

  // Calculate perimeter-derived diameter if perimeter is provided
  const perimeterDerivedDiameter = perimeter ? perimeter / Math.PI : 0;

  return {
    longAxisLength: maxDistance,
    shortAxisLength,
    longAxisP1,
    longAxisP2,
    shortAxisP1,
    shortAxisP2,
    perimeterDerivedDiameter
  };
}

/**
 * Format axis measurement for display
 */
export function formatAxisMeasurement(value: number, unit: string = 'mm'): string {
  return `${value.toFixed(2)} ${unit}`;
}
