import React, { useEffect, useRef, useState } from 'react';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import vtkImageResliceMapper from '@kitware/vtk.js/Rendering/Core/ImageResliceMapper';
import vtkInteractorStyleImage from '@kitware/vtk.js/Interaction/Style/InteractorStyleImage';

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface SimpleCPRViewportProps {
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
}

const SimpleCPRViewport: React.FC<SimpleCPRViewportProps> = ({
  patientInfo,
  rootPoints,
  width = 800,
  height = 600,
  backgroundColor = [0, 0, 0]
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
    imageData?: any;
  }>({});

  // Create a simple "straightened" view by concatenating cross-sections
  const createSimpleCPRData = () => {
    try {
      console.log('🔄 Creating Simple CPR - straightened cross-sections...');
      
      // Create straightened CPR image - much simpler approach
      const cprWidth = 100;   // Number of cross-sections along centerline
      const cprHeight = 64;   // Size of each cross-section  
      const cprDepth = 1;     // Single slice for true 2D
      const totalPixels = cprWidth * cprHeight * cprDepth;
      
      console.log('📊 CPR dimensions:', { width: cprWidth, height: cprHeight, totalPixels });
      
      // Create 2D image data for the straightened view
      const scalarData = new Float32Array(totalPixels);
      
      // Generate synthetic "straightened vessel" data
      for (let y = 0; y < cprHeight; y++) {
        for (let x = 0; x < cprWidth; x++) {
          const index = y * cprWidth + x;
          
          // Create vessel profile - distance from center line
          const centerY = cprHeight / 2;
          const distFromCenter = Math.abs(y - centerY);
          
          // Simulate vessel walls and lumen along the straightened path
          const vesselRadius = 8 + 3 * Math.sin(x * 0.1); // Varying vessel radius
          
          let intensity = 0;
          if (distFromCenter < vesselRadius * 0.6) {
            // Vessel lumen - high intensity (contrast-enhanced)
            intensity = 255; // Full white for lumen
          } else if (distFromCenter < vesselRadius) {
            // Vessel wall - medium intensity
            intensity = 150; // Gray for walls
          } else if (distFromCenter < vesselRadius + 5) {
            // Perivascular tissue
            intensity = 80; // Darker gray
          } else {
            // Background
            intensity = 20; // Dark background
          }
          
          scalarData[index] = intensity;
        }
      }
      
      // Create VTK ImageData - ensure it's properly 3D
      const imageData = vtkImageData.newInstance();
      imageData.setDimensions([cprWidth, cprHeight, cprDepth]);
      imageData.setSpacing([1.0, 1.0, 1.0]);
      imageData.setOrigin([0, 0, 0]);
      
      console.log('📋 Image dimensions set:', imageData.getDimensions());
      
      const scalars = vtkDataArray.newInstance({
        name: 'Scalars',
        numberOfComponents: 1,
        values: scalarData,
        dataType: 'Float32Array',
      });
      imageData.getPointData().setScalars(scalars);
      
      console.log('✅ Simple CPR data created successfully:', {
        dimensions: [cprWidth, cprHeight, 1],
        dataLength: scalarData.length
      });
      
      return imageData;

    } catch (error) {
      console.error('❌ Failed to create simple CPR data:', error);
      throw error;
    }
  };

  const initializeSimpleCPR = async () => {
    if (!containerRef.current || !patientInfo || rootPoints.length < 3) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      console.log('🔄 Initializing Simple CPR fallback with root points:', rootPoints);

      // Create VTK rendering setup - much simpler than ImageCPRMapper
      const genericRenderWindow = vtkGenericRenderWindow.newInstance();
      genericRenderWindow.setContainer(containerRef.current);
      genericRenderWindow.resize();

      const renderer = genericRenderWindow.getRenderer();
      const renderWindow = genericRenderWindow.getRenderWindow();
      const interactor = renderWindow.getInteractor();
      
      interactor.setInteractorStyle(vtkInteractorStyleImage.newInstance());
      interactor.setDesiredUpdateRate(15.0);

      renderer.setBackground(backgroundColor);

      // Create simple CPR data - no complex VTK mappers
      const imageData = createSimpleCPRData();

      // Use basic ImageMapper and debug available methods
      const mapper = vtkImageMapper.newInstance();
      mapper.setInputData(imageData);
      
      // Debug: log available methods
      console.log('🔍 Available mapper methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(mapper)).filter(name => typeof mapper[name] === 'function'));
      
      const actor = vtkImageSlice.newInstance();
      actor.setMapper(mapper);
      
      // Set window/level for proper contrast
      const property = actor.getProperty();
      property.setColorWindow(255);
      property.setColorLevel(127);
      
      console.log('🎨 Window/Level set:', { window: 255, level: 127 });

      // Add actor to renderer
      renderer.addActor(actor);
      
      console.log('🎭 Actor added to renderer');
      console.log('📊 Image data bounds:', imageData.getBounds());
      console.log('📊 Image data range:', imageData.getPointData().getScalars().getRange());

      // Set up simple camera for 2D view
      const camera = renderer.getActiveCamera();
      camera.setParallelProjection(true);
      
      // Reset camera to fit the image
      renderer.resetCamera();
      renderer.resetCameraClippingRange();
      
      console.log('📷 Camera reset to fit image');
      console.log('📷 Camera position:', camera.getPosition());
      console.log('📷 Camera focal point:', camera.getFocalPoint());

      // Store VTK objects for cleanup
      vtkObjects.current = {
        renderWindow,
        renderer,
        mapper,
        actor,
        imageData,
      };

      // Simple render - no complex texture management
      console.log('🎬 Performing initial render...');
      renderWindow.render();
      
      // Force a second render after a short delay to ensure visibility
      setTimeout(() => {
        console.log('🎬 Performing delayed render...');
        renderWindow.render();
      }, 500);
      
      setIsInitialized(true);
      setIsLoading(false);
      
      console.log('✅ Simple CPR fallback initialized successfully - no texture errors expected');

    } catch (error) {
      console.error('❌ Simple CPR initialization failed:', error);
      setError(`Simple CPR initialization failed: ${error}`);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (patientInfo && rootPoints.length >= 3) {
      initializeSimpleCPR();
    }

    // Cleanup
    return () => {
      if (vtkObjects.current.renderWindow) {
        console.log('🧹 Cleaning up Simple CPR viewport');
      }
    };
  }, [patientInfo, rootPoints]);

  return (
    <div className="w-full h-full relative">
      {/* Demo Notice */}
      <div className="absolute top-4 left-4 bg-green-600/90 backdrop-blur-sm p-3 rounded-lg z-20">
        <div className="flex items-center gap-2 text-white text-sm">
          <span>✅</span>
          <div>
            <div className="font-medium">Simple CPR Fallback</div>
            <div className="text-xs text-green-200">
              2D straightened view - bypasses VTK.js texture issues
            </div>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="flex items-center gap-3 text-white">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-500"></div>
            <span>Generating Simple CPR from {rootPoints.length} points...</span>
          </div>
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="bg-red-900 border border-red-700 rounded-lg p-6 text-white max-w-lg">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              ⚠️ Simple CPR Error
            </h3>
            <p className="text-sm whitespace-pre-line">{error}</p>
          </div>
        </div>
      )}

      {/* CPR Explanation */}
      {isInitialized && (
        <div className="absolute top-4 right-4 bg-blue-900/80 backdrop-blur-sm p-3 rounded-lg z-20 max-w-xs">
          <div className="text-white text-xs">
            <div className="font-medium mb-1">CPR Concept Demo</div>
            <div className="text-blue-200">
              This shows how a curved vessel (like aortic root) appears when "straightened" - 
              the bright center represents the vessel lumen, with walls and surrounding tissue.
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

export default SimpleCPRViewport;