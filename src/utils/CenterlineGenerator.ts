import { Vector3 } from '@kitware/vtk.js/types';
import { vec3, mat3, mat4, quat } from 'gl-matrix';
import { RootPoint, RootPointType, CenterlineData, AnnularPlane } from '../types/WorkflowTypes';

interface SplinePoint {
  position: Vector3;
  tangent: Vector3;
  distance: number;
  isAnnulusPlane?: boolean;
}

export class CenterlineGenerator {
  /**
   * Generate a smooth centerline from 3 or more root points
   * If annularPlane is provided, inserts ±5mm points around annulus for natural straight segment
   */
  static generateFromRootPoints(rootPoints: RootPoint[], annularPlane?: AnnularPlane): CenterlineData {
    if (rootPoints.length < 3) {
      throw new Error('At least 3 root points are required for centerline generation');
    }

    // Sort points by anatomical order: LV -> Valve -> Ascending Aorta
    const sortedPoints = this.sortRootPointsByOrder(rootPoints);
    let positions = sortedPoints.map(p => p.position);

    // [CL_DEBUG] Log before modification
    console.log(`[CL_DEBUG] 🏗️ CenterlineGenerator: Processing ${rootPoints.length} root points`);
    console.log(`[CL_DEBUG]    Has annularPlane: ${!!annularPlane}`);

    // If annular plane is provided, INSERT ±5mm points around annulus
    // This creates 5 control points: LV, -5mm, annulus, +5mm, ascending
    // The 3 collinear middle points will naturally create a straight segment
    if (annularPlane) {
      console.log(`[CL_DEBUG]    Inserting ±5mm points for natural 10mm straight segment...`);

      // Calculate unit normal
      const normal = annularPlane.normal;
      const normalMagnitude = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2);
      const unitNormal: Vector3 = [
        normal[0] / normalMagnitude,
        normal[1] / normalMagnitude,
        normal[2] / normalMagnitude
      ];

      // Create 5 control points
      const lvPoint = positions[0]; // Original LV outflow
      const ascendingPoint = positions[2]; // Original ascending aorta
      const annulusCenter = annularPlane.center;

      // Calculate ±5mm points PERFECTLY PARALLEL to normal vector
      const point1: Vector3 = [
        annulusCenter[0] + 5 * unitNormal[0],
        annulusCenter[1] + 5 * unitNormal[1],
        annulusCenter[2] + 5 * unitNormal[2]
      ];

      const point2: Vector3 = [
        annulusCenter[0] - 5 * unitNormal[0],
        annulusCenter[1] - 5 * unitNormal[1],
        annulusCenter[2] - 5 * unitNormal[2]
      ];

      // SIMPLE LOGIC: Use distance to determine which point is upstream/downstream
      // Point closer to LV = upstream (goes after LV)
      // Point closer to Aorta = downstream (goes before Aorta)
      const distPoint1ToLV = vec3.distance(point1 as vec3, lvPoint as vec3);
      const distPoint2ToLV = vec3.distance(point2 as vec3, lvPoint as vec3);

      let upstreamPoint: Vector3;
      let downstreamPoint: Vector3;

      if (distPoint1ToLV < distPoint2ToLV) {
        // point1 is closer to LV
        upstreamPoint = point1;
        downstreamPoint = point2;
        console.log(`[CL_DEBUG]    Point selection: point1 (+5*normal) is closer to LV (upstream)`);
      } else {
        // point2 is closer to LV
        upstreamPoint = point2;
        downstreamPoint = point1;
        console.log(`[CL_DEBUG]    Point selection: point2 (-5*normal) is closer to LV (upstream)`);
      }

      // VALIDATION: Verify the 3 points are perfectly collinear along normal
      const vec1 = vec3.subtract(vec3.create(), annulusCenter as vec3, upstreamPoint as vec3);
      const vec2 = vec3.subtract(vec3.create(), downstreamPoint as vec3, annulusCenter as vec3);
      vec3.normalize(vec1, vec1);
      vec3.normalize(vec2, vec2);
      const dotProduct = vec3.dot(vec1, vec2);

      if (Math.abs(dotProduct - 1.0) < 0.000001) {
        console.log(`[CL_DEBUG]    ✓ Validated: ±5mm points perfectly collinear along normal (dot product: ${dotProduct.toFixed(8)})`);
      } else {
        console.warn(`[CL_DEBUG]    ⚠ Warning: ±5mm points not perfectly collinear (dot product: ${dotProduct.toFixed(8)})`);
      }

      // Replace positions with 5 control points in CORRECT ORDER
      // Order: LV → upstream point (closer to LV) → annulus → downstream point (closer to Aorta) → ascending aorta
      positions = [
        lvPoint,
        upstreamPoint,
        annulusCenter as Vector3,
        downstreamPoint,
        ascendingPoint
      ];

      console.log(`[CL_DEBUG]    ✅ Control points: [LV, upstream (closer to LV), annulus, downstream (closer to Aorta), ascending]`);
    }

    // Generate smooth spline through the control points (same method for all cases)
    let splinePoints = this.generateCatmullRomSpline(positions, 50);

    console.log(`[CL_DEBUG]    Generated ${splinePoints.length} spline points`);

    // If annular plane was provided, FORCE the ±5mm segment to be PERFECTLY STRAIGHT
    if (annularPlane) {
      // Find the point closest to annulus center
      let annulusIndex = -1;
      let minDist = Infinity;
      const annulusCenter = annularPlane.center;

      for (let i = 0; i < splinePoints.length; i++) {
        const dist = vec3.distance(splinePoints[i].position, annulusCenter as vec3);
        if (dist < minDist) {
          minDist = dist;
          annulusIndex = i;
        }
      }

      if (annulusIndex >= 0) {
        splinePoints[annulusIndex].isAnnulusPlane = true;
        console.log(`[CL_DEBUG]    Annulus plane marker at index: ${annulusIndex}`);
        console.log(`[CL_DEBUG]    Annulus position: [${splinePoints[annulusIndex].position[0].toFixed(6)}, ${splinePoints[annulusIndex].position[1].toFixed(6)}, ${splinePoints[annulusIndex].position[2].toFixed(6)}]`);

        // NOW FORCE PERFECT STRAIGHTNESS in the ±5mm region
        console.log(`[CL_DEBUG]    🔧 Forcing perfect straight line in ±5mm segment...`);

        const normal = annularPlane.normal;
        const normalMag = Math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2);
        const unitNormal = vec3.fromValues(normal[0]/normalMag, normal[1]/normalMag, normal[2]/normalMag);

        // Calculate the upstream and downstream 5mm positions
        const upstreamPos = vec3.fromValues(
          annulusCenter[0] + 5 * unitNormal[0],
          annulusCenter[1] + 5 * unitNormal[1],
          annulusCenter[2] + 5 * unitNormal[2]
        );
        const downstreamPos = vec3.fromValues(
          annulusCenter[0] - 5 * unitNormal[0],
          annulusCenter[1] - 5 * unitNormal[1],
          annulusCenter[2] - 5 * unitNormal[2]
        );

        // Determine which is which based on distance to LV
        const distUpstreamToStart = vec3.distance(upstreamPos, splinePoints[0].position);
        const distDownstreamToStart = vec3.distance(downstreamPos, splinePoints[0].position);

        let startPos: vec3;
        let endPos: vec3;

        if (distUpstreamToStart < distDownstreamToStart) {
          startPos = upstreamPos;
          endPos = downstreamPos;
        } else {
          startPos = downstreamPos;
          endPos = upstreamPos;
        }

        // Determine the correct flow direction by looking at tangents OUTSIDE the ±5mm region
        // Find a point well before the annulus to get the flow direction
        let flowDirection: vec3 | null = null;
        for (let i = 0; i < annulusIndex; i++) {
          const pos = splinePoints[i].position;
          const vecFromCenter = vec3.subtract(vec3.create(), pos, annulusCenter as vec3);
          const distAlongNormal = vec3.dot(vecFromCenter, unitNormal);

          // Find a point outside the ±5mm region (at least 7mm away)
          if (Math.abs(distAlongNormal) > 7.0) {
            flowDirection = vec3.clone(splinePoints[i].tangent);
            console.log(`[CL_DEBUG]    Flow direction determined from point at index ${i} (dist: ${distAlongNormal.toFixed(2)}mm)`);
            break;
          }
        }

        // If we couldn't find a point before, try after
        if (!flowDirection) {
          for (let i = annulusIndex + 1; i < splinePoints.length; i++) {
            const pos = splinePoints[i].position;
            const vecFromCenter = vec3.subtract(vec3.create(), pos, annulusCenter as vec3);
            const distAlongNormal = vec3.dot(vecFromCenter, unitNormal);

            if (Math.abs(distAlongNormal) > 7.0) {
              flowDirection = vec3.clone(splinePoints[i].tangent);
              console.log(`[CL_DEBUG]    Flow direction determined from point at index ${i} (dist: ${distAlongNormal.toFixed(2)}mm)`);
              break;
            }
          }
        }

        // Calculate the straight line tangent (from start to end)
        const straightTangent = vec3.subtract(vec3.create(), endPos, startPos);
        vec3.normalize(straightTangent, straightTangent);

        // Ensure straight tangent points in same direction as flow
        if (flowDirection) {
          const dotProduct = vec3.dot(straightTangent, flowDirection);
          if (dotProduct < 0) {
            // Tangent is pointing backwards! Flip it and swap start/end
            vec3.negate(straightTangent, straightTangent);
            const temp = startPos;
            startPos = endPos;
            endPos = temp;
            console.log(`[CL_DEBUG]    ⚠ Flipped straight tangent to match flow direction`);
          }
        }

        // Find all points within the ±5mm region and REPLACE them with perfectly straight interpolation
        let straightCount = 0;
        for (let i = 0; i < splinePoints.length; i++) {
          const pos = splinePoints[i].position;

          // Calculate distance from annulus center along the normal
          const vecFromCenter = vec3.subtract(vec3.create(), pos, annulusCenter as vec3);
          const distAlongNormal = vec3.dot(vecFromCenter, unitNormal);

          // Is this point within ±5mm?
          if (Math.abs(distAlongNormal) <= 5.0) {
            // YES - REPLACE with perfect linear interpolation
            // Calculate t based on where we are along the straight line
            const vecFromStart = vec3.subtract(vec3.create(), pos, startPos);
            const totalLength = vec3.distance(endPos, startPos);
            const distFromStart = vec3.dot(vecFromStart, straightTangent);
            const t = Math.max(0, Math.min(1, distFromStart / totalLength));

            // Perfect linear interpolation between start and end
            const newPos = vec3.create();
            vec3.lerp(newPos, startPos, endPos, t);

            splinePoints[i].position = newPos as Vector3;

            // Set tangent to match the flow direction (already corrected)
            splinePoints[i].tangent = vec3.clone(straightTangent) as Vector3;

            straightCount++;
          }
        }

        console.log(`[CL_DEBUG]    ✓ Straightened ${straightCount} points in ±5mm segment with correct flow direction`);
      }
    }

    // Calculate orientations along the spline
    // Pass annular plane info to lock orientation in the straight segment
    const orientations = this.calculateOrientations(splinePoints, annularPlane);

    // Convert to the format expected by VTK ImageCPRMapper
    const centerlinePosition = new Float32Array(splinePoints.length * 3);
    const centerlineOrientation = new Float32Array(splinePoints.length * 16);
    let annulusPlaneIndex = -1;

    for (let i = 0; i < splinePoints.length; i++) {
      // Position (x, y, z)
      centerlinePosition[i * 3] = splinePoints[i].position[0];
      centerlinePosition[i * 3 + 1] = splinePoints[i].position[1];
      centerlinePosition[i * 3 + 2] = splinePoints[i].position[2];

      // Track annulus plane index
      if (splinePoints[i].isAnnulusPlane === true) {
        annulusPlaneIndex = i;
      }

      // Orientation as 4x4 matrix (16 elements)
      const matrix = orientations[i];
      for (let j = 0; j < 16; j++) {
        centerlineOrientation[i * 16 + j] = matrix[j];
      }
    }

    const totalLength = splinePoints[splinePoints.length - 1].distance;

    console.log(`[CL_DEBUG] 📊 Final centerline data:`);
    console.log(`[CL_DEBUG]    Total points: ${splinePoints.length}`);
    console.log(`[CL_DEBUG]    Annulus plane index: ${annulusPlaneIndex}`);
    console.log(`[CL_DEBUG]    Total length: ${totalLength.toFixed(2)} mm`);

    return {
      position: centerlinePosition,
      orientation: centerlineOrientation,
      length: totalLength,
      generatedFrom: rootPoints,
      annulusPlaneIndex: annulusPlaneIndex, // Store the index for easy lookup
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
        const point = rootPoints.find(p => {
          return p.type === type;
        });
        if (!point) {
          throw new Error(`Missing root point of type: ${type}`);
        }
        return point;
      });
    }

    // For more than 3 points (refinement points added), PRESERVE the array order
    // The spheres are already in the correct order from the insertion logic
    // DO NOT re-sort by Z-coordinate as this can reverse the centerline direction
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
   * If annularPlane is provided, locks orientation in the ±5mm straight segment to prevent rotation
   */
  private static calculateOrientations(splinePoints: SplinePoint[], annularPlane?: AnnularPlane): Float32Array[] {
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

    // If annular plane is provided, identify the ±5mm straight segment range
    let straightSegmentStart = -1;
    let straightSegmentEnd = -1;
    let lockedUp: vec3 | null = null;
    let lockedRight: vec3 | null = null;

    if (annularPlane) {
      // Find annulus index
      const annulusIndex = splinePoints.findIndex(p => p.isAnnulusPlane === true);

      if (annulusIndex >= 0) {
        const annulusCenter = annularPlane.center;
        const unitNormal = annularPlane.normal;
        const normalMag = Math.sqrt(unitNormal[0]**2 + unitNormal[1]**2 + unitNormal[2]**2);
        const normal = vec3.fromValues(unitNormal[0]/normalMag, unitNormal[1]/normalMag, unitNormal[2]/normalMag);

        // Calculate ±5mm positions
        const point1 = vec3.fromValues(
          annulusCenter[0] + 5 * normal[0],
          annulusCenter[1] + 5 * normal[1],
          annulusCenter[2] + 5 * normal[2]
        );
        const point2 = vec3.fromValues(
          annulusCenter[0] - 5 * normal[0],
          annulusCenter[1] - 5 * normal[1],
          annulusCenter[2] - 5 * normal[2]
        );

        // Determine which point is upstream (closer to start of spline)
        // straightSegmentStart should be EARLIER in the spline (smaller index)
        // straightSegmentEnd should be LATER in the spline (larger index)
        let upstreamPos: vec3;
        let downstreamPos: vec3;

        // The upstream point should be closer to the beginning of the spline
        if (annulusIndex > splinePoints.length / 2) {
          // Annulus is in second half - compare distances from start
          const distPoint1ToStart = vec3.distance(point1, splinePoints[0].position);
          const distPoint2ToStart = vec3.distance(point2, splinePoints[0].position);
          if (distPoint1ToStart < distPoint2ToStart) {
            upstreamPos = point1;
            downstreamPos = point2;
          } else {
            upstreamPos = point2;
            downstreamPos = point1;
          }
        } else {
          // Annulus is in first half - compare distances from end
          const lastIdx = splinePoints.length - 1;
          const distPoint1ToEnd = vec3.distance(point1, splinePoints[lastIdx].position);
          const distPoint2ToEnd = vec3.distance(point2, splinePoints[lastIdx].position);
          if (distPoint1ToEnd < distPoint2ToEnd) {
            downstreamPos = point1;
            upstreamPos = point2;
          } else {
            downstreamPos = point2;
            upstreamPos = point1;
          }
        }

        // Find indices closest to upstream and downstream positions
        let minDistStart = Infinity;
        let minDistEnd = Infinity;

        for (let i = 0; i < splinePoints.length; i++) {
          const distToUpstream = vec3.distance(splinePoints[i].position, upstreamPos);
          const distToDownstream = vec3.distance(splinePoints[i].position, downstreamPos);

          if (distToUpstream < minDistStart) {
            minDistStart = distToUpstream;
            straightSegmentStart = i;
          }
          if (distToDownstream < minDistEnd) {
            minDistEnd = distToDownstream;
            straightSegmentEnd = i;
          }
        }

        // Ensure start < end (swap if necessary)
        if (straightSegmentStart > straightSegmentEnd) {
          const temp = straightSegmentStart;
          straightSegmentStart = straightSegmentEnd;
          straightSegmentEnd = temp;
          console.log(`[CL_DEBUG]    Swapped start/end to ensure correct order`);
        }

        console.log(`[CL_DEBUG] 🔒 Orientation lock range: [${straightSegmentStart}, ${straightSegmentEnd}] (annulus at ${annulusIndex})`);
      }
    }

    // Use rotation-minimizing frame (parallel transport) for subsequent frames
    // This ensures smooth, flip-free transitions along the centerline
    for (let i = 1; i < splinePoints.length; i++) {
      const currTangent = vec3.clone(splinePoints[i].tangent);

      // CHECK: Are we entering the straight segment? If so, lock the orientation
      if (straightSegmentStart >= 0 && i === straightSegmentStart) {
        lockedUp = vec3.clone(prevUp);
        lockedRight = vec3.clone(prevRight);
        console.log(`[CL_DEBUG] 🔒 Locked orientation at index ${i} (entering straight segment)`);
      }

      // CHECK: Are we inside the straight segment? Use locked orientation
      if (straightSegmentStart >= 0 && straightSegmentEnd >= 0 &&
          i >= straightSegmentStart && i <= straightSegmentEnd &&
          lockedUp && lockedRight) {
        // Use locked orientation - no rotation allowed in straight segment
        const matrix = mat4.fromValues(
          currTangent[0], currTangent[1], currTangent[2], 0,
          lockedUp[0], lockedUp[1], lockedUp[2], 0,
          lockedRight[0], lockedRight[1], lockedRight[2], 0,
          splinePoints[i].position[0], splinePoints[i].position[1], splinePoints[i].position[2], 1
        );
        orientations.push(new Float32Array(matrix));

        // Keep prevUp and prevRight as locked values
        prevUp = lockedUp;
        prevRight = lockedRight;
        continue;
      }

      // CHECK: Have we exited the straight segment? Unlock orientation
      if (straightSegmentEnd >= 0 && i === straightSegmentEnd + 1 && lockedUp && lockedRight) {
        console.log(`[CL_DEBUG] 🔓 Unlocked orientation at index ${i} (exiting straight segment)`);
        lockedUp = null;
        lockedRight = null;
      }

      // NORMAL RMF CALCULATION for curved segments
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