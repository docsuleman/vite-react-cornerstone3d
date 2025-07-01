import { getEnabledElements } from '@cornerstonejs/core';
import { BaseTool, Types } from '@cornerstonejs/tools';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import { Vector3 } from '@kitware/vtk.js/types';
import { CPRCoordinateConverter } from '../utils/CPRCoordinateConverter';
import VTKToCornerstone3DConverter from '../utils/VTKToCornerstone3DConverter';

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface CPRAwareSphere {
  id: string;
  worldPos: Point3D; // Original DICOM coordinates
  cprPos?: [number, number, number]; // CPR image coordinates
  actor: any;
  source: any;
  color: string;
  cuspType?: 'left' | 'right' | 'non-coronary';
}

/**
 * CPR-Aware Sphere Marker Tool
 * Extends SphereMarkerTool with coordinate transformation support
 * Preserves original DICOM coordinates while working in CPR space
 */
class CPRAwareSphereMarkerTool extends BaseTool {
  static toolName = 'CPRAwareSphereMarker';
  
  private spheres: CPRAwareSphere[] = [];
  private coordinateConverter: CPRCoordinateConverter | null = null;
  private positionUpdateCallback: ((spheres: { id: string; pos: Point3D; color: string }[]) => void) | null = null;
  private isDraggable: boolean = true;
  private activeSphere: { id: string; startPos: Point3D } | null = null;

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
    this.positionUpdateCallback = this.configuration.positionUpdateCallback || null;
  }

  getToolName() {
    return CPRAwareSphereMarkerTool.toolName;
  }

  /**
   * Set coordinate converter for transform operations
   */
  setCoordinateConverter(converter: CPRCoordinateConverter): void {
    this.coordinateConverter = converter;
    console.log('🔄 CPR-Aware SphereMarkerTool: Coordinate converter set');
  }

  /**
   * Set callback for position updates
   */
  setPositionUpdateCallback(callback: (spheres: { id: string; pos: Point3D; color: string }[]) => void): void {
    this.positionUpdateCallback = callback;
  }

  /**
   * Set draggable state
   */
  setDraggable(draggable: boolean): void {
    this.isDraggable = draggable;
    console.log(`🔒 CPR-Aware SphereMarkerTool draggable state: ${draggable}`);
  }

  /**
   * Mouse click callback - places sphere at clicked location
   */
  mouseClickCallback = (evt: any) => {
    if (this.activeSphere) {
      // We're in drag mode, don't add new sphere
      return;
    }

    if (this.spheres.length >= 3) {
      console.warn('Maximum of 3 spheres already placed.');
      return;
    }

    const { element, currentPoints } = evt.detail;
    const { world: worldPos, canvas: canvasPos } = currentPoints;

    console.log('🎯 CPR-Aware click:', {
      worldPos,
      canvasPos,
      hasConverter: !!this.coordinateConverter
    });

    // Get the original DICOM coordinates
    let originalWorldPos: Point3D;

    if (this.coordinateConverter) {
      // Get the viewport to determine image bounds
      const enabledElements = getEnabledElements();
      const enabledElement = enabledElements.find(el => el.viewport.element === element);
      
      if (enabledElement?.viewport) {
        const viewport = enabledElement.viewport;
        
        // Check if this is a synthetic CPR image
        const imageIds = viewport.getImageIds?.() || [];
        const firstImageId = imageIds[0] || '';
        
        if (VTKToCornerstone3DConverter.isSyntheticImageId(firstImageId)) {
          console.log('🔄 Converting CPR coordinates to original DICOM coordinates...');
          
          // Get transform data from the image
          const transformData = VTKToCornerstone3DConverter.getTransformDataForImageId(firstImageId);
          
          if (transformData) {
            // Update coordinate converter with current transform data
            this.coordinateConverter.updateTransformData(transformData);
            
            // Get image bounds for coordinate conversion
            const bounds = viewport.getBounds?.() || [0, 100, 0, 100, 0, 1];
            
            // Convert canvas coordinates to original world coordinates
            originalWorldPos = this.coordinateConverter.canvasToWorld(
              [canvasPos[0], canvasPos[1]], 
              viewport, 
              bounds
            );
            
            console.log('✅ Coordinate conversion:', {
              canvasPos,
              cprWorldPos: worldPos,
              originalWorldPos
            });
          } else {
            console.warn('⚠️ No transform data found, using world coordinates as-is');
            originalWorldPos = { x: worldPos[0], y: worldPos[1], z: worldPos[2] };
          }
        } else {
          // Not a CPR image, use world coordinates directly
          originalWorldPos = { x: worldPos[0], y: worldPos[1], z: worldPos[2] };
        }
      } else {
        originalWorldPos = { x: worldPos[0], y: worldPos[1], z: worldPos[2] };
      }
    } else {
      // No coordinate converter, use world coordinates as-is
      originalWorldPos = { x: worldPos[0], y: worldPos[1], z: worldPos[2] };
    }

    // Determine sphere color/type based on placement order
    const sphereId = `cpr_sphere_${Date.now()}`;
    const colors = ['yellow', 'red', 'green']; // Aorta, Valve, LV
    const cuspTypes: ('left' | 'right' | 'non-coronary')[] = ['left', 'right', 'non-coronary'];
    const color = colors[this.spheres.length];
    const cuspType = cuspTypes[this.spheres.length];

    // Create sphere
    const sphere: CPRAwareSphere = {
      id: sphereId,
      worldPos: originalWorldPos,
      cprPos: [worldPos[0], worldPos[1], worldPos[2]],
      actor: null,
      source: null,
      color,
      cuspType
    };

    this.spheres.push(sphere);
    this._placeSphere(sphere);

    // Notify callback with original coordinates
    this._notifyPositionUpdate();

    console.log(`✅ CPR-Aware sphere ${this.spheres.length}/3 placed:`, {
      id: sphereId,
      originalPos: originalWorldPos,
      cprPos: sphere.cprPos,
      color,
      cuspType
    });
  };

  /**
   * Mouse drag callback - moves sphere while preserving coordinate transforms
   */
  mouseDragCallback = (evt: any) => {
    if (!this.isDraggable || !this.activeSphere) {
      return;
    }

    const { currentPoints } = evt.detail;
    const worldPos = currentPoints.world;

    // Find the sphere being dragged
    const sphere = this.spheres.find(s => s.id === this.activeSphere!.id);
    if (!sphere) return;

    // Update positions
    let newOriginalPos: Point3D;

    if (this.coordinateConverter) {
      // Convert new CPR position back to original coordinates
      const cprPos: [number, number, number] = [worldPos[0], worldPos[1], worldPos[2]];
      newOriginalPos = this.coordinateConverter.cprToWorld(cprPos);
      sphere.cprPos = cprPos;
    } else {
      newOriginalPos = { x: worldPos[0], y: worldPos[1], z: worldPos[2] };
    }

    sphere.worldPos = newOriginalPos;

    // Update VTK sphere position
    if (sphere.source) {
      sphere.source.setCenter([worldPos[0], worldPos[1], worldPos[2]]);
      sphere.source.modified();
    }

    // Render all viewports
    const enabledElements = getEnabledElements();
    enabledElements.forEach(({ viewport }) => viewport.render());

    // Notify position update
    this._notifyPositionUpdate();

    console.log('🎯 CPR-Aware sphere dragged:', {
      id: sphere.id,
      newOriginalPos,
      newCprPos: sphere.cprPos
    });
  };

  /**
   * Mouse down callback - start drag operation
   */
  preMouseDownCallback = (evt: any) => {
    if (!this.isDraggable) return false;

    const { currentPoints } = evt.detail;
    const worldPos = currentPoints.world;

    // Find closest sphere to click point
    let closestSphere: CPRAwareSphere | null = null;
    let minDistance = Number.MAX_VALUE;

    this.spheres.forEach(sphere => {
      const spherePos = sphere.cprPos || [sphere.worldPos.x, sphere.worldPos.y, sphere.worldPos.z];
      const distance = Math.sqrt(
        Math.pow(spherePos[0] - worldPos[0], 2) +
        Math.pow(spherePos[1] - worldPos[1], 2) +
        Math.pow(spherePos[2] - worldPos[2], 2)
      );

      if (distance < this.configuration.sphereRadius * 2.0 && distance < minDistance) {
        minDistance = distance;
        closestSphere = sphere;
      }
    });

    if (closestSphere) {
      this.activeSphere = {
        id: closestSphere.id,
        startPos: { ...closestSphere.worldPos }
      };
      return true;
    }

    return false;
  };

  /**
   * Mouse up callback - end drag operation
   */
  mouseUpCallback = () => {
    this.activeSphere = null;
  };

  /**
   * Place sphere in the viewport
   */
  private _placeSphere(sphere: CPRAwareSphere): void {
    const enabledElements = getEnabledElements();
    if (enabledElements.length === 0) {
      console.error('No enabled viewports found.');
      return;
    }

    console.log(`🔵 Creating CPR-aware ${sphere.color} sphere:`, sphere);

    const sphereSource = vtkSphereSource.newInstance();
    
    // Use CPR coordinates for display, but store original coordinates
    const displayPos = sphere.cprPos || [sphere.worldPos.x, sphere.worldPos.y, sphere.worldPos.z];
    sphereSource.setCenter(displayPos);
    sphereSource.setRadius(this.configuration.sphereRadius);
    sphereSource.setPhiResolution(16);
    sphereSource.setThetaResolution(16);

    sphere.source = sphereSource;

    const mapper = vtkMapper.newInstance();
    mapper.setInputConnection(sphereSource.getOutputPort());

    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);

    const property = actor.getProperty();
    if (sphere.color === 'red') property.setColor(1.0, 0.0, 0.0);
    if (sphere.color === 'yellow') property.setColor(1.0, 1.0, 0.0);
    if (sphere.color === 'green') property.setColor(0.0, 1.0, 0.0);

    sphere.actor = actor;

    enabledElements.forEach(({ viewport }) => {
      if (!viewport.addActor) {
        console.warn('Viewport does not support adding actors.');
        return;
      }
      viewport.addActor({ uid: sphere.id, actor });
      viewport.render();
    });

    this._notifyPositionUpdate();
  }

  /**
   * Notify position update callback with original coordinates
   */
  private _notifyPositionUpdate(): void {
    if (this.positionUpdateCallback) {
      const positions = this.spheres.map(sphere => ({
        id: sphere.id,
        pos: sphere.worldPos, // Return original DICOM coordinates
        color: sphere.color
      }));
      this.positionUpdateCallback(positions);
    }
  }

  /**
   * Clear all spheres
   */
  clearAll(): void {
    const enabledElements = getEnabledElements();
    
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

    this.spheres = [];
    this.activeSphere = null;

    // Render all viewports
    enabledElements.forEach(({ viewport }) => viewport.render());

    this._notifyPositionUpdate();
    console.log('🧹 Cleared all CPR-aware spheres');
  }

  /**
   * Get all sphere positions in original coordinates
   */
  getSpherePositions(): { id: string; pos: Point3D; color: string; cuspType?: string }[] {
    return this.spheres.map(sphere => ({
      id: sphere.id,
      pos: sphere.worldPos,
      color: sphere.color,
      cuspType: sphere.cuspType
    }));
  }

  /**
   * Update sphere positions when coordinate system changes
   */
  updateSpherePositions(): void {
    if (!this.coordinateConverter) return;

    this.spheres.forEach(sphere => {
      if (sphere.source && sphere.cprPos) {
        // Recalculate CPR position from original coordinates
        const newCprPos = this.coordinateConverter!.worldToCpr(sphere.worldPos);
        sphere.cprPos = newCprPos;
        sphere.source.setCenter(newCprPos);
        sphere.source.modified();
      }
    });

    // Render all viewports
    const enabledElements = getEnabledElements();
    enabledElements.forEach(({ viewport }) => viewport.render());

    console.log('🔄 Updated sphere positions for coordinate system change');
  }
}

export default CPRAwareSphereMarkerTool;