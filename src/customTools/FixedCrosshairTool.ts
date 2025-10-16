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
  // Static callback shared across all instances - ensures it persists even if instance changes
  private static globalCPRRotationCallback: ((deltaAngle: number) => void) | null = null;
  // Static rotation angle shared across all instances - ensures it persists even if instance changes
  private static globalRotationAngle: number = 0;

  private fixedPosition: Types.Point3 | null = null;
  private renderingEngineId: string | null = null;
  private rafId: number | null = null;
  private lastViewportSizes: { [key: string]: { width: number; height: number } } = {};
  private skipDrawUntil: { [key: string]: number } = {}; // Timestamp to skip drawing until

  // Rotation state
  private isDragging: boolean = false;
  private dragStartAngle: number = 0;
  private minRotationThreshold: number = 0.001; // Very small threshold for smooth updates (0.001 radians = ~0.057 degrees)
  private rotationSmoothingFactor: number = 0.5; // 0.5 = balanced sensitivity and smoothness

  // Center dot dragging state
  private isCenterDragging: boolean = false;
  private dragStartWorldPos: Types.Point3 | null = null;
  private valveSphereUpdateCallback: ((newPosition: Types.Point3) => void) | null = null;
  private annularPlaneDefined: boolean = false; // True after 3 cusp dots are placed
  private centerDraggingDisabled: boolean = false; // Disable center dragging (e.g., during measurements)
  private annulusReferencePosition: Types.Point3 | null = null; // Reference position for distance measurement (annulus plane)
  private showDistanceFromAnnulus: boolean = false; // Show distance measurement during measurements stage

  // Windowing state
  private isWindowing: boolean = false;
  private windowingStartPos: { x: number; y: number } | null = null;
  private windowingStartValues: { windowCenter: number; windowWidth: number } | null = null;

  // Color scheme per viewport - pinkish red and lighter green with black shadows
  private redColor = 'rgba(255, 105, 135, 0.9)'; // Pinkish red with 90% opacity
  private greenColor = 'rgba(144, 238, 144, 0.9)'; // Light green with 90% opacity
  private centerColor = 'rgba(255, 105, 135, 0.95)'; // Pinkish red sphere at center
  private shadowColor = 'rgba(0, 0, 0, 0.8)'; // Darker shadow with 80% opacity
  private gapSizeMM = 30; // Gap size in millimeters (world coordinates)
  private lineLengthMM = 80; // Length of each crosshair segment in millimeters (equal for all)
  private lineMargin = 50; // Margin from viewport edges in pixels (used as fallback)
  private endMarkerRadius = 7; // Radius of end marker circles (increased from 5 to 7)
  private endMarkerBuffer = 12; // Extra buffer for end markers (radius + stroke width + safety margin)

  // Hover state
  private hoveredLine: string | null = null; // Track which line is hovered (e.g., "axial-horizontal-left")

  constructor(toolProps = {}, defaultToolProps = {}) {
    super(toolProps, defaultToolProps);
  }

  /**
   * Set the fixed 3D position where crosshairs should be locked
   */
  setFixedPosition(position: Types.Point3, renderingEngineId: string = 'mprRenderingEngine') {
    this.fixedPosition = [...position] as Types.Point3; // Clone to avoid reference issues
    this.renderingEngineId = renderingEngineId;

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
   * Get the current rotation angle
   * Returns the static rotation angle shared across all instances
   */
  getRotationAngle(): number {
    return FixedCrosshairTool.globalRotationAngle;
  }

  /**
   * Set callback for valve sphere position updates (called when center dot is dragged)
   */
  setValveSphereUpdateCallback(callback: (newPosition: Types.Point3) => void) {
    this.valveSphereUpdateCallback = callback;
  }

  /**
   * Set whether the annular plane is defined (3 cusp dots placed)
   * When true, the center dot is locked and cannot be dragged
   */
  setAnnularPlaneDefined(isDefined: boolean) {
    this.annularPlaneDefined = isDefined;
    console.log(`🔒 Center dot ${isDefined ? 'LOCKED' : 'UNLOCKED'} (annular plane ${isDefined ? 'defined' : 'not defined'})`);
  }

  /**
   * Disable/enable center dragging (for measurements stage - only scroll along centerline)
   */
  setCenterDraggingDisabled(disabled: boolean) {
    this.centerDraggingDisabled = disabled;
    console.log(`${disabled ? '🔒' : '🔓'} Center dragging ${disabled ? 'DISABLED' : 'ENABLED'} (measurements: ${disabled})`);
  }

  /**
   * Set annulus reference position and enable distance display (for measurements stage)
   */
  setAnnulusReference(position: Types.Point3 | null) {
    this.annulusReferencePosition = position ? [...position] as Types.Point3 : null;
    this.showDistanceFromAnnulus = position !== null;
    console.log(`📏 Distance measurement ${position ? 'ENABLED' : 'DISABLED'} at:`, position);
  }

  /**
   * Set callback for CPR rotation (updates CPR mapper direction matrices)
   * Pass null to use standard MPR rotation (camera position rotation)
   * Uses static property to ensure callback persists across all instances
   */
  setCPRRotationCallback(callback: ((deltaAngle: number) => void) | null) {
    FixedCrosshairTool.globalCPRRotationCallback = callback;
    console.log(`🔧 CPR rotation callback ${callback ? 'SET (CPR mode)' : 'CLEARED (MPR mode)'}`);
  }

  /**
   * Get the current CPR rotation callback
   * Returns the static callback shared across all instances
   */
  getCPRRotationCallback(): ((deltaAngle: number) => void) | null {
    return FixedCrosshairTool.globalCPRRotationCallback;
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
   * Reset viewport size cache to force recalculation of crosshair positions
   * Call this when viewport layout changes (e.g., entering measurements stage)
   */
  resetViewportSizes() {
    console.log('🔄 FixedCrosshairTool: Resetting viewport size cache');
    this.lastViewportSizes = {};
    this.skipDrawUntil = {};
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

          // Convert gap size from millimeters to canvas pixels
          // Use a test world point offset to calculate scale
          const testWorldPoint1 = [...this.fixedPosition] as Types.Point3;
          const testWorldPoint2 = [...this.fixedPosition] as Types.Point3;
          testWorldPoint2[0] += this.gapSizeMM; // Add gap distance in world coordinates
          const testCanvas1 = viewport.worldToCanvas(testWorldPoint1);
          const testCanvas2 = viewport.worldToCanvas(testWorldPoint2);
          const gapSize = Math.abs(testCanvas2[0] - testCanvas1[0]); // Gap in canvas pixels

          // Convert line length from millimeters to canvas pixels
          const testWorldPoint3 = [...this.fixedPosition] as Types.Point3;
          testWorldPoint3[0] += this.lineLengthMM;
          const testCanvas3 = viewport.worldToCanvas(testWorldPoint3);
          const desiredLineLength = Math.abs(testCanvas3[0] - testCanvas1[0]); // Desired line length in canvas pixels

          // Calculate maximum line length for EACH line independently
          // Minimum line length to ensure visibility
          const minLineLength = 20; // At least 20 pixels

          // Left line: from center-gap to left edge (with margin)
          const maxLeftLength = Math.max(minLineLength, clientPoint[0] - gapSize - this.lineMargin - this.endMarkerBuffer);
          // Right line: from center+gap to right edge (with margin)
          const maxRightLength = Math.max(minLineLength, width - (clientPoint[0] + gapSize) - this.lineMargin - this.endMarkerBuffer);
          // Top line: from center-gap to top edge (with margin)
          const maxTopLength = Math.max(minLineLength, clientPoint[1] - gapSize - this.lineMargin - this.endMarkerBuffer);
          // Bottom line: from center+gap to bottom edge (with margin)
          const maxBottomLength = Math.max(minLineLength, height - (clientPoint[1] + gapSize) - this.lineMargin - this.endMarkerBuffer);

          // Each line uses its own available space (not the minimum of both sides)
          const leftLineLength = Math.min(desiredLineLength, maxLeftLength);
          const rightLineLength = Math.min(desiredLineLength, maxRightLength);
          const topLineLength = Math.min(desiredLineLength, maxTopLength);
          const bottomLineLength = Math.min(desiredLineLength, maxBottomLength);

          // Debug logging (disabled to reduce console noise)
          // if (Date.now() % 1000 < 16) {
          //   console.log(`📐 ${viewportId}: client=${width}x${height}, point=[${clientPoint[0].toFixed(1)}, ${clientPoint[1].toFixed(1)}]`);
          // }

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

            // Add drop shadow filter definition
            const defs = document.createElementNS(svgns, 'defs');
            const filter = document.createElementNS(svgns, 'filter');
            filter.setAttribute('id', `${viewportId}-drop-shadow`);
            filter.setAttribute('x', '-50%');
            filter.setAttribute('y', '-50%');
            filter.setAttribute('width', '200%');
            filter.setAttribute('height', '200%');

            const feGaussianBlur = document.createElementNS(svgns, 'feGaussianBlur');
            feGaussianBlur.setAttribute('in', 'SourceAlpha');
            feGaussianBlur.setAttribute('stdDeviation', '1');

            const feOffset = document.createElementNS(svgns, 'feOffset');
            feOffset.setAttribute('dx', '1');
            feOffset.setAttribute('dy', '1');
            feOffset.setAttribute('result', 'offsetblur');

            const feComponentTransfer = document.createElementNS(svgns, 'feComponentTransfer');
            const feFuncA = document.createElementNS(svgns, 'feFuncA');
            feFuncA.setAttribute('type', 'linear');
            feFuncA.setAttribute('slope', '0.6');
            feComponentTransfer.appendChild(feFuncA);

            const feMerge = document.createElementNS(svgns, 'feMerge');
            const feMergeNode1 = document.createElementNS(svgns, 'feMergeNode');
            const feMergeNode2 = document.createElementNS(svgns, 'feMergeNode');
            feMergeNode2.setAttribute('in', 'SourceGraphic');
            feMerge.appendChild(feMergeNode1);
            feMerge.appendChild(feMergeNode2);

            filter.appendChild(feGaussianBlur);
            filter.appendChild(feOffset);
            filter.appendChild(feComponentTransfer);
            filter.appendChild(feMerge);
            defs.appendChild(filter);
            svgLayer.appendChild(defs);
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

          // Calculate line endpoints - each line uses its own calculated length
          // Left and right lines can have different lengths based on available space
          const leftLineEnd = clientPoint[0] - gapSize;
          const leftLineStart = leftLineEnd - leftLineLength;
          const rightLineStart = clientPoint[0] + gapSize;
          const rightLineEnd = rightLineStart + rightLineLength;

          // Apply rotation ONLY to axial view crosshairs, not long axis views
          const rotationToApply = isLongAxisView ? 0 : FixedCrosshairTool.globalRotationAngle;

          // Apply rotation to horizontal line endpoints
          const hLineLeftStart = rotatePoint(leftLineStart, clientPoint[1], clientPoint[0], clientPoint[1], rotationToApply);
          const hLineLeftEnd = rotatePoint(leftLineEnd, clientPoint[1], clientPoint[0], clientPoint[1], rotationToApply);
          const hLineRightStart = rotatePoint(rightLineStart, clientPoint[1], clientPoint[0], clientPoint[1], rotationToApply);
          const hLineRightEnd = rotatePoint(rightLineEnd, clientPoint[1], clientPoint[0], clientPoint[1], rotationToApply);

          // Debug logging for horizontal line calculations (disabled to reduce console noise)
          // if (Date.now() % 1000 < 16) {
          //   console.log(`  📏 ${viewportId} rotation=${(this.rotationAngle * 180 / Math.PI).toFixed(1)}°`);
          // }

          // Draw shadow for horizontal line LEFT
          const horizontalLineLeftShadow = document.createElementNS(svgns, 'line');
          horizontalLineLeftShadow.setAttribute('id', `${viewportId}-fixed-horizontal-left-shadow`);
          horizontalLineLeftShadow.setAttribute('x1', (hLineLeftStart.x + 1).toString());
          horizontalLineLeftShadow.setAttribute('y1', (hLineLeftStart.y + 1).toString());
          horizontalLineLeftShadow.setAttribute('x2', (hLineLeftEnd.x + 1).toString());
          horizontalLineLeftShadow.setAttribute('y2', (hLineLeftEnd.y + 1).toString());
          horizontalLineLeftShadow.setAttribute('stroke', this.shadowColor);
          horizontalLineLeftShadow.setAttribute('stroke-width', (lineWidth + 1).toString());
          horizontalLineLeftShadow.setAttribute('shape-rendering', 'geometricPrecision');
          horizontalLineLeftShadow.style.pointerEvents = 'none';
          horizontalLineLeftShadow.style.filter = 'blur(1px)';

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
          horizontalLineLeft.style.pointerEvents = 'none'; // Lines are NOT interactive

          // Draw shadow for horizontal line RIGHT
          const horizontalLineRightShadow = document.createElementNS(svgns, 'line');
          horizontalLineRightShadow.setAttribute('id', `${viewportId}-fixed-horizontal-right-shadow`);
          horizontalLineRightShadow.setAttribute('x1', (hLineRightStart.x + 1).toString());
          horizontalLineRightShadow.setAttribute('y1', (hLineRightStart.y + 1).toString());
          horizontalLineRightShadow.setAttribute('x2', (hLineRightEnd.x + 1).toString());
          horizontalLineRightShadow.setAttribute('y2', (hLineRightEnd.y + 1).toString());
          horizontalLineRightShadow.setAttribute('stroke', this.shadowColor);
          horizontalLineRightShadow.setAttribute('stroke-width', (lineWidth + 1).toString());
          horizontalLineRightShadow.setAttribute('shape-rendering', 'geometricPrecision');
          horizontalLineRightShadow.style.pointerEvents = 'none';
          horizontalLineRightShadow.style.filter = 'blur(1px)';

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
          horizontalLineRight.style.pointerEvents = 'none'; // Lines are NOT interactive

          // IDs for hover tracking
          const hLeftLineId = `${viewportId}-horizontal-left`;
          const hRightLineId = `${viewportId}-horizontal-right`;

          // Draw end markers for horizontal line
          // Left end: FILLED circle at the START of left line
          const horizontalLeftMarker = document.createElementNS(svgns, 'circle');
          horizontalLeftMarker.setAttribute('id', `${viewportId}-fixed-horizontal-left-marker`);
          horizontalLeftMarker.setAttribute('cx', hLineLeftStart.x.toString());
          horizontalLeftMarker.setAttribute('cy', hLineLeftStart.y.toString());
          horizontalLeftMarker.setAttribute('r', this.endMarkerRadius.toString());
          horizontalLeftMarker.setAttribute('fill', horizontalColor);
          horizontalLeftMarker.setAttribute('stroke', 'rgba(0, 0, 0, 0.9)'); // Dark border
          horizontalLeftMarker.setAttribute('stroke-width', '2'); // Thicker border
          horizontalLeftMarker.setAttribute('filter', `url(#${viewportId}-drop-shadow)`);
          horizontalLeftMarker.style.cursor = isLongAxisView ? 'default' : 'grab'; // Only draggable in axial
          horizontalLeftMarker.style.pointerEvents = 'all'; // Markers ARE interactive for rotation and hover

          // Add hover listeners to left marker
          horizontalLeftMarker.addEventListener('mouseenter', () => {
            this.hoveredLine = hLeftLineId;
          });
          horizontalLeftMarker.addEventListener('mouseleave', () => {
            if (this.hoveredLine === hLeftLineId) {
              this.hoveredLine = null;
            }
          });

          // Add direct mouse event listener for marker rotation (only in axial view)
          if (!isLongAxisView) {
            this.addMarkerEventListeners(horizontalLeftMarker, viewport, viewportId);
          }

          // Right end: TRANSPARENT circle with layered borders
          // Layer 1: Transparent fill with colored border
          const horizontalRightMarkerBase = document.createElementNS(svgns, 'circle');
          horizontalRightMarkerBase.setAttribute('id', `${viewportId}-fixed-horizontal-right-marker-base`);
          horizontalRightMarkerBase.setAttribute('cx', hLineRightEnd.x.toString());
          horizontalRightMarkerBase.setAttribute('cy', hLineRightEnd.y.toString());
          horizontalRightMarkerBase.setAttribute('r', this.endMarkerRadius.toString());
          horizontalRightMarkerBase.setAttribute('fill', horizontalColor.replace('0.9)', '0.3)')); // Transparent fill (30% opacity)
          horizontalRightMarkerBase.setAttribute('stroke', horizontalColor); // Full opacity colored border
          horizontalRightMarkerBase.setAttribute('stroke-width', '2');
          horizontalRightMarkerBase.setAttribute('filter', `url(#${viewportId}-drop-shadow)`);
          horizontalRightMarkerBase.style.pointerEvents = 'none';

          // Layer 2: Black outer border (same size)
          const horizontalRightMarker = document.createElementNS(svgns, 'circle');
          horizontalRightMarker.setAttribute('id', `${viewportId}-fixed-horizontal-right-marker`);
          horizontalRightMarker.setAttribute('cx', hLineRightEnd.x.toString());
          horizontalRightMarker.setAttribute('cy', hLineRightEnd.y.toString());
          horizontalRightMarker.setAttribute('r', this.endMarkerRadius.toString());
          horizontalRightMarker.setAttribute('fill', 'none'); // No fill for outer layer
          horizontalRightMarker.setAttribute('stroke', 'rgba(0, 0, 0, 0.9)'); // Black outer border
          horizontalRightMarker.setAttribute('stroke-width', '1'); // Thin black border
          horizontalRightMarker.style.cursor = isLongAxisView ? 'default' : 'grab'; // Only draggable in axial
          horizontalRightMarker.style.pointerEvents = 'all'; // Markers ARE interactive for rotation and hover

          // Add hover listeners to right marker
          horizontalRightMarker.addEventListener('mouseenter', () => {
            this.hoveredLine = hRightLineId;
          });
          horizontalRightMarker.addEventListener('mouseleave', () => {
            if (this.hoveredLine === hRightLineId) {
              this.hoveredLine = null;
            }
          });

          // Add direct mouse event listener for marker rotation (only in axial view)
          if (!isLongAxisView) {
            this.addMarkerEventListeners(horizontalRightMarker, viewport, viewportId);
          }

          // Append horizontal lines and markers (shadows first, then main elements, then layered markers)
          svgLayer.appendChild(horizontalLineLeftShadow);
          svgLayer.appendChild(horizontalLineRightShadow);
          svgLayer.appendChild(horizontalLineLeft);
          svgLayer.appendChild(horizontalLineRight);
          svgLayer.appendChild(horizontalLeftMarker);
          svgLayer.appendChild(horizontalRightMarkerBase); // Base layer: transparent fill + colored border
          svgLayer.appendChild(horizontalRightMarker); // Top layer: black outer border

          // Draw gap filler connecting opposite lines on hover (thinner and more transparent)
          if (this.hoveredLine === hLeftLineId || this.hoveredLine === hRightLineId) {
            const gapFiller = document.createElementNS(svgns, 'line');
            gapFiller.setAttribute('id', `${viewportId}-fixed-horizontal-filler`);
            gapFiller.setAttribute('x1', hLineLeftEnd.x.toString());
            gapFiller.setAttribute('y1', hLineLeftEnd.y.toString());
            gapFiller.setAttribute('x2', hLineRightStart.x.toString());
            gapFiller.setAttribute('y2', hLineRightStart.y.toString());
            gapFiller.setAttribute('stroke', horizontalColor.replace('0.7', '0.3')); // More transparent
            gapFiller.setAttribute('stroke-width', '1'); // Thinner
            gapFiller.setAttribute('stroke-dasharray', '4,4'); // Dashed line
            gapFiller.setAttribute('shape-rendering', 'geometricPrecision');
            gapFiller.style.pointerEvents = 'none';
            svgLayer.appendChild(gapFiller);
          }

          // Draw vertical lines ONLY for short axis (axial) view
          if (!isLongAxisView) {
            // Calculate vertical line endpoints - each line uses its own calculated length
            // Top and bottom lines can have different lengths based on available space
            const topLineEnd = clientPoint[1] - gapSize;
            const topLineStart = topLineEnd - topLineLength;
            const bottomLineStart = clientPoint[1] + gapSize;
            const bottomLineEnd = bottomLineStart + bottomLineLength;

            // Apply rotation to vertical line endpoints (rotationToApply already calculated above)
            const vLineTopStart = rotatePoint(clientPoint[0], topLineStart, clientPoint[0], clientPoint[1], rotationToApply);
            const vLineTopEnd = rotatePoint(clientPoint[0], topLineEnd, clientPoint[0], clientPoint[1], rotationToApply);
            const vLineBottomStart = rotatePoint(clientPoint[0], bottomLineStart, clientPoint[0], clientPoint[1], rotationToApply);
            const vLineBottomEnd = rotatePoint(clientPoint[0], bottomLineEnd, clientPoint[0], clientPoint[1], rotationToApply);

            // Draw shadow for vertical line TOP
            const verticalLineTopShadow = document.createElementNS(svgns, 'line');
            verticalLineTopShadow.setAttribute('id', `${viewportId}-fixed-vertical-top-shadow`);
            verticalLineTopShadow.setAttribute('x1', (vLineTopStart.x + 1).toString());
            verticalLineTopShadow.setAttribute('y1', (vLineTopStart.y + 1).toString());
            verticalLineTopShadow.setAttribute('x2', (vLineTopEnd.x + 1).toString());
            verticalLineTopShadow.setAttribute('y2', (vLineTopEnd.y + 1).toString());
            verticalLineTopShadow.setAttribute('stroke', this.shadowColor);
            verticalLineTopShadow.setAttribute('stroke-width', (lineWidth + 1).toString());
            verticalLineTopShadow.setAttribute('shape-rendering', 'geometricPrecision');
            verticalLineTopShadow.style.pointerEvents = 'none';
            verticalLineTopShadow.style.filter = 'blur(1px)';

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
            verticalLineTop.style.pointerEvents = 'none'; // Lines are NOT interactive

            // Draw shadow for vertical line BOTTOM
            const verticalLineBottomShadow = document.createElementNS(svgns, 'line');
            verticalLineBottomShadow.setAttribute('id', `${viewportId}-fixed-vertical-bottom-shadow`);
            verticalLineBottomShadow.setAttribute('x1', (vLineBottomStart.x + 1).toString());
            verticalLineBottomShadow.setAttribute('y1', (vLineBottomStart.y + 1).toString());
            verticalLineBottomShadow.setAttribute('x2', (vLineBottomEnd.x + 1).toString());
            verticalLineBottomShadow.setAttribute('y2', (vLineBottomEnd.y + 1).toString());
            verticalLineBottomShadow.setAttribute('stroke', this.shadowColor);
            verticalLineBottomShadow.setAttribute('stroke-width', (lineWidth + 1).toString());
            verticalLineBottomShadow.setAttribute('shape-rendering', 'geometricPrecision');
            verticalLineBottomShadow.style.pointerEvents = 'none';
            verticalLineBottomShadow.style.filter = 'blur(1px)';

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
            verticalLineBottom.style.pointerEvents = 'none'; // Lines are NOT interactive

            // IDs for hover tracking
            const vTopLineId = `${viewportId}-vertical-top`;
            const vBottomLineId = `${viewportId}-vertical-bottom`;

            // Draw end markers for vertical line
            // Top end: FILLED circle at the START of top line
            const verticalTopMarker = document.createElementNS(svgns, 'circle');
            verticalTopMarker.setAttribute('id', `${viewportId}-fixed-vertical-top-marker`);
            verticalTopMarker.setAttribute('cx', vLineTopStart.x.toString());
            verticalTopMarker.setAttribute('cy', vLineTopStart.y.toString());
            verticalTopMarker.setAttribute('r', this.endMarkerRadius.toString());
            verticalTopMarker.setAttribute('fill', verticalColor); // FILLED
            verticalTopMarker.setAttribute('stroke', 'rgba(0, 0, 0, 0.9)'); // Dark border
            verticalTopMarker.setAttribute('stroke-width', '2'); // Thicker border
            verticalTopMarker.setAttribute('filter', `url(#${viewportId}-drop-shadow)`);
            verticalTopMarker.style.cursor = 'grab';
            verticalTopMarker.style.pointerEvents = 'all'; // Markers ARE interactive for rotation and hover

            // Add hover listeners to top marker
            verticalTopMarker.addEventListener('mouseenter', () => {
              this.hoveredLine = vTopLineId;
            });
            verticalTopMarker.addEventListener('mouseleave', () => {
              if (this.hoveredLine === vTopLineId) {
                this.hoveredLine = null;
              }
            });

            // Add direct mouse event listener for marker rotation
            this.addMarkerEventListeners(verticalTopMarker, viewport, viewportId);

            // Bottom end: TRANSPARENT circle with layered borders (transparent green → green border → black border)
            // Layer 1: Transparent fill with colored border
            const verticalBottomMarkerBase = document.createElementNS(svgns, 'circle');
            verticalBottomMarkerBase.setAttribute('id', `${viewportId}-fixed-vertical-bottom-marker-base`);
            verticalBottomMarkerBase.setAttribute('cx', vLineBottomEnd.x.toString());
            verticalBottomMarkerBase.setAttribute('cy', vLineBottomEnd.y.toString());
            verticalBottomMarkerBase.setAttribute('r', this.endMarkerRadius.toString());
            verticalBottomMarkerBase.setAttribute('fill', verticalColor.replace('0.9)', '0.3)')); // Transparent fill (30% opacity)
            verticalBottomMarkerBase.setAttribute('stroke', verticalColor); // Full opacity colored border
            verticalBottomMarkerBase.setAttribute('stroke-width', '2');
            verticalBottomMarkerBase.setAttribute('filter', `url(#${viewportId}-drop-shadow)`);
            verticalBottomMarkerBase.style.pointerEvents = 'none';

            // Layer 2: Black outer border (same size)
            const verticalBottomMarker = document.createElementNS(svgns, 'circle');
            verticalBottomMarker.setAttribute('id', `${viewportId}-fixed-vertical-bottom-marker`);
            verticalBottomMarker.setAttribute('cx', vLineBottomEnd.x.toString());
            verticalBottomMarker.setAttribute('cy', vLineBottomEnd.y.toString());
            verticalBottomMarker.setAttribute('r', this.endMarkerRadius.toString());
            verticalBottomMarker.setAttribute('fill', 'none'); // No fill for outer layer
            verticalBottomMarker.setAttribute('stroke', 'rgba(0, 0, 0, 0.9)'); // Black outer border
            verticalBottomMarker.setAttribute('stroke-width', '1'); // Thin black border
            verticalBottomMarker.style.cursor = 'grab';
            verticalBottomMarker.style.pointerEvents = 'all'; // Markers ARE interactive for rotation and hover

            // Add hover listeners to bottom marker
            verticalBottomMarker.addEventListener('mouseenter', () => {
              this.hoveredLine = vBottomLineId;
            });
            verticalBottomMarker.addEventListener('mouseleave', () => {
              if (this.hoveredLine === vBottomLineId) {
                this.hoveredLine = null;
              }
            });

            // Add direct mouse event listener for marker rotation
            this.addMarkerEventListeners(verticalBottomMarker, viewport, viewportId);

            // Append vertical lines and markers (shadows first, then main elements, then layered markers)
            svgLayer.appendChild(verticalLineTopShadow);
            svgLayer.appendChild(verticalLineBottomShadow);
            svgLayer.appendChild(verticalLineTop);
            svgLayer.appendChild(verticalLineBottom);
            svgLayer.appendChild(verticalTopMarker);
            svgLayer.appendChild(verticalBottomMarkerBase); // Base layer: transparent fill + colored border
            svgLayer.appendChild(verticalBottomMarker); // Top layer: black outer border

            // Draw gap filler connecting opposite vertical lines on hover (thinner and more transparent)
            if (this.hoveredLine === vTopLineId || this.hoveredLine === vBottomLineId) {
              const gapFiller = document.createElementNS(svgns, 'line');
              gapFiller.setAttribute('id', `${viewportId}-fixed-vertical-filler`);
              gapFiller.setAttribute('x1', vLineTopEnd.x.toString());
              gapFiller.setAttribute('y1', vLineTopEnd.y.toString());
              gapFiller.setAttribute('x2', vLineBottomStart.x.toString());
              gapFiller.setAttribute('y2', vLineBottomStart.y.toString());
              gapFiller.setAttribute('stroke', verticalColor.replace('0.7', '0.3')); // More transparent
              gapFiller.setAttribute('stroke-width', '1'); // Thinner
              gapFiller.setAttribute('stroke-dasharray', '4,4'); // Dashed line
              gapFiller.setAttribute('shape-rendering', 'geometricPrecision');
              gapFiller.style.pointerEvents = 'none';
              svgLayer.appendChild(gapFiller);
            }
          }

          // Draw center dot (smaller than rotation markers) - ALL VIEWS
          const centerRadius = 5; // Smaller than rotation markers (7px)
          const centerDot = document.createElementNS(svgns, 'circle');
          centerDot.setAttribute('id', `${viewportId}-fixed-center`);
          centerDot.setAttribute('cx', clientPoint[0].toString());
          centerDot.setAttribute('cy', clientPoint[1].toString());
          centerDot.setAttribute('r', centerRadius.toString());
          centerDot.setAttribute('fill', this.centerColor); // Pinkish red
          centerDot.setAttribute('stroke', 'rgba(0, 0, 0, 0.9)'); // Black border
          centerDot.setAttribute('stroke-width', '2');
          centerDot.setAttribute('filter', `url(#${viewportId}-drop-shadow)`);
          centerDot.style.pointerEvents = 'all'; // Make center dot interactive
          centerDot.style.cursor = this.centerDraggingDisabled ? 'default' : 'grab'; // Show draggable state

          // Add direct event listeners for center dot dragging
          this.addCenterSphereEventListeners(centerDot as any, viewport, viewportId);

          // Append center dot
          svgLayer.appendChild(centerDot);

          // Draw distance measurement text if enabled (measurements stage)
          if (this.showDistanceFromAnnulus && this.annulusReferencePosition) {
            // Calculate signed distance along centerline (axial normal)
            // IMPORTANT: Always use axial viewport's normal, not current viewport's normal
            const axialViewport = renderingEngine.getViewport('axial');
            const axialNormal = axialViewport.getCamera().viewPlaneNormal; // Direction along centerline

            // Vector from annulus to current position
            const displacement = [
              this.fixedPosition[0] - this.annulusReferencePosition[0],
              this.fixedPosition[1] - this.annulusReferencePosition[1],
              this.fixedPosition[2] - this.annulusReferencePosition[2]
            ];

            // Project displacement onto axial normal to get signed distance
            // INVERTED: Positive = below annulus, Negative = above annulus
            const rawDistance =
              displacement[0] * axialNormal[0] +
              displacement[1] * axialNormal[1] +
              displacement[2] * axialNormal[2];

            // Invert the sign
            const signedDistance = -rawDistance;

            // Format distance text
            const distanceText = signedDistance >= 0
              ? `+${signedDistance.toFixed(1)}mm`
              : `${signedDistance.toFixed(1)}mm`;

            // Create text element with background for better visibility
            const distanceLabel = document.createElementNS(svgns, 'text');
            distanceLabel.setAttribute('id', `${viewportId}-fixed-distance`);
            distanceLabel.style.fill = 'yellow'; // Bright yellow color
            distanceLabel.style.fontSize = '13px';
            distanceLabel.style.fontWeight = 'bold';
            distanceLabel.style.fontFamily = 'monospace';
            distanceLabel.style.pointerEvents = 'none';
            distanceLabel.style.userSelect = 'none';
            distanceLabel.style.textShadow = '2px 2px 4px black, -1px -1px 2px black, 1px -1px 2px black, -1px 1px 2px black'; // Black outline for visibility

            // Position based on viewport type
            if (viewportId === 'axial') {
              // Axial: bottom left corner
              distanceLabel.setAttribute('x', '15');
              distanceLabel.setAttribute('y', (height - 15).toString());
              distanceLabel.setAttribute('text-anchor', 'start');
            } else {
              // Sagittal/Coronal: above crosshair on left side
              distanceLabel.setAttribute('x', (clientPoint[0] - 60).toString());
              distanceLabel.setAttribute('y', (clientPoint[1] - 30).toString());
              distanceLabel.setAttribute('text-anchor', 'end');
            }

            distanceLabel.textContent = distanceText;
            svgLayer.appendChild(distanceLabel);
          }

          drawnCount++;

        } catch (error) {
          errors.push(`${viewportId}: ${error.message}`);
        }
      });

      // Log status periodically (disabled to reduce console noise)
      // if (Date.now() % 1000 < 16) {
      //   if (drawnCount > 0) {
      //     console.log(`✅ FixedCrosshairTool: Drew on ${drawnCount}/3 viewports`);
      //   }
      //   if (errors.length > 0) {
      //     console.warn(`⚠️ FixedCrosshairTool errors:`, errors);
      //   }
      // }
    } catch (error) {
      console.error('FixedCrosshairTool draw error:', error);
    }
  }

  /**
   * Add direct event listeners to center sphere for dragging
   */
  private addCenterSphereEventListeners(sphere: SVGCircleElement, viewport: any, viewportId: string) {
    sphere.addEventListener('mousedown', (e: MouseEvent) => {
      // Prevent dragging if disabled (measurements stage)
      if (this.centerDraggingDisabled) {
        console.log('⛔ Center dragging disabled (measurements mode)');
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      console.log('🎯 Starting center dot drag');
      this.isCenterDragging = true;
      this.dragStartWorldPos = [...this.fixedPosition!] as Types.Point3;

      // Change cursor
      sphere.style.cursor = 'grabbing';

      const renderingEngine = getRenderingEngine(this.renderingEngineId!);
      if (!renderingEngine) return;

      // Get axial viewport to determine the axial normal (constraint axis)
      const axialViewport = renderingEngine.getViewport('axial');
      const axialNormal = axialViewport ? axialViewport.getCamera().viewPlaneNormal : null;

      // Add global mousemove listener
      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!this.isCenterDragging || !this.renderingEngineId || !this.fixedPosition) {
          return;
        }

        const renderingEngine = getRenderingEngine(this.renderingEngineId);
        if (!renderingEngine) return;

        // Get the viewport where the drag is happening
        const dragViewport = renderingEngine.getViewport(viewportId);
        if (!dragViewport) return;

        // Get mouse position relative to viewport
        const rect = dragViewport.element.getBoundingClientRect();
        const canvasX = moveEvent.clientX - rect.left;
        const canvasY = moveEvent.clientY - rect.top;

        // Convert canvas to world coordinates
        const newWorldPos = dragViewport.canvasToWorld([canvasX, canvasY]) as Types.Point3;

        let finalPosition: Types.Point3;

        if (this.annularPlaneDefined && axialNormal) {
          // AFTER 3 cusp dots: Constrain movement to axial direction only
          // Project the movement onto the axial normal
          const movement = [
            newWorldPos[0] - this.dragStartWorldPos![0],
            newWorldPos[1] - this.dragStartWorldPos![1],
            newWorldPos[2] - this.dragStartWorldPos![2]
          ];

          // Project movement onto axial normal
          const projectionOnNormal =
            movement[0] * axialNormal[0] +
            movement[1] * axialNormal[1] +
            movement[2] * axialNormal[2];

          // Move only along the axial normal
          finalPosition = [
            this.dragStartWorldPos![0] + axialNormal[0] * projectionOnNormal,
            this.dragStartWorldPos![1] + axialNormal[1] * projectionOnNormal,
            this.dragStartWorldPos![2] + axialNormal[2] * projectionOnNormal
          ] as Types.Point3;

          console.log('🔒 Axial-only movement:', projectionOnNormal.toFixed(2), 'mm');
        } else {
          // BEFORE 3 cusp dots: Free movement in all directions
          finalPosition = newWorldPos;
          console.log('🆓 Free movement');
        }

        // Update the fixed position
        this.fixedPosition = finalPosition;

        // Call the callback if set (to update valve sphere)
        if (this.valveSphereUpdateCallback) {
          this.valveSphereUpdateCallback(finalPosition);
        }
      };

      // Add global mouseup listener
      const handleMouseUp = () => {
        if (this.isCenterDragging) {
          this.isCenterDragging = false;
          console.log('✅ Center dot drag complete');

          // Reset cursor
          sphere.style.cursor = 'grab';
        }

        // Remove global listeners
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      // Add global listeners
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    });
  }

  /**
   * Add direct event listeners to a marker element for rotation
   */
  private addMarkerEventListeners(marker: SVGCircleElement, viewport: any, viewportId: string) {
    marker.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      console.log('🔄 Starting crosshair rotation from marker in viewport:', viewportId);
      this.isDragging = true;

      // Get center point in canvas coordinates
      const centerCanvas = viewport.worldToCanvas(this.fixedPosition!);

      // Get mouse position relative to viewport
      const rect = viewport.element.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      // Calculate initial angle
      const angleToClick = Math.atan2(canvasY - centerCanvas[1], canvasX - centerCanvas[0]);
      this.dragStartAngle = angleToClick - FixedCrosshairTool.globalRotationAngle;

      // Change cursor to grabbing
      marker.style.cursor = 'grabbing';

      console.log('📎 Adding global event listeners to document');
      let moveCount = 0;

      // Add global mousemove listener
      const handleMouseMove = (moveEvent: MouseEvent) => {
        moveCount++;

        // Log every 10th move to reduce console spam
        if (moveCount % 10 === 1) {
          console.log(`🖱️ MouseMove event #${moveCount}`, {
            isDragging: this.isDragging,
            hasRenderingEngineId: !!this.renderingEngineId,
            hasFixedPosition: !!this.fixedPosition
          });
        }

        if (!this.isDragging || !this.renderingEngineId || !this.fixedPosition) {
          console.warn('⚠️ MouseMove: Conditions not met', {
            isDragging: this.isDragging,
            hasRenderingEngineId: !!this.renderingEngineId,
            hasFixedPosition: !!this.fixedPosition
          });
          return;
        }

        const renderingEngine = getRenderingEngine(this.renderingEngineId);
        if (!renderingEngine) {
          console.warn('⚠️ MouseMove: Rendering engine not found');
          return;
        }

        const axialViewport = renderingEngine.getViewport('axial');
        if (!axialViewport) {
          console.warn('⚠️ MouseMove: Axial viewport not found');
          return;
        }

        // Get center point in canvas coordinates
        const centerCanvas = axialViewport.worldToCanvas(this.fixedPosition);

        // Get mouse position relative to viewport
        const rect = axialViewport.element.getBoundingClientRect();
        const canvasX = moveEvent.clientX - rect.left;
        const canvasY = moveEvent.clientY - rect.top;

        // Calculate angle from center to current mouse position
        const currentAngle = Math.atan2(canvasY - centerCanvas[1], canvasX - centerCanvas[0]);

        // Calculate rotation delta
        const oldRotation = FixedCrosshairTool.globalRotationAngle;
        const rawNewRotation = currentAngle - this.dragStartAngle;
        const rawDeltaAngle = rawNewRotation - oldRotation;

        // Apply smoothing: blend between old and new rotation
        const smoothedDeltaAngle = rawDeltaAngle * this.rotationSmoothingFactor;
        FixedCrosshairTool.globalRotationAngle = oldRotation + smoothedDeltaAngle;
        const deltaAngle = smoothedDeltaAngle;

        // Log rotation updates
        if (Math.abs(deltaAngle) > 0.001) {
          console.log(`🔄 Rotating: deltaAngle=${(deltaAngle * 180 / Math.PI).toFixed(2)}°, total=${(FixedCrosshairTool.globalRotationAngle * 180 / Math.PI).toFixed(1)}°`);
        }

        // Always update for smooth rotation - even tiny movements
        if (Math.abs(deltaAngle) > 0) {
          // Rotate the MPR viewing planes (negate deltaAngle to fix direction)
          console.log('📐 Calling rotateMPRPlanes...');
          this.rotateMPRPlanes(renderingEngine, 'axial', -deltaAngle);
        }
      };

      // Add global mouseup listener
      const handleMouseUp = () => {
        console.log(`🖱️ MouseUp event, total moves: ${moveCount}`);
        if (this.isDragging) {
          this.isDragging = false;
          console.log(`✅ Crosshair rotation complete: ${(FixedCrosshairTool.globalRotationAngle * 180 / Math.PI).toFixed(1)}°`);

          // Reset cursor on all markers
          const allMarkers = document.querySelectorAll('[id*="-fixed-"][id*="-marker"]');
          allMarkers.forEach((m) => {
            (m as HTMLElement).style.cursor = 'grab';
          });
        }

        // Remove global listeners
        console.log('🗑️ Removing global event listeners');
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      // Add global listeners
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      // Add a temporary test listener to verify ANY mousemove events fire
      let testCount = 0;
      const testMove = () => {
        testCount++;
        if (testCount <= 5) {
          console.log(`🧪 Test mousemove event ${testCount}`);
        }
      };
      document.addEventListener('mousemove', testMove);
      setTimeout(() => {
        console.log(`🧪 Test complete: ${testCount} mousemove events detected`);
        document.removeEventListener('mousemove', testMove);
      }, 2000);
    });
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
   * Only trigger when clicking on a MARKER (circle), not on lines
   */
  preMouseDownCallback = (evt: any) => {
    const { element, currentPoints } = evt.detail;
    const canvas = currentPoints.canvas;
    const event = evt.detail.event as MouseEvent;

    if (!this.renderingEngineId || !this.fixedPosition) {
      return false;
    }

    const renderingEngine = getRenderingEngine(this.renderingEngineId);
    if (!renderingEngine) return false;

    const viewportId = element.getAttribute('data-viewport-uid');
    const viewport = renderingEngine.getViewport(viewportId);
    if (!viewport) return false;

    // Check for windowing (Shift + drag anywhere on viewport)
    if (event.shiftKey) {
      this.isWindowing = true;
      this.windowingStartPos = { x: event.clientX, y: event.clientY };

      // Get current window values
      const voiRange = viewport.getProperties().voiRange;
      if (voiRange) {
        const windowWidth = voiRange.upper - voiRange.lower;
        const windowCenter = (voiRange.upper + voiRange.lower) / 2;
        this.windowingStartValues = { windowCenter, windowWidth };
      } else {
        // Default values if no VOI range set
        this.windowingStartValues = { windowCenter: 40, windowWidth: 400 };
      }

      console.log('🪟 Starting windowing:', this.windowingStartValues);
      return true; // We're handling this event
    }

    // Get center point in canvas coordinates
    const centerCanvas = viewport.worldToCanvas(this.fixedPosition);
    const canvasElement = viewport.getCanvas();
    const width = canvasElement.clientWidth;
    const height = canvasElement.clientHeight;

    // Calculate marker positions based on current rotation
    const isLongAxisView = viewportId === 'sagittal' || viewportId === 'coronal';
    const gapSize = isLongAxisView ? this.gapSizeLongAxis : this.gapSizeShortAxis;

    // Calculate line endpoints
    const leftLineStart = this.lineMargin + this.endMarkerBuffer;
    const rightLineEnd = width - this.lineMargin - this.endMarkerBuffer;
    const topLineStart = this.lineMargin + this.endMarkerBuffer;
    const bottomLineEnd = height - this.lineMargin - this.endMarkerBuffer;

    // Rotation helper
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

    const rotationToApply = FixedCrosshairTool.globalRotationAngle;

    // Calculate 4 marker positions (rotated if in axial view)
    const hLineLeftStart = rotatePoint(leftLineStart, centerCanvas[1], centerCanvas[0], centerCanvas[1], rotationToApply);
    const hLineRightEnd = rotatePoint(rightLineEnd, centerCanvas[1], centerCanvas[0], centerCanvas[1], rotationToApply);

    const markerPositions = [
      hLineLeftStart, // Left horizontal marker
      hLineRightEnd,  // Right horizontal marker
    ];

    // Add vertical markers only for axial view
    if (!isLongAxisView) {
      const vLineTopStart = rotatePoint(centerCanvas[0], topLineStart, centerCanvas[0], centerCanvas[1], rotationToApply);
      const vLineBottomEnd = rotatePoint(centerCanvas[0], bottomLineEnd, centerCanvas[0], centerCanvas[1], rotationToApply);
      markerPositions.push(vLineTopStart);    // Top vertical marker
      markerPositions.push(vLineBottomEnd);   // Bottom vertical marker
    }

    // First check if clicking on center sphere (highest priority)
    const centerGrabRadius = 10; // Slightly larger than sphere radius (6px)
    const dxCenter = canvas[0] - centerCanvas[0];
    const dyCenter = canvas[1] - centerCanvas[1];
    const distanceToCenter = Math.sqrt(dxCenter * dxCenter + dyCenter * dyCenter);

    if (distanceToCenter <= centerGrabRadius) {
      // Clicking on center sphere - check if dragging is disabled
      if (this.centerDraggingDisabled) {
        console.log('⛔ Center dragging disabled (measurements mode)');
        return false; // Don't handle this event, let rotation work
      }

      // Start center drag
      this.isCenterDragging = true;
      this.dragStartWorldPos = [...this.fixedPosition] as Types.Point3;
      console.log('🎯 Starting center dot drag from preMouseDown');
      return true; // We're handling this event
    }

    // Check if click is near any marker (within 15px radius)
    const markerGrabRadius = 15;
    for (const markerPos of markerPositions) {
      const dx = canvas[0] - markerPos.x;
      const dy = canvas[1] - markerPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= markerGrabRadius) {
        // Clicking on a marker - start rotation
        this.isDragging = true;
        const angleToClick = Math.atan2(canvas[1] - centerCanvas[1], canvas[0] - centerCanvas[0]);
        this.dragStartAngle = angleToClick - FixedCrosshairTool.globalRotationAngle;
        console.log('🔄 Starting crosshair rotation from marker');
        return true; // We're handling this event
      }
    }

    return false; // Not on a marker or center, let other tools handle it
  };

  /**
   * Mouse drag callback - handle rotation or center dot dragging
   */
  mouseDragCallback = (evt: any) => {
    const { element, currentPoints, deltaPoints } = evt.detail;
    const canvas = currentPoints.canvas;
    const event = evt.detail.event as MouseEvent;

    // Handle windowing (Shift + drag)
    if (this.isWindowing && this.windowingStartPos && this.windowingStartValues) {
      if (!this.renderingEngineId) return false;

      const renderingEngine = getRenderingEngine(this.renderingEngineId);
      if (!renderingEngine) return false;

      const viewportId = element.getAttribute('data-viewport-uid');
      const viewport = renderingEngine.getViewport(viewportId);
      if (!viewport) return false;

      // Calculate mouse delta
      const deltaX = event.clientX - this.windowingStartPos.x;
      const deltaY = event.clientY - this.windowingStartPos.y;

      // Apply windowing changes: horizontal = window width, vertical = window level/center
      const windowWidthDelta = deltaX * 2; // Sensitivity multiplier for width
      const windowCenterDelta = -deltaY; // Invert Y (down = darker)

      const newWindowWidth = Math.max(1, this.windowingStartValues.windowWidth + windowWidthDelta);
      const newWindowCenter = this.windowingStartValues.windowCenter + windowCenterDelta;

      // Calculate new VOI range
      const newLower = newWindowCenter - newWindowWidth / 2;
      const newUpper = newWindowCenter + newWindowWidth / 2;

      // Apply to viewport
      viewport.setProperties({
        voiRange: { lower: newLower, upper: newUpper }
      });

      viewport.render();

      evt.preventDefault();
      evt.stopPropagation();
      return true;
    }

    // Handle center dot dragging
    if (this.isCenterDragging && this.renderingEngineId && this.fixedPosition) {
      const renderingEngine = getRenderingEngine(this.renderingEngineId);
      if (!renderingEngine) return false;

      const viewportId = element.getAttribute('data-viewport-uid');
      const viewport = renderingEngine.getViewport(viewportId);
      if (!viewport) return false;

      // Convert canvas to world coordinates
      const newWorldPos = viewport.canvasToWorld([canvas[0], canvas[1]]) as Types.Point3;

      // Get axial viewport to determine the axial normal (constraint axis)
      const axialViewport = renderingEngine.getViewport('axial');
      const axialNormal = axialViewport ? axialViewport.getCamera().viewPlaneNormal : null;

      let finalPosition: Types.Point3;

      if (this.annularPlaneDefined && axialNormal) {
        // AFTER 3 cusp dots: Constrain movement to axial direction only
        const movement = [
          newWorldPos[0] - this.dragStartWorldPos![0],
          newWorldPos[1] - this.dragStartWorldPos![1],
          newWorldPos[2] - this.dragStartWorldPos![2]
        ];

        // Project movement onto axial normal
        const projectionOnNormal =
          movement[0] * axialNormal[0] +
          movement[1] * axialNormal[1] +
          movement[2] * axialNormal[2];

        // Move only along the axial normal
        finalPosition = [
          this.dragStartWorldPos![0] + axialNormal[0] * projectionOnNormal,
          this.dragStartWorldPos![1] + axialNormal[1] * projectionOnNormal,
          this.dragStartWorldPos![2] + axialNormal[2] * projectionOnNormal
        ] as Types.Point3;
      } else {
        // BEFORE 3 cusp dots: Free movement in all directions
        finalPosition = newWorldPos;
      }

      // Update the fixed position
      this.fixedPosition = finalPosition;

      // Call the callback if set (to update valve sphere)
      if (this.valveSphereUpdateCallback) {
        this.valveSphereUpdateCallback(finalPosition);
      }

      evt.preventDefault();
      evt.stopPropagation();
      return true;
    }

    // Handle rotation dragging
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

    // Calculate angle from center to current mouse position
    // Negate to fix rotation direction (make mouse movement intuitive)
    const currentAngle = Math.atan2(dy, dx);

    // Calculate rotation delta
    const oldRotation = FixedCrosshairTool.globalRotationAngle;
    const rawNewRotation = currentAngle - this.dragStartAngle;
    const rawDeltaAngle = rawNewRotation - oldRotation;

    // Apply smoothing: blend between old and new rotation
    const smoothedDeltaAngle = rawDeltaAngle * this.rotationSmoothingFactor;
    FixedCrosshairTool.globalRotationAngle = oldRotation + smoothedDeltaAngle;
    const deltaAngle = smoothedDeltaAngle;

    // Always update for smooth rotation - even tiny movements
    if (Math.abs(deltaAngle) > 0) {
      // Rotate the MPR viewing planes (negate deltaAngle to fix direction)
      this.rotateMPRPlanes(renderingEngine, viewportId, -deltaAngle);
    }

    evt.preventDefault();
    evt.stopPropagation();
    return true;
  };

  /**
   * Rotate the MPR viewing planes around the fixed center point
   * - Axial: Crosshair rotates visually only (image doesn't rotate)
   * - Sagittal/Coronal: Actual CT planes rotate to match crosshair angle (MPR mode)
   *                     OR update CPR direction matrices (CPR mode via callback)
   */
  private rotateMPRPlanes(renderingEngine: any, activeViewportId: string, deltaAngle: number) {
    if (!this.fixedPosition) {
      console.warn('⚠️ rotateMPRPlanes: No fixed position');
      return;
    }

    // Only allow rotation from axial view
    if (activeViewportId !== 'axial') {
      console.log(`⏭️ rotateMPRPlanes: Ignoring rotation from ${activeViewportId} (only axial allowed)`);
      return;
    }

    // If CPR rotation callback is set (check static property), use it instead of standard rotation
    // IMPORTANT: Only use CPR callback if it's actually set and not null
    if (FixedCrosshairTool.globalCPRRotationCallback && typeof FixedCrosshairTool.globalCPRRotationCallback === 'function') {
      console.log('🔄 Using CPR rotation callback for CPR mode');
      FixedCrosshairTool.globalCPRRotationCallback(deltaAngle);
      return;
    }

    console.log(`🔄 Using MPR rotation (standard camera rotation): deltaAngle=${(deltaAngle * 180 / Math.PI).toFixed(1)}°`);

    const axialViewport = renderingEngine.getViewport('axial') as Types.IVolumeViewport;
    if (!axialViewport) {
      console.warn('⚠️ rotateMPRPlanes: Axial viewport not found');
      return;
    }

    const axialCamera = axialViewport.getCamera();
    const axialNormal = axialCamera.viewPlaneNormal; // This is the rotation axis (perpendicular to axial plane)

    // Rotate sagittal and coronal viewing planes
    const longAxisViewports = ['sagittal', 'coronal'];

    longAxisViewports.forEach(viewportId => {
      const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
      if (!viewport) {
        console.warn(`⚠️ rotateMPRPlanes: ${viewportId} viewport not found`);
        return;
      }

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

      // CRITICAL: Also rotate the viewPlaneNormal to slice through different parts of the volume
      const newViewPlaneNormal = this.rotateVectorAroundAxis(
        camera.viewPlaneNormal,
        axialNormal,
        deltaAngle
      );

      // Set the new camera with ALL parameters including viewPlaneNormal
      console.log(`  📷 Updating ${viewportId} camera...`);
      viewport.setCamera({
        position: newPosition,
        viewUp: newViewUp,
        viewPlaneNormal: newViewPlaneNormal, // This determines which slice we see!
        focalPoint: this.fixedPosition, // Keep focal point locked at valve
        clippingRange: camera.clippingRange, // Preserve clipping range
        parallelScale: camera.parallelScale, // Preserve zoom
      });

      // Force immediate render - call render() directly on viewport
      viewport.render();
      console.log(`  ✅ ${viewportId} camera updated and rendered`);
    });

    // CRITICAL: Force render all viewports together to ensure synchronization
    // This is especially important for the new 2-row layout in measurements stage
    renderingEngine.renderViewports(['axial', 'sagittal', 'coronal']);
    console.log('  🔄 All viewports rendered together');

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
   * Mouse up callback - stop rotation or center dragging or windowing
   */
  mouseUpCallback = (evt: any) => {
    if (this.isWindowing) {
      this.isWindowing = false;
      this.windowingStartPos = null;
      this.windowingStartValues = null;
      console.log('✅ Windowing complete');
      return true;
    }
    if (this.isCenterDragging) {
      this.isCenterDragging = false;
      console.log('✅ Center dot drag complete');
      return true;
    }
    if (this.isDragging) {
      this.isDragging = false;
      console.log(`✅ Crosshair rotation complete: ${(FixedCrosshairTool.globalRotationAngle * 180 / Math.PI).toFixed(1)}°`);
      return true;
    }
    return false;
  };
}

export default FixedCrosshairTool;
