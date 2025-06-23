import React, { useEffect, useRef, useState, useCallback } from 'react';
import "@kitware/vtk.js/favicon";
import "@kitware/vtk.js/Rendering/Profiles/All";
import "@kitware/vtk.js/IO/Core/DataAccessHelper/HttpDataAccessHelper";

import { ProjectionMode } from "@kitware/vtk.js/Rendering/Core/ImageCPRMapper/Constants";
import { radiansFromDegrees } from "@kitware/vtk.js/Common/Core/Math";
import { updateState } from "@kitware/vtk.js/Widgets/Widgets3D/ResliceCursorWidget/helpers";
import { vec3, mat3, mat4 } from "gl-matrix";
import { ViewTypes } from "@kitware/vtk.js/Widgets/Core/WidgetManager/Constants";
import vtkCPRManipulator from "@kitware/vtk.js/Widgets/Manipulators/CPRManipulator";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray";
import vtkGenericRenderWindow from "@kitware/vtk.js/Rendering/Misc/GenericRenderWindow";
import vtkHttpDataSetReader from "@kitware/vtk.js/IO/Core/HttpDataSetReader";
import vtkImageCPRMapper from "@kitware/vtk.js/Rendering/Core/ImageCPRMapper";
import vtkImageMapper from "@kitware/vtk.js/Rendering/Core/ImageMapper";
import vtkImageReslice from "@kitware/vtk.js/Imaging/Core/ImageReslice";
import vtkImageSlice from "@kitware/vtk.js/Rendering/Core/ImageSlice";
import vtkInteractorStyleImage from "@kitware/vtk.js/Interaction/Style/InteractorStyleImage";
import vtkPlaneManipulator from "@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import vtkRenderer from "@kitware/vtk.js/Rendering/Core/Renderer";
import vtkResliceCursorWidget from "@kitware/vtk.js/Widgets/Widgets3D/ResliceCursorWidget";
import vtkWidgetManager from "@kitware/vtk.js/Widgets/Core/WidgetManager";
import widgetBehavior from "@kitware/vtk.js/Widgets/Widgets3D/ResliceCursorWidget/cprBehavior";

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface CPRViewportProps {
  // Root points for generating centerline
  rootPoints?: Point3D[];
  // DICOM volume data URL
  volumeUrl?: string;
  // Width of the viewport
  width?: number;
  // Height of the viewport
  height?: number;
  // Background color
  backgroundColor?: [number, number, number];
  // Projection mode
  projectionMode?: keyof typeof ProjectionMode;
  // CPR mode: 'stretched' or 'straightened'
  cprMode?: 'stretched' | 'straightened';
  // Callback when measurements are taken
  onMeasurement?: (measurement: any) => void;
}

const CPRViewport: React.FC<CPRViewportProps> = ({
  rootPoints = [],
  volumeUrl = '/data/LIDC2.vti/index.json',
  width = 800,
  height = 600,
  backgroundColor = [0, 0, 0],
  projectionMode = 'AVERAGE',
  cprMode = 'straightened',
  onMeasurement
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [angle, setAngle] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  
  // VTK objects refs
  const vtkObjects = useRef<{
    renderWindow?: any;
    stretchRenderer?: any;
    crossRenderer?: any;
    mapper?: any;
    actor?: any;
    widget?: any;
    widgetManager?: any;
    crossWidgetManager?: any;
    centerline?: any;
    cprManipulator?: any;
    planeManipulator?: any;
    reader?: any;
    reslice?: any;
    resliceMapper?: any;
    resliceActor?: any;
    animationId?: number;
  }>({});

  // Generate centerline from root points
  const generateCenterlineFromPoints = useCallback((points: Point3D[]) => {
    if (points.length < 3) return null;

    // Simple linear interpolation between points for now
    // This will be enhanced with spline interpolation later
    const positions: number[] = [];
    const orientations: number[] = [];
    
    const totalSegments = 50; // Number of points along centerline
    
    for (let i = 0; i < totalSegments; i++) {
      const t = i / (totalSegments - 1);
      
      // Linear interpolation between the three root points
      let x = 0, y = 0, z = 0;
      
      if (t <= 0.5) {
        // Interpolate between first and second point
        const localT = t * 2;
        x = points[0].x + (points[1].x - points[0].x) * localT;
        y = points[0].y + (points[1].y - points[0].y) * localT;
        z = points[0].z + (points[1].z - points[0].z) * localT;
      } else {
        // Interpolate between second and third point
        const localT = (t - 0.5) * 2;
        x = points[1].x + (points[2].x - points[1].x) * localT;
        y = points[1].y + (points[2].y - points[1].y) * localT;
        z = points[1].z + (points[2].z - points[1].z) * localT;
      }
      
      positions.push(x, y, z);
      
      // Create identity orientation matrices for now
      orientations.push(
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      );
    }
    
    return {
      position: positions,
      orientation: orientations
    };
  }, []);

  // Update distance and direction function
  const updateDistanceAndDirection = useCallback(() => {
    const { widget, mapper, cprManipulator, stretchRenderer, crossRenderer, reslice, resliceActor, planeManipulator } = vtkObjects.current;
    
    if (!widget || !mapper || !cprManipulator) return;

    const stretchPlane = "Y";
    const crossPlane = "Z";
    const stretchViewType = ViewTypes.XZ_PLANE;
    const crossViewType = ViewTypes.XY_PLANE;
    
    const widgetState = widget.getWidgetState();
    
    // Directions and position in world space from the widget
    const widgetPlanes = widgetState.getPlanes();
    const worldBitangent = widgetPlanes[stretchViewType].normal;
    const worldNormal = widgetPlanes[stretchViewType].viewUp;
    widgetPlanes[crossViewType].normal = worldNormal;
    widgetPlanes[crossViewType].viewUp = worldBitangent;
    const worldTangent = vec3.create();
    vec3.cross(worldTangent, worldBitangent, worldNormal);
    vec3.normalize(worldTangent, worldTangent);
    const worldWidgetCenter = widgetState.getCenter();
    const distance = cprManipulator.getCurrentDistance();

    // CPR mapper tangent and bitangent directions update
    const { orientation } = mapper.getCenterlinePositionAndOrientation(distance);
    const modelDirections = mat3.create();
    mat3.fromQuat(modelDirections, orientation);
    const inverseModelDirections = mat3.create();
    mat3.invert(inverseModelDirections, modelDirections);
    const worldDirections = mat3.fromValues(
      worldTangent[0], worldTangent[1], worldTangent[2],
      worldBitangent[0], worldBitangent[1], worldBitangent[2],
      worldNormal[0], worldNormal[1], worldNormal[2]
    );
    const baseDirections = mat3.create();
    mat3.mul(baseDirections, inverseModelDirections, worldDirections);
    mapper.setDirectionMatrix(baseDirections);

    // Cross renderer update
    if (crossRenderer && reslice && resliceActor) {
      widget.updateReslicePlane(reslice, crossViewType);
      resliceActor.setUserMatrix(reslice.getResliceAxes());
      widget.updateCameraPoints(crossRenderer, crossViewType, false, false);
      const crossCamera = crossRenderer.getActiveCamera();
      crossCamera.setViewUp(
        modelDirections[3],
        modelDirections[4],
        modelDirections[5]
      );
    }

    // Update plane manipulator origin / normal for the cross view
    if (planeManipulator) {
      planeManipulator.setUserOrigin(worldWidgetCenter);
      planeManipulator.setUserNormal(worldNormal);
    }

    // Find the angle
    const signedRadAngle = Math.atan2(baseDirections[1], baseDirections[0]);
    const signedDegAngle = (signedRadAngle * 180) / Math.PI;
    const degAngle = signedDegAngle > 0 ? signedDegAngle : 360 + signedDegAngle;
    setAngle(degAngle);
    
    updateState(
      widgetState,
      widget.getScaleInPixels(),
      widget.getRotationHandlePosition()
    );

    const mapperWidth = mapper.getWidth();
    const mapperHeight = mapper.getHeight();

    // CPR actor matrix update
    const { actor } = vtkObjects.current;
    if (actor) {
      const worldActorTranslation = vec3.create();
      vec3.scaleAndAdd(
        worldActorTranslation,
        worldWidgetCenter,
        worldTangent,
        -0.5 * mapperWidth
      );
      vec3.scaleAndAdd(
        worldActorTranslation,
        worldActorTranslation,
        worldNormal,
        distance - mapperHeight
      );
      const scaledBitangent = vec3.create();
      vec3.scale(scaledBitangent, worldBitangent, -1);
      const worldActorTransform = mat4.fromValues(
        worldTangent[0], worldTangent[1], worldTangent[2], 0,
        worldNormal[0], worldNormal[1], worldNormal[2], 0,
        scaledBitangent[0], scaledBitangent[1], scaledBitangent[2], 0,
        worldActorTranslation[0], worldActorTranslation[1], worldActorTranslation[2], 1
      );
      actor.setUserMatrix(worldActorTransform);
    }

    // CPR camera reset
    if (stretchRenderer) {
      const stretchCamera = stretchRenderer.getActiveCamera();
      const cameraDistance =
        (0.5 * mapperHeight) /
        Math.tan(radiansFromDegrees(0.5 * stretchCamera.getViewAngle()));
      stretchCamera.setParallelScale(0.5 * mapperHeight);
      stretchCamera.setParallelProjection(true);
      const cameraFocalPoint = vec3.create();
      vec3.scaleAndAdd(
        cameraFocalPoint,
        worldWidgetCenter,
        worldNormal,
        distance - 0.5 * mapperHeight
      );
      const cameraPosition = vec3.create();
      vec3.scaleAndAdd(
        cameraPosition,
        cameraFocalPoint,
        worldBitangent,
        -cameraDistance
      );
      stretchCamera.setPosition(cameraPosition[0], cameraPosition[1], cameraPosition[2]);
      stretchCamera.setFocalPoint(cameraFocalPoint[0], cameraFocalPoint[1], cameraFocalPoint[2]);
      stretchCamera.setViewUp(worldNormal[0], worldNormal[1], worldNormal[2]);
      stretchRenderer.resetCameraClippingRange();
    }

    const { renderWindow } = vtkObjects.current;
    if (renderWindow) {
      renderWindow.render();
    }
  }, []);

  // Set centerline from generated data
  const setCenterlineData = useCallback((centerlineData: any) => {
    const { centerline, mapper, cprManipulator, widget, widgetManager } = vtkObjects.current;
    
    if (!centerline || !centerlineData) return;

    // Set positions of the centerline (model coordinates)
    const centerlinePoints = Float32Array.from(centerlineData.position);
    const nPoints = centerlinePoints.length / 3;
    centerline.getPoints().setData(centerlinePoints, 3);

    // Set polylines of the centerline
    const centerlineLines = new Uint16Array(1 + nPoints);
    centerlineLines[0] = nPoints;
    for (let i = 0; i < nPoints; ++i) {
      centerlineLines[i + 1] = i;
    }
    centerline.getLines().setData(centerlineLines);

    // Create a rotated basis data array to oriented the CPR
    centerline.getPointData().setTensors(
      vtkDataArray.newInstance({
        name: "Orientation",
        numberOfComponents: 16,
        values: Float32Array.from(centerlineData.orientation),
      })
    );
    centerline.modified();

    if (mapper && cprManipulator && widget) {
      const midPointDistance = mapper.getHeight() / 2;
      const { worldCoords } = cprManipulator.distanceEvent(midPointDistance);
      const widgetState = widget.getWidgetState();
      widgetState.setCenter(worldCoords);
      updateDistanceAndDirection();

      const stretchPlane = "Y";
      const crossPlane = "Z";
      widgetState[`getAxis${crossPlane}in${stretchPlane}`]().setManipulator(cprManipulator);
      
      const { planeManipulator } = vtkObjects.current;
      if (planeManipulator) {
        widgetState[`getAxis${stretchPlane}in${crossPlane}`]().setManipulator(planeManipulator);
      }
      
      widget.setManipulator(cprManipulator);
    }

    const { renderWindow } = vtkObjects.current;
    if (renderWindow) {
      renderWindow.render();
    }
  }, [updateDistanceAndDirection]);

  // Initialize VTK rendering
  useEffect(() => {
    if (!containerRef.current || isInitialized) return;

    // Create render window
    const genericRenderWindow = vtkGenericRenderWindow.newInstance({
      background: backgroundColor
    });
    
    genericRenderWindow.setContainer(containerRef.current);
    genericRenderWindow.resize();

    const renderWindow = genericRenderWindow.getRenderWindow();
    const stretchRenderer = genericRenderWindow.getRenderer();
    const interactor = renderWindow.getInteractor();
    
    interactor.setInteractorStyle(vtkInteractorStyleImage.newInstance());
    interactor.setDesiredUpdateRate(15.0);

    // Create CPR-specific components
    const stretchPlane = "Y";
    const crossPlane = "Z";
    const widget = vtkResliceCursorWidget.newInstance({
      behavior: widgetBehavior,
    });

    const widgetManager = vtkWidgetManager.newInstance();
    widgetManager.setRenderer(stretchRenderer);
    const stretchViewType = ViewTypes.XZ_PLANE;
    const crossViewType = ViewTypes.XY_PLANE;
    const stretchViewWidgetInstance = widgetManager.addWidget(widget, stretchViewType);

    const widgetState = widget.getWidgetState();
    try {
      widgetState
        .getStatesWithLabel("sphere")
        .forEach((handle: any) => handle.setScale1(20));
      // widgetState.getCenterHandle().setVisible(false); // This method may not exist
      widgetState
        .getStatesWithLabel(`rotationIn${stretchPlane}`)
        .forEach((handle: any) => handle.setVisible(false));
    } catch (error) {
      console.warn('Some widget state methods not available:', error);
    }

    // Create cross renderer
    const crossRenderer = vtkRenderer.newInstance();
    crossRenderer.setViewport(0.7, 0, 1, 0.3);
    renderWindow.addRenderer(crossRenderer);
    renderWindow.setNumberOfLayers(2);
    crossRenderer.setLayer(1);
    const crossWidgetManager = vtkWidgetManager.newInstance();
    crossWidgetManager.setRenderer(crossRenderer);
    const crossViewWidgetInstance = crossWidgetManager.addWidget(widget, crossViewType);

    // Create reslice components
    const reslice = vtkImageReslice.newInstance();
    reslice.setTransformInputSampling(false);
    reslice.setAutoCropOutput(true);
    reslice.setOutputDimensionality(2);
    const resliceMapper = vtkImageMapper.newInstance();
    resliceMapper.setBackgroundColor(0, 0, 0, 0);
    resliceMapper.setInputConnection(reslice.getOutputPort());
    const resliceActor = vtkImageSlice.newInstance();
    resliceActor.setMapper(resliceMapper);

    // Create CPR components
    const centerline = vtkPolyData.newInstance();
    const actor = vtkImageSlice.newInstance();
    const mapper = vtkImageCPRMapper.newInstance();
    // mapper.setBackgroundColor(...backgroundColor, 0); // This method may not exist
    actor.setMapper(mapper as any); // Type assertion needed
    mapper.setInputData(centerline, 1);
    mapper.setWidth(400);

    // Create manipulators
    const cprManipulator = vtkCPRManipulator.newInstance({
      cprActor: actor,
    });
    const planeManipulator = vtkPlaneManipulator.newInstance();

    // Create reader
    const reader = vtkHttpDataSetReader.newInstance({ fetchGzip: true });
    mapper.setInputConnection(reader.getOutputPort(), 0);

    // Store VTK objects
    vtkObjects.current = {
      renderWindow,
      stretchRenderer,
      crossRenderer,
      mapper,
      actor,
      widget,
      widgetManager,
      crossWidgetManager,
      centerline,
      cprManipulator,
      planeManipulator,
      reader,
      reslice,
      resliceMapper,
      resliceActor
    };

    // Set up interaction event handlers
    stretchViewWidgetInstance.onInteractionEvent(updateDistanceAndDirection);
    crossViewWidgetInstance.onInteractionEvent(updateDistanceAndDirection);

    setIsInitialized(true);

    // Cleanup
    return () => {
      if (vtkObjects.current.animationId) {
        clearInterval(vtkObjects.current.animationId);
      }
      genericRenderWindow.delete();
    };
  }, [backgroundColor, updateDistanceAndDirection, isInitialized]);

  // Load volume data
  useEffect(() => {
    if (!isInitialized || !volumeUrl) return;

    const { reader, widget, actor, stretchRenderer, reslice, crossRenderer, resliceActor, mapper } = vtkObjects.current;
    
    if (!reader) return;

    reader.setUrl(volumeUrl).then(() => {
      reader.loadData().then(() => {
        const image = reader.getOutputData();
        
        if (!image) {
          console.error('Failed to load volume data from:', volumeUrl);
          return;
        }
        
        widget.setImage(image);
        const imageDimensions = image.getDimensions();
        const imageSpacing = image.getSpacing();
        
        if (!imageDimensions || !imageSpacing) {
          console.error('Invalid image data - missing dimensions or spacing');
          return;
        }
        const diagonalVec = vec3.create();
        vec3.mul(diagonalVec, imageDimensions as any, imageSpacing as any);
        mapper.setWidth(2 * vec3.len(diagonalVec));

        const stretchViewType = ViewTypes.XZ_PLANE;
        const crossViewType = ViewTypes.XY_PLANE;
        
        actor.setUserMatrix(widget.getResliceAxes(stretchViewType));
        stretchRenderer.addVolume(actor);
        widget.updateCameraPoints(stretchRenderer, stretchViewType, true, true);

        reslice.setInputData(image);
        crossRenderer.addActor(resliceActor);
        widget.updateReslicePlane(reslice, crossViewType);
        resliceActor.setUserMatrix(reslice.getResliceAxes());
        widget.updateCameraPoints(crossRenderer, crossViewType, true, true);
      }).catch((error) => {
        console.error('Error loading volume data:', error);
      });
    }).catch((error) => {
      console.error('Error setting volume URL:', error);
    });
  }, [isInitialized, volumeUrl]);

  // Update centerline when root points change
  useEffect(() => {
    if (!isInitialized || rootPoints.length < 3) return;

    const centerlineData = generateCenterlineFromPoints(rootPoints);
    if (centerlineData) {
      setCenterlineData(centerlineData);
    }
  }, [isInitialized, rootPoints, generateCenterlineFromPoints, setCenterlineData]);

  // Handle CPR mode changes
  useEffect(() => {
    if (!isInitialized) return;

    const { mapper } = vtkObjects.current;
    if (!mapper) return;

    switch (cprMode) {
      case 'stretched':
        mapper.useStretchedMode();
        break;
      default:
        mapper.useStraightenedMode();
        break;
    }
    updateDistanceAndDirection();
  }, [cprMode, isInitialized, updateDistanceAndDirection]);

  // Handle projection mode changes
  useEffect(() => {
    if (!isInitialized) return;

    const { mapper, renderWindow } = vtkObjects.current;
    if (!mapper || !renderWindow) return;

    mapper.setProjectionMode(ProjectionMode[projectionMode]);
    renderWindow.render();
  }, [projectionMode, isInitialized]);

  // Handle angle changes
  const setAngleFromSlider = useCallback((radAngle: number) => {
    if (!isInitialized) return;

    const { mapper, cprManipulator, widget } = vtkObjects.current;
    if (!mapper || !cprManipulator || !widget) return;

    // Compute normal and bitangent directions from angle
    const origin = vec3.fromValues(0, 0, 0);
    const normalDir = vec3.fromValues(0, 0, 1);
    const bitangentDir = vec3.fromValues(0, 1, 0);
    vec3.rotateZ(bitangentDir, bitangentDir, origin, radAngle);

    // Get orientation from distance
    const distance = cprManipulator.getCurrentDistance();
    const { orientation } = mapper.getCenterlinePositionAndOrientation(distance);
    const modelDirections = mat3.create();
    mat3.fromQuat(modelDirections, orientation);

    // Set widget normal and viewUp from orientation and directions
    const worldBitangent = vec3.create();
    const worldNormal = vec3.create();
    vec3.transformMat3(worldBitangent, bitangentDir as any, modelDirections);
    vec3.transformMat3(worldNormal, normalDir as any, modelDirections);
    const widgetState = widget.getWidgetState();
    const widgetPlanes = widgetState.getPlanes();
    const stretchViewType = ViewTypes.XZ_PLANE;
    const crossViewType = ViewTypes.XY_PLANE;
    
    widgetPlanes[stretchViewType].normal = worldBitangent;
    widgetPlanes[stretchViewType].viewUp = worldNormal;
    widgetPlanes[crossViewType].normal = worldNormal;
    widgetPlanes[crossViewType].viewUp = worldBitangent;
    widgetState.setPlanes(widgetPlanes);

    updateDistanceAndDirection();
  }, [isInitialized, updateDistanceAndDirection]);

  // Handle animation
  useEffect(() => {
    if (!isAnimating) {
      if (vtkObjects.current.animationId) {
        clearInterval(vtkObjects.current.animationId);
        vtkObjects.current.animationId = undefined;
      }
      return;
    }

    const animationId = setInterval(() => {
      const currentAngle = radiansFromDegrees(angle);
      setAngleFromSlider(currentAngle + 0.1);
    }, 60) as unknown as number;

    vtkObjects.current.animationId = animationId;

    return () => {
      clearInterval(animationId);
    };
  }, [isAnimating, angle, setAngleFromSlider]);

  return (
    <div className="flex flex-col w-full h-full">
      {/* Controls */}
      <div className="flex items-center gap-4 p-4 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-300">Angle:</label>
          <input
            type="range"
            min="0"
            max="360"
            value={angle}
            onChange={(e) => setAngleFromSlider(radiansFromDegrees(parseFloat(e.target.value)))}
            className="w-32"
          />
          <span className="text-sm text-slate-300 w-12">{angle.toFixed(0)}°</span>
        </div>
        
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-300">Mode:</label>
          <select
            value={cprMode}
            onChange={(e) => {
              // This would need to be passed up to parent component
              console.log('CPR Mode changed to:', e.target.value);
            }}
            className="bg-slate-700 text-white px-2 py-1 rounded text-sm"
          >
            <option value="straightened">Straightened</option>
            <option value="stretched">Stretched</option>
          </select>
        </div>
        
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isAnimating}
            onChange={(e) => setIsAnimating(e.target.checked)}
            className="rounded"
          />
          <label className="text-sm text-slate-300">Animate</label>
        </div>
      </div>

      {/* Viewport */}
      <div 
        ref={containerRef} 
        className="flex-1 w-full bg-black"
        style={{ minHeight: '400px' }}
      />
    </div>
  );
};

export default CPRViewport;