import { BaseTool } from '@cornerstonejs/tools';
import type { Types } from '@cornerstonejs/core';
import { getRenderingEngine } from '@cornerstonejs/core';

/**
 * FixedCrosshairTool - A tool that draws fixed reference lines across viewports
 * The lines are locked at a specific 3D position and cannot be moved by the user.
 * This is used during annulus definition to keep the crosshair centered at the valve.
 */
class FixedCrosshairTool extends BaseTool {
  static toolName = 'FixedCrosshair';
  private fixedPosition: Types.Point3 | null = null;
  private renderingEngineId: string | null = null;
  private rafId: number | null = null;
  private lastViewportSizes: { [key: string]: { width: number; height: number } } = {};
  private skipDrawUntil: { [key: string]: number } = {}; // Timestamp to skip drawing until

  // Rotation state
  private rotationAngle: number = 0; // Rotation angle in radians
  private isDragging: boolean = false;
  private dragStartAngle: number = 0;

  // Color scheme per viewport
  private redColor = 'rgba(255, 50, 50, 0.7)'; // Red with 70% opacity - for coronal and axial horizontal
  private greenColor = 'rgba(50, 255, 50, 0.7)'; // Green with 70% opacity - for sagittal and axial vertical
  private centerColor = 'rgba(255, 50, 50, 0.9)'; // Red sphere at center (90% opacity)
  private gapSizeShortAxis = 20; // Gap size for axial (short axis) view in pixels
  private gapSizeLongAxis = 35; // Gap size for sagittal/coronal (long axis) views in pixels
  private lineMargin = 50; // Margin from viewport edges in pixels
  private endMarkerRadius = 5; // Radius of end marker circles
  private endMarkerBuffer = 10; // Extra buffer for end markers (radius + stroke width + safety margin)

  constructor(toolProps = {}, defaultToolProps = {}) {
    super(toolProps, defaultToolProps);
  }

  /**
   * Set the fixed 3D position where crosshairs should be locked
   */
  setFixedPosition(position: Types.Point3, renderingEngineId: string = 'mprRenderingEngine') {
    this.fixedPosition = [...position] as Types.Point3; // Clone to avoid reference issues
    this.renderingEngineId = renderingEngineId;
    console.log('🔒 FixedCrosshairTool: Position set to', this.fixedPosition);

    // Start rendering loop
    this.startRenderLoop();
  }

  /**
   * Get the current fixed position
   */
  getFixedPosition(): Types.Point3 | null {
    return this.fixedPosition;
  }

  /**
   * Clear the fixed position (hide crosshairs)
   */
  clearFixedPosition() {
    this.fixedPosition = null;
    this.stopRenderLoop();

    // Clean up any existing lines
    this.cleanupLines();

    console.log('🔓 FixedCrosshairTool: Position cleared');
  }

  /**
   * Clean up all existing crosshair lines
   */
  private cleanupLines() {
    const viewportIds = ['axial', 'sagittal', 'coronal'];
    viewportIds.forEach(viewportId => {
      const element = document.querySelector(`[data-viewport-uid="${viewportId}"]`);
      if (element) {
        const svgLayer = element.querySelector('svg');
        if (svgLayer) {
          // Remove all elements with IDs starting with viewportId-fixed-
          const oldElements = svgLayer.querySelectorAll(`[id^="${viewportId}-fixed-"]`);
          oldElements.forEach(el => el.remove());
        }
      }
    });
  }

  /**
   * Start the continuous render loop
   */
  private startRenderLoop() {
    if (this.rafId !== null) {
      return; // Already running
    }

    const render = () => {
      if (this.fixedPosition && this.renderingEngineId) {
        this.drawCrosshairs();
      }
      this.rafId = requestAnimationFrame(render);
    };

    this.rafId = requestAnimationFrame(render);
    console.log('🎬 FixedCrosshairTool: Render loop started');
  }

  /**
   * Stop the render loop
   */
  private stopRenderLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
      console.log('⏹️ FixedCrosshairTool: Render loop stopped');
    }
  }

  /**
   * Draw the crosshairs on all viewports
   */
  private drawCrosshairs() {
    if (!this.fixedPosition || !this.renderingEngineId) {
      return; // Silently skip if not ready
    }

    try {
      const renderingEngine = getRenderingEngine(this.renderingEngineId);
      if (!renderingEngine) {
        return; // Silently skip if engine not found
      }

      const viewportIds = ['axial', 'sagittal', 'coronal'];
      let drawnCount = 0;
      const errors: string[] = [];

      viewportIds.forEach(viewportId => {
        try {
          const viewport = renderingEngine.getViewport(viewportId);
          if (!viewport) {
            errors.push(`${viewportId}: viewport not found`);
            return;
          }

          // Get the viewport element
          const element = viewport.element;
          const canvas = viewport.getCanvas();

          // Check if viewport size has changed
          const currentWidth = canvas.clientWidth;
          const currentHeight = canvas.clientHeight;
          const lastSize = this.lastViewportSizes[viewportId];

          if (lastSize && (lastSize.width !== currentWidth || lastSize.height !== currentHeight)) {
            // Viewport resized - skip drawing for 100ms to let Cornerstone settle
            console.log(`🔄 ${viewportId} resized: ${lastSize.width}x${lastSize.height} → ${currentWidth}x${currentHeight}`);
            this.skipDrawUntil[viewportId] = Date.now() + 100; // Skip for 100ms
            viewport.render();
          }

          // Store current size
          this.lastViewportSizes[viewportId] = { width: currentWidth, height: currentHeight };

          // Skip drawing if we're waiting for viewport to settle after resize
          if (this.skipDrawUntil[viewportId] && Date.now() < this.skipDrawUntil[viewportId]) {
            return; // Skip this viewport for now
          }

          // Get the canvas point for the fixed 3D position
          const canvasPoint = viewport.worldToCanvas(this.fixedPosition!);

          // Debug resize behavior
          if (this.skipDrawUntil[viewportId] && Date.now() >= this.skipDrawUntil[viewportId]) {
            console.log(`✅ ${viewportId} settled after resize, canvasPoint=[${canvasPoint[0].toFixed(1)}, ${canvasPoint[1].toFixed(1)}]`);
            delete this.skipDrawUntil[viewportId];
          }

          // Check if point is valid
          if (!canvasPoint || isNaN(canvasPoint[0]) || isNaN(canvasPoint[1])) {
            errors.push(`${viewportId}: invalid canvas point`);
            return;
          }

          // IMPORTANT: worldToCanvas() already returns coordinates in client/display space!
          // Use canvas client dimensions directly
          const width = canvas.clientWidth;
          const height = canvas.clientHeight;

          // Use canvasPoint as-is (it's already in the right coordinate system)
          const clientPoint = canvasPoint;

          // Determine if this is a long axis view (sagittal/coronal) or short axis (axial)
          const isLongAxisView = viewportId === 'sagittal' || viewportId === 'coronal';
          const gapSize = isLongAxisView ? this.gapSizeLongAxis : this.gapSizeShortAxis;

          // Debug logging (once per second)
          if (Date.now() % 1000 < 16) {
            console.log(`📐 ${viewportId}: client=${width}x${height}, point=[${clientPoint[0].toFixed(1)}, ${clientPoint[1].toFixed(1)}]`);
          }

          // Determine horizontal line color based on viewport
          // Axial: red horizontal, Coronal: red horizontal, Sagittal: green horizontal
          const horizontalColor = viewportId === 'sagittal' ? this.greenColor : this.redColor;
          const verticalColor = this.greenColor; // Only used for axial

          // Draw parameters
          const lineWidth = 2;

          // Get the SVG layer for drawing
          const svgns = 'http://www.w3.org/2000/svg';
          let svgLayer = element.querySelector('svg');

          if (!svgLayer) {
            // Create SVG layer if it doesn't exist
            svgLayer = document.createElementNS(svgns, 'svg');
            svgLayer.style.position = 'absolute';
            svgLayer.style.top = '0';
            svgLayer.style.left = '0';
            svgLayer.style.width = '100%';
            svgLayer.style.height = '100%';
            svgLayer.style.pointerEvents = 'auto'; // Enable pointer events for rotation
            svgLayer.style.zIndex = '1000';
            svgLayer.style.overflow = 'visible'; // Ensure markers don't get clipped
            element.appendChild(svgLayer);
          }

          // Remove old elements if they exist
          const oldElements = svgLayer.querySelectorAll(`[id^="${viewportId}-fixed-"]`);
          oldElements.forEach(el => el.remove());

          // Helper function to rotate a point around the center
          const rotatePoint = (x: number, y: number, cx: number, cy: number, angle: number) => {
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const dx = x - cx;
            const dy = y - cy;
            return {
              x: cx + dx * cos - dy * sin,
              y: cy + dx * sin + dy * cos
            };
          };

          // Calculate line endpoints - account for marker size so markers are fully visible
          // Use buffer instead of radius to account for stroke width
          const leftLineStart = this.lineMargin + this.endMarkerBuffer;
          const leftLineEnd = clientPoint[0] - gapSize;
          const rightLineStart = clientPoint[0] + gapSize;
          const rightLineEnd = width - this.lineMargin - this.endMarkerBuffer;

          // CRITICAL: Only apply rotation in axial view
          // Long axis views (sagittal/coronal) should NOT rotate - they stay aligned with image axes
          const rotationToApply = viewportId === 'axial' ? this.rotationAngle : 0;

          // Apply rotation to horizontal line endpoints
          const hLineLeftStart = rotatePoint(leftLineStart, clientPoint[1], clientPoint[0], clientPoint[1], rotationToApply);
          const hLineLeftEnd = rotatePoint(leftLineEnd, clientPoint[1], clientPoint[0], clientPoint[1], rotationToApply);
          const hLineRightStart = rotatePoint(rightLineStart, clientPoint[1], clientPoint[0], clientPoint[1], rotationToApply);
          const hLineRightEnd = rotatePoint(rightLineEnd, clientPoint[1], clientPoint[0], clientPoint[1], rotationToApply);

          // Debug logging for horizontal line calculations (once per second)
          if (Date.now() % 1000 < 16) {
            console.log(`  📏 ${viewportId} rotation=${(this.rotationAngle * 180 / Math.PI).toFixed(1)}°`);
          }

          // Draw horizontal line with gap (LEFT side) - ALL VIEWS
          const horizontalLineLeft = document.createElementNS(svgns, 'line');
          horizontalLineLeft.setAttribute('id', `${viewportId}-fixed-horizontal-left`);
          horizontalLineLeft.setAttribute('x1', hLineLeftStart.x.toString());
          horizontalLineLeft.setAttribute('y1', hLineLeftStart.y.toString());
          horizontalLineLeft.setAttribute('x2', hLineLeftEnd.x.toString());
          horizontalLineLeft.setAttribute('y2', hLineLeftEnd.y.toString());
          horizontalLineLeft.setAttribute('stroke', horizontalColor);
          horizontalLineLeft.setAttribute('stroke-width', lineWidth.toString());
          horizontalLineLeft.setAttribute('shape-rendering', 'geometricPrecision');
          horizontalLineLeft.setAttribute('cursor', 'grab');
          horizontalLineLeft.style.pointerEvents = 'stroke'; // Make line interactive

          // Draw horizontal line with gap (RIGHT side) - ALL VIEWS
          const horizontalLineRight = document.createElementNS(svgns, 'line');
          horizontalLineRight.setAttribute('id', `${viewportId}-fixed-horizontal-right`);
          horizontalLineRight.setAttribute('x1', hLineRightStart.x.toString());
          horizontalLineRight.setAttribute('y1', hLineRightStart.y.toString());
          horizontalLineRight.setAttribute('x2', hLineRightEnd.x.toString());
          horizontalLineRight.setAttribute('y2', hLineRightEnd.y.toString());
          horizontalLineRight.setAttribute('stroke', horizontalColor);
          horizontalLineRight.setAttribute('stroke-width', lineWidth.toString());
          horizontalLineRight.setAttribute('shape-rendering', 'geometricPrecision');
          horizontalLineRight.setAttribute('cursor', 'grab');
          horizontalLineRight.style.pointerEvents = 'stroke'; // Make line interactive

          // Draw end markers for horizontal line
          // Left end: filled circle at the START of left line
          const horizontalLeftMarker = document.createElementNS(svgns, 'circle');
          horizontalLeftMarker.setAttribute('id', `${viewportId}-fixed-horizontal-left-marker`);
          horizontalLeftMarker.setAttribute('cx', hLineLeftStart.x.toString());
          horizontalLeftMarker.setAttribute('cy', hLineLeftStart.y.toString());
          horizontalLeftMarker.setAttribute('r', this.endMarkerRadius.toString());
          horizontalLeftMarker.setAttribute('fill', horizontalColor);
          horizontalLeftMarker.setAttribute('stroke', 'rgba(255, 255, 255, 0.8)');
          horizontalLeftMarker.setAttribute('stroke-width', '1');
          horizontalLeftMarker.style.pointerEvents = 'none';

          // Right end: hollow circle at the END of right line
          const horizontalRightMarker = document.createElementNS(svgns, 'circle');
          horizontalRightMarker.setAttribute('id', `${viewportId}-fixed-horizontal-right-marker`);
          horizontalRightMarker.setAttribute('cx', hLineRightEnd.x.toString());
          horizontalRightMarker.setAttribute('cy', hLineRightEnd.y.toString());
          horizontalRightMarker.setAttribute('r', this.endMarkerRadius.toString());
          horizontalRightMarker.setAttribute('fill', 'none');
          horizontalRightMarker.setAttribute('stroke', horizontalColor);
          horizontalRightMarker.setAttribute('stroke-width', '2');
          horizontalRightMarker.style.pointerEvents = 'none';

          // Append horizontal lines and markers
          svgLayer.appendChild(horizontalLineLeft);
          svgLayer.appendChild(horizontalLineRight);
          svgLayer.appendChild(horizontalLeftMarker);
          svgLayer.appendChild(horizontalRightMarker);

          // Draw vertical lines ONLY for short axis (axial) view
          if (!isLongAxisView) {
            // Calculate vertical line endpoints - account for marker size so markers are fully visible
            // Use buffer instead of radius to account for stroke width
            const topLineStart = this.lineMargin + this.endMarkerBuffer;
            const topLineEnd = clientPoint[1] - gapSize;
            const bottomLineStart = clientPoint[1] + gapSize;
            const bottomLineEnd = height - this.lineMargin - this.endMarkerBuffer;

            // Apply rotation to vertical line endpoints (rotationToApply already calculated above)
            const vLineTopStart = rotatePoint(clientPoint[0], topLineStart, clientPoint[0], clientPoint[1], rotationToApply);
            const vLineTopEnd = rotatePoint(clientPoint[0], topLineEnd, clientPoint[0], clientPoint[1], rotationToApply);
            const vLineBottomStart = rotatePoint(clientPoint[0], bottomLineStart, clientPoint[0], clientPoint[1], rotationToApply);
            const vLineBottomEnd = rotatePoint(clientPoint[0], bottomLineEnd, clientPoint[0], clientPoint[1], rotationToApply);

            // Draw vertical line with gap (TOP side)
            const verticalLineTop = document.createElementNS(svgns, 'line');
            verticalLineTop.setAttribute('id', `${viewportId}-fixed-vertical-top`);
            verticalLineTop.setAttribute('x1', vLineTopStart.x.toString());
            verticalLineTop.setAttribute('y1', vLineTopStart.y.toString());
            verticalLineTop.setAttribute('x2', vLineTopEnd.x.toString());
            verticalLineTop.setAttribute('y2', vLineTopEnd.y.toString());
            verticalLineTop.setAttribute('stroke', verticalColor);
            verticalLineTop.setAttribute('stroke-width', lineWidth.toString());
            verticalLineTop.setAttribute('shape-rendering', 'geometricPrecision');
            verticalLineTop.setAttribute('cursor', 'grab');
            verticalLineTop.style.pointerEvents = 'stroke'; // Make line interactive

            // Draw vertical line with gap (BOTTOM side)
            const verticalLineBottom = document.createElementNS(svgns, 'line');
            verticalLineBottom.setAttribute('id', `${viewportId}-fixed-vertical-bottom`);
            verticalLineBottom.setAttribute('x1', vLineBottomStart.x.toString());
            verticalLineBottom.setAttribute('y1', vLineBottomStart.y.toString());
            verticalLineBottom.setAttribute('x2', vLineBottomEnd.x.toString());
            verticalLineBottom.setAttribute('y2', vLineBottomEnd.y.toString());
            verticalLineBottom.setAttribute('stroke', verticalColor);
            verticalLineBottom.setAttribute('stroke-width', lineWidth.toString());
            verticalLineBottom.setAttribute('shape-rendering', 'geometricPrecision');
            verticalLineBottom.setAttribute('cursor', 'grab');
            verticalLineBottom.style.pointerEvents = 'stroke'; // Make line interactive

            // Draw end markers for vertical line
            // Top end: filled circle at the START of top line
            const verticalTopMarker = document.createElementNS(svgns, 'circle');
            verticalTopMarker.setAttribute('id', `${viewportId}-fixed-vertical-top-marker`);
            verticalTopMarker.setAttribute('cx', vLineTopStart.x.toString());
            verticalTopMarker.setAttribute('cy', vLineTopStart.y.toString());
            verticalTopMarker.setAttribute('r', this.endMarkerRadius.toString());
            verticalTopMarker.setAttribute('fill', verticalColor);
            verticalTopMarker.setAttribute('stroke', 'rgba(255, 255, 255, 0.8)');
            verticalTopMarker.setAttribute('stroke-width', '1');
            verticalTopMarker.style.pointerEvents = 'none';

            // Bottom end: hollow circle at the END of bottom line
            const verticalBottomMarker = document.createElementNS(svgns, 'circle');
            verticalBottomMarker.setAttribute('id', `${viewportId}-fixed-vertical-bottom-marker`);
            verticalBottomMarker.setAttribute('cx', vLineBottomEnd.x.toString());
            verticalBottomMarker.setAttribute('cy', vLineBottomEnd.y.toString());
            verticalBottomMarker.setAttribute('r', this.endMarkerRadius.toString());
            verticalBottomMarker.setAttribute('fill', 'none');
            verticalBottomMarker.setAttribute('stroke', verticalColor);
            verticalBottomMarker.setAttribute('stroke-width', '2');
            verticalBottomMarker.style.pointerEvents = 'none';

            // Append vertical lines and markers
            svgLayer.appendChild(verticalLineTop);
            svgLayer.appendChild(verticalLineBottom);
            svgLayer.appendChild(verticalTopMarker);
            svgLayer.appendChild(verticalBottomMarker);
          }

          // Draw red sphere at center - ALL VIEWS
          const centerSphere = document.createElementNS(svgns, 'circle');
          centerSphere.setAttribute('id', `${viewportId}-fixed-center`);
          centerSphere.setAttribute('cx', clientPoint[0].toString());
          centerSphere.setAttribute('cy', clientPoint[1].toString());
          centerSphere.setAttribute('r', '6'); // 6 pixel radius
          centerSphere.setAttribute('fill', this.centerColor);
          centerSphere.setAttribute('stroke', 'rgba(255, 255, 255, 0.8)'); // Semi-transparent white border
          centerSphere.setAttribute('stroke-width', '1');
          centerSphere.style.pointerEvents = 'none';

          // Append center sphere
          svgLayer.appendChild(centerSphere);

          drawnCount++;

        } catch (error) {
          errors.push(`${viewportId}: ${error.message}`);
        }
      });

      // Log status periodically (once per second)
      if (Date.now() % 1000 < 16) {
        if (drawnCount > 0) {
          console.log(`✅ FixedCrosshairTool: Drew on ${drawnCount}/3 viewports`);
        }
        if (errors.length > 0) {
          console.warn(`⚠️ FixedCrosshairTool errors:`, errors);
        }
      }
    } catch (error) {
      console.error('FixedCrosshairTool draw error:', error);
    }
  }

  /**
   * Render the fixed crosshair lines on all viewports
   */
  onSetToolEnabled() {
    console.log('✅ FixedCrosshairTool enabled');
    if (this.fixedPosition) {
      this.startRenderLoop();
    }
  }

  onSetToolDisabled() {
    console.log('🔇 FixedCrosshairTool disabled');
    this.stopRenderLoop();
    this.cleanupLines();
  }

  /**
   * Pre mouse down callback - check if we should handle this event
   */
  preMouseDownCallback = (evt: any) => {
    const { element, currentPoints } = evt.detail;
    const canvas = currentPoints.canvas;

    if (!this.renderingEngineId || !this.fixedPosition) {
      return false;
    }

    const renderingEngine = getRenderingEngine(this.renderingEngineId);
    if (!renderingEngine) return false;

    const viewportId = element.getAttribute('data-viewport-uid');
    const viewport = renderingEngine.getViewport(viewportId);
    if (!viewport) return false;

    // Get center point in canvas coordinates
    const centerCanvas = viewport.worldToCanvas(this.fixedPosition);

    // Check if click is near the crosshair center (within 150px)
    const dx = canvas[0] - centerCanvas[0];
    const dy = canvas[1] - centerCanvas[1];
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 150) {
      this.isDragging = true;
      // Store the initial angle
      this.dragStartAngle = Math.atan2(dy, dx) - this.rotationAngle;
      console.log('🔄 Starting crosshair rotation');
      evt.preventDefault();
      evt.stopPropagation();
      return true; // We're handling this event
    }

    return false;
  };

  /**
   * Mouse drag callback - handle rotation during drag
   */
  mouseDragCallback = (evt: any) => {
    const { element, currentPoints, deltaPoints } = evt.detail;
    const canvas = currentPoints.canvas;

    if (!this.isDragging || !this.renderingEngineId || !this.fixedPosition) {
      return false;
    }

    const renderingEngine = getRenderingEngine(this.renderingEngineId);
    if (!renderingEngine) return false;

    const viewportId = element.getAttribute('data-viewport-uid');
    const viewport = renderingEngine.getViewport(viewportId);
    if (!viewport) return false;

    // Get center point in canvas coordinates
    const centerCanvas = viewport.worldToCanvas(this.fixedPosition);

    // Calculate angle from center to current mouse position
    const dx = canvas[0] - centerCanvas[0];
    const dy = canvas[1] - centerCanvas[1];
    const currentAngle = Math.atan2(dy, dx);

    // Calculate rotation delta
    const oldRotation = this.rotationAngle;
    this.rotationAngle = currentAngle - this.dragStartAngle;
    const deltaAngle = this.rotationAngle - oldRotation;

    // Only update if there's a meaningful change
    if (Math.abs(deltaAngle) > 0.01) {
      // Rotate the MPR viewing planes
      this.rotateMPRPlanes(renderingEngine, viewportId, deltaAngle);
      console.log(`🔄 Rotating MPR planes: ${(this.rotationAngle * 180 / Math.PI).toFixed(1)}°`);
    }

    evt.preventDefault();
    evt.stopPropagation();
    return true;
  };

  /**
   * Rotate the MPR viewing planes around the fixed center point
   * - Axial: Crosshair rotates visually only (image doesn't rotate)
   * - Sagittal/Coronal: Actual CT planes rotate to match crosshair angle
   */
  private rotateMPRPlanes(renderingEngine: any, activeViewportId: string, deltaAngle: number) {
    if (!this.fixedPosition) return;

    // Only rotate if dragging in axial view
    if (activeViewportId !== 'axial') {
      return; // For now, only support rotation from axial view
    }

    const axialViewport = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
    if (!axialViewport) return;

    const axialCamera = axialViewport.getCamera();
    const axialNormal = axialCamera.viewPlaneNormal; // This is the rotation axis (perpendicular to axial plane)

    // Rotate sagittal and coronal viewing planes
    const longAxisViewports = ['sagittal', 'coronal'];

    longAxisViewports.forEach(viewportId => {
      const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
      if (!viewport) return;

      const camera = viewport.getCamera();

      // Calculate direction from focal point to camera
      const directionToCamera = [
        camera.position[0] - this.fixedPosition[0],
        camera.position[1] - this.fixedPosition[1],
        camera.position[2] - this.fixedPosition[2]
      ] as Types.Point3;

      // Rotate camera position around the axial normal (Z-axis)
      const newDirection = this.rotateVectorAroundAxis(
        directionToCamera,
        axialNormal,
        deltaAngle
      );

      const newPosition = [
        this.fixedPosition[0] + newDirection[0],
        this.fixedPosition[1] + newDirection[1],
        this.fixedPosition[2] + newDirection[2]
      ] as Types.Point3;

      // Also rotate viewUp vector around the same axis
      const newViewUp = this.rotateVectorAroundAxis(
        camera.viewUp,
        axialNormal,
        deltaAngle
      );

      viewport.setCamera({
        ...camera,
        position: newPosition,
        viewUp: newViewUp,
        focalPoint: this.fixedPosition, // Keep focal point locked at valve
      });

      viewport.render();
    });

    // DON'T rotate the axial viewport camera - only the visual crosshair lines rotate
    // This is handled by the rotationAngle in the drawing code
  }

  /**
   * Rotate a vector around an axis by a given angle (Rodrigues' rotation formula)
   */
  private rotateVectorAroundAxis(vector: Types.Point3, axis: Types.Point3, angle: number): Types.Point3 {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const oneMinusCos = 1 - cos;

    // Normalize axis
    const axisLength = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
    const k = [axis[0] / axisLength, axis[1] / axisLength, axis[2] / axisLength];

    // Rodrigues' rotation formula
    const result = [
      vector[0] * (cos + k[0] * k[0] * oneMinusCos) +
      vector[1] * (k[0] * k[1] * oneMinusCos - k[2] * sin) +
      vector[2] * (k[0] * k[2] * oneMinusCos + k[1] * sin),

      vector[0] * (k[1] * k[0] * oneMinusCos + k[2] * sin) +
      vector[1] * (cos + k[1] * k[1] * oneMinusCos) +
      vector[2] * (k[1] * k[2] * oneMinusCos - k[0] * sin),

      vector[0] * (k[2] * k[0] * oneMinusCos - k[1] * sin) +
      vector[1] * (k[2] * k[1] * oneMinusCos + k[0] * sin) +
      vector[2] * (cos + k[2] * k[2] * oneMinusCos)
    ] as Types.Point3;

    return result;
  }

  /**
   * Mouse up callback - stop rotation
   */
  mouseUpCallback = (evt: any) => {
    if (this.isDragging) {
      this.isDragging = false;
      console.log(`✅ Crosshair rotation complete: ${(this.rotationAngle * 180 / Math.PI).toFixed(1)}°`);
      return true;
    }
    return false;
  };
}

export default FixedCrosshairTool;
