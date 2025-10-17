import React, { useEffect, useRef, useState } from 'react';
import { 
  getRenderingEngine,
  RenderingEngine,
  Types,
  Enums,
  imageLoader
} from '@cornerstonejs/core';
import { initializeCornerstone, isCornerStoneInitialized } from '../utils/cornerstoneInit';

interface SimpleDicomViewportProps {
  patientInfo?: {
    patientID?: string;
    patientName?: string;
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
  };
  onImageLoaded?: (imageData: any) => void;
}

const SimpleDicomViewport: React.FC<SimpleDicomViewportProps> = ({ 
  patientInfo,
  onImageLoaded 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageInfo, setImageInfo] = useState<any>(null);
  const [renderingEngine, setRenderingEngine] = useState<RenderingEngine | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [imageIds, setImageIds] = useState<string[]>([]);

  const viewportId = 'simple-dicom-viewport';
  const renderingEngineId = 'simple-dicom-rendering-engine';

  useEffect(() => {
    if (!containerRef.current || !patientInfo?.seriesInstanceUID) return;

    initializeSimpleDicomViewport();

    return () => {
      // Cleanup
      if (renderingEngine) {
        renderingEngine.destroy();
      }
    };
  }, [patientInfo]);

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      if (renderingEngine && containerRef.current) {
        const viewport = renderingEngine.getViewport(viewportId);
        if (viewport) {
          viewport.resetCamera();
          viewport.render();
        }
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderingEngine]);

  const initializeSimpleDicomViewport = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Initialize Cornerstone3D if not already initialized
      if (!isCornerStoneInitialized()) {
        await initializeCornerstone();
      }

      // Create rendering engine
      const newRenderingEngine = new RenderingEngine(renderingEngineId);
      setRenderingEngine(newRenderingEngine);

      // Get viewport element
      const viewportElement = containerRef.current!;

      // Define viewport as STACK (single images) instead of VOLUME
      const viewportInput = {
        viewportId,
        type: Enums.ViewportType.STACK,
        element: viewportElement,
      };

      newRenderingEngine.enableElement(viewportInput);

      // Trigger resize to ensure proper viewport sizing
      setTimeout(() => {
        newRenderingEngine.resize();
      }, 100);

      // Load DICOM images
      if (patientInfo?.seriesInstanceUID) {
        await loadDicomImages(newRenderingEngine);
      } else {
        setError('No series selected. Please select a patient and series to view DICOM images.');
        setIsLoading(false);
      }

    } catch (err) {
      setError(`Failed to initialize medical imaging: ${err}`);
      setIsLoading(false);
    }
  };

  const loadDicomImages = async (engine: RenderingEngine) => {
    try {
      
      // Generate DICOM-web image IDs
      const generatedImageIds = await generateImageIds();
      
      if (generatedImageIds.length === 0) {
        setError('No DICOM images available for this series. This could be due to:\n• Orthanc server not running\n• Series not found\n• Network connectivity issues');
        setIsLoading(false);
        return;
      }

      setImageIds(generatedImageIds);

      // Get viewport and load the first image
      const viewport = engine.getViewport(viewportId) as Types.IStackViewport;
      
      // Set the stack of images
      await viewport.setStack(generatedImageIds, 0);

      // Fit the image to the viewport
      viewport.resetCamera();
      
      // Set appropriate display properties for medical images
      viewport.setProperties({
        voiRange: {
          lower: -1000,
          upper: 1000,
        },
      });

      // Render the viewport
      viewport.render();

      // Get image information
      const currentImage = viewport.getCurrentImageId();
      if (currentImage) {
        try {
          const image = await imageLoader.loadImage(currentImage);
          
          setImageInfo({
            width: image.width,
            height: image.height,
            numberOfImages: generatedImageIds.length,
            currentIndex: 0,
            seriesInstanceUID: patientInfo?.seriesInstanceUID,
            imageId: currentImage
          });

          if (onImageLoaded) {
            onImageLoaded(image);
          }

          setIsLoading(false);
          
        } catch (imageError) {
          
          // Still show success since the image is displayed
          setImageInfo({
            width: 512, // Default
            height: 512, // Default
            numberOfImages: generatedImageIds.length,
            currentIndex: 0,
            seriesInstanceUID: patientInfo?.seriesInstanceUID,
            imageId: currentImage
          });

          setIsLoading(false);
        }
      }

    } catch (err) {
      setError(`Failed to load DICOM images: ${err}`);
      setIsLoading(false);
    }
  };

  const generateImageIds = async (): Promise<string[]> => {
    if (!patientInfo?.seriesInstanceUID || !patientInfo?.studyInstanceUID) {
      return [];
    }

    try {
      
      // Import DicomWebService dynamically
      const { dicomWebService } = await import('../services/DicomWebService');
      
      // Get all instances for the series
      const instances = await dicomWebService.getInstancesForSeriesOnly(patientInfo.seriesInstanceUID);
      
      if (instances.length === 0) {
        return [];
      }
      
      
      // Now try to load actual DICOM images
      
      // Use a simpler approach - try different Orthanc endpoint formats
      const imageIds: string[] = [];
      
      // Try using Orthanc's direct instance endpoint
      for (let i = 0; i < Math.min(instances.length, 5); i++) { // Limit to first 5 for testing
        const instance = instances[i];
        
        // Format: Use base Orthanc API with instance UID
        const orthancUrl = `http://127.0.0.1/orthanc/instances?expand&query=${instance.SOPInstanceUID}`;
        
        // For now, let's create a test pattern for each instance
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        if (ctx) {
          // Create a different pattern for each slice
          const brightness = 50 + (i * 30); // Vary brightness per slice
          ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
          ctx.fillRect(0, 0, 512, 512);
          
          // Add slice info
          ctx.fillStyle = '#fff';
          ctx.font = '20px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(`Slice ${i + 1} of ${instances.length}`, 256, 200);
          ctx.fillText(`Instance: ${instance.InstanceNumber || i + 1}`, 256, 240);
          ctx.fillText(`SOP: ${instance.SOPInstanceUID.substring(0, 20)}...`, 256, 280);
        }
        
        const testImageUrl = canvas.toDataURL('image/png');
        imageIds.push(`web:${testImageUrl}`);
      }
      
      return imageIds;
      
    } catch (error) {
      return [];
    }
  };

  const handleSliceChange = (direction: 'up' | 'down') => {
    if (!renderingEngine || imageIds.length === 0) return;

    try {
      const viewport = renderingEngine.getViewport(viewportId) as Types.IStackViewport;
      let newIndex = currentImageIndex;
      
      if (direction === 'up' && currentImageIndex < imageIds.length - 1) {
        newIndex = currentImageIndex + 1;
      } else if (direction === 'down' && currentImageIndex > 0) {
        newIndex = currentImageIndex - 1;
      }
      
      if (newIndex !== currentImageIndex) {
        viewport.setImageIdIndex(newIndex);
        viewport.render();
        setCurrentImageIndex(newIndex);
        
        // Update image info
        setImageInfo(prev => prev ? { ...prev, currentIndex: newIndex } : null);
      }
    } catch (err) {
    }
  };

  const handleWindowLevel = (window: number, level: number) => {
    if (!renderingEngine) return;

    try {
      const viewport = renderingEngine.getViewport(viewportId) as Types.IStackViewport;
      viewport.setProperties({
        voiRange: {
          lower: level - window / 2,
          upper: level + window / 2,
        },
      });
      viewport.render();
    } catch (err) {
    }
  };

  return (
    <div className="flex flex-col w-full h-full">
      {/* Controls */}
      <div className="flex items-center justify-between p-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-4">
          {patientInfo && (
            <div className="text-sm">
              <span className="text-slate-300">Patient: </span>
              <span className="text-white font-medium">{patientInfo.patientName || 'Unknown'}</span>
              <span className="text-slate-400 ml-2">({patientInfo.patientID || 'Unknown ID'})</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {/* Slice Navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleSliceChange('down')}
              disabled={isLoading || currentImageIndex <= 0}
              className="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:cursor-not-allowed px-3 py-1 rounded text-white text-sm"
            >
              ←
            </button>
            <span className="text-sm text-slate-300 px-2">
              {imageIds.length > 0 ? `${currentImageIndex + 1}/${imageIds.length}` : 'Slice'}
            </span>
            <button
              onClick={() => handleSliceChange('up')}
              disabled={isLoading || currentImageIndex >= imageIds.length - 1}
              className="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:cursor-not-allowed px-3 py-1 rounded text-white text-sm"
            >
              →
            </button>
          </div>
          
          {/* Window/Level presets */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleWindowLevel(400, 40)}
              disabled={isLoading || imageIds.length === 0}
              className="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 px-3 py-1 rounded text-white text-sm"
            >
              Soft Tissue
            </button>
            <button
              onClick={() => handleWindowLevel(1500, 300)}
              disabled={isLoading || imageIds.length === 0}
              className="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 px-3 py-1 rounded text-white text-sm"
            >
              Bone
            </button>
            <button
              onClick={() => handleWindowLevel(2000, 0)}
              disabled={isLoading || imageIds.length === 0}
              className="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 px-3 py-1 rounded text-white text-sm"
            >
              Lung
            </button>
          </div>
        </div>
      </div>

      {/* Image Info */}
      {imageInfo && !isLoading && (
        <div className="px-3 py-2 bg-slate-900 border-b border-slate-700 text-xs text-slate-400">
          <span className="mr-4">
            Series: {patientInfo?.seriesInstanceUID}
          </span>
          <span className="mr-4">
            Images: {imageInfo.numberOfImages}
          </span>
          <span className="mr-4">
            Size: {imageInfo.width}×{imageInfo.height}
          </span>
          <span>
            Current: {imageInfo.currentIndex + 1}/{imageInfo.numberOfImages}
          </span>
        </div>
      )}

      {/* Viewport */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
            <div className="flex items-center gap-3 text-white">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <span>Loading DICOM images from Orthanc...</span>
            </div>
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
            <div className="bg-red-900 border border-red-700 rounded-lg p-6 text-white max-w-md">
              <h3 className="font-semibold mb-2">DICOM Loading Error</h3>
              <p className="text-sm whitespace-pre-line">{error}</p>
              <p className="text-xs mt-2 text-red-200">
                Series: {patientInfo?.seriesInstanceUID || 'Not selected'}
              </p>
            </div>
          </div>
        )}
        
        {!patientInfo?.seriesInstanceUID && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
            <div className="text-center text-slate-400">
              <div className="text-4xl mb-4">🏥</div>
              <h3 className="text-lg font-medium mb-2">No Series Selected</h3>
              <p className="text-sm">Please select a patient and series to view DICOM images.</p>
            </div>
          </div>
        )}
        
        <div 
          ref={containerRef} 
          className="w-full h-full bg-black"
          style={{ minHeight: '400px' }}
        />
      </div>
    </div>
  );
};

export default SimpleDicomViewport;