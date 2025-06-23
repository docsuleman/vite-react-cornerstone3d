import React, { useEffect, useRef, useState } from 'react';
import { 
  getRenderingEngine,
  RenderingEngine,
  Types,
  Enums,
  setVolumesForViewports,
  volumeLoader,
  cache,
  utilities
} from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import { initializeCornerstone, isCornerStoneInitialized } from '../utils/cornerstoneInit';

interface DicomMPRViewportProps {
  patientInfo?: {
    patientID?: string;
    patientName?: string;
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
  };
  onImageLoaded?: (imageData: any) => void;
}

const DicomMPRViewport: React.FC<DicomMPRViewportProps> = ({ 
  patientInfo,
  onImageLoaded 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageInfo, setImageInfo] = useState<any>(null);
  const [renderingEngine, setRenderingEngine] = useState<RenderingEngine | null>(null);

  const viewportId = 'dicom-viewport';
  const renderingEngineId = 'dicom-rendering-engine';

  useEffect(() => {
    if (!containerRef.current || !patientInfo?.seriesInstanceUID) return;

    initializeCornerstoneViewport();

    return () => {
      // Cleanup
      if (renderingEngine) {
        renderingEngine.destroy();
      }
    };
  }, [patientInfo]);

  const initializeCornerstoneViewport = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Initialize Cornerstone3D if not already initialized
      if (!isCornerStoneInitialized()) {
        console.log('🔄 Initializing Cornerstone3D...');
        await initializeCornerstone();
      }

      // Create rendering engine
      const newRenderingEngine = new RenderingEngine(renderingEngineId);
      setRenderingEngine(newRenderingEngine);

      // Get viewport element
      const viewportElement = containerRef.current!;

      // Define viewport
      const viewportInput = {
        viewportId,
        type: Enums.ViewportType.ORTHOGRAPHIC,
        element: viewportElement,
      };

      newRenderingEngine.enableElement(viewportInput);

      // Load DICOM series
      if (patientInfo?.seriesInstanceUID) {
        await loadDicomSeries(newRenderingEngine);
      } else {
        // Show placeholder message
        setError('No series selected. Please select a patient and series to view DICOM images.');
        setIsLoading(false);
      }

    } catch (err) {
      console.error('Failed to initialize Cornerstone:', err);
      setError(`Failed to initialize medical imaging: ${err}`);
      setIsLoading(false);
    }
  };

  const loadDicomSeries = async (engine: RenderingEngine) => {
    try {
      // Create volume ID
      const volumeId = `dicomVolume:${patientInfo?.seriesInstanceUID}`;
      
      // For now, use a fallback approach since we need to integrate with DICOM-web properly
      // This would normally load from the Orthanc DICOM-web server
      const imageIds = await generateImageIds();
      
      if (imageIds.length === 0) {
        // Don't throw error, just show message that no images are available
        setError('No DICOM images available for this series. This could be due to:\n• Orthanc server not running\n• Series not found\n• Network connectivity issues');
        setIsLoading(false);
        return;
      }

      // Try to actually load DICOM volume if images are available
      console.log('🔄 Attempting to load DICOM volume with', imageIds.length, 'images');
      
      try {
        // Define volume
        const volume = await volumeLoader.createAndCacheVolume(volumeId, {
          imageIds,
        });

        // Set volume for viewport
        const viewport = engine.getViewport(viewportId);
        
        await setVolumesForViewports(
          engine,
          [{ volumeId }],
          [viewportId]
        );

        // Get actual image information from loaded volume
        const imageData = volume.imageData;
        if (imageData) {
          const dimensions = imageData.getDimensions();
          const spacing = imageData.getSpacing();
          const origin = imageData.getOrigin();

          setImageInfo({
            dimensions,
            spacing,
            origin,
            numberOfImages: imageIds.length,
            volumeId,
            seriesInstanceUID: patientInfo?.seriesInstanceUID
          });

          if (onImageLoaded) {
            onImageLoaded(imageData);
          }

          console.log('✅ DICOM volume loaded successfully!');
          viewport.render();
          setIsLoading(false);
        } else {
          throw new Error('Volume loaded but no image data available');
        }
        
      } catch (volumeError) {
        console.warn('Failed to load DICOM volume:', volumeError);
        
        // Fallback to mock data with informative message
        setImageInfo({
          dimensions: [512, 512, imageIds.length || 100],
          spacing: [1, 1, 1],
          origin: [0, 0, 0],
          numberOfImages: imageIds.length,
          volumeId,
          seriesInstanceUID: patientInfo?.seriesInstanceUID
        });

        setError(`⚠️ DICOM images found but failed to load:\n\n${volumeError}\n\nThis could be due to:\n• Network connectivity to Orthanc server\n• CORS configuration\n• DICOM image format compatibility`);
        setIsLoading(false);

        if (onImageLoaded) {
          onImageLoaded({ message: 'Found DICOM data but failed to load volume', error: volumeError });
        }
      }

    } catch (err) {
      console.error('Failed to load DICOM series:', err);
      setError(`Failed to load medical images: ${err}`);
      setIsLoading(false);
    }
  };

  const generateImageIds = async (): Promise<string[]> => {
    if (!patientInfo?.seriesInstanceUID || !patientInfo?.studyInstanceUID) {
      return [];
    }

    try {
      console.log('🔍 Fetching instances for series:', patientInfo.seriesInstanceUID);
      
      // Import DicomWebService dynamically to avoid circular dependencies
      const { dicomWebService } = await import('../services/DicomWebService');
      
      // Get all instances for the series
      const instances = await dicomWebService.getInstancesForSeriesOnly(patientInfo.seriesInstanceUID);
      
      if (instances.length === 0) {
        console.warn('No instances found for series:', patientInfo.seriesInstanceUID);
        return [];
      }
      
      console.log(`📋 Found ${instances.length} instances in series`);
      
      // Generate DICOM-web URLs for each instance
      const baseUrl = 'http://192.168.2.52/orthanc/dicom-web';
      const studyUID = patientInfo.studyInstanceUID;
      const seriesUID = patientInfo.seriesInstanceUID;
      
      const imageIds = instances.map(instance => {
        // Format: dicomweb:<WADO-RS URL>
        return `dicomweb:${baseUrl}/studies/${studyUID}/series/${seriesUID}/instances/${instance.SOPInstanceUID}/frames/1`;
      });
      
      console.log('✅ Generated image IDs:', imageIds.length);
      return imageIds;
      
    } catch (error) {
      console.error('Failed to generate image IDs:', error);
      // Return empty array instead of throwing to show proper error message
      return [];
    }
  };

  const handleSliceChange = (direction: 'up' | 'down') => {
    if (!renderingEngine) return;

    try {
      const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
      const camera = viewport.getCamera();
      
      // Simple slice navigation - would need proper implementation
      const { focalPoint } = camera;
      const sliceStep = 1;
      
      if (direction === 'up') {
        focalPoint[2] += sliceStep;
      } else {
        focalPoint[2] -= sliceStep;
      }
      
      viewport.setCamera({ focalPoint });
      viewport.render();
    } catch (err) {
      console.warn('Slice navigation not available:', err);
    }
  };

  const handleWindowLevel = (window: number, level: number) => {
    if (!renderingEngine) return;

    try {
      const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
      viewport.setProperties({
        voiRange: {
          lower: level - window / 2,
          upper: level + window / 2,
        },
      });
      viewport.render();
    } catch (err) {
      console.warn('Window/Level adjustment not available:', err);
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
              disabled={isLoading}
              className="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 px-3 py-1 rounded text-white text-sm"
            >
              ←
            </button>
            <span className="text-sm text-slate-300 px-2">Slice</span>
            <button
              onClick={() => handleSliceChange('up')}
              disabled={isLoading}
              className="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 px-3 py-1 rounded text-white text-sm"
            >
              →
            </button>
          </div>
          
          {/* Window/Level presets */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleWindowLevel(400, 40)}
              disabled={isLoading}
              className="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 px-3 py-1 rounded text-white text-sm"
            >
              Soft Tissue
            </button>
            <button
              onClick={() => handleWindowLevel(1500, 300)}
              disabled={isLoading}
              className="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 px-3 py-1 rounded text-white text-sm"
            >
              Bone
            </button>
            <button
              onClick={() => handleWindowLevel(2000, 0)}
              disabled={isLoading}
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
          {imageInfo.dimensions && (
            <span className="mr-4">
              Dimensions: {imageInfo.dimensions.join(' × ')}
            </span>
          )}
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
              <h3 className="font-semibold mb-2">Failed to Load DICOM Images</h3>
              <p className="text-sm">{error}</p>
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
              <p className="text-sm">Please select a patient and series to view medical images.</p>
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

export default DicomMPRViewport;