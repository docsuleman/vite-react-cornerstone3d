import { getEnabledElements, utilities, eventTarget, Enums as CornerstoneEnums } from '@cornerstonejs/core';
import { BaseTool, Types } from '@cornerstonejs/tools';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkLineSource from '@kitware/vtk.js/Filters/Sources/LineSource';
import vtkTubeFilter from '@kitware/vtk.js/Filters/General/TubeFilter';
import vtkCardinalSpline from '@kitware/vtk.js/Common/DataModel/CardinalSpline';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import { Vector3 } from '@kitware/vtk.js/types';

class SphereMarkerTool extends BaseTool {
  static toolName = 'Centerline';
  spheres: { 
    id: string; 
    pos: Vector3; 
    actors: Map<string, any>; // Map of viewportId -> actor
    source: any;
    color: string 
  }[] = [];
  connectionLines: {
    id: string;
    actor: any;
    source: any;
    tubeFilter?: any;
  }[] = [];
  activeSphereDrag: { id: string; distanceFromCamera: number } | null = null;
  positionUpdateCallback: ((spheres: { id: string; pos: Vector3; color: string }[]) => void) | null = null;
  lastLineUpdate: number = 0;
  isDraggable: boolean = true; // Can be disabled during certain workflow stages
  cameraChangeListeners: Map<string, () => void> = new Map(); // Track camera change listeners
  globalCameraListener: ((evt: any) => void) | null = null; // Global camera listener
  visibilityUpdatesDisabled: boolean = false; // Flag to temporarily disable visibility updates
  sphereKeeperInterval: number | null = null; // Interval to keep spheres visible

  // Set draggable state (disable during certain workflow stages)
  setDraggable(draggable: boolean) {
    this.isDraggable = draggable;
    
    
    // Clear drag state if disabling dragging
    if (!draggable && this.activeSphereDrag) {
      
      this.activeSphereDrag = null;
    }
  }

  // Explicitly clear drag state (useful for debugging or reset)
  clearDragState() {
    
    this.activeSphereDrag = null;
  }

  // Find sphere at a given world position (for click detection)
  _findSphereAtPosition(worldPos: Vector3) {
    const clickThreshold = this.configuration.sphereRadius * 4; // Even larger threshold for easier clicking
    let closestSphere = null;
    let closestDistance = Infinity;
    
    // Find the closest sphere within threshold
    for (const sphere of this.spheres) {
      const distance = Math.sqrt(
        Math.pow(sphere.pos[0] - worldPos[0], 2) +
        Math.pow(sphere.pos[1] - worldPos[1], 2) +
        Math.pow(sphere.pos[2] - worldPos[2], 2)
      );
      
      if (distance <= clickThreshold && distance < closestDistance) {
        closestDistance = distance;
        closestSphere = sphere;
      }
    }
    
    if (closestSphere) {
      
      return closestSphere;
    }
    
    return null;
  }

  // Center all viewports on a specific 3D point
  _centerAllViewportsOnPoint(worldPos: Vector3) {
    
    const enabledElements = getEnabledElements();
    
    
    // Filter to only the main MPR viewports (not duplicates)
    const mainViewports = enabledElements.filter(({ viewport }) => 
      viewport.id && (
        viewport.id.includes('axial') || 
        viewport.id.includes('sagittal') || 
        viewport.id.includes('coronal')
      )
    );
    
    
    
    // Try a more direct approach using Cornerstone's built-in methods
    mainViewports.forEach(({ viewport }, index) => {
      try {
        if (viewport.type === 'orthographic') {
          const viewportId = viewport.id;
          const camera = viewport.getCamera();
          
          
          
          
          
          // Use Cornerstone's jumpToSlice method if available
          if (viewport.setSliceIndex && viewport.getCurrentImageIdIndex) {
            try {
              // Calculate which slice index corresponds to this world position
              const currentIndex = viewport.getCurrentImageIdIndex();
              
              
              // For now, just center using camera method but with better calculation
              this._centerSingleViewport(viewport, worldPos, viewportId);
            } catch (error) {
              console.warn(`Could not use slice-based centering for ${viewportId}, using camera method`);
              this._centerSingleViewport(viewport, worldPos, viewportId);
            }
          } else {
            this._centerSingleViewport(viewport, worldPos, viewportId);
          }
        }
      } catch (error) {
        console.error(`❌ Failed to center viewport ${index}:`, error);
      }
    });
    
    
    
    // Force a comprehensive update after a small delay
    setTimeout(() => {
      
      mainViewports.forEach(({ viewport }) => {
        try {
          viewport.render();
        } catch (error) {
          console.warn('Could not force render:', error);
        }
      });
      
    }, 100);
    
    // Add a visual confirmation sphere at the exact position for debugging
    this._addDebugMarker(worldPos);
  }
  
  // Center a single viewport with better handling
  _centerSingleViewport(viewport: any, worldPos: Vector3, viewportId: string) {
    const camera = viewport.getCamera();
    
    // Keep the current scale - different scales might be intentional for different views
    // The key is consistent positioning, not necessarily identical scales
    const targetParallelScale = camera.parallelScale; // Keep current scale
    
    // Calculate camera distance based on viewport orientation
    let cameraDistance = 300;
    
    // Adjust camera positioning based on viewport type
    if (viewportId.includes('axial')) {
      // Axial view - camera looks down Z axis
      cameraDistance = 300;
    } else if (viewportId.includes('sagittal')) {
      // Sagittal view - camera looks along X axis  
      cameraDistance = 300;
    } else if (viewportId.includes('coronal')) {
      // Coronal view - camera looks along Y axis
      cameraDistance = 300;
    }
    
    // Preserve the viewing direction but center on new point
    const viewDirection = camera.viewPlaneNormal;
    
    const newCamera = {
      ...camera,
      focalPoint: [worldPos[0], worldPos[1], worldPos[2]],
      position: [
        worldPos[0] + viewDirection[0] * cameraDistance,
        worldPos[1] + viewDirection[1] * cameraDistance,
        worldPos[2] + viewDirection[2] * cameraDistance
      ],
      parallelScale: targetParallelScale
    };
    
    
    
    
    viewport.setCamera(newCamera);
    viewport.render();
    
    // Verify the camera was actually set correctly
    const verifyCamera = viewport.getCamera();
    
    
    
  }
  
  // Add a temporary debug marker to verify positioning
  _addDebugMarker(worldPos: Vector3) {
    // This will help verify if the positioning is correct across all viewports
  }

  // Add position debug marker to verify coordinate accuracy
  _addPositionDebugMarker(worldPos: Vector3, canvasPos: [number, number], viewport: any) {
    
    
    
    if (viewport) {
      try {
        // Test reverse transformation: world back to canvas
        if (viewport.worldToCanvas) {
          const backToCanvas = viewport.worldToCanvas(worldPos);
          
          
          const canvasDiff = [
            Math.abs(backToCanvas[0] - canvasPos[0]),
            Math.abs(backToCanvas[1] - canvasPos[1])
          ];
          
          
          if (canvasDiff[0] > 5 || canvasDiff[1] > 5) {
            console.warn(`⚠️ Large canvas coordinate mismatch detected! This explains sphere positioning issues.`);
          }
        }
        
        // Check if we're at the correct slice position
        const camera = viewport.getCamera();
        if (camera) {
          const sliceDistance = Math.abs(
            (worldPos[0] - camera.focalPoint[0]) * camera.viewPlaneNormal[0] +
            (worldPos[1] - camera.focalPoint[1]) * camera.viewPlaneNormal[1] +
            (worldPos[2] - camera.focalPoint[2]) * camera.viewPlaneNormal[2]
          );
          
          
          if (sliceDistance > 10) {
            console.warn(`⚠️ Sphere is ${sliceDistance.toFixed(1)}mm away from current slice - may appear displaced!`);
          }
        }
        
      } catch (error) {
        console.warn('Could not perform position debug analysis:', error);
      }
    }
  }

  // Update crosshair position across all viewports
  _updateCrosshairPosition(worldPos: Vector3) {
    try {
      // Use Cornerstone's event system to update crosshairs
      const eventData = {
        detail: {
          centerPoint: worldPos,
          worldPos: worldPos
        }
      };
      
      // Try different event approaches
      if (eventTarget && eventTarget.trigger) {
        eventTarget.trigger('CORNERSTONE_TOOLS_CROSSHAIRS_RESET', eventData);
      } else if (eventTarget && eventTarget.triggerEvent) {
        eventTarget.triggerEvent('CORNERSTONE_TOOLS_CROSSHAIRS_RESET', eventData);
      } else {
        
        return;
      }
      
    } catch (error) {
      console.warn('Could not update crosshair position:', error);
    }
  }

  constructor(
    toolProps: Types.PublicToolProps = {},
    defaultToolProps: Types.ToolProps = {
      supportedInteractionTypes: ['Mouse'],
      configuration: {
        sphereRadius: 2, // Very small spheres, 2mm like 3mensio
        positionUpdateCallback: null
      },
    }
  ) {
    super(toolProps, defaultToolProps);
    this.spheres = [];
    this.connectionLines = [];
    this.activeSphereDrag = null;
    
    // Initialize callback from configuration if provided
    this.positionUpdateCallback = this.configuration.positionUpdateCallback || null;
    
    // Event listeners will be set up when first sphere is placed
    
  }

  getToolName() {
    return SphereMarkerTool.toolName;
  }


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

      // Only update visibility for THIS viewport, not all viewports
      if (!this.visibilityUpdatesDisabled) {
        this.updateVisibilityForSingleViewport(viewport, index);
      } else {

      }
    };

    // Add wheel event listener directly to the viewport element
    viewport.element.addEventListener('wheel', updateVisibility, { passive: true });

    // Also try keydown for arrow keys (slice navigation)
    const keyHandler = (evt: KeyboardEvent) => {
      if (evt.key === 'ArrowUp' || evt.key === 'ArrowDown') {

        setTimeout(() => {
          if (!this.visibilityUpdatesDisabled) {
            this.updateVisibilityForSingleViewport(viewport, index);
          } else {

          }
        }, 50);
      }
    };
    viewport.element.addEventListener('keydown', keyHandler);

    // CRITICAL: Listen for camera changes from CrosshairsTool sync
    const cameraChangeHandler = (evt: any) => {
      // Small delay to let camera settle
      setTimeout(() => {
        if (!this.visibilityUpdatesDisabled) {
          this.updateVisibilityForSingleViewport(viewport, index);
        }
      }, 10);
    };
    viewport.element.addEventListener(CornerstoneEnums.Events.CAMERA_MODIFIED, cameraChangeHandler);

    // Store all listeners
    this.cameraChangeListeners.set(viewport.id, updateVisibility);
    this.cameraChangeListeners.set(viewport.id + '_key', keyHandler);
    this.cameraChangeListeners.set(viewport.id + '_camera', cameraChangeHandler);


  }

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

  // Set callback to be called whenever sphere positions change
  setPositionUpdateCallback(callback: (spheres: { id: string; pos: Vector3; color: string }[]) => void) {
    this.positionUpdateCallback = callback;
    this.configuration.positionUpdateCallback = callback;
  }
  
  // Method to call when entering a section that should show spheres
  onSectionEnter() {
    
    // First make all spheres visible, then apply proper visibility based on slice position
    setTimeout(() => {
      this.refreshVisibilityForAllViewports();
    }, 100);
  }

  // Call the callback with current sphere positions
  _notifyPositionUpdate() {
    if (this.positionUpdateCallback) {
      const positions = this.spheres.map(s => ({ 
        id: s.id, 
        pos: s.pos, 
        color: s.color 
      }));
      this.positionUpdateCallback(positions);
    }
  }

  preMouseDownCallback = (evt: any) => {
    
    
    
    
    if (!this.isDraggable) {
      
      return false; // Tool is locked - don't allow sphere dragging
    }

    const { element, currentPoints } = evt.detail;
    const enabledElements = getEnabledElements();
    const enabledElement = enabledElements.find(
      el => el.viewport.element === element
    );

    if (!enabledElement || !enabledElement.viewport.getCamera) {
      
      return false;
    }

    // Check if click is on a sphere
    const worldPos = currentPoints.world;
    
    
    // If there are no spheres, don't bother checking
    if (this.spheres.length === 0) {
      
      return false;
    }
    
    const camera = enabledElement.viewport.getCamera();
    const cameraPos = camera.position;
    
    // Find the closest sphere to the click point
    let closestSphere = null;
    let minDistance = Number.MAX_VALUE;
    
    this.spheres.forEach(sphere => {
      const distance = Math.sqrt(
        Math.pow(sphere.pos[0] - worldPos[0], 2) +
        Math.pow(sphere.pos[1] - worldPos[1], 2) +
        Math.pow(sphere.pos[2] - worldPos[2], 2)
      );
      
      
      
      // Check if click is within sphere radius (with some tolerance)
      if (distance < this.configuration.sphereRadius * 2.0 && distance < minDistance) {
        minDistance = distance;
        closestSphere = sphere;
        
      }
    });
    
    if (closestSphere) {
      
      
      // Only set drag state if we're not already in drag mode
      if (!this.activeSphereDrag) {
        // Calculate distance from camera to sphere (used to maintain during drag)
        const distanceFromCamera = Math.sqrt(
          Math.pow(closestSphere.pos[0] - cameraPos[0], 2) +
          Math.pow(closestSphere.pos[1] - cameraPos[1], 2) +
          Math.pow(closestSphere.pos[2] - cameraPos[2], 2)
        );
        
        // Set active drag sphere
        this.activeSphereDrag = {
          id: closestSphere.id,
          distanceFromCamera
        };
        
        
        // Return true to indicate that this tool has captured the mouse
        return true;
      } else {
        
        return false;
      }
    }
    
    
    return false;
  };

  mouseClickCallback = (evt: any) => {





    // If tool is not draggable, clear any stuck drag state
    if (!this.isDraggable && this.activeSphereDrag) {

      this.activeSphereDrag = null;
    }

    // If we're in drag mode, don't add a new sphere
    if (this.activeSphereDrag) {


      return;
    }

    const { element, currentPoints } = evt.detail;
    const { canvas: canvasPos, world: eventWorldPos } = currentPoints;

    // Also get raw event coordinates as fallback
    const nativeEvent = evt.detail.event;
    let rawCanvasPos: [number, number] | null = null;
    if (nativeEvent && element) {
      const rect = element.getBoundingClientRect();
      rawCanvasPos = [
        nativeEvent.clientX - rect.left,
        nativeEvent.clientY - rect.top
      ];

      // Debug: Check if element has offset from canvas
      console.log(`Element rect: left=${rect.left.toFixed(2)}, top=${rect.top.toFixed(2)}, width=${rect.width.toFixed(2)}, height=${rect.height.toFixed(2)}`);
      console.log(`Mouse event: clientX=${nativeEvent.clientX}, clientY=${nativeEvent.clientY}`);

      // Check if element is actually a canvas or has a canvas child
      if (element.tagName === 'CANVAS') {
        console.log(`✓ Element IS a canvas`);
      } else {
        console.log(`⚠️ Element is ${element.tagName}, checking for canvas child...`);
        const canvasChild = element.querySelector('canvas');
        if (canvasChild) {
          const canvasRect = canvasChild.getBoundingClientRect();
          console.log(`  Canvas child rect: left=${canvasRect.left.toFixed(2)}, top=${canvasRect.top.toFixed(2)}`);
          console.log(`  Offset from parent: dx=${(canvasRect.left - rect.left).toFixed(2)}, dy=${(canvasRect.top - rect.top).toFixed(2)}`);
        }
      }
    }

    // Get the viewport to check zoom/transformation
    const enabledElements = getEnabledElements();
    const enabledElement = enabledElements.find(el => el.viewport.element === element);

    if (!enabledElement || !enabledElement.viewport) {
      console.warn('No viewport found for click event');
      return;
    }

    const viewport = enabledElement.viewport;

    // Compare both coordinate calculation methods
    let worldPos: Vector3;

    if (viewport.canvasToWorld) {
      // Get canvas and element info for debugging
      const canvas = viewport.getCanvas();
      const element = viewport.element;
      const dpr = window.devicePixelRatio || 1;

      // Don't scale - Cornerstone3D handles DPR internally
      const canvasToWorldPos = viewport.canvasToWorld([canvasPos[0], canvasPos[1]]) as Vector3;

      // Get camera info to check slice position
      const camera = viewport.getCamera();
      const focalPoint = camera.focalPoint;
      const viewPlaneNormal = camera.viewPlaneNormal;
      console.log(`🎯 Click in ${viewport.id}:`);
      console.log(`   DPR: ${dpr}, Element: ${element.clientWidth}x${element.clientHeight}, Canvas: ${canvas.width}x${canvas.height}`);
      console.log(`   Event canvas: [${canvasPos[0].toFixed(2)}, ${canvasPos[1].toFixed(2)}]`);
      if (rawCanvasPos) {
        console.log(`   Raw canvas: [${rawCanvasPos[0].toFixed(2)}, ${rawCanvasPos[1].toFixed(2)}]`);
        const diff = Math.sqrt(Math.pow(rawCanvasPos[0] - canvasPos[0], 2) + Math.pow(rawCanvasPos[1] - canvasPos[1], 2));
        console.log(`   Difference: ${diff.toFixed(2)} pixels`);
      }
      console.log(`   World coords: [${canvasToWorldPos[0].toFixed(2)}, ${canvasToWorldPos[1].toFixed(2)}, ${canvasToWorldPos[2].toFixed(2)}]`);

      // Check distance from click to focal plane
      const distanceToFocalPlane =
        (canvasToWorldPos[0] - focalPoint[0]) * viewPlaneNormal[0] +
        (canvasToWorldPos[1] - focalPoint[1]) * viewPlaneNormal[1] +
        (canvasToWorldPos[2] - focalPoint[2]) * viewPlaneNormal[2];
      console.log(`   Distance to focal plane: ${distanceToFocalPlane.toFixed(2)}mm`);

      // Calculate difference
      const diff = [
        Math.abs(eventWorldPos[0] - canvasToWorldPos[0]),
        Math.abs(eventWorldPos[1] - canvasToWorldPos[1]),
        Math.abs(eventWorldPos[2] - canvasToWorldPos[2])
      ];
      const maxDiff = Math.max(...diff);
      console.log(`   Coordinate difference: ${maxDiff.toFixed(2)}mm`);

      // Use canvasToWorld as it should be more accurate for orthographic viewports
      worldPos = canvasToWorldPos;
    } else {
      console.error('Viewport does not have canvasToWorld method');
      return;
    }

    // Check if clicking on an existing sphere to center viewports
    const clickedSphere = this._findSphereAtPosition(worldPos);
    if (clickedSphere) {


      // Use the CLICK position instead of stored sphere position for better accuracy
      this._centerAllViewportsOnPoint(worldPos);
      return; // Don't create a new sphere
    }





    // Allow more than 3 spheres for extended centerline definition
    if (this.spheres.length >= 10) {
      console.warn('Maximum of 10 spheres allowed for centerline definition.');
      return;
    }

    const sphereId = `sphere-${Date.now()}`;
    // Color sequence for extended centerline: cycle through colors
    // All spheres are yellow (centerline points), except one will be the valve
    const color = 'yellow';

    // Use worldPos directly - canvasToWorld already gives us the correct position
    const finalPos: Vector3 = [worldPos[0], worldPos[1], worldPos[2]];

    console.log('Final sphere position:', finalPos);

    const sphereData = {
      id: sphereId,
      pos: finalPos, 
      actors: new Map(), 
      source: null,
      color 
    };
    
    this.spheres.push(sphereData);
    this._placeSphere(sphereData, canvasPos, viewport);

    // Always create lines if we have 2+ spheres
    if (this.spheres.length >= 2) {
      this._createConnectionLines();
    }
    
    if (this.spheres.length === 3) {
      this._updateSphereColors();
    }

    // Don't auto-center camera - let user control the view
    // Only center when explicitly clicking on existing sphere

    this._notifyPositionUpdate();
  };

  mouseDragCallback = (evt: any) => {
    if (!this.isDraggable || !this.activeSphereDrag) {
      return; // Tool is locked or no active drag
    }

    const { element, currentPoints } = evt.detail;
    const { canvas: canvasPos } = currentPoints;

    // Get viewport to use canvasToWorld
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

    // Find the sphere being dragged
    const sphereIndex = this.spheres.findIndex(s => s.id === this.activeSphereDrag.id);
    if (sphereIndex === -1) {
      return;
    }

    // Update sphere position
    const newPos: Vector3 = [worldPos[0], worldPos[1], worldPos[2]];

    // Update the sphere position in our array
    this.spheres[sphereIndex].pos = newPos;

    // Update the sphere source center (not actor position)
    if (this.spheres[sphereIndex].source) {
      this.spheres[sphereIndex].source.setCenter(newPos[0], newPos[1], newPos[2]);
      this.spheres[sphereIndex].source.modified();
    }
    
    // Update colors if we have all 3 spheres
    if (this.spheres.length === 3) {
      this._updateSphereColors();
    }
    
    // Rate limit line updates to prevent too many during drag
    const now = Date.now();
    if (now - this.lastLineUpdate > 100) { // Only update every 100ms
      this.lastLineUpdate = now;
      this._updateConnectionLines();
    }
    
    // Render all viewports
    const enabledElements2 = getEnabledElements();
    enabledElements2.forEach(({ viewport }) => viewport.render());
    
    // Notify position update
    this._notifyPositionUpdate();
  };

  mouseUpCallback = (evt: any) => {
    
    
    
    if (this.activeSphereDrag) {
      
      this.activeSphereDrag = null;
      
    } else {
      
    }
  };

  _placeSphere(sphereData: { id: string; pos: Vector3; actors: Map<string, any>; source: any; color: string }, canvasPos?: [number, number], clickedViewport?: any) {
    const enabledElements = getEnabledElements();
    if (enabledElements.length === 0) {
      console.error('No enabled viewports found.');
      return;
    }

    const sphereName = sphereData.color === 'yellow' ? 'Aorta' : sphereData.color === 'red' ? 'Valve' : 'LV';


    const sphereSource = vtkSphereSource.newInstance();

    // Set sphere center directly to world coordinates (same as polydata points for lines)
    sphereSource.setCenter(sphereData.pos[0], sphereData.pos[1], sphereData.pos[2]);

    // Determine if this is the valve sphere (middle sphere when 3+ spheres exist)
    const middleIndex = Math.floor(this.spheres.length / 2);
    const isValveSphere = (this.spheres.indexOf(sphereData) === middleIndex) && this.spheres.length >= 3;

    // Valve sphere is larger, centerline points are smaller
    const radius = isValveSphere ? 3.5 : this.configuration.sphereRadius; // Valve: 3.5mm, Others: 2mm
    sphereSource.setRadius(radius);
    // High resolution for smooth, professional look
    sphereSource.setPhiResolution(32);
    sphereSource.setThetaResolution(32);



    // Store the source for later updates
    sphereData.source = sphereSource;
    sphereData.actors = new Map();

    // Add sphere to all viewports - they share the same world coordinate system
    enabledElements.forEach(({ viewport }, index) => {
      if (!viewport.addActor) {
        console.warn('Viewport does not support adding actors.');
        return;
      }

      // Create a separate actor for each viewport
      const mapper = vtkMapper.newInstance();
      mapper.setInputConnection(sphereSource.getOutputPort());

      const actor = vtkActor.newInstance();
      actor.setMapper(mapper);

      // Don't set actor position - the sphere source center already defines the position
      // This matches how the polydata points work for the connection lines
      console.log(`Sphere source center set to:`, sphereData.pos);

      // DEBUG: Check if the sphere appears where expected
      if (clickedViewport && viewport.id === clickedViewport.id && canvasPos) {
        setTimeout(() => {
          const sphereCenter = sphereSource.getCenter();
          const renderedCanvasPos = viewport.worldToCanvas(sphereCenter);
          const diffX = renderedCanvasPos[0] - canvasPos[0];
          const diffY = renderedCanvasPos[1] - canvasPos[1];
          const diffPixels = Math.sqrt(diffX * diffX + diffY * diffY);

          console.log(`📍 ${viewport.id} viewport:`);
          console.log(`   Click canvas: [${canvasPos[0].toFixed(2)}, ${canvasPos[1].toFixed(2)}]`);
          console.log(`   Sphere canvas: [${renderedCanvasPos[0].toFixed(2)}, ${renderedCanvasPos[1].toFixed(2)}]`);
          console.log(`   Difference: ${diffPixels.toFixed(2)} pixels (${diffX.toFixed(2)}px X, ${diffY.toFixed(2)}px Y)`);

          if (diffPixels > 2) {
            console.warn(`⚠️ Sphere is ${diffPixels.toFixed(1)} pixels away from click!`);
          } else {
            console.log(`✓ Sphere positioned correctly`);
          }
        }, 100);
      }


      const property = actor.getProperty();
      
      // Make spheres very bright and obvious
      if (sphereData.color === 'red') {
        property.setColor(1.0, 0.0, 0.0);
      } else if (sphereData.color === 'yellow') {
        property.setColor(1.0, 1.0, 0.0);
      } else if (sphereData.color === 'green') {
        property.setColor(0.0, 1.0, 0.0);
      } else {
        // Default bright magenta for visibility
        property.setColor(1.0, 0.0, 1.0);
      }
      
      // High-quality sphere appearance with smooth shading
      property.setOpacity(1.0);
      property.setAmbient(0.2);
      property.setDiffuse(0.8);
      property.setSpecular(0.4);
      property.setSpecularPower(50);
      property.setInterpolationToGouraud(); // Smooth shading
      
      // Enhanced rendering quality
      const sphereMapper = actor.getMapper();
      sphereMapper.setResolveCoincidentTopology(true);
      sphereMapper.setResolveCoincidentTopologyToPolygonOffset();
      sphereMapper.setResolveCoincidentTopologyPolygonOffsetParameters(10, 10);
      
      // Enable high-quality rendering
      sphereMapper.setStatic(true); // Optimize for static geometry
      sphereMapper.setScalarVisibility(false); // Use material colors only

      // Store actor for this viewport
      sphereData.actors.set(viewport.id, actor);
      
      // Add actor to this viewport with unique ID
      viewport.addActor({ uid: `${sphereData.id}-${viewport.id}`, actor });
      
      // VTK actors are rendered in world coordinates by Cornerstone3D

      // DEBUG: Check volume properties
      if (viewport.id === clickedViewport?.id && canvasPos) {
        try {
          // Import is already at top of file, use cache directly
          const { cache } = require('@cornerstonejs/core');
          const volumes = cache.getVolumes();
          if (volumes && volumes.length > 0) {
            const vol = volumes[0];
            console.log(`📦 Volume info:`);
            console.log(`  Origin: [${vol.origin[0].toFixed(2)}, ${vol.origin[1].toFixed(2)}, ${vol.origin[2].toFixed(2)}]`);
            console.log(`  Spacing: [${vol.spacing[0].toFixed(2)}, ${vol.spacing[1].toFixed(2)}, ${vol.spacing[2].toFixed(2)}]`);
            console.log(`  Dimensions: [${vol.dimensions[0]}, ${vol.dimensions[1]}, ${vol.dimensions[2]}]`);
            if (vol.direction) {
              console.log(`  Direction matrix: [${vol.direction.map((v: number) => v.toFixed(2)).join(', ')}]`);
            }
          }
        } catch (e) {
          console.warn('Could not get volume info:', e);
        }
      }

      viewport.render();
      
      // Set up event listeners for this viewport
      this._setupViewportEventListeners(viewport, index);
      
      // Do an initial visibility check for this viewport (unless disabled)
      setTimeout(() => {
        if (!this.visibilityUpdatesDisabled) {
          this.updateVisibilityForSingleViewport(viewport, index);
        } else {
          
        }
      }, 100);
    });
    
    // Notify position update
    this._notifyPositionUpdate();
  }

  _updateSphereColors() {
    // For centerline: all yellow except middle sphere (valve) is red/orange
    // If we have 3+ spheres, the middle one is the valve
    this.spheres.forEach((sphere, index) => {
      const middleIndex = Math.floor(this.spheres.length / 2);
      if (index === middleIndex && this.spheres.length >= 3) {
        sphere.color = 'red'; // Valve position
      } else {
        sphere.color = 'yellow'; // Centerline points
      }
    });
    
    
    this._updateRenderedSpheres();
  }

  _updateRenderedSpheres() {
    const enabledElements = getEnabledElements();

    this.spheres.forEach(sphere => {
      // Update color for all actors of this sphere
      sphere.actors.forEach(actor => {
        const property = actor.getProperty();
        if (sphere.color === 'red') property.setColor(1.0, 0.0, 0.0);
        if (sphere.color === 'yellow') property.setColor(1.0, 1.0, 0.0);
        if (sphere.color === 'green') property.setColor(0.0, 1.0, 0.0);
      });
    });

    enabledElements.forEach(({ viewport }) => viewport.render());
  }

  _createConnectionLines() {
    
    
    // Clear existing lines
    this._clearConnectionLines();
    
    if (this.spheres.length < 2) {
      
      return;
    }
    
    const enabledElements = getEnabledElements();
    if (enabledElements.length === 0) {
      console.error('No enabled viewports found for lines.');
      return;
    }

    

    // Create smooth splined curves instead of straight lines
    if (this.spheres.length >= 2) {
      try {
        
        this._createSmoothSplineCurve();
        
        // Green test line removed - only showing smooth spline curves now
      } catch (error) {
        console.error('🌊 Spline creation failed, falling back to straight lines:', error);
        this._createStraightLines();
      }
    }
    
    
    
    // Force render all viewports
    enabledElements.forEach(({ viewport }, index) => {
      try {
        viewport.render();
        
      } catch (error) {
        console.error(`❌ Failed to render viewport ${index}:`, error);
      }
    });
  }

  _updateConnectionLines() {


    if (this.spheres.length < 2) {
      return;
    }

    // For smooth spline, we need to regenerate from scratch when spheres move
    // Recreate the entire spline with new sphere positions
    this._createConnectionLines();
  }

  _createSingleConnectionLine(index: number, startSphere: any, endSphere: any) {
    const lineId = `line-${index}-${index+1}`;
    this._createSingleConnectionLineWithId(index, startSphere, endSphere, lineId);
  }

  _createSmoothSplineCurve() {
    
    
    const enabledElements = getEnabledElements();
    if (enabledElements.length === 0) {
      console.error('🌊 No enabled elements for spline creation');
      return;
    }
    
    // Generate smooth spline points using cardinal spline interpolation
    const splinePoints = this._generateSplinePoints();
    
    
    if (splinePoints.length === 0) {
      console.error('🌊 No spline points generated - cannot create curve');
      return;
    }
    
    // Log first few points to debug
    
    // Create polydata from spline points
    const points = vtkPoints.newInstance();
    
    
    // Set the number of points first
    points.setNumberOfPoints(splinePoints.length);
    
    splinePoints.forEach((point, index) => {
      // Ensure point is a valid 3D coordinate
      if (!point || point.length !== 3) {
        console.error(`🌊 Invalid point at index ${index}:`, point);
        return;
      }
      
      points.setPoint(index, point[0], point[1], point[2]);
      if (index < 5 || index >= splinePoints.length - 5) {
      }
    });
    
    const polyData = vtkPolyData.newInstance();
    polyData.setPoints(points);
    
    
    
    // Create line segments connecting consecutive spline points
    const lines = vtkCellArray.newInstance();
    for (let i = 0; i < splinePoints.length - 1; i++) {
      lines.insertNextCell([i, i + 1]);
    }
    polyData.setLines(lines);
    
    // Validate polydata
    
    
    // Test with simple direct line first (if spline fails)
    if (splinePoints.length < 2) {
      console.error('🌊 Not enough spline points for curve');
      return;
    }
    
    // Create smooth, thin tube like 3mensio
    const tubeFilter = vtkTubeFilter.newInstance();
    tubeFilter.setInputData(polyData);
    tubeFilter.setRadius(0.5); // Thin line like 3mensio (0.5mm)
    tubeFilter.setNumberOfSides(16); // Good quality without being too heavy
    tubeFilter.setCapping(true);
    tubeFilter.setGenerateTCoords(false);
    tubeFilter.setVaryRadius(false); // Consistent radius for clean look

    // Force update
    tubeFilter.update();

    const mapper = vtkMapper.newInstance();
    mapper.setInputConnection(tubeFilter.getOutputPort());
    mapper.setStatic(false); // Allow dynamic updates
    mapper.setScalarVisibility(false);

    // High-quality rendering settings
    mapper.setResolveCoincidentTopology(true);
    mapper.setResolveCoincidentTopologyToPolygonOffset();
    mapper.setResolveCoincidentTopologyPolygonOffsetParameters(10, 10);

    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);

    // Simple yellow line like 3mensio
    const property = actor.getProperty();
    property.setColor(1.0, 1.0, 0.0); // Yellow centerline
    property.setOpacity(1.0); // Fully opaque
    property.setAmbient(0.3);
    property.setDiffuse(0.7);
    property.setSpecular(0.2); // Minimal specularity for matte look
    property.setSpecularPower(20);
    property.setInterpolationToPhong();
    property.setRepresentation(2); // Surface representation

    // Simple material - no metallic look
    property.setMetallic(0.0);
    property.setRoughness(0.5); // Slightly rough for matte finish
    
    const splineId = 'smooth-spline-curve';
    this.connectionLines.push({
      id: splineId,
      actor,
      source: polyData, // Store polydata for updates
      tubeFilter: tubeFilter
    });
    
    
    
    
    // Add spline to all viewports with anti-aliasing
    enabledElements.forEach(({ viewport }, viewportIndex) => {
      if (!viewport.addActor) {
        console.warn(`🌊 Viewport ${viewportIndex} does not support adding actors.`);
        return;
      }
      
      try {
        viewport.addActor({ uid: splineId, actor });
        
        // Skip VTK-specific rendering configuration for Cornerstone3D viewports
        
        
        viewport.render(); // Force render after adding
        
      } catch (error) {
        console.error(`❌ Failed to add spline to viewport ${viewportIndex}:`, error);
      }
    });
    
    // Let the slice-based visibility system handle spline visibility properly
    
    
    // Trigger proper visibility update for all viewports after spline creation
    setTimeout(() => {
      enabledElements.forEach(({ viewport }, viewportIndex) => {
        this.updateVisibilityForSingleViewport(viewport, viewportIndex);
      });
      
    }, 100);
  }
  
  _generateSplinePoints(): Vector3[] {
    
    
    if (this.spheres.length < 2) {
      
      return [];
    }
    
    const splinePoints: Vector3[] = [];
    const resolution = 25; // Moderate resolution - smoothness comes from anti-aliasing
    
    
    
    try {
      // For each segment between spheres
      for (let i = 0; i < this.spheres.length - 1; i++) {
        const p0 = this.spheres[Math.max(0, i - 1)].pos;
        const p1 = this.spheres[i].pos;
        const p2 = this.spheres[i + 1].pos;
        const p3 = this.spheres[Math.min(this.spheres.length - 1, i + 2)].pos;
        
        
        
        // Generate smooth curve points using Catmull-Rom spline
        for (let t = 0; t < resolution; t++) {
          const u = t / resolution;
          try {
            const point = this._catmullRomInterpolation(p0, p1, p2, p3, u);
            splinePoints.push(point);
            
            if (t === 0 || t === resolution - 1) {
            }
          } catch (error) {
            console.error(`🌊 Error in interpolation for segment ${i}, t=${t}:`, error);
          }
        }
      }
      
      // Add the final point
      const finalPoint = this.spheres[this.spheres.length - 1].pos;
      splinePoints.push(finalPoint);
      
      
      
      return splinePoints;
      
    } catch (error) {
      console.error('🌊 ❌ Error in spline point generation:', error);
      return [];
    }
  }
  
  _catmullRomInterpolation(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number): Vector3 {
    const t2 = t * t;
    const t3 = t2 * t;
    
    // Catmull-Rom spline coefficients
    const c0 = -0.5 * t3 + t2 - 0.5 * t;
    const c1 = 1.5 * t3 - 2.5 * t2 + 1;
    const c2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
    const c3 = 0.5 * t3 - 0.5 * t2;
    
    return [
      c0 * p0[0] + c1 * p1[0] + c2 * p2[0] + c3 * p3[0],
      c0 * p0[1] + c1 * p1[1] + c2 * p2[1] + c3 * p3[1],
      c0 * p0[2] + c1 * p1[2] + c2 * p2[2] + c3 * p3[2]
    ];
  }
  
  _createSimpleTestLine() {
    
    
    if (this.spheres.length < 2) return;
    
    const enabledElements = getEnabledElements();
    const startPos = this.spheres[0].pos;
    const endPos = this.spheres[this.spheres.length - 1].pos;
    
    
    
    // Create a very simple, thick, visible line
    const lineSource = vtkLineSource.newInstance();
    lineSource.setPoint1(startPos);
    lineSource.setPoint2(endPos);
    
    const tubeFilter = vtkTubeFilter.newInstance();
    tubeFilter.setInputConnection(lineSource.getOutputPort());
    tubeFilter.setRadius(3.0); // Very thick for visibility
    tubeFilter.setNumberOfSides(8);
    
    const mapper = vtkMapper.newInstance();
    mapper.setInputConnection(tubeFilter.getOutputPort());
    
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);
    
    // Bright green for easy identification
    const property = actor.getProperty();
    property.setColor(0.0, 1.0, 0.0); // Bright green
    property.setOpacity(1.0);
    
    const testLineId = 'simple-test-line';
    this.connectionLines.push({
      id: testLineId,
      actor,
      source: lineSource,
      tubeFilter
    });
    
    // Add to all viewports
    enabledElements.forEach(({ viewport }, viewportIndex) => {
      if (viewport.addActor) {
        viewport.addActor({ uid: testLineId, actor });
        actor.setVisibility(true);
        
      }
    });
  }

  _createStraightLines() {
    
    
    const enabledElements = getEnabledElements();
    if (enabledElements.length === 0) {
      console.error('📏 No enabled elements for line creation');
      return;
    }
    
    // Create individual straight lines between consecutive spheres
    for (let i = 0; i < this.spheres.length - 1; i++) {
      const startSphere = this.spheres[i];
      const endSphere = this.spheres[i + 1];
      
      
      
      // Create improved straight line with high quality
      const lineSource = vtkLineSource.newInstance();
      lineSource.setPoint1(startSphere.pos);
      lineSource.setPoint2(endSphere.pos);
      lineSource.setResolution(1);
      
      // Use tube filter to create high-quality tubes
      const tubeFilter = vtkTubeFilter.newInstance();
      tubeFilter.setInputConnection(lineSource.getOutputPort());
      tubeFilter.setRadius(0.8);
      tubeFilter.setNumberOfSides(16); // High resolution
      tubeFilter.setCapping(true);
      
      const mapper = vtkMapper.newInstance();
      mapper.setInputConnection(tubeFilter.getOutputPort());
      mapper.setStatic(true);
      mapper.setScalarVisibility(false);
      
      const actor = vtkActor.newInstance();
      actor.setMapper(mapper);
      
      // High-quality material
      const property = actor.getProperty();
      property.setColor(0.9, 0.1, 0.9);
      property.setOpacity(0.95);
      property.setAmbient(0.1);
      property.setDiffuse(0.8);
      property.setSpecular(0.5);
      property.setSpecularPower(60);
      property.setInterpolationToGouraud();
      property.setRepresentation(2);
      
      const lineId = `straight-line-${i}-${i+1}`;
      this.connectionLines.push({
        id: lineId,
        actor,
        source: lineSource,
        tubeFilter: tubeFilter
      });
      
      // Add line to all viewports
      enabledElements.forEach(({ viewport }, viewportIndex) => {
        if (!viewport.addActor) {
          console.warn(`📏 Viewport ${viewportIndex} does not support adding actors.`);
          return;
        }
        
        try {
          viewport.addActor({ uid: lineId, actor });
          
        } catch (error) {
          console.error(`❌ Failed to add straight line ${lineId} to viewport ${viewportIndex}:`, error);
        }
      });
    }
  }

  _createSingleConnectionLineWithId(index: number, startSphere: any, endSphere: any, lineId: string) {
    
    
    
    const enabledElements = getEnabledElements();
    if (enabledElements.length === 0) {
      console.error('🏗️ No enabled elements for line creation');
      return;
    }
    
    // Create thick tube lines for better visibility
    const lineSource = vtkLineSource.newInstance();
    lineSource.setPoint1(startSphere.pos);
    lineSource.setPoint2(endSphere.pos);
    lineSource.setResolution(1);
    
    // Use tube filter to create thick visible lines
    const tubeFilter = vtkTubeFilter.newInstance();
    tubeFilter.setInputConnection(lineSource.getOutputPort());
    tubeFilter.setRadius(1.0); // Thick tube radius
    tubeFilter.setNumberOfSides(8);
    tubeFilter.setCapping(true);
    
    const mapper = vtkMapper.newInstance();
    mapper.setInputConnection(tubeFilter.getOutputPort());
    
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);
    
    const property = actor.getProperty();
    property.setColor(1.0, 0.0, 1.0); // Magenta tubes for better visibility
    property.setOpacity(1.0);
    property.setRepresentation(2); // Surface representation
    
    this.connectionLines.push({
      id: lineId,
      actor,
      source: lineSource,
      tubeFilter: tubeFilter
    });
    
    
    
    
    // Add line to all viewports
    enabledElements.forEach(({ viewport }, viewportIndex) => {
      if (viewport.addActor) {
        try {
          viewport.addActor({ uid: lineId, actor });
          
        } catch (error) {
          console.error(`🏗️ Failed to add line ${lineId} to viewport ${viewportIndex}:`, error);
        }
      } else {
        console.warn(`🏗️ Viewport ${viewportIndex} doesn't support addActor`);
      }
    });
  }

  _clearConnectionLines() {
    const enabledElements = getEnabledElements();
    
    
    
    this.connectionLines.forEach(line => {
      enabledElements.forEach(({ viewport }, viewportIndex) => {
        if (viewport._removeActor) {
          try {
            viewport._removeActor(line.id);
            
          } catch (error) {
            console.warn(`⚠️ Failed to remove line ${line.id} from viewport ${viewportIndex}:`, error);
          }
        }
      });
    });
    
    // Also try to remove any lines with old naming patterns to clean up
    const possibleOldIds = ['line-0-1', 'line-1-2', 'line-2-3'];
    possibleOldIds.forEach(oldId => {
      enabledElements.forEach(({ viewport }, viewportIndex) => {
        if (viewport._removeActor) {
          try {
            viewport._removeActor(oldId);
            
          } catch (error) {
            // Ignore - line might not exist
          }
        }
      });
    });
    
    // Force render to ensure removals are complete
    enabledElements.forEach(({ viewport }, index) => {
      viewport.render();
      
    });
    
    this.connectionLines = [];
    
  }

  // Clear all spheres and lines (useful for reset)
  clearAll() {
    const enabledElements = getEnabledElements();
    
    // Remove all spheres
    this.spheres.forEach(sphere => {
      enabledElements.forEach(({ viewport }) => {
        if (viewport._removeActor) {
          try {
            viewport._removeActor(sphere.id);
          } catch (error) {
            // Actor might not exist in this viewport
          }
        }
      });
    });
    
    // Clear connection lines
    this._clearConnectionLines();
    
    // Reset arrays
    this.spheres = [];
    this.connectionLines = [];
    
    // Render all viewports
    enabledElements.forEach(({ viewport }) => viewport.render());
    
    // Notify position update
    this._notifyPositionUpdate();
  }

  // Update sphere visibility based on current slice positions
  updateVisibilityForViewports() {
    // Instead of updating all viewports, let's update each one independently
    // The problem was that the last viewport processed would override visibility for all
    
    // We'll implement per-viewport visibility in the scroll handler instead
  }
  
  updateVisibilityForSingleViewport(viewport: any, viewportIndex: number) {
    if (!viewport || viewport.type !== 'orthographic') return;

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
        // The axis with the largest component in viewPlaneNormal is the scroll axis
        const absNormal = [
          Math.abs(viewPlaneNormal[0]),
          Math.abs(viewPlaneNormal[1]),
          Math.abs(viewPlaneNormal[2])
        ];

        const maxIndex = absNormal.indexOf(Math.max(...absNormal));
        sliceSpacing = spacing[maxIndex];

        console.log(`🔍 ${viewport.id}: viewPlaneNormal=[${viewPlaneNormal.map(v => v.toFixed(2)).join(',')}], scroll axis=${['X','Y','Z'][maxIndex]}, spacing=${sliceSpacing.toFixed(2)}mm`);
      }
    } catch (error) {
      console.warn('Could not get volume spacing, using default:', error);
    }

    // Adaptive visibility threshold based on slice spacing
    // Use 5x slice spacing to ensure spheres visible when crosshair intersects them
    // This ensures visibility in all directions across all views
    const sphereRadius = this.configuration.sphereRadius; // Usually 2mm
    const commonVisibilityThreshold = Math.max(sphereRadius * 3, sliceSpacing * 5);

    const visibilityThreshold = commonVisibilityThreshold;
    
    // Track which spheres are visible for line visibility calculation
    const visibleSpheres = new Set<string>();
    
    // For each sphere, check if it should be visible in THIS viewport
    this.spheres.forEach(sphere => {
      const actor = sphere.actors.get(viewport.id);
      if (!actor) return;
      
      // Calculate distance from sphere center to slice plane
      const sphereCenter = sphere.pos;
      
      // Calculate the distance from sphere to the slice plane
      const planeToSphere = [
        sphereCenter[0] - focalPoint[0],
        sphereCenter[1] - focalPoint[1],
        sphereCenter[2] - focalPoint[2]
      ];
      
      // Project onto view plane normal to get signed distance to plane
      const signedDistanceToPlane = 
        planeToSphere[0] * viewPlaneNormal[0] +
        planeToSphere[1] * viewPlaneNormal[1] +
        planeToSphere[2] * viewPlaneNormal[2];
      
      // Get absolute distance from sphere center to slice plane
      const distanceToPlane = Math.abs(signedDistanceToPlane);
      
      // Sphere is visible if it intersects the slice plane
      const shouldBeVisible = distanceToPlane <= visibilityThreshold;
      
      // Track visible spheres for line visibility
      if (shouldBeVisible) {
        visibleSpheres.add(sphere.id);
      }
      
      // Get the current visibility for this viewport specifically
      const currentVisibility = actor.getVisibility();
      
      // Only update if visibility should change
      if (currentVisibility !== shouldBeVisible) {
        
        
        // Update visibility for this sphere in this viewport only
        actor.setVisibility(shouldBeVisible);
        actor.modified();
      }
    });
    
    // Update connection line visibility with VERY tight threshold
    // Line should only show when the slice plane actually intersects or is very close to the spline
    // Use a much smaller threshold than spheres - only show when line passes through current slice
    const lineVisibilityThreshold = sliceSpacing * 1.5; // Much tighter than sphere threshold

    this.connectionLines.forEach((line, lineIndex) => {
      // For splines, check distance to ALL spheres in the path (not just consecutive ones)
      let minDistanceToSpline = Infinity;
      let closestSphereDistance = Infinity;

      // Check distance to all spheres that this spline connects
      this.spheres.forEach((sphere, sphereIndex) => {
        const sphereDistance = Math.abs(
          (sphere.pos[0] - focalPoint[0]) * viewPlaneNormal[0] +
          (sphere.pos[1] - focalPoint[1]) * viewPlaneNormal[1] +
          (sphere.pos[2] - focalPoint[2]) * viewPlaneNormal[2]
        );

        minDistanceToSpline = Math.min(minDistanceToSpline, sphereDistance);

        // Track the closest sphere for logging
        if (sphereDistance < closestSphereDistance) {
          closestSphereDistance = sphereDistance;
        }
      });

      // Spline is visible ONLY when very close to the slice plane
      // This creates a "sectional" effect where line only shows where it intersects current slice
      const shouldLineBeVisible = minDistanceToSpline <= lineVisibilityThreshold;

        const currentLineVisibility = line.actor.getVisibility();

        if (currentLineVisibility !== shouldLineBeVisible) {


          line.actor.setVisibility(shouldLineBeVisible);
          line.actor.modified();
        }
    });
    
    // Render only this viewport
    viewport.render();
  }
  
  // Update visibility for all viewports when entering a new section
  refreshVisibilityForAllViewports() {
    
    
    
    if (this.spheres.length === 0) {
      
      return;
    }
    
    // Just make all spheres visible and disable updates - don't do visibility calculations
    // This prevents the hide-then-show conflict
    this.showAllSpheres();
  }
  
  // Restore spheres from saved state
  restoreSpheres(savedSpheres: { id: string; pos: [number, number, number]; color: string }[]) {
    
    
    
    // Clear existing spheres first
    this.clearAll();
    
    // Restore each sphere
    savedSpheres.forEach((savedSphere, index) => {
      
      
      const sphereData = { 
        id: savedSphere.id, 
        pos: savedSphere.pos as Vector3, 
        actors: new Map(), 
        source: null,
        color: savedSphere.color
      };
      
      this.spheres.push(sphereData);
      this._placeSphere(sphereData);
    });
    
    // Create connection lines if we have multiple spheres
    if (this.spheres.length >= 2) {
      this._createConnectionLines();
    }
    
    // Update colors if we have 3+ spheres
    if (this.spheres.length >= 3) {
      this._updateSphereColors();
    }
    
    
  }

  // Make all spheres visible (useful when entering a section)
  showAllSpheres() {
    
    
    
    this.spheres.forEach((sphere, sphereIndex) => {
      
      sphere.actors.forEach((actor, viewportId) => {
        const wasVisible = actor.getVisibility();
        actor.setVisibility(true);
        actor.modified();
        
      });
    });
    
    // Render all viewports
    const enabledElements = getEnabledElements();
    
    enabledElements.forEach(({ viewport }, index) => {
      if (viewport) {
        viewport.render();
        
      }
    });
    
    // Don't disable visibility updates - we want normal slice-based behavior
    
  }
  
  // Debug method to check sphere status
  debugSphereStatus() {
    
    
    
    this.spheres.forEach((sphere, index) => {
      
      
      
      sphere.actors.forEach((actor, viewportId) => {
        const isVisible = actor.getVisibility();
        const bounds = actor.getBounds();
        const position = actor.getPosition();
        
        
        
      });
    });
    
    // Check if actors are still in the viewports
    const enabledElements = getEnabledElements();
    enabledElements.forEach(({ viewport }, index) => {
      if (viewport) {
        
        
        // Check viewport camera and bounds
        const camera = viewport.getCamera();
        const viewportBounds = viewport.getBounds();
        
        
        this.spheres.forEach(sphere => {
          const uid = `${sphere.id}-${viewport.id}`;
          try {
            // Try to check if the actor is still in the viewport
            const actor = sphere.actors.get(viewport.id);
            if (actor) {
              
              
              // Check if sphere is within viewport bounds
              const spherePos = sphere.pos;
              const [xMin, xMax, yMin, yMax, zMin, zMax] = viewportBounds;
              const withinBounds = 
                spherePos[0] >= xMin && spherePos[0] <= xMax &&
                spherePos[1] >= yMin && spherePos[1] <= yMax &&
                spherePos[2] >= zMin && spherePos[2] <= zMax;
              
            } else {
              
            }
          } catch (error) {
            
          }
        });
      }
    });
  }
  
  // Force re-render spheres (useful after camera changes)
  forceReRenderSpheres() {
    
    
    // Try a more aggressive approach: re-add all actors to viewports
    const enabledElements = getEnabledElements();
    
    this.spheres.forEach(sphere => {
      // CRITICAL FIX: Re-apply the sphere center to the source
      if (sphere.source) {
        
        sphere.source.setCenter(sphere.pos);
        sphere.source.modified();
      }
      
      // Re-add actors to viewports (in case they were cleared)
      enabledElements.forEach(({ viewport }) => {
        if (!viewport.addActor) return;
        
        const actor = sphere.actors.get(viewport.id);
        if (actor) {
          try {
            // Try to remove first (in case it's already there)
            const uid = `${sphere.id}-${viewport.id}`;
            try {
              viewport._removeActor(uid);
            } catch (e) {
              // Ignore if not found
            }
            
            // Re-add the actor
            viewport.addActor({ uid, actor });
            
            // Force visibility and updates
            actor.setVisibility(true);
            actor.modified();
            actor.getMapper().update();
            
            
          } catch (error) {
            console.error(`❌ Error re-adding sphere ${sphere.id} to viewport ${viewport.id}:`, error);
          }
        }
      });
    });
    
    // Force render all viewports
    enabledElements.forEach(({ viewport }) => {
      if (viewport) {
        viewport.render();
      }
    });
    
    
  }
  
  // Start continuous sphere keeper to ensure spheres stay visible
  startSphereKeeper() {
    
    
    // Clear any existing interval
    if (this.sphereKeeperInterval) {
      clearInterval(this.sphereKeeperInterval);
    }
    
    // Set up interval to check and maintain sphere visibility every 500ms
    this.sphereKeeperInterval = setInterval(() => {
      this.keepSpheresVisible();
    }, 500);
    
    // Stop sphere keeper after 30 seconds (once spheres are stable)
    setTimeout(() => {
      this.stopSphereKeeper();
    }, 30000);
  }
  
  // Stop the sphere keeper
  stopSphereKeeper() {
    if (this.sphereKeeperInterval) {
      
      clearInterval(this.sphereKeeperInterval);
      this.sphereKeeperInterval = null;
    }
  }
  
  // Continuously ensure spheres stay visible
  keepSpheresVisible() {
    let changesMade = false;
    
    this.spheres.forEach(sphere => {
      sphere.actors.forEach((actor, viewportId) => {
        if (!actor.getVisibility()) {
          
          actor.setVisibility(true);
          actor.modified();
          changesMade = true;
        }
      });
    });
    
    // Only render if changes were made to avoid excessive rendering
    if (changesMade) {
      const enabledElements = getEnabledElements();
      enabledElements.forEach(({ viewport }) => {
        if (viewport) {
          viewport.render();
        }
      });
      
    }
  }
  
  // Temporarily disable visibility updates to prevent spheres from disappearing immediately
  temporarilyDisableVisibilityUpdates() {
    
    this.visibilityUpdatesDisabled = true;
    
    // Re-enable after 5 seconds (camera reset is no longer an issue)
    setTimeout(() => {
      
      this.visibilityUpdatesDisabled = false;
    }, 5000);
  }
}

export default SphereMarkerTool;