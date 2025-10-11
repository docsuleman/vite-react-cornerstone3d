import { getEnabledElements, Enums as CornerstoneEnums } from '@cornerstonejs/core';
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
    actors: Map<string, any>; // Map of viewport.id -> actor (one actor per viewport)
    source: any;
    color: string;
    cuspType: 'left' | 'right' | 'non-coronary';
  }[] = [];
  activeDotDrag: { id: string; distanceFromCamera: number } | null = null;
  positionUpdateCallback: ((dots: { id: string; pos: Vector3; color: string; cuspType: string }[]) => void) | null = null;
  isDraggable: boolean = true; // Can be disabled after annulus creation
  forceVisible: boolean = false; // Force all dots visible regardless of slice position (for measurements stage)
  cameraChangeListeners: Map<string, () => void> = new Map(); // Track camera change listeners

  constructor(
    toolProps: Types.PublicToolProps = {},
    defaultToolProps: Types.ToolProps = {
      supportedInteractionTypes: ['Mouse'],
      configuration: {
        dotRadius: 0.8, // Very small precise dots (0.8mm) - reduced from 1.5mm for better precision
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

  // Force all dots visible regardless of slice position (for measurements stage)
  setForceVisible(forceVisible: boolean) {
    this.forceVisible = forceVisible;
    console.log(`👁️ CuspNadirTool force visible: ${forceVisible}`);

    // If forcing visible, make all dots visible immediately
    if (forceVisible) {
      const enabledElements = getEnabledElements();
      this.cuspDots.forEach(dot => {
        dot.actors.forEach((actor) => {
          actor.setVisibility(true);
          actor.modified();
        });
      });
      enabledElements.forEach(({ viewport }) => viewport.render());
    }
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

      // Check if click is within dot radius (with generous tolerance for small dots)
      if (distance < this.configuration.dotRadius * 6.0 && distance < minDistance) {
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

      console.log(`🎯 CuspNadirTool capturing event - dragging ${closestDot.cuspType} dot`);

      // Return true to indicate that this tool has captured the mouse
      // This prevents FixedCrosshairTool from handling this event
      return true;
    }

    console.log('🔄 CuspNadirTool - not over a dot, delegating to FixedCrosshairTool for rotation');

    // Return false to allow FixedCrosshairTool to handle rotation
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
    const { canvas: canvasPos } = currentPoints;

    // Get viewport for accurate coordinate conversion
    const enabledElements = getEnabledElements();
    const enabledElement = enabledElements.find(el => el.viewport.element === element);

    if (!enabledElement || !enabledElement.viewport) {
      console.warn('No viewport found for click event');
      return;
    }

    const viewport = enabledElement.viewport;

    // Use canvasToWorld for more accurate positioning (same as SphereMarkerTool)
    let worldPos: Vector3;
    if (viewport.canvasToWorld) {
      worldPos = viewport.canvasToWorld([canvasPos[0], canvasPos[1]]) as Vector3;

      // Debug logging
      console.log('🎯 CuspNadirTool click coordinates:');
      console.log('   Canvas position:', canvasPos);
      console.log('   World position:', worldPos);
      console.log('   Viewport:', viewport.id);

      // Also try currentPoints.world for comparison
      const eventWorldPos = currentPoints.world;
      console.log('   Event world pos:', eventWorldPos);
      console.log('   Difference:', [
        worldPos[0] - eventWorldPos[0],
        worldPos[1] - eventWorldPos[1],
        worldPos[2] - eventWorldPos[2]
      ]);
    } else {
      console.error('Viewport does not have canvasToWorld method');
      return;
    }

    // Don't add a new dot if we're at the maximum
    if (this.cuspDots.length >= 3) {
      console.warn('Maximum of 3 cusp nadir dots already placed.');
      return;
    }

    const dotId = `cusp-${Date.now()}`;

    // Cusp types and colors based on placement order
    const cuspTypes: ('left' | 'right' | 'non-coronary')[] = ['left', 'right', 'non-coronary'];
    const colors = ['#FF6B6B', '#FFD700', '#4169E1']; // Red, Gold, Royal Blue (very distinct)

    const cuspType = cuspTypes[this.cuspDots.length];
    const color = colors[this.cuspDots.length];

    // Use accurate world coordinates from canvasToWorld conversion
    const finalPos: Vector3 = [worldPos[0], worldPos[1], worldPos[2]];
    
    const dotData = {
      id: dotId,
      pos: finalPos,
      actors: new Map(), // Will store one actor per viewport
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

    const { element, currentPoints } = evt.detail;
    const { canvas: canvasPos } = currentPoints;

    // Get viewport for accurate coordinate conversion
    const enabledElements = getEnabledElements();
    const enabledElement = enabledElements.find(el => el.viewport.element === element);

    if (!enabledElement || !enabledElement.viewport) {
      return;
    }

    const viewport = enabledElement.viewport;

    // Use canvasToWorld for accurate positioning (same as click handler)
    let worldPos: Vector3;
    if (viewport.canvasToWorld) {
      worldPos = viewport.canvasToWorld([canvasPos[0], canvasPos[1]]) as Vector3;
    } else {
      return;
    }

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
      // CRITICAL: setCenter expects three separate numbers, not an array!
      this.cuspDots[dotIndex].source.setCenter(newPos[0], newPos[1], newPos[2]);
      this.cuspDots[dotIndex].source.modified();
    }

    // Render all viewports (reuse enabledElements from above)
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

  _placeDot(dotData: { id: string; pos: Vector3; actors: Map<string, any>; source: any; color: string; cuspType: string }) {
    const enabledElements = getEnabledElements();
    if (enabledElements.length === 0) {
      console.error('No enabled viewports found.');
      return;
    }

    console.log(`🔵 Creating ${dotData.cuspType} cusp dot:`, dotData);

    const dotSource = vtkSphereSource.newInstance();
    // CRITICAL: setCenter expects three separate numbers, not an array!
    dotSource.setCenter(dotData.pos[0], dotData.pos[1], dotData.pos[2]);
    dotSource.setRadius(this.configuration.dotRadius);
    dotSource.setPhiResolution(32); // High resolution for smooth appearance
    dotSource.setThetaResolution(32);

    // Store the source for later updates
    dotData.source = dotSource;

    // Convert hex color to RGB once
    const hex = dotData.color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;

    // CRITICAL: Create a separate actor for EACH viewport (like SphereMarkerTool)
    // This ensures proper rendering in all views
    enabledElements.forEach(({ viewport }) => {
      if (!viewport.addActor) {
        console.warn('Viewport does not support adding actors.');
        return;
      }

      // Create a separate mapper and actor for this viewport
      const mapper = vtkMapper.newInstance();
      mapper.setInputConnection(dotSource.getOutputPort());

      const actor = vtkActor.newInstance();
      actor.setMapper(mapper);

      const property = actor.getProperty();
      property.setColor(r, g, b);

      // Store actor for this viewport
      dotData.actors.set(viewport.id, actor);

      // Add actor to this viewport with unique ID
      viewport.addActor({ uid: `${dotData.id}-${viewport.id}`, actor });
      viewport.render();
    });

    // Notify position update
    this._notifyPositionUpdate();

    // Set up camera change listeners for slice-based visibility (reuse enabledElements from above)
    enabledElements.forEach(({ viewport }, index) => {
      this._setupViewportEventListeners(viewport, index);
    });

    // Do initial visibility check after a short delay
    setTimeout(() => {
      enabledElements.forEach(({ viewport }, index) => {
        this.updateVisibilityForSingleViewport(viewport, index);
      });
    }, 100);
  }

  // Set up camera change event listeners for slice-based visibility
  _setupViewportEventListeners(viewport: any, index: number) {
    if (!viewport) {
      return;
    }

    // Remove old listeners first
    const oldListener = this.cameraChangeListeners.get(viewport.id);
    const oldKeyListener = this.cameraChangeListeners.get(viewport.id + '_key');
    const oldCameraListener = this.cameraChangeListeners.get(viewport.id + '_camera');
    if (oldListener) {
      viewport.element.removeEventListener('wheel', oldListener);
    }
    if (oldKeyListener) {
      viewport.element.removeEventListener('keydown', oldKeyListener);
    }
    if (oldCameraListener) {
      viewport.element.removeEventListener(CornerstoneEnums.Events.CAMERA_MODIFIED, oldCameraListener);
    }

    // Create a specific handler for this viewport only
    const updateVisibility = () => {
      this.updateVisibilityForSingleViewport(viewport, index);
    };

    // Add wheel event listener directly to the viewport element
    viewport.element.addEventListener('wheel', updateVisibility, { passive: true });

    // Also try keydown for arrow keys (slice navigation)
    const keyHandler = (evt: KeyboardEvent) => {
      if (evt.key === 'ArrowUp' || evt.key === 'ArrowDown') {
        setTimeout(() => {
          this.updateVisibilityForSingleViewport(viewport, index);
        }, 50);
      }
    };
    viewport.element.addEventListener('keydown', keyHandler);

    // Listen for camera changes from CrosshairsTool sync
    const cameraChangeHandler = (evt: any) => {
      setTimeout(() => {
        this.updateVisibilityForSingleViewport(viewport, index);
      }, 10);
    };
    viewport.element.addEventListener(CornerstoneEnums.Events.CAMERA_MODIFIED, cameraChangeHandler);

    // Store all listeners
    this.cameraChangeListeners.set(viewport.id, updateVisibility);
    this.cameraChangeListeners.set(viewport.id + '_key', keyHandler);
    this.cameraChangeListeners.set(viewport.id + '_camera', cameraChangeHandler);
  }

  // Update cusp dot visibility based on current slice position for a single viewport
  updateVisibilityForSingleViewport(viewport: any, viewportIndex: number) {
    if (!viewport || viewport.type !== 'orthographic') return;

    // If forcing all dots visible (measurements stage), skip slice-based visibility
    if (this.forceVisible) {
      this.cuspDots.forEach(dot => {
        const actor = dot.actors.get(viewport.id);
        if (actor) {
          actor.setVisibility(true);
          actor.modified();
        }
      });
      viewport.render();
      return;
    }

    // Get the current slice plane information for this specific viewport
    const camera = viewport.getCamera();
    const { viewPlaneNormal, focalPoint } = camera;

    // Calculate viewport-specific slice spacing for adaptive visibility threshold
    let sliceSpacing = 5.0; // Default fallback

    try {
      // Get volume spacing from Cornerstone cache
      const { cache } = require('@cornerstonejs/core');
      const volumes = cache.getVolumes();

      if (volumes && volumes.length > 0) {
        const volume = volumes[0];
        const spacing = volume.spacing; // [x, y, z] spacing in mm

        // Determine which axis this viewport scrolls along based on viewPlaneNormal
        const absNormal = [
          Math.abs(viewPlaneNormal[0]),
          Math.abs(viewPlaneNormal[1]),
          Math.abs(viewPlaneNormal[2])
        ];

        const maxIndex = absNormal.indexOf(Math.max(...absNormal));
        sliceSpacing = spacing[maxIndex];
      }
    } catch (error) {
      console.warn('Could not get volume spacing, using default:', error);
    }

    // STRICT visibility threshold - only show when crosshair is very close
    // Cusp dots should only appear when slice plane intersects or is very near them
    const dotRadius = this.configuration.dotRadius; // Usually 1.5mm
    const visibilityThreshold = Math.max(dotRadius * 2, sliceSpacing * 2);

    // For each cusp dot, check if it should be visible in THIS viewport
    this.cuspDots.forEach(dot => {
      const actor = dot.actors.get(viewport.id);
      if (!actor) return;

      // Calculate distance from dot center to slice plane
      const dotCenter = dot.pos;

      // Calculate the distance from dot to the slice plane
      const planeToPoint = [
        dotCenter[0] - focalPoint[0],
        dotCenter[1] - focalPoint[1],
        dotCenter[2] - focalPoint[2]
      ];

      // Project onto view plane normal to get signed distance to plane
      const signedDistanceToPlane =
        planeToPoint[0] * viewPlaneNormal[0] +
        planeToPoint[1] * viewPlaneNormal[1] +
        planeToPoint[2] * viewPlaneNormal[2];

      // Get absolute distance from dot center to slice plane
      const distanceToPlane = Math.abs(signedDistanceToPlane);

      // Dot is visible if it intersects the slice plane
      const shouldBeVisible = distanceToPlane <= visibilityThreshold;

      // Get the current visibility for this viewport specifically
      const currentVisibility = actor.getVisibility();

      // Only update if visibility should change
      if (currentVisibility !== shouldBeVisible) {
        actor.setVisibility(shouldBeVisible);
        actor.modified();
      }
    });

    // Render only this viewport
    viewport.render();
  }

  // Remove camera change listeners
  _removeCameraChangeListeners() {
    const enabledElements = getEnabledElements();

    enabledElements.forEach(({ viewport }) => {
      if (!viewport) return;

      const listener = this.cameraChangeListeners.get(viewport.id);
      const keyListener = this.cameraChangeListeners.get(viewport.id + '_key');
      const cameraListener = this.cameraChangeListeners.get(viewport.id + '_camera');

      if (listener) {
        viewport.element.removeEventListener('wheel', listener);
        this.cameraChangeListeners.delete(viewport.id);
      }

      if (keyListener) {
        viewport.element.removeEventListener('keydown', keyListener);
        this.cameraChangeListeners.delete(viewport.id + '_key');
      }

      if (cameraListener) {
        viewport.element.removeEventListener(CornerstoneEnums.Events.CAMERA_MODIFIED, cameraListener);
        this.cameraChangeListeners.delete(viewport.id + '_camera');
      }
    });
  }

  // Clear all cusp dots (useful for reset)
  clearAll() {
    const enabledElements = getEnabledElements();

    console.log('🗑️ Clearing all cusp nadir dots');

    // Remove camera change listeners first
    this._removeCameraChangeListeners();

    // Remove all dots
    this.cuspDots.forEach(dot => {
      enabledElements.forEach(({ viewport }) => {
        if (viewport.removeActor) {
          try {
            // Remove actor with unique viewport ID
            viewport.removeActor({ uid: `${dot.id}-${viewport.id}` });
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

  // Force re-render all cusp dots (useful after camera changes)
  forceReRenderDots() {
    console.log('🔄 Force re-rendering cusp dots after camera adjustment');
    const enabledElements = getEnabledElements();

    this.cuspDots.forEach(dot => {
      // CRITICAL: Re-apply the dot center to the source
      if (dot.source) {
        dot.source.setCenter(dot.pos[0], dot.pos[1], dot.pos[2]);
        dot.source.modified();
      }

      // Update all actors
      dot.actors.forEach((actor, viewportId) => {
        actor.modified();
        actor.getMapper().update();
      });
    });

    // Force render all viewports
    enabledElements.forEach(({ viewport }) => {
      if (viewport) {
        viewport.render();
      }
    });

    // Update visibility based on current slice positions after re-render
    setTimeout(() => {
      enabledElements.forEach(({ viewport }, index) => {
        this.updateVisibilityForSingleViewport(viewport, index);
      });
    }, 50);

    console.log('✅ Cusp dots re-rendered');
  }
}

export default CuspNadirTool;