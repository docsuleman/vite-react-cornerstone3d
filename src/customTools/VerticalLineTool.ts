/**
 * VerticalLineTool - A custom line tool that constrains drawing to vertical lines only (in canvas coordinates)
 * Used in CPR long axis view for consistent vertical measurements across the vessel
 */

import { LengthTool } from '@cornerstonejs/tools';
import type { Types } from '@cornerstonejs/core';
import { getEnabledElement } from '@cornerstonejs/core';

class VerticalLineTool extends LengthTool {
  static toolName = 'VerticalLineTool';

  constructor(toolProps = {}, defaultToolProps = {}) {
    super(toolProps, defaultToolProps);
  }

  /**
   * Override the mouseDragCallback to constrain the line to be vertical in canvas coordinates
   */
  mouseDragCallback = (evt: any): void => {
    const { element, currentPoints, deltaPoints } = evt.detail;
    const enabledElement = getEnabledElement(element);
    const { viewport } = enabledElement;

    // Get the annotation being drawn/edited
    const annotationUID = this.editData?.annotation?.annotationUID;
    if (!annotationUID || !this.editData?.annotation) {
      super.mouseDragCallback(evt);
      return;
    }

    const annotation = this.editData.annotation;
    const { data } = annotation;
    const { points } = data.handles;

    if (points && points.length === 2) {
      // Convert both points to canvas coordinates
      const startCanvas = viewport.worldToCanvas(points[0]);
      const endCanvas = viewport.worldToCanvas(points[1]);

      // Constrain end point to have same X as start point (vertical line in canvas)
      const constrainedEndCanvas: Types.Point2 = [
        startCanvas[0], // Same X coordinate (vertical)
        endCanvas[1]    // Keep Y coordinate
      ];

      // Convert back to world coordinates
      const constrainedEndWorld = viewport.canvasToWorld(constrainedEndCanvas);

      // Update the end point
      points[1][0] = constrainedEndWorld[0];
      points[1][1] = constrainedEndWorld[1];
      points[1][2] = constrainedEndWorld[2];
    }

    super.mouseDragCallback(evt);
  };
}

export default VerticalLineTool;
