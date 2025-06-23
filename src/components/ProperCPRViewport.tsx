import React, { useEffect, useRef, useState } from 'react';
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
import vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData";
import vtkGenericRenderWindow from "@kitware/vtk.js/Rendering/Misc/GenericRenderWindow";
import vtkHttpDataSetReader from "@kitware/vtk.js/IO/Core/HttpDataSetReader";
import vtkImageCPRMapper from "@kitware/vtk.js/Rendering/Core/ImageCPRMapper";
import vtkImageSlice from "@kitware/vtk.js/Rendering/Core/ImageSlice";
import vtkInteractorStyleImage from "@kitware/vtk.js/Interaction/Style/InteractorStyleImage";
import vtkPlaneManipulator from "@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import vtkResliceCursorWidget from "@kitware/vtk.js/Widgets/Widgets3D/ResliceCursorWidget";
import vtkWidgetManager from "@kitware/vtk.js/Widgets/Core/WidgetManager";
import widgetBehavior from "@kitware/vtk.js/Widgets/Widgets3D/ResliceCursorWidget/cprBehavior";

import createImageIdsAndCacheMetaData from '../lib/createImageIdsAndCacheMetaData';
import {
  RenderingEngine,
  Enums as CornerstoneEnums,
  volumeLoader,
  cornerstoneStreamingImageVolumeLoader,
  cache,
} from "@cornerstonejs/core";

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface ProperCPRViewportProps {
  patientInfo?: {
    patientID?: string;
    patientName?: string;
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
  };
  rootPoints: Point3D[];
  width?: number;
  height?: number;
  backgroundColor?: [number, number, number];
  projectionMode?: keyof typeof ProjectionMode;
  cprMode?: 'stretched' | 'straightened';
}

// Register volume loader
volumeLoader.registerUnknownVolumeLoader(cornerstoneStreamingImageVolumeLoader);

const ProperCPRViewport: React.FC<ProperCPRViewportProps> = ({
  patientInfo,
  rootPoints,
  width = 800,
  height = 600,
  backgroundColor = [0, 0, 0],
  projectionMode = 'AVERAGE',
  cprMode = 'straightened'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [angle, setAngle] = useState(0);
  
  // VTK objects refs
  const vtkObjects = useRef<{
    renderWindow?: any;
    renderer?: any;
    mapper?: any;
    actor?: any;
    widget?: any;
    widgetManager?: any;
    centerline?: any;
    cprManipulator?: any;
    planeManipulator?: any;
    imageData?: any;
  }>({});

  // Generate centerline from root points using spline interpolation
  const generateCenterlineFromPoints = (points: Point3D[]) => {
    if (points.length < 3) return null;

    const centerline = vtkPolyData.newInstance();
    
    // Create smooth centerline with many interpolated points (like the example)
    const numInterpolatedPoints = 50; // Reasonable number for real data
    const centerlinePoints: number[] = [];
    const orientations: number[] = [];
    
    // Quadratic interpolation for 3 points (similar to ImageCPRMapper.js approach)
    for (let i = 0; i <= numInterpolatedPoints; i++) {
      const t = i / numInterpolatedPoints;
      
      // Quadratic interpolation for 3 points
      const t2 = t * t;
      const mt = 1 - t;
      const mt2 = mt * mt;
      
      const x = mt2 * points[0].x + 2 * mt * t * points[1].x + t2 * points[2].x;
      const y = mt2 * points[0].y + 2 * mt * t * points[1].y + t2 * points[2].y;
      const z = mt2 * points[0].z + 2 * mt * t * points[1].z + t2 * points[2].z;
      
      centerlinePoints.push(x, y, z);
      
      // Create identity orientation matrix for each point (like the example)
      const identity = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ];
      orientations.push(...identity);
    }

    // Set points
    const points3D = Float32Array.from(centerlinePoints);
    const nPoints = points3D.length / 3;
    centerline.getPoints().setData(points3D, 3);

    // Set lines
    const lines = new Uint16Array(1 + nPoints);
    lines[0] = nPoints;
    for (let i = 0; i < nPoints; i++) {
      lines[i + 1] = i;
    }
    centerline.getLines().setData(lines);

    // Set orientations (like ImageCPRMapper.js example)
    centerline.getPointData().setTensors(
      vtkDataArray.newInstance({
        name: "Orientation",
        numberOfComponents: 16,
        values: Float32Array.from(orientations),
      })
    );

    centerline.modified();
    return centerline;
  };

  // Load real DICOM data from your Orthanc server
  const loadDicomData = async () => {
    try {
      console.log('🔄 Loading real DICOM data from Orthanc server...');
      
      // Use your real DICOM server and patient data
      const imageIds = await createImageIdsAndCacheMetaData({
        StudyInstanceUID: patientInfo!.studyInstanceUID!,
        SeriesInstanceUID: patientInfo!.seriesInstanceUID!,
        wadoRsRoot: "http://192.168.2.52/orthanc/dicom-web",
      });

      if (imageIds.length === 0) {
        throw new Error('No DICOM images found for this series');
      }

      console.log(`📋 Found ${imageIds.length} DICOM images`);

      // Create volume from real DICOM data (like Cornerstone3D workflow)
      const volumeId = `cprVolume_${Date.now()}`;
      const volume = await volumeLoader.createAndCacheVolume(volumeId, {
        imageIds,
      });
      
      // Load the volume
      await volume.load();
      
      console.log('✅ Real DICOM volume loaded successfully');
      console.log('📊 Volume info:', {
        dimensions: volume.dimensions,
        spacing: volume.spacing,
        origin: volume.origin
      });

      return volume;

    } catch (error) {
      console.error('❌ Failed to load DICOM data:', error);
      throw error;
    }
  };

  // Convert Cornerstone3D volume to VTK ImageData
  const cornerstoneToVTKImageData = async (volume: any) => {
    try {
      console.log('🔄 Converting Cornerstone3D volume to VTK ImageData...');
      
      // Debug: Check what properties/methods the volume has
      console.log('🔍 Volume properties:', Object.keys(volume));
      console.log('🔍 Volume methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(volume)).filter(name => typeof volume[name] === 'function'));
      
      // Try different approaches to get VTK ImageData
      let imageData = null;
      
      // Method 1: Check if volume has vtkImageData property
      if (volume.vtkImageData) {
        imageData = volume.vtkImageData;
        console.log('✅ Found vtkImageData property');
      }
      // Method 2: Check if volume has imageData property
      else if (volume.imageData) {
        imageData = volume.imageData;
        console.log('✅ Found imageData property');
      }
      // Method 3: Check if volume has scalarData and we need to create VTK ImageData
      else if (volume.scalarData && volume.dimensions) {
        console.log('🔄 Creating VTK ImageData from volume scalarData...');
        
        // Create VTK ImageData manually
        imageData = vtkImageData.newInstance();
        imageData.setDimensions(volume.dimensions);
        imageData.setSpacing(volume.spacing);
        imageData.setOrigin(volume.origin);
        
        // Create scalar array
        const scalars = vtkDataArray.newInstance({
          name: 'Scalars',
          numberOfComponents: 1,
          values: volume.scalarData,
        });
        imageData.getPointData().setScalars(scalars);
        
        console.log('✅ VTK ImageData created from scalarData');
      }
      // Method 4: Check if it's already VTK ImageData
      else if (volume.getDimensions && typeof volume.getDimensions === 'function') {
        imageData = volume;
        console.log('✅ Volume is already VTK ImageData');
      }
      else {
        throw new Error('Could not find or create VTK ImageData from Cornerstone volume');
      }
      
      if (!imageData) {
        throw new Error('ImageData is null after all conversion attempts');
      }
      
      console.log('✅ VTK ImageData ready:', {
        dimensions: imageData.getDimensions(),
        spacing: imageData.getSpacing(),
        origin: imageData.getOrigin(),
        bounds: imageData.getBounds()
      });
      
      return imageData;
      
    } catch (error) {
      console.error('❌ Failed to convert volume to VTK:', error);
      throw error;
    }
  };

  // Update distance and direction function (from ImageCPRMapper.js example)
  const updateDistanceAndDirection = () => {
    const { widget, mapper, cprManipulator, renderer } = vtkObjects.current;
    
    if (!widget || !mapper || !cprManipulator) {
      console.warn('⚠️ updateDistanceAndDirection: Missing required objects');
      return;
    }

    const stretchPlane = "Y";
    const crossPlane = "Z";
    const stretchViewType = ViewTypes.XZ_PLANE;
    const crossViewType = ViewTypes.XY_PLANE;
    
    const widgetState = widget.getWidgetState();
    
    // Check if widget state is properly initialized
    const widgetPlanes = widgetState.getPlanes();
    if (!widgetPlanes || !widgetPlanes[stretchViewType] || !widgetPlanes[stretchViewType].normal) {
      console.warn('⚠️ Widget planes not properly initialized yet, skipping update');
      return;
    }
    
    // Directions and position in world space from the widget (from example)
    const worldBitangent = widgetPlanes[stretchViewType].normal;
    const worldNormal = widgetPlanes[stretchViewType].viewUp;
    
    if (!worldBitangent || !worldNormal) {
      console.warn('⚠️ Widget directions not available yet, skipping update');
      return;
    }
    
    widgetPlanes[crossViewType].normal = worldNormal;
    widgetPlanes[crossViewType].viewUp = worldBitangent;
    const worldTangent = vec3.cross([], worldBitangent, worldNormal);
    vec3.normalize(worldTangent, worldTangent);
    const worldWidgetCenter = widgetState.getCenter();
    const distance = cprManipulator.getCurrentDistance();

    // CPR mapper tangent and bitangent directions update (from example)
    const { orientation } = mapper.getCenterlinePositionAndOrientation(distance);
    const modelDirections = mat3.fromQuat([], orientation);
    const inverseModelDirections = mat3.invert([], modelDirections);
    const worldDirections = mat3.fromValues(
      ...worldTangent,
      ...worldBitangent,
      ...worldNormal
    );
    const baseDirections = mat3.mul([], inverseModelDirections, worldDirections);
    mapper.setDirectionMatrix(baseDirections);

    // Find the angle (from example)
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

    // CPR actor matrix update (from example)
    const { actor } = vtkObjects.current;
    if (actor) {
      const worldActorTranslation = vec3.scaleAndAdd(
        [],
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
      const worldActorTransform = mat4.fromValues(
        ...worldTangent,
        0,
        ...worldNormal,
        0,
        ...vec3.scale([], worldBitangent, -1),
        0,
        ...worldActorTranslation,
        1
      );
      actor.setUserMatrix(worldActorTransform);
    }

    // CPR camera reset (from example)
    if (renderer) {
      const stretchCamera = renderer.getActiveCamera();
      const cameraDistance =
        (0.5 * mapperHeight) /
        Math.tan(radiansFromDegrees(0.5 * stretchCamera.getViewAngle()));
      stretchCamera.setParallelScale(0.5 * mapperHeight);
      stretchCamera.setParallelProjection(true);
      const cameraFocalPoint = vec3.scaleAndAdd(
        [],
        worldWidgetCenter,
        worldNormal,
        distance - 0.5 * mapperHeight
      );
      const cameraPosition = vec3.scaleAndAdd(
        [],
        cameraFocalPoint,
        worldBitangent,
        -cameraDistance
      );
      stretchCamera.setPosition(...cameraPosition);
      stretchCamera.setFocalPoint(...cameraFocalPoint);
      stretchCamera.setViewUp(...worldNormal);
      renderer.resetCameraClippingRange();
    }

    const { renderWindow } = vtkObjects.current;
    if (renderWindow) {
      renderWindow.render();
    }
  };

  const initializeProperCPR = async () => {
    if (!containerRef.current || !patientInfo || rootPoints.length < 3) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      console.log('🔄 Initializing Proper CPR with real DICOM data...');
      console.log('🎯 Root points:', rootPoints);

      // Load real DICOM data from your server
      const volume = await loadDicomData();
      const imageData = await cornerstoneToVTKImageData(volume);

      // Generate centerline from root points
      const centerline = generateCenterlineFromPoints(rootPoints);
      if (!centerline) {
        throw new Error('Failed to generate centerline from root points');
      }

      // Create VTK rendering setup (following ImageCPRMapper.js example)
      const genericRenderWindow = vtkGenericRenderWindow.newInstance();
      genericRenderWindow.setContainer(containerRef.current);
      genericRenderWindow.resize();

      const renderer = genericRenderWindow.getRenderer();
      const renderWindow = genericRenderWindow.getRenderWindow();
      const interactor = renderWindow.getInteractor();
      
      interactor.setInteractorStyle(vtkInteractorStyleImage.newInstance());
      interactor.setDesiredUpdateRate(15.0);

      renderer.setBackground(backgroundColor);

      // Create CPR mapper and actor (like ImageCPRMapper.js example)
      const mapper = vtkImageCPRMapper.newInstance();
      mapper.setBackgroundColor(0, 0, 0, 0);
      const actor = vtkImageSlice.newInstance();
      actor.setMapper(mapper);

      // Set inputs (like the example)
      mapper.setInputData(imageData, 0);
      mapper.setInputData(centerline, 1);
      
      // Set CPR parameters based on image dimensions (like the example)
      const imageDimensions = imageData.getDimensions();
      const imageSpacing = imageData.getSpacing();
      const diagonal = vec3.mul([], imageDimensions, imageSpacing);
      mapper.setWidth(2 * vec3.len(diagonal)); // Like the example

      // Set CPR mode
      if (cprMode === 'straightened') {
        mapper.useStraightenedMode();
      } else {
        mapper.useStretchedMode();
      }

      // Set projection mode and parameters
      mapper.setProjectionMode(ProjectionMode[projectionMode]);
      mapper.setProjectionSlabThickness(0.1);
      mapper.setProjectionSlabNumberOfSamples(10);
      
      console.log('🔧 CPR Mapper configured with real DICOM data:', {
        mode: cprMode,
        projection: projectionMode,
        width: mapper.getWidth(),
        imageDimensions,
        imageSpacing
      });

      // Add actor to renderer
      renderer.addActor(actor);

      // Setup widget for interaction (like the example)
      const widget = vtkResliceCursorWidget.newInstance({
        planes: ["Y"],
        behavior: widgetBehavior,
      });
      
      const widgetManager = vtkWidgetManager.newInstance();
      widgetManager.setRenderer(renderer);
      const widgetInstance = widgetManager.addWidget(widget, ViewTypes.XZ_PLANE);
      
      widget.setImage(imageData);
      
      const widgetState = widget.getWidgetState();
      widgetState.getStatesWithLabel("sphere").forEach((handle) => handle.setScale1(20));
      widgetState.getCenterHandle().setVisible(false);

      // Setup CPR manipulator (like the example)
      console.log('🔧 Setting up CPR manipulator...');
      const cprManipulator = vtkCPRManipulator.newInstance({
        cprActor: actor,
      });
      
      const planeManipulator = vtkPlaneManipulator.newInstance();
      
      try {
        widget.setManipulator(cprManipulator);
        console.log('✅ CPR manipulator set successfully');
      } catch (error) {
        console.warn('⚠️ Failed to set CPR manipulator:', error);
      }

      // Position widget at centerline midpoint (like the example)
      try {
        const midPointDistance = mapper.getHeight() / 2;
        console.log('🎯 Positioning widget at midpoint distance:', midPointDistance);
        const { worldCoords } = cprManipulator.distanceEvent(midPointDistance);
        widgetState.setCenter(worldCoords);
        console.log('✅ Widget positioned at:', worldCoords);
      } catch (error) {
        console.warn('⚠️ Failed to position widget:', error);
        // Set a default center
        widgetState.setCenter([0, 0, 0]);
      }

      // Set up interaction events (like the example)
      widgetInstance.onInteractionEvent(updateDistanceAndDirection);

      // Delay initial update to allow widget state to initialize
      setTimeout(() => {
        console.log('🔄 Performing delayed updateDistanceAndDirection...');
        updateDistanceAndDirection();
      }, 1000);

      // Store VTK objects for cleanup
      vtkObjects.current = {
        renderWindow,
        renderer,
        mapper,
        actor,
        widget,
        widgetManager,
        centerline,
        cprManipulator,
        planeManipulator,
        imageData,
      };

      renderWindow.render();
      
      setIsInitialized(true);
      setIsLoading(false);
      
      console.log('✅ Proper CPR initialized successfully with real DICOM data');

    } catch (error) {
      console.error('❌ Proper CPR initialization failed:', error);
      setError(`CPR initialization failed: ${error}`);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (patientInfo && rootPoints.length >= 3) {
      initializeProperCPR();
    }

    // Cleanup
    return () => {
      if (vtkObjects.current.renderWindow) {
        console.log('🧹 Cleaning up Proper CPR viewport');
      }
    };
  }, [patientInfo, rootPoints, cprMode, projectionMode]);

  return (
    <div className="w-full h-full relative">
      {/* Demo Notice */}
      <div className="absolute top-4 left-4 bg-blue-600/90 backdrop-blur-sm p-3 rounded-lg z-20">
        <div className="flex items-center gap-2 text-white text-sm">
          <span>🔬</span>
          <div>
            <div className="font-medium">Proper CPR with Real DICOM</div>
            <div className="text-xs text-blue-200">
              VTK.js ImageCPRMapper + Cornerstone3D + your centerline
            </div>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="flex items-center gap-3 text-white">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <span>Loading real DICOM data and generating CPR...</span>
          </div>
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="bg-red-900 border border-red-700 rounded-lg p-6 text-white max-w-lg">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              ⚠️ CPR Error
            </h3>
            <p className="text-sm whitespace-pre-line">{error}</p>
          </div>
        </div>
      )}

      {/* CPR Controls */}
      {isInitialized && (
        <div className="absolute top-4 right-4 bg-slate-800/90 backdrop-blur-sm p-3 rounded-lg z-20">
          <div className="text-white text-xs space-y-2">
            <div className="font-medium">CPR Controls</div>
            <div className="flex items-center gap-2">
              <label>Angle:</label>
              <span className="font-mono">{angle.toFixed(0)}°</span>
            </div>
            <div className="text-slate-300">
              Drag widget to navigate CPR
            </div>
          </div>
        </div>
      )}

      <div 
        ref={containerRef}
        className="w-full h-full"
        style={{ minHeight: `${height}px`, minWidth: `${width}px` }}
      />
    </div>
  );
};

export default ProperCPRViewport;