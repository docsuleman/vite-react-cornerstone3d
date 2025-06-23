import { getEnabledElements } from '@cornerstonejs/core';
import { BaseTool, Types } from '@cornerstonejs/tools';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import { Vector3 } from '@kitware/vtk.js/types';
import { RootPointType, AnnulusPointType, RootPoint, AnnulusPoint } from '../types/WorkflowTypes';

export type SphereMode = 'root' | 'annulus';

export interface TAVISphere {
  id: string;
  position: Vector3;
  type: RootPointType | AnnulusPointType;
  mode: SphereMode;
  actor: any;
  source: any;
  color: string;
  timestamp: number;
}

export interface TAVISphereUpdateData {
  rootPoints?: RootPoint[];
  annulusPoints?: AnnulusPoint[];
}

class TAVISphereMarkerTool extends BaseTool {
  static toolName = 'TAVISphereMarker';
  
  private spheres: TAVISphere[] = [];
  private activeSphereDrag: { id: string; distanceFromCamera: number } | null = null;
  private currentMode: SphereMode = 'root';
  private positionUpdateCallback: ((data: TAVISphereUpdateData) => void) | null = null;

  private readonly rootPointColors = {
    [RootPointType.LV_OUTFLOW]: { r: 0.0, g: 1.0, b: 0.0 }, // Green
    [RootPointType.AORTIC_VALVE]: { r: 1.0, g: 0.0, b: 0.0 }, // Red
    [RootPointType.ASCENDING_AORTA]: { r: 1.0, g: 1.0, b: 0.0 }, // Yellow
  };

  private readonly annulusPointColors = {
    [AnnulusPointType.RIGHT_CORONARY_CUSP]: { r: 0.0, g: 1.0, b: 0.0 }, // Green
    [AnnulusPointType.LEFT_CORONARY_CUSP]: { r: 1.0, g: 0.0, b: 0.0 }, // Red
    [AnnulusPointType.NON_CORONARY_CUSP]: { r: 1.0, g: 1.0, b: 0.0 }, // Yellow
  };

  constructor(
    toolProps: Types.PublicToolProps = {},
    defaultToolProps: Types.ToolProps = {
      supportedInteractionTypes: ['Mouse'],
      configuration: {
        sphereRadius: 3,
        mode: 'root',
        positionUpdateCallback: null,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
    this.spheres = [];
    this.activeSphereDrag = null;
    this.currentMode = this.configuration.mode || 'root';
    this.positionUpdateCallback = this.configuration.positionUpdateCallback || null;
  }

  getToolName() {
    return TAVISphereMarkerTool.toolName;
  }

  /**
   * Set the current mode (root or annulus)
   */
  setMode(mode: SphereMode) {
    this.currentMode = mode;
    this.configuration.mode = mode;
  }

  /**
   * Get the current mode
   */
  getMode(): SphereMode {
    return this.currentMode;
  }

  /**
   * Set callback for position updates
   */
  setPositionUpdateCallback(callback: (data: TAVISphereUpdateData) => void) {
    this.positionUpdateCallback = callback;
    this.configuration.positionUpdateCallback = callback;
  }

  /**
   * Clear all spheres
   */
  clearSpheres() {
    this.spheres.forEach(sphere => {
      this.removeActorFromViewports(sphere.id);
    });
    this.spheres = [];
    this.notifyPositionUpdate();
  }

  /**
   * Clear spheres by mode
   */
  clearSpheresByMode(mode: SphereMode) {
    const spheresToRemove = this.spheres.filter(s => s.mode === mode);
    spheresToRemove.forEach(sphere => {
      this.removeActorFromViewports(sphere.id);
    });
    this.spheres = this.spheres.filter(s => s.mode !== mode);
    this.notifyPositionUpdate();
  }

  /**
   * Get spheres by mode
   */
  getSpheresByMode(mode: SphereMode): TAVISphere[] {
    return this.spheres.filter(s => s.mode === mode);
  }

  /**
   * Check if sphere can be placed based on current mode and existing spheres
   */
  private canPlaceSphere(): { canPlace: boolean; nextType?: RootPointType | AnnulusPointType; reason?: string } {
    const spheresInCurrentMode = this.getSpheresByMode(this.currentMode);

    if (this.currentMode === 'root') {
      if (spheresInCurrentMode.length >= 3) {
        return { canPlace: false, reason: 'Maximum 3 root points already placed' };
      }

      const existingTypes = spheresInCurrentMode.map(s => s.type as RootPointType);
      const rootOrder = [RootPointType.LV_OUTFLOW, RootPointType.AORTIC_VALVE, RootPointType.ASCENDING_AORTA];
      
      for (const type of rootOrder) {
        if (!existingTypes.includes(type)) {
          return { canPlace: true, nextType: type };
        }
      }
    } else if (this.currentMode === 'annulus') {
      if (spheresInCurrentMode.length >= 3) {
        return { canPlace: false, reason: 'Maximum 3 annulus points already placed' };
      }

      const existingTypes = spheresInCurrentMode.map(s => s.type as AnnulusPointType);
      const annulusOrder = [AnnulusPointType.RIGHT_CORONARY_CUSP, AnnulusPointType.LEFT_CORONARY_CUSP, AnnulusPointType.NON_CORONARY_CUSP];
      
      for (const type of annulusOrder) {
        if (!existingTypes.includes(type)) {
          return { canPlace: true, nextType: type };
        }
      }
    }

    return { canPlace: false, reason: 'All points for current mode already placed' };
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

    const worldPos = currentPoints.world;
    const camera = enabledElement.viewport.getCamera();
    const cameraPos = camera.position;
    
    // Find the closest sphere to the click point
    let closestSphere = null;
    let minDistance = Number.MAX_VALUE;
    
    this.spheres.forEach(sphere => {
      const distance = Math.sqrt(
        Math.pow(sphere.position[0] - worldPos[0], 2) +
        Math.pow(sphere.position[1] - worldPos[1], 2) +
        Math.pow(sphere.position[2] - worldPos[2], 2)
      );
      
      // Check if click is within sphere radius (with tolerance)
      if (distance < this.configuration.sphereRadius * 2 && distance < minDistance) {
        minDistance = distance;
        closestSphere = sphere;
      }
    });
    
    if (closestSphere) {
      // Calculate distance from camera to sphere
      const distanceFromCamera = Math.sqrt(
        Math.pow(closestSphere.position[0] - cameraPos[0], 2) +
        Math.pow(closestSphere.position[1] - cameraPos[1], 2) +
        Math.pow(closestSphere.position[2] - cameraPos[2], 2)
      );
      
      this.activeSphereDrag = {
        id: closestSphere.id,
        distanceFromCamera
      };
      
      return true;
    }
    
    return false;
  };

  mouseClickCallback = (evt: any) => {
    if (this.activeSphereDrag) {
      return;
    }
    
    const { world: worldPos } = evt.detail.currentPoints;
    const placementCheck = this.canPlaceSphere();
    
    if (!placementCheck.canPlace) {
      console.warn(placementCheck.reason);
      return;
    }

    const sphereId = `tavi-sphere-${Date.now()}`;
    const type = placementCheck.nextType!;
    const colorInfo = this.currentMode === 'root' 
      ? this.rootPointColors[type as RootPointType]
      : this.annulusPointColors[type as AnnulusPointType];

    const sphereData: TAVISphere = {
      id: sphereId,
      position: worldPos,
      type,
      mode: this.currentMode,
      actor: null,
      source: null,
      color: `rgb(${Math.floor(colorInfo.r * 255)}, ${Math.floor(colorInfo.g * 255)}, ${Math.floor(colorInfo.b * 255)})`,
      timestamp: Date.now(),
    };
    
    this.spheres.push(sphereData);
    this.placeSphere(sphereData);
    this.notifyPositionUpdate();
  };

  mouseDragCallback = (evt: any) => {
    if (!this.activeSphereDrag) {
      return;
    }
    
    const { currentPoints } = evt.detail;
    const worldPos = currentPoints.world;
    
    const sphereIndex = this.spheres.findIndex(s => s.id === this.activeSphereDrag!.id);
    if (sphereIndex === -1) {
      return;
    }
    
    // Update sphere position
    this.spheres[sphereIndex].position = worldPos;
    this.spheres[sphereIndex].timestamp = Date.now();
    
    // Update the sphere source
    if (this.spheres[sphereIndex].source) {
      this.spheres[sphereIndex].source.setCenter(worldPos);
      this.spheres[sphereIndex].source.modified();
    }
    
    // Render all viewports
    const enabledElements = getEnabledElements();
    enabledElements.forEach(({ viewport }) => viewport.render());
    
    this.notifyPositionUpdate();
  };

  mouseUpCallback = (evt: any) => {
    if (this.activeSphereDrag) {
      this.activeSphereDrag = null;
    }
  };

  private placeSphere(sphereData: TAVISphere) {
    const enabledElements = getEnabledElements();
    if (enabledElements.length === 0) {
      console.error('No enabled viewports found.');
      return;
    }

    const sphereSource = vtkSphereSource.newInstance();
    sphereSource.setCenter(sphereData.position);
    sphereSource.setRadius(this.configuration.sphereRadius);
    sphereSource.setPhiResolution(20);
    sphereSource.setThetaResolution(20);

    sphereData.source = sphereSource;

    const mapper = vtkMapper.newInstance();
    mapper.setInputConnection(sphereSource.getOutputPort());

    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);

    const property = actor.getProperty();
    const colorInfo = this.currentMode === 'root' 
      ? this.rootPointColors[sphereData.type as RootPointType]
      : this.annulusPointColors[sphereData.type as AnnulusPointType];
    
    property.setColor(colorInfo.r, colorInfo.g, colorInfo.b);
    property.setOpacity(0.8);

    sphereData.actor = actor;

    enabledElements.forEach(({ viewport }) => {
      if (viewport.addActor) {
        viewport.addActor({ uid: sphereData.id, actor });
        viewport.render();
      }
    });
  }

  private removeActorFromViewports(sphereId: string) {
    const enabledElements = getEnabledElements();
    enabledElements.forEach(({ viewport }) => {
      // TODO: Find correct method to remove actors from viewport
      // Current Cornerstone3D version may not have removeActor method
      // if (viewport.removeActor) {
      //   viewport.removeActor({ uid: sphereId });
      //   viewport.render();
      // }
      viewport.render();
    });
  }

  private notifyPositionUpdate() {
    if (this.positionUpdateCallback) {
      const rootSpheres = this.getSpheresByMode('root');
      const annulusSpheres = this.getSpheresByMode('annulus');

      const rootPoints: RootPoint[] = rootSpheres.map(sphere => ({
        id: sphere.id,
        type: sphere.type as RootPointType,
        position: sphere.position,
        timestamp: sphere.timestamp,
      }));

      const annulusPoints: AnnulusPoint[] = annulusSpheres.map(sphere => ({
        id: sphere.id,
        type: sphere.type as AnnulusPointType,
        position: sphere.position,
        timestamp: sphere.timestamp,
      }));

      const updateData: TAVISphereUpdateData = {};
      if (rootPoints.length > 0) updateData.rootPoints = rootPoints;
      if (annulusPoints.length > 0) updateData.annulusPoints = annulusPoints;

      this.positionUpdateCallback(updateData);
    }
  }

  /**
   * Get sphere count by mode
   */
  getSphereCountByMode(mode: SphereMode): number {
    return this.getSpheresByMode(mode).length;
  }

  /**
   * Get next expected sphere type for current mode
   */
  getNextExpectedType(): RootPointType | AnnulusPointType | null {
    const check = this.canPlaceSphere();
    return check.nextType || null;
  }

  /**
   * Remove sphere by ID
   */
  removeSphere(sphereId: string): boolean {
    const sphereIndex = this.spheres.findIndex(s => s.id === sphereId);
    if (sphereIndex === -1) {
      return false;
    }

    this.removeActorFromViewports(sphereId);
    this.spheres.splice(sphereIndex, 1);
    this.notifyPositionUpdate();
    return true;
  }

  /**
   * Get sphere by ID
   */
  getSphere(sphereId: string): TAVISphere | null {
    return this.spheres.find(s => s.id === sphereId) || null;
  }
}

export default TAVISphereMarkerTool;