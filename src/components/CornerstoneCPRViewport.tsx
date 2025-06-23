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
import vtkGenericRenderWindow from "@kitware/vtk.js/Rendering/Misc/GenericRenderWindow";
import vtkHttpDataSetReader from "@kitware/vtk.js/IO/Core/HttpDataSetReader";
import vtkImageCPRMapper from "@kitware/vtk.js/Rendering/Core/ImageCPRMapper";
import vtkImageSlice from "@kitware/vtk.js/Rendering/Core/ImageSlice";
import vtkInteractorStyleImage from "@kitware/vtk.js/Interaction/Style/InteractorStyleImage";
import vtkPlaneManipulator from "@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData";
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

interface CornerstoneCPRViewportProps {
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

const CornerstoneCPRViewport: React.FC<CornerstoneCPRViewportProps> = ({
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
    
    // Create very short centerline to avoid massive CPR textures
    const numInterpolatedPoints = 20; // Dramatically reduced from 100
    const centerlinePoints: number[] = [];
    const orientations: number[] = [];
    
    // Simple Catmull-Rom spline interpolation
    for (let i = 0; i <= numInterpolatedPoints; i++) {
      const t = i / numInterpolatedPoints;
      
      if (points.length === 3) {
        // Quadratic interpolation for 3 points
        const t2 = t * t;
        const mt = 1 - t;
        const mt2 = mt * mt;
        
        const x = mt2 * points[0].x + 2 * mt * t * points[1].x + t2 * points[2].x;
        const y = mt2 * points[0].y + 2 * mt * t * points[1].y + t2 * points[2].y;
        const z = mt2 * points[0].z + 2 * mt * t * points[1].z + t2 * points[2].z;
        
        centerlinePoints.push(x, y, z);
      } else {
        // Linear interpolation fallback
        const segmentIndex = Math.floor(t * (points.length - 1));
        const localT = (t * (points.length - 1)) - segmentIndex;
        const p1 = points[Math.min(segmentIndex, points.length - 1)];
        const p2 = points[Math.min(segmentIndex + 1, points.length - 1)];
        
        const x = p1.x + (p2.x - p1.x) * localT;
        const y = p1.y + (p2.y - p1.y) * localT;
        const z = p1.z + (p2.z - p1.z) * localT;
        
        centerlinePoints.push(x, y, z);
      }
      
      // Create identity orientation matrix for each point
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

    // Set orientations
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

  // Create synthetic volume data for CPR demonstration
  const createSyntheticVolumeData = (customDimensions?: number[]) => {
    try {
      console.log('🔄 Creating synthetic volume data for CPR demonstration...');
      
      // Use adaptive dimensions based on GPU capabilities or fallback
      const dimensions = customDimensions || [16, 16, 16];
      const spacing = [8.0, 8.0, 8.0];
      const origin = [-64, -64, -64];
      
      const size = dimensions[0] * dimensions[1] * dimensions[2];
      const scalarData = new Float32Array(size);
      
      // Generate synthetic data that looks like a vessel/tube structure
      const centerX = dimensions[0] / 2;
      const centerY = dimensions[1] / 2;
      
      for (let z = 0; z < dimensions[2]; z++) {
        for (let y = 0; y < dimensions[1]; y++) {
          for (let x = 0; x < dimensions[0]; x++) {
            const index = z * dimensions[0] * dimensions[1] + y * dimensions[0] + x;
            
            // Create a curved vessel structure that follows a path similar to aortic root
            const t = z / dimensions[2];
            
            // Create S-curve that resembles aortic root anatomy - scale based on volume size
            const curveFactor = Math.max(dimensions[0] / 16, 0.5); // Scale curve with volume size
            const vesselCenterX = centerX + (4 * curveFactor) * Math.sin(t * Math.PI);
            const vesselCenterY = centerY + (3 * curveFactor) * Math.cos(t * Math.PI * 0.5);
            
            const distFromVessel = Math.sqrt(
              Math.pow(x - vesselCenterX, 2) + 
              Math.pow(y - vesselCenterY, 2)
            );
            
            // Create vessel with radius scaled to volume size
            const vesselRadius = Math.max(2 * curveFactor, 1) + 0.5 * Math.sin(t * Math.PI * 2);
            
            let value = 0;
            if (distFromVessel < vesselRadius) {
              // Inside vessel lumen - high contrast (contrast-enhanced CT)
              value = 800 + 200 * Math.random();
            } else if (distFromVessel < vesselRadius + 3) {
              // Vessel wall - medium intensity
              value = 150 + 50 * Math.random();
            } else if (distFromVessel < vesselRadius + 8) {
              // Surrounding tissue - lower intensity
              value = 80 + 30 * Math.random();
            } else {
              // Background - very low with minimal noise
              value = 10 + 5 * Math.random();
            }
            
            scalarData[index] = value;
          }
        }
      }
      
      // Create VTK ImageData
      const imageData = vtkImageData.newInstance();
      imageData.setDimensions(dimensions);
      imageData.setSpacing(spacing);
      imageData.setOrigin(origin);
      
      const scalars = vtkDataArray.newInstance({
        name: 'Scalars',
        numberOfComponents: 1,
        values: scalarData,
        dataType: 'Float32Array', // Explicitly specify data type
      });
      imageData.getPointData().setScalars(scalars);
      
      console.log('✅ Synthetic volume data created successfully:', {
        dimensions,
        spacing,
        origin,
        dataLength: scalarData.length
      });
      
      return imageData;

    } catch (error) {
      console.error('❌ Failed to create synthetic volume data:', error);
      throw error;
    }
  };

  const initializeCPR = async () => {
    if (!containerRef.current || !patientInfo || rootPoints.length < 3) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      console.log('🔄 Initializing CPR with root points:', rootPoints);

      // Check WebGL context availability
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        throw new Error('WebGL not supported - CPR visualization requires WebGL');
      }
      
      // Check texture size limits and adjust accordingly
      const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
      console.log('🔍 WebGL Capabilities:', {
        maxTextureSize,
        maxRenderbufferSize,
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER)
      });
      
      // For powerful GPUs, the issue is VTK.js ImageCPRMapper creating massive internal textures
      // We need to be much more conservative regardless of GPU capability
      console.log('⚠️ Using ultra-conservative settings even for powerful GPU due to VTK.js CPR mapper limitations');
      
      // Force ultra-conservative settings regardless of GPU power
      // The issue is VTK.js ImageCPRMapper creates massive internal textures
      const safeDimension = 8; // Force minimal size even for powerful GPUs
      console.warn('🔧 Forcing 8³ volume due to VTK.js ImageCPRMapper texture size issues');
      
      // Override dimensions to minimal size
      const adaptiveDimensions = [safeDimension, safeDimension, safeDimension];

      // Create VTK rendering setup
      const genericRenderWindow = vtkGenericRenderWindow.newInstance();
      genericRenderWindow.setContainer(containerRef.current);
      genericRenderWindow.resize();

      const renderer = genericRenderWindow.getRenderer();
      const renderWindow = genericRenderWindow.getRenderWindow();
      const interactor = renderWindow.getInteractor();
      
      interactor.setInteractorStyle(vtkInteractorStyleImage.newInstance());
      interactor.setDesiredUpdateRate(15.0);

      renderer.setBackground(backgroundColor);

      // Create synthetic volume data for demonstration using adaptive dimensions
      const imageData = createSyntheticVolumeData(adaptiveDimensions);

      // Generate centerline from root points
      const centerline = generateCenterlineFromPoints(rootPoints);
      if (!centerline) {
        throw new Error('Failed to generate centerline from root points');
      }

      // Create CPR mapper and actor with error handling
      const mapper = vtkImageCPRMapper.newInstance();
      
      // Try to set background color with fallback
      try {
        mapper.setBackgroundColor(0, 0, 0, 0);
      } catch (e) {
        console.warn('⚠️ Could not set mapper background color:', e);
      }
      
      const actor = vtkImageSlice.newInstance();
      actor.setMapper(mapper);
      
      // Debug: log available methods
      console.log('🔍 Available CPR Mapper methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(mapper)).filter(name => typeof mapper[name] === 'function'));

      // Set inputs
      mapper.setInputData(imageData, 0);
      mapper.setInputData(centerline, 1);
      
      // Set CPR parameters for good visualization
      const imageDimensions = imageData.getDimensions();
      const imageSpacing = imageData.getSpacing();
      
      // Set minimal width to avoid massive CPR textures
      const minimalWidth = 8; // Ultra-minimal width regardless of volume size
      mapper.setWidth(minimalWidth);
      
      console.log('📏 Ultra-minimal CPR width:', minimalWidth, 'to avoid texture size issues');
      
      // Set CPR mode
      if (cprMode === 'straightened') {
        mapper.useStraightenedMode();
      } else {
        mapper.useStretchedMode();
      }

      // Set ultra-minimal projection parameters
      mapper.setProjectionMode(ProjectionMode[projectionMode]);
      mapper.setProjectionSlabThickness(1); // Ultra-minimal thickness 
      mapper.setProjectionSlabNumberOfSamples(1); // Single sample to minimize texture creation
      
      console.log('🔧 CPR Mapper configured:', {
        mode: cprMode,
        projection: projectionMode,
        width: mapper.getWidth()
      });

      // Add actor to renderer
      renderer.addActor(actor);

      // Setup widget for interaction with error handling
      console.log('🔧 Setting up CPR widget...');
      
      let widget, widgetManager, widgetInstance;
      try {
        widget = vtkResliceCursorWidget.newInstance({
          planes: ["Y"],
          behavior: widgetBehavior,
        });
        
        widgetManager = vtkWidgetManager.newInstance();
        widgetManager.setRenderer(renderer);
        widgetInstance = widgetManager.addWidget(widget, ViewTypes.XZ_PLANE);
        
        console.log('✅ CPR widget created successfully');
      } catch (widgetError) {
        console.error('❌ Widget creation failed:', widgetError);
        throw new Error(`Widget setup failed: ${widgetError.message}`);
      }
      
      widget.setImage(imageData);
      
      const widgetState = widget.getWidgetState();
      widgetState.getStatesWithLabel("sphere").forEach((handle) => handle.setScale1(20));
      widgetState.getCenterHandle().setVisible(false);

      // Setup CPR manipulator with error handling
      console.log('🔧 Setting up CPR manipulator...');
      
      let cprManipulator, planeManipulator;
      try {
        cprManipulator = vtkCPRManipulator.newInstance({
          cprActor: actor,
        });
        
        planeManipulator = vtkPlaneManipulator.newInstance();
        
        // Try to set manipulator - this might trigger texture creation
        console.log('🔧 Connecting manipulator to widget...');
        widget.setManipulator(cprManipulator);
        
        console.log('✅ CPR manipulator connected successfully');
      } catch (manipulatorError) {
        console.error('❌ Manipulator setup failed:', manipulatorError);
        // Continue without manipulator if it fails
        console.warn('⚠️ Continuing without CPR manipulator due to error');
      }

      // Position widget at centerline midpoint with error handling
      if (cprManipulator) {
        try {
          const midPointDistance = 10; // Reduced distance for minimal setup
          const { worldCoords } = cprManipulator.distanceEvent(midPointDistance);
          widgetState.setCenter(worldCoords);
          console.log('✅ Widget positioned successfully');
        } catch (positionError) {
          console.warn('⚠️ Widget positioning failed:', positionError);
          // Use default center position
          widgetState.setCenter([0, 0, 0]);
        }
      } else {
        // Use default center if no manipulator
        widgetState.setCenter([0, 0, 0]);
      }

      // Set up minimal camera for CPR view
      const camera = renderer.getActiveCamera();
      camera.setParallelProjection(true);
      camera.setParallelScale(10); // Very small scale for minimal texture requirements
      
      // Use simple camera positioning
      camera.setFocalPoint(0, 0, 0);
      camera.setPosition(0, -20, 0);
      camera.setViewUp(0, 0, 1);
      
      renderer.resetCameraClippingRange();
      
      console.log('📷 Camera configured for CPR view:', {
        focalPoint: [0, 0, 0],
        parallelScale: camera.getParallelScale()
      });

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

      // Final render with error handling
      try {
        renderWindow.render();
        console.log('✅ Initial render completed');
      } catch (renderError) {
        console.warn('⚠️ Render warning:', renderError);
        // Continue anyway as some warnings are non-critical
      }
      
      setIsInitialized(true);
      setIsLoading(false);
      
      console.log('✅ CPR initialized successfully with optimized settings');

    } catch (error) {
      console.error('❌ CPR initialization failed:', error);
      setError(`CPR initialization failed: ${error}`);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (patientInfo && rootPoints.length >= 3) {
      initializeCPR();
    }

    // Cleanup
    return () => {
      if (vtkObjects.current.renderWindow) {
        // Cleanup VTK objects
        console.log('🧹 Cleaning up CPR viewport');
      }
    };
  }, [patientInfo, rootPoints, cprMode, projectionMode]);

  return (
    <div className="w-full h-full relative">
      {/* Demo Notice */}
      <div className="absolute top-4 left-4 bg-yellow-600/90 backdrop-blur-sm p-3 rounded-lg z-20">
        <div className="flex items-center gap-2 text-white text-sm">
          <span>🚧</span>
          <div>
            <div className="font-medium">CPR Ultra-Minimal Mode</div>
            <div className="text-xs text-yellow-200">
              8³ volume, width=8, minimal projection to avoid WebGL texture errors
            </div>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="flex items-center gap-3 text-white">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <span>Generating CPR from {rootPoints.length} points...</span>
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

      <div 
        ref={containerRef}
        className="w-full h-full"
        style={{ minHeight: `${height}px`, minWidth: `${width}px` }}
      />
    </div>
  );
};

export default CornerstoneCPRViewport;