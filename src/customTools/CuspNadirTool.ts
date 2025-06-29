import { getEnabledElements } from '@cornerstonejs/core';
import { BaseTool, Types } from '@cornerstonejs/tools';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import { Vector3 } from '@kitware/vtk.js/types';

class CuspNadirTool extends BaseTool {
  static toolName = 'CuspNadir';
  cuspDots: { 
    id: string; 
    pos: Vector3; 
    actor: any; 
    source: any;
    color: string;
    cuspType: 'left' | 'right' | 'non-coronary';
  }[] = [];
  activeDotDrag: { id: string; distanceFromCamera: number } | null = null;
  positionUpdateCallback: ((dots: { id: string; pos: Vector3; color: string; cuspType: string }[]) => void) | null = null;
  isDraggable: boolean = true; // Can be disabled after annulus creation

  constructor(
    toolProps: Types.PublicToolProps = {},
    defaultToolProps: Types.ToolProps = {
      supportedInteractionTypes: ['Mouse'],
      configuration: {
        dotRadius: 3,
        positionUpdateCallback: null
      },
    }
  ) {
    super(toolProps, defaultToolProps);
    this.cuspDots = [];
    this.activeDotDrag = null;
    
    // Initialize callback from configuration if provided
    this.positionUpdateCallback = this.configuration.positionUpdateCallback || null;
  }

  getToolName() {
    return CuspNadirTool.toolName;
  }

  // Set callback to be called whenever dot positions change
  setPositionUpdateCallback(callback: (dots: { id: string; pos: Vector3; color: string; cuspType: string }[]) => void) {
    this.positionUpdateCallback = callback;
    this.configuration.positionUpdateCallback = callback;
  }

  // Set draggable state (disable after annulus creation)
  setDraggable(draggable: boolean) {
    this.isDraggable = draggable;
    console.log(`🔒 CuspNadirTool draggable state: ${draggable}`);
  }

  // Call the callback with current dot positions
  _notifyPositionUpdate() {
    if (this.positionUpdateCallback) {
      const positions = this.cuspDots.map(dot => ({ 
        id: dot.id, 
        pos: dot.pos, 
        color: dot.color,
        cuspType: dot.cuspType
      }));
      this.positionUpdateCallback(positions);
    }
  }

  preMouseDownCallback = (evt: any) => {
    if (!this.isDraggable) {
      return false; // Tool is locked
    }

    const { element, currentPoints } = evt.detail;
    const enabledElements = getEnabledElements();
    const enabledElement = enabledElements.find(
      el => el.viewport.element === element
    );

    if (!enabledElement || !enabledElement.viewport.getCamera) {
      return false;
    }

    // Check if click is on a cusp dot
    const worldPos = currentPoints.world;
    const camera = enabledElement.viewport.getCamera();
    const cameraPos = camera.position;
    
    // Find the closest dot to the click point
    let closestDot = null;
    let minDistance = Number.MAX_VALUE;
    
    this.cuspDots.forEach(dot => {
      const distance = Math.sqrt(
        Math.pow(dot.pos[0] - worldPos[0], 2) +
        Math.pow(dot.pos[1] - worldPos[1], 2) +
        Math.pow(dot.pos[2] - worldPos[2], 2)
      );
      
      // Check if click is within dot radius (with some tolerance)
      if (distance < this.configuration.dotRadius * 2.0 && distance < minDistance) {
        minDistance = distance;
        closestDot = dot;
      }
    });
    
    if (closestDot) {
      // Calculate distance from camera to dot (used to maintain during drag)
      const distanceFromCamera = Math.sqrt(
        Math.pow(closestDot.pos[0] - cameraPos[0], 2) +
        Math.pow(closestDot.pos[1] - cameraPos[1], 2) +
        Math.pow(closestDot.pos[2] - cameraPos[2], 2)
      );
      
      // Set active drag dot
      this.activeDotDrag = {
        id: closestDot.id,
        distanceFromCamera
      };
      
      console.log(`🎯 Starting drag of cusp dot: ${closestDot.cuspType}`);
      
      // Return true to indicate that this tool has captured the mouse
      return true;
    }
    
    return false;
  };

  mouseClickCallback = (evt: any) => {
    console.log('🎯 CuspNadirTool mouseClickCallback triggered, isDraggable:', this.isDraggable);
    
    if (!this.isDraggable) {
      console.log('🔒 CuspNadirTool is locked, ignoring click');
      return; // Tool is locked
    }

    // If we're in drag mode, don't add a new dot
    if (this.activeDotDrag) {
      console.log('🎯 Currently dragging, ignoring click');
      return;
    }
    
    const { element, currentPoints } = evt.detail;
    const { world: worldPos } = currentPoints;
    
    console.log('🎯 Placing cusp nadir dot at world position:', worldPos);
    
    // Don't add a new dot if we're at the maximum
    if (this.cuspDots.length >= 3) {
      console.warn('Maximum of 3 cusp nadir dots already placed.');
      return;
    }

    const dotId = `cusp-${Date.now()}`;
    
    // Cusp types and colors based on placement order
    const cuspTypes: ('left' | 'right' | 'non-coronary')[] = ['left', 'right', 'non-coronary'];
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1']; // Red, Teal, Blue
    
    const cuspType = cuspTypes[this.cuspDots.length];
    const color = colors[this.cuspDots.length];

    // Use world coordinates directly for VTK actors
    const finalPos: Vector3 = [worldPos[0], worldPos[1], worldPos[2]];
    
    const dotData = { 
      id: dotId, 
      pos: finalPos, 
      actor: null, 
      source: null,
      color: color,
      cuspType: cuspType
    };
    
    this.cuspDots.push(dotData);
    this._placeDot(dotData);

    console.log(`🎯 Placed ${cuspType} cusp nadir dot (${this.cuspDots.length}/3)`);
    
    this._notifyPositionUpdate();
  };

  mouseDragCallback = (evt: any) => {
    if (!this.isDraggable || !this.activeDotDrag) {
      return;
    }
    
    const { currentPoints } = evt.detail;
    const worldPos = currentPoints.world;
    
    // Find the dot being dragged
    const dotIndex = this.cuspDots.findIndex(dot => dot.id === this.activeDotDrag.id);
    if (dotIndex === -1) {
      return;
    }
    
    // Update dot position
    const newPos: Vector3 = [worldPos[0], worldPos[1], worldPos[2]];
    this.cuspDots[dotIndex].pos = newPos;
    
    console.log(`🎯 Dragging ${this.cuspDots[dotIndex].cuspType} cusp dot to:`, newPos);
    
    // Update the dot source directly with the new position
    if (this.cuspDots[dotIndex].source) {
      this.cuspDots[dotIndex].source.setCenter(newPos);
      this.cuspDots[dotIndex].source.modified();
    }
    
    // Render all viewports
    const enabledElements = getEnabledElements();
    enabledElements.forEach(({ viewport }) => viewport.render());
    
    // Notify position update
    this._notifyPositionUpdate();
  };

  mouseUpCallback = (evt: any) => {
    if (this.activeDotDrag) {
      console.log(`🎯 Finished dragging ${this.activeDotDrag.id}`);
      this.activeDotDrag = null;
    }
  };

  _placeDot(dotData: { id: string; pos: Vector3; actor: any; source: any; color: string; cuspType: string }) {
    const enabledElements = getEnabledElements();
    if (enabledElements.length === 0) {
      console.error('No enabled viewports found.');
      return;
    }

    console.log(`🔵 Creating ${dotData.cuspType} cusp dot:`, dotData);

    const dotSource = vtkSphereSource.newInstance();
    dotSource.setCenter(dotData.pos);
    dotSource.setRadius(this.configuration.dotRadius);
    dotSource.setPhiResolution(12);
    dotSource.setThetaResolution(12);

    // Store the source for later updates
    dotData.source = dotSource;

    const mapper = vtkMapper.newInstance();
    mapper.setInputConnection(dotSource.getOutputPort());

    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);

    const property = actor.getProperty();
    // Convert hex color to RGB
    const hex = dotData.color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;
    property.setColor(r, g, b);

    dotData.actor = actor;

    enabledElements.forEach(({ viewport }) => {
      if (!viewport.addActor) {
        console.warn('Viewport does not support adding actors.');
        return;
      }
      viewport.addActor({ uid: dotData.id, actor });
      viewport.render();
    });
    
    // Notify position update
    this._notifyPositionUpdate();
  }

  // Clear all cusp dots (useful for reset)
  clearAll() {
    const enabledElements = getEnabledElements();
    
    console.log('🗑️ Clearing all cusp nadir dots');
    
    // Remove all dots
    this.cuspDots.forEach(dot => {
      enabledElements.forEach(({ viewport }) => {
        if (viewport.removeActor) {
          try {
            viewport.removeActor({ uid: dot.id });
          } catch (error) {
            // Actor might not exist in this viewport
          }
        }
      });
    });
    
    // Reset array
    this.cuspDots = [];
    
    // Render all viewports
    enabledElements.forEach(({ viewport }) => viewport.render());
    
    // Notify position update
    this._notifyPositionUpdate();
    
    console.log('🗑️ All cusp nadir dots cleared');
  }

  // Get current cusp dots positions
  getCuspDots() {
    return this.cuspDots.map(dot => ({
      id: dot.id,
      pos: dot.pos,
      color: dot.color,
      cuspType: dot.cuspType
    }));
  }

  // Check if all 3 cusp dots are placed
  isComplete() {
    return this.cuspDots.length === 3;
  }
}

export default CuspNadirTool;