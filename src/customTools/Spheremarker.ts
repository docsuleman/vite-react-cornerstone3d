import { getEnabledElements } from '@cornerstonejs/core';
import { BaseTool, Types } from '@cornerstonejs/tools';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkLineSource from '@kitware/vtk.js/Filters/Sources/LineSource';
import vtkTubeFilter from '@kitware/vtk.js/Filters/General/TubeFilter';
import { Vector3 } from '@kitware/vtk.js/types';

class SphereMarkerTool extends BaseTool {
  static toolName = 'SphereMarker';
  spheres: { 
    id: string; 
    pos: Vector3; 
    actor: any; 
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

  // Set draggable state (disable during certain workflow stages)
  setDraggable(draggable: boolean) {
    this.isDraggable = draggable;
    console.log(`🔒 SphereMarkerTool draggable state: ${draggable}`);
  }

  constructor(
    toolProps: Types.PublicToolProps = {},
    defaultToolProps: Types.ToolProps = {
      supportedInteractionTypes: ['Mouse'],
      configuration: {
        sphereRadius: 5,
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
  }

  getToolName() {
    return SphereMarkerTool.toolName;
  }

  // Set callback to be called whenever sphere positions change
  setPositionUpdateCallback(callback: (spheres: { id: string; pos: Vector3; color: string }[]) => void) {
    this.positionUpdateCallback = callback;
    this.configuration.positionUpdateCallback = callback;
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
    }
    
    return false;
  };

  mouseClickCallback = (evt: any) => {
    // If we're in drag mode, don't add a new sphere
    if (this.activeSphereDrag) {
      return;
    }
    
    const { element, currentPoints } = evt.detail;
    const { world: worldPos, canvas: canvasPos } = currentPoints;
    
    console.log('🎯 Raw world position:', worldPos);
    console.log('🎯 Canvas position:', canvasPos);
    
    // Get the viewport to check zoom/transformation
    const enabledElements = getEnabledElements();
    const enabledElement = enabledElements.find(el => el.viewport.element === element);
    
    if (enabledElement && enabledElement.viewport) {
      const viewport = enabledElement.viewport;
      console.log('🔍 Viewport info:', {
        zoom: viewport.getZoom ? viewport.getZoom() : 'unknown',
        camera: viewport.getCamera ? viewport.getCamera() : 'unknown'
      });
    }
    
    // Don't add a new sphere if we're at the maximum
    if (this.spheres.length >= 3) {
      console.warn('Maximum of 3 spheres already placed.');
      return;
    }

    const sphereId = `sphere-${Date.now()}`;
    // Color sequence: 1st=Aorta(yellow), 2nd=Valve(red), 3rd=LV(green)
    const color = this.spheres.length === 0 ? 'yellow' : this.spheres.length === 1 ? 'red' : 'green';

    // Use world coordinates directly for VTK actors (they should work consistently across viewports)
    const finalPos: Vector3 = [worldPos[0], worldPos[1], worldPos[2]];
    
    // For Cornerstone viewports, world coordinates should be consistent
    // The issue might be with different viewport zoom levels affecting visual positioning
    if (enabledElement && enabledElement.viewport) {
      const viewport = enabledElement.viewport;
      
      // Get viewport info for debugging
      const camera = viewport.getCamera ? viewport.getCamera() : null;
      const zoom = viewport.getZoom ? viewport.getZoom() : null;
      
      console.log('🔄 Viewport info for sphere placement:', {
        viewportType: viewport.type || 'unknown',
        zoom: zoom,
        parallelScale: camera ? camera.parallelScale : 'unknown',
        position: camera ? camera.position : 'unknown'
      });
      
      // Use world coordinates directly - they should be correct for VTK
      // The visual mismatch might be due to viewport zoom differences
      console.log('🎯 Using world coordinates directly:', worldPos);
    }
    
    console.log('🎯 Final sphere position:', finalPos);
    
    const sphereData = { 
      id: sphereId, 
      pos: finalPos, 
      actor: null, 
      source: null,
      color 
    };
    
    this.spheres.push(sphereData);
    this._placeSphere(sphereData);

    // Always create lines if we have 2+ spheres
    if (this.spheres.length >= 2) {
      this._createConnectionLines();
    }
    
    if (this.spheres.length === 3) {
      this._updateSphereColors();
    }
    
    this._notifyPositionUpdate();
  };

  mouseDragCallback = (evt: any) => {
    if (!this.isDraggable || !this.activeSphereDrag) {
      return; // Tool is locked or no active drag
    }
    
    const { currentPoints } = evt.detail;
    const worldPos = currentPoints.world;
    
    // Find the sphere being dragged
    const sphereIndex = this.spheres.findIndex(s => s.id === this.activeSphereDrag.id);
    if (sphereIndex === -1) {
      return;
    }
    
    // Update sphere position with coordinate correction
    const newPos: Vector3 = [worldPos[0], worldPos[1], worldPos[2]];
    
    // Use world coordinates directly for consistent positioning
    console.log('🎯 Dragging sphere - raw world position:', worldPos);
    console.log('🎯 Which sphere being dragged:', this.activeSphereDrag.id, 'at index', sphereIndex);
    
    // Update the sphere position in our array
    const oldPos = [...this.spheres[sphereIndex].pos];
    this.spheres[sphereIndex].pos = newPos;
    
    console.log('🎯 Sphere position changed:', {
      sphereId: this.activeSphereDrag.id,
      sphereIndex: sphereIndex,
      color: this.spheres[sphereIndex].color,
      oldPos: oldPos,
      newPos: newPos,
      changed: JSON.stringify(oldPos) !== JSON.stringify(newPos)
    });
    
    // Update the sphere source directly with the new position
    if (this.spheres[sphereIndex].source) {
      this.spheres[sphereIndex].source.setCenter(newPos);
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
    }
  };

  _placeSphere(sphereData: { id: string; pos: Vector3; actor: any; source: any; color: string }) {
    const enabledElements = getEnabledElements();
    if (enabledElements.length === 0) {
      console.error('No enabled viewports found.');
      return;
    }

    const sphereName = sphereData.color === 'yellow' ? 'Aorta' : sphereData.color === 'red' ? 'Valve' : 'LV';
    console.log(`🔵 Creating ${sphereName} sphere:`, sphereData);

    const sphereSource = vtkSphereSource.newInstance();
    sphereSource.setCenter(sphereData.pos);
    sphereSource.setRadius(this.configuration.sphereRadius);
    sphereSource.setPhiResolution(16);
    sphereSource.setThetaResolution(16);

    // Store the source for later updates
    sphereData.source = sphereSource;

    const mapper = vtkMapper.newInstance();
    mapper.setInputConnection(sphereSource.getOutputPort());

    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);

    const property = actor.getProperty();
    if (sphereData.color === 'red') property.setColor(1.0, 0.0, 0.0);
    if (sphereData.color === 'yellow') property.setColor(1.0, 1.0, 0.0);
    if (sphereData.color === 'green') property.setColor(0.0, 1.0, 0.0);

    sphereData.actor = actor;

    enabledElements.forEach(({ viewport }) => {
      if (!viewport.addActor) {
        console.warn('Viewport does not support adding actors.');
        return;
      }
      viewport.addActor({ uid: sphereData.id, actor });
      viewport.render();
    });
    
    // Notify position update
    this._notifyPositionUpdate();
  }

  _updateSphereColors() {
    // Keep the original placement order colors - don't change them based on position
    // 1st=Aorta(yellow), 2nd=Valve(red), 3rd=LV(green)
    if (this.spheres.length >= 1) this.spheres[0].color = 'yellow'; // Aorta
    if (this.spheres.length >= 2) this.spheres[1].color = 'red';    // Valve
    if (this.spheres.length >= 3) this.spheres[2].color = 'green';  // LV
    
    console.log('🎨 Updated sphere colors:', this.spheres.map(s => `${s.id}: ${s.color}`));
    this._updateRenderedSpheres();
  }

  _updateRenderedSpheres() {
    const enabledElements = getEnabledElements();

    this.spheres.forEach(sphere => {
      const property = sphere.actor.getProperty();
      if (sphere.color === 'red') property.setColor(1.0, 0.0, 0.0);
      if (sphere.color === 'yellow') property.setColor(1.0, 1.0, 0.0);
      if (sphere.color === 'green') property.setColor(0.0, 1.0, 0.0);
    });

    enabledElements.forEach(({ viewport }) => viewport.render());
  }

  _createConnectionLines() {
    console.log('🔗 Creating connection lines for spheres:', this.spheres.length);
    console.log('🔗 Sphere details:', this.spheres.map((s, i) => `${i}: ${s.color} at [${s.pos.join(', ')}]`));
    
    // Clear existing lines
    this._clearConnectionLines();
    
    if (this.spheres.length < 2) {
      console.log('⚠️ Need at least 2 spheres for lines');
      return;
    }
    
    const enabledElements = getEnabledElements();
    if (enabledElements.length === 0) {
      console.error('No enabled viewports found for lines.');
      return;
    }

    console.log('🔗 Will create', this.spheres.length - 1, 'lines between', this.spheres.length, 'spheres');

    // Create lines between consecutive spheres
    for (let i = 0; i < this.spheres.length - 1; i++) {
      const startSphere = this.spheres[i];
      const endSphere = this.spheres[i + 1];
      
      console.log(`🔗 Creating line ${i+1}: from`, startSphere.pos, 'to', endSphere.pos);
      
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
      
      const lineId = `line-${i}-${i+1}`;
      this.connectionLines.push({
        id: lineId,
        actor,
        source: lineSource,
        tubeFilter: tubeFilter
      });
      
      console.log(`🔗 Tube ${lineId} created with properties:`, {
        point1: startSphere.pos,
        point2: endSphere.pos,
        radius: 1.0,
        color: [1.0, 0.0, 1.0],
        representation: property.getRepresentation(),
        numberOfSides: 8
      });
      
      // Add line to all viewports
      enabledElements.forEach(({ viewport }, viewportIndex) => {
        if (!viewport.addActor) {
          console.warn(`Viewport ${viewportIndex} does not support adding actors.`);
          return;
        }
        
        try {
          viewport.addActor({ uid: lineId, actor });
          console.log(`✅ Added line ${lineId} to viewport ${viewportIndex}`);
        } catch (error) {
          console.error(`❌ Failed to add line ${lineId} to viewport ${viewportIndex}:`, error);
        }
      });
    }
    
    console.log('🔗 Created', this.connectionLines.length, 'connection lines');
    
    // Force render all viewports
    enabledElements.forEach(({ viewport }, index) => {
      try {
        viewport.render();
        console.log(`🎨 Rendered viewport ${index}`);
      } catch (error) {
        console.error(`❌ Failed to render viewport ${index}:`, error);
      }
    });
  }

  _updateConnectionLines() {
    console.log('🔄 Updating connection lines for spheres:', this.spheres.length);
    
    if (this.spheres.length < 2) {
      return;
    }
    
    // Simple in-place update approach - this worked for some lines
    this.connectionLines.forEach((line, lineIndex) => {
      const startSphere = this.spheres[lineIndex];
      const endSphere = this.spheres[lineIndex + 1];
      
      if (startSphere && endSphere && line.source) {
        console.log(`🔄 Updating line ${line.id}: from [${startSphere.pos.join(', ')}] to [${endSphere.pos.join(', ')}]`);
        
        // Update the VTK line source directly
        line.source.setPoint1(startSphere.pos);
        line.source.setPoint2(endSphere.pos);
        line.source.modified();
        
        // Force the tube filter to update
        if (line.tubeFilter) {
          line.tubeFilter.modified();
        }
        
        // Force the actor to update
        if (line.actor) {
          line.actor.modified();
        }
        
        console.log(`✅ Updated line ${line.id}`);
      }
    });
    
    // Render all viewports
    const enabledElements = getEnabledElements();
    enabledElements.forEach(({ viewport }) => viewport.render());
  }

  _createSingleConnectionLine(index: number, startSphere: any, endSphere: any) {
    const lineId = `line-${index}-${index+1}`;
    this._createSingleConnectionLineWithId(index, startSphere, endSphere, lineId);
  }

  _createSingleConnectionLineWithId(index: number, startSphere: any, endSphere: any, lineId: string) {
    console.log(`🏗️ Creating single line ${lineId}: ${startSphere.color} to ${endSphere.color}`);
    console.log(`🏗️ Positions: [${startSphere.pos.join(', ')}] to [${endSphere.pos.join(', ')}]`);
    
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
    
    console.log(`🏗️ Added line ${lineId} to connections array. Total lines: ${this.connectionLines.length}`);
    console.log(`🏗️ Current line IDs:`, this.connectionLines.map(line => line.id));
    
    // Add line to all viewports
    enabledElements.forEach(({ viewport }, viewportIndex) => {
      if (viewport.addActor) {
        try {
          viewport.addActor({ uid: lineId, actor });
          console.log(`🏗️ Successfully added line ${lineId} to viewport ${viewportIndex}`);
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
    
    console.log('🗑️ Clearing connection lines:', this.connectionLines.map(line => line.id));
    
    this.connectionLines.forEach(line => {
      enabledElements.forEach(({ viewport }, viewportIndex) => {
        if (viewport._removeActor) {
          try {
            viewport._removeActor(line.id);
            console.log(`🗑️ Removed line ${line.id} from viewport ${viewportIndex}`);
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
            console.log(`🗑️ Cleaned up old line ${oldId} from viewport ${viewportIndex}`);
          } catch (error) {
            // Ignore - line might not exist
          }
        }
      });
    });
    
    // Force render to ensure removals are complete
    enabledElements.forEach(({ viewport }, index) => {
      viewport.render();
      console.log(`🗑️ Rendered viewport ${index} after line removal`);
    });
    
    this.connectionLines = [];
    console.log('🗑️ Connection lines array cleared');
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
}

export default SphereMarkerTool;