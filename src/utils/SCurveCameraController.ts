/**
 * S-Curve Camera Controller
 *
 * Manages 3D camera rotation based on S-curve LAO/RAO and CRAN/CAUD angles.
 * Keeps all camera rotation logic in one place for easy debugging and maintenance.
 */

import { Types } from '@cornerstonejs/core';
import { SCurveGenerator } from './SCurveGenerator';

export interface CameraState {
  position: Types.Point3;
  focalPoint: Types.Point3;
  viewUp: Types.Point3;
}

export class SCurveCameraController {
  private viewport: any;  // Cornerstone viewport
  private focalPoint: Types.Point3 | null = null;
  private cameraDistance: number = 500; // Default distance in mm
  private onAngleChangeCallback: ((laoRao: number, cranCaud: number) => void) | null = null;

  constructor(viewport: any) {
    this.viewport = viewport;
  }

  /**
   * Set the focal point for camera rotation
   * This is typically the center of the annulus or volume center
   */
  setFocalPoint(point: Types.Point3) {
    this.focalPoint = point;
  }

  /**
   * Set the camera distance from focal point
   */
  setCameraDistance(distance: number) {
    this.cameraDistance = distance;
  }

  /**
   * Set callback for when camera angles change (for bidirectional sync)
   */
  setOnAngleChange(callback: (laoRao: number, cranCaud: number) => void) {
    this.onAngleChangeCallback = callback;
  }

  /**
   * Get the current camera's LAO/RAO and CRAN/CAUD angles
   */
  getCurrentAngles(): { laoRao: number; cranCaud: number } {
    if (!this.viewport || !this.focalPoint) {
      return { laoRao: 0, cranCaud: 0 };
    }

    const camera = this.viewport.getCamera();
    return SCurveGenerator.cameraToFluoroAngles(
      camera.position as [number, number, number],
      camera.focalPoint as [number, number, number]
    );
  }

  /**
   * Rotate the camera to specific LAO/RAO and CRAN/CAUD angles
   * @param laoRao - LAO/RAO angle in degrees (positive = LAO, negative = RAO)
   * @param cranCaud - CRAN/CAUD angle in degrees (positive = CRAN, negative = CAUD)
   * @param animate - Whether to animate the transition (future feature)
   */
  rotateTo(laoRao: number, cranCaud: number, animate: boolean = false) {
    if (!this.viewport || !this.focalPoint) {
      console.warn('⚠️ SCurveCameraController: Cannot rotate - viewport or focal point not set');
      return;
    }

    // Use default values if angles are undefined/null
    const safeLaoRao = laoRao ?? 0;
    const safeCranCaud = cranCaud ?? 0;

    // Calculate new camera position based on angles
    const newPosition = SCurveGenerator.fluoroAnglesToCamera(
      safeLaoRao,
      safeCranCaud,
      this.cameraDistance,
      this.focalPoint as [number, number, number]
    );

    // Determine view-up vector based on angle
    // For most orientations, [0, 0, 1] (pointing superior) is appropriate
    // Adjust if the camera is looking straight down or up
    let viewUp: Types.Point3 = [0, 0, 1];

    // If looking nearly straight up/down, use a different view-up
    if (Math.abs(safeCranCaud) > 80) {
      viewUp = [0, 1, 0]; // Use anterior direction instead
    }

    // Set the camera
    this.viewport.setCamera({
      position: newPosition,
      focalPoint: this.focalPoint,
      viewUp: viewUp,
    });

    // Render the viewport
    this.viewport.render();

    console.log(`📹 Camera rotated to LAO/RAO=${safeLaoRao.toFixed(1)}°, CRAN/CAUD=${safeCranCaud.toFixed(1)}°`);
  }

  /**
   * Enable camera modified event listening for bidirectional sync
   * When user manually rotates the camera, update the S-curve red dot
   */
  enableBidirectionalSync() {
    if (!this.viewport) {
      return;
    }

    const element = this.viewport.element;
    if (!element) {
      return;
    }

    const handleCameraModified = () => {
      if (this.onAngleChangeCallback && this.focalPoint) {
        const camera = this.viewport.getCamera();
        const { laoRao, cranCaud } = SCurveGenerator.cameraToFluoroAngles(
          camera.position as [number, number, number],
          camera.focalPoint as [number, number, number]
        );

        // Notify the S-curve overlay to update the red dot
        this.onAngleChangeCallback(laoRao, cranCaud);
      }
    };

    // Listen for camera modification events
    element.addEventListener('cornerstonecameramodified', handleCameraModified);

    // Store cleanup function
    return () => {
      element.removeEventListener('cornerstonecameramodified', handleCameraModified);
    };
  }

  /**
   * Initialize camera to look perpendicular to the annular plane
   * This gives a good starting view for TAVI planning
   * @param annularPlaneNormal - Normal vector of the annular plane
   */
  initializeToAnnularPlane(annularPlaneNormal: Types.Point3) {
    if (!this.viewport || !this.focalPoint) {
      return;
    }

    // Calculate camera position along the normal vector
    const normal = annularPlaneNormal;
    const position: Types.Point3 = [
      this.focalPoint[0] + normal[0] * this.cameraDistance,
      this.focalPoint[1] + normal[1] * this.cameraDistance,
      this.focalPoint[2] + normal[2] * this.cameraDistance,
    ];

    // Set camera
    this.viewport.setCamera({
      position: position,
      focalPoint: this.focalPoint,
      viewUp: [0, 0, 1],
    });

    this.viewport.render();

    console.log('📹 Camera initialized to annular plane orientation');
  }

  /**
   * Reset camera to default AP view (LAO/RAO = 0, CRAN/CAUD = 0)
   */
  resetToAPView() {
    this.rotateTo(0, 0);
  }

  /**
   * Jump to 3-cusp optimal view (COPV_LCC_P - centers RCC)
   * This view shows all three cusps separated with RCC anterior
   */
  jumpTo3CuspView(
    leftCusp: { x: number; y: number; z: number },
    rightCusp: { x: number; y: number; z: number },
    nonCoronaryCusp: { x: number; y: number; z: number },
    animate: boolean = false
  ) {
    const { laoRao, cranCaud } = SCurveGenerator.calculate3CuspView(
      leftCusp,
      rightCusp,
      nonCoronaryCusp
    );
    console.log(`📹 Jumping to 3-cusp view: LAO/RAO=${laoRao.toFixed(1)}°, CRAN/CAUD=${cranCaud.toFixed(1)}°`);
    this.rotateTo(laoRao, cranCaud, animate);
  }

  /**
   * Jump to cusp-overlap view (COPV_NCC_P - centers NCC, overlaps L and R)
   * This view shows NCC isolated with LCC and RCC overlapping
   */
  jumpToCuspOverlapView(
    leftCusp: { x: number; y: number; z: number },
    rightCusp: { x: number; y: number; z: number },
    nonCoronaryCusp: { x: number; y: number; z: number },
    animate: boolean = false
  ) {
    const { laoRao, cranCaud } = SCurveGenerator.calculateCuspOverlapView(
      leftCusp,
      rightCusp,
      nonCoronaryCusp
    );
    console.log(`📹 Jumping to cusp-overlap view: LAO/RAO=${laoRao.toFixed(1)}°, CRAN/CAUD=${cranCaud.toFixed(1)}°`);
    this.rotateTo(laoRao, cranCaud, animate);
  }

  /**
   * Get common preset views for TAVI planning
   */
  static getPresetViews() {
    return {
      AP: { laoRao: 0, cranCaud: 0, name: 'AP (Anterior-Posterior)' },
      LAO30: { laoRao: 30, cranCaud: 0, name: 'LAO 30°' },
      RAO30: { laoRao: -30, cranCaud: 0, name: 'RAO 30°' },
      CRAN20: { laoRao: 0, cranCaud: 20, name: 'CRAN 20°' },
      CAUD20: { laoRao: 0, cranCaud: -20, name: 'CAUD 20°' },
      LAO30CRAN20: { laoRao: 30, cranCaud: 20, name: 'LAO 30° CRAN 20°' },
    };
  }
}
