/**
 * S-Curve Generator for TAVI Planning
 * Computes the S-curve from three cusp coordinates for optimal C-arm positioning
 *
 * The S-curve represents the locus of CRAN/CAUD angles as a function of LAO/RAO angles
 * such that the viewing direction is perpendicular to the annular plane defined by
 * the three cusp points.
 */

export interface CuspPoint {
  x: number;
  y: number;
  z: number;
}

export interface SCurveData {
  laoRaoAngles: number[];  // X-axis: -90 to +90 degrees
  cranCaudAngles: number[]; // Y-axis: corresponding CRAN/CAUD angles
}

export class SCurveGenerator {
  /**
   * Generate S-curve from three cusp coordinates (LCC, RCC, NCC)
   * Based on the SCurve_XYZ algorithm from NAVICath.py
   *
   * @param leftCusp - Left Coronary Cusp coordinates
   * @param rightCusp - Right Coronary Cusp coordinates
   * @param nonCoronaryCusp - Non-Coronary Cusp coordinates
   * @returns SCurveData with LAO/RAO and CRAN/CAUD angle arrays
   */
  static generateFromCusps(
    leftCusp: CuspPoint,
    rightCusp: CuspPoint,
    nonCoronaryCusp: CuspPoint
  ): SCurveData {
    const laoRaoAngles: number[] = [];
    const cranCaudAngles: number[] = [];

    // Destructure coordinates
    const { x: Lx, y: Ly, z: Lz } = leftCusp;
    const { x: Rx, y: Ry, z: Rz } = rightCusp;
    const { x: Nx, y: Ny, z: Nz } = nonCoronaryCusp;

    // Generate S-curve for LAO/RAO range -90 to +90 degrees
    for (let xLR = -90; xLR < 90; xLR++) {
      const radLR = (xLR * Math.PI) / 180;

      // Compute plane normal projection components
      // This represents the annular plane orientation in fluoroscopy angles
      let val1 = -Math.sin(radLR) * ((Ry - Ny) * (Lz - Nz) - (Rz - Nz) * (Ly - Ny));
      let val2 = Math.cos(radLR) * ((Rz - Nz) * (Lx - Nx) - (Rx - Nx) * (Lz - Nz));
      let val3 = (Rx - Nx) * (Ly - Ny) - (Ry - Ny) * (Lx - Nx);

      // Avoid division by zero (same as Python code)
      val1 = val1 === 0 ? 0.1 : val1;
      val2 = val2 === 0 ? 0.1 : val2;
      val3 = val3 === 0 ? 0.1 : val3;

      // Compute CRAN/CAUD angle
      const cranCaudAngle = (Math.atan((val1 + val2) / val3) * 180) / Math.PI;

      laoRaoAngles.push(xLR);
      cranCaudAngles.push(cranCaudAngle);
    }

    return {
      laoRaoAngles,
      cranCaudAngles,
    };
  }

  /**
   * Find the nearest point on the S-curve to a given LAO/RAO, CRAN/CAUD coordinate
   * Used when dragging the red dot to snap it to the S-curve
   *
   * @param sCurve - S-curve data
   * @param targetLaoRao - Target LAO/RAO angle
   * @param targetCranCaud - Target CRAN/CAUD angle
   * @returns Index of nearest point on S-curve
   */
  static findNearestPoint(
    sCurve: SCurveData,
    targetLaoRao: number,
    targetCranCaud: number
  ): number {
    let minDistance = Infinity;
    let nearestIndex = 0;

    for (let i = 0; i < sCurve.laoRaoAngles.length; i++) {
      const dx = sCurve.laoRaoAngles[i] - targetLaoRao;
      const dy = sCurve.cranCaudAngles[i] - targetCranCaud;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < minDistance) {
        minDistance = distance;
        nearestIndex = i;
      }
    }

    return nearestIndex;
  }

  /**
   * Convert 3D camera orientation to LAO/RAO and CRAN/CAUD angles
   *
   * @param cameraPosition - Camera position in world coordinates
   * @param cameraFocalPoint - Camera focal point in world coordinates
   * @returns LAO/RAO and CRAN/CAUD angles in degrees
   */
  static cameraToFluoroAngles(
    cameraPosition: [number, number, number],
    cameraFocalPoint: [number, number, number]
  ): { laoRao: number; cranCaud: number } {
    // Compute viewing direction vector (from focal point to camera)
    const dx = cameraPosition[0] - cameraFocalPoint[0];
    const dy = cameraPosition[1] - cameraFocalPoint[1];
    const dz = cameraPosition[2] - cameraFocalPoint[2];

    // Convert to LAO/RAO (rotation around Z-axis)
    // Using atan2(dx, -dy) to match fluoroscopy conventions:
    // - At AP view (dy < 0, dx = 0): angle = 0 (camera at posterior)
    // - At LAO (dx > 0, positive angle): camera to patient's left
    // - At RAO (dx < 0, negative angle): camera to patient's right
    const laoRao = (Math.atan2(dx, -dy) * 180) / Math.PI;

    // Convert to CRAN/CAUD (elevation angle)
    // CRAN = positive Z, CAUD = negative Z
    const horizontalDist = Math.sqrt(dx * dx + dy * dy);
    const cranCaud = (Math.atan2(dz, horizontalDist) * 180) / Math.PI;

    return { laoRao, cranCaud };
  }

  /**
   * Convert LAO/RAO and CRAN/CAUD angles to 3D camera position
   *
   * @param laoRao - LAO/RAO angle in degrees (positive = LAO, negative = RAO)
   * @param cranCaud - CRAN/CAUD angle in degrees (positive = CRAN, negative = CAUD)
   * @param distance - Distance from focal point
   * @param focalPoint - Camera focal point
   * @returns Camera position in world coordinates
   */
  static fluoroAnglesToCamera(
    laoRao: number,
    cranCaud: number,
    distance: number,
    focalPoint: [number, number, number]
  ): [number, number, number] {
    const radLR = (laoRao * Math.PI) / 180;
    const radCC = (cranCaud * Math.PI) / 180;

    // Compute camera position in spherical coordinates using fluoroscopy conventions
    // The camera looks from this position toward the focal point
    //
    // Fluoroscopy conventions (RAS coordinate system):
    // - LAO/RAO = 0, CRAN/CAUD = 0: AP view (camera at posterior/back, looking toward anterior/front)
    // - In fluoroscopy, X-ray source is typically posterior, detector is anterior
    // - LAO (positive): Camera rotates to patient's left (-X direction)
    // - RAO (negative): Camera rotates to patient's right (+X direction)
    // - CRAN (positive): Camera tilts toward head (+Z direction)
    // - CAUD (negative): Camera tilts toward feet (-Z direction)
    const x = focalPoint[0] + distance * Math.cos(radCC) * Math.sin(radLR); // Flipped sign for correct LAO/RAO
    const y = focalPoint[1] - distance * Math.cos(radCC) * Math.cos(radLR); // Posterior camera position
    const z = focalPoint[2] + distance * Math.sin(radCC);

    return [x, y, z];
  }
}
