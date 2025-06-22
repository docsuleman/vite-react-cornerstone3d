import { getEnabledElements } from '@cornerstonejs/core';
import { BaseTool, Types } from '@cornerstonejs/tools';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
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
  activeSphereDrag: { id: string; distanceFromCamera: number } | null = null;
  positionUpdateCallback: ((spheres: { id: string; pos: Vector3; color: string }[]) => void) | null = null;

  constructor(
    toolProps: Types.PublicToolProps = {},
    defaultToolProps: Types.ToolProps = {
      supportedInteractionTypes: ['Mouse'],
      configuration: {
        sphereRadius: 2,
        positionUpdateCallback: null
      },
    }
  ) {
    super(toolProps, defaultToolProps);
    this.spheres = [];
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
      if (distance < this.configuration.sphereRadius * 1.5 && distance < minDistance) {
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
    
    const { world: worldPos } = evt.detail.currentPoints;
    
    // Don't add a new sphere if we're at the maximum
    if (this.spheres.length >= 3) {
      console.warn('Maximum of 3 spheres already placed.');
      return;
    }

    const sphereId = `sphere-${Date.now()}`;
    const color = this.spheres.length === 0 ? 'green' : this.spheres.length === 1 ? 'red' : 'yellow';

    const sphereData = { 
      id: sphereId, 
      pos: worldPos, 
      actor: null, 
      source: null,
      color 
    };
    
    this.spheres.push(sphereData);
    this._placeSphere(sphereData);

    if (this.spheres.length === 3) {
      this._updateSphereColors();
      this._notifyPositionUpdate();
    }
  };

  mouseDragCallback = (evt: any) => {
    if (!this.activeSphereDrag) {
      return;
    }
    
    const { currentPoints } = evt.detail;
    const worldPos = currentPoints.world;
    
    // Find the sphere being dragged
    const sphereIndex = this.spheres.findIndex(s => s.id === this.activeSphereDrag.id);
    if (sphereIndex === -1) {
      return;
    }
    
    // Update sphere position
    this.spheres[sphereIndex].pos = worldPos;
    
    // Update the sphere source directly with the new position
    if (this.spheres[sphereIndex].source) {
      this.spheres[sphereIndex].source.setCenter(worldPos);
      this.spheres[sphereIndex].source.modified();
    }
    
    // Update colors if we have all 3 spheres
    if (this.spheres.length === 3) {
      this._updateSphereColors();
    }
    
    // Render all viewports
    const enabledElements = getEnabledElements();
    enabledElements.forEach(({ viewport }) => viewport.render());
    
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

    const sphereSource = vtkSphereSource.newInstance();
    sphereSource.setCenter(sphereData.pos);
    sphereSource.setRadius(this.configuration.sphereRadius);
    sphereSource.setPhiResolution(20);
    sphereSource.setThetaResolution(20);

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
    const sortedByY = [...this.spheres].sort((a, b) => a.pos[1] - b.pos[1]);
    const sortedByX = [...this.spheres].sort((a, b) => a.pos[0] - b.pos[0]);

    sortedByY[0].color = 'red';
    sortedByX[0].color = 'yellow';

    this.spheres.forEach(sphere => {
      if (sphere.pos[0] > sortedByX[0].pos[0] && sphere.pos[1] > sortedByY[0].pos[1]) {
        sphere.color = 'green';
      }
    });

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
}

export default SphereMarkerTool;