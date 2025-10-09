import React, { useEffect, useRef, useState } from 'react';
import '@kitware/vtk.js/favicon';
import '@kitware/vtk.js/Rendering/Profiles/All';
import '@kitware/vtk.js/IO/Core/DataAccessHelper/HttpDataAccessHelper';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkHttpDataSetReader from '@kitware/vtk.js/IO/Core/HttpDataSetReader';
import vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkInteractorStyleImage from '@kitware/vtk.js/Interaction/Style/InteractorStyleImage';

interface MPRViewportProps {
  volumeUrl?: string;
  patientInfo?: {
    patientID?: string;
    patientName?: string;
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
  };
  onImageLoaded?: (imageData: any) => void;
}

const MPRViewport: React.FC<MPRViewportProps> = ({ 
  volumeUrl = '/data/LIDC2.vti/index.json',
  patientInfo,
  onImageLoaded 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageInfo, setImageInfo] = useState<any>(null);
  const vtkObjects = useRef<{
    renderWindow?: any;
    renderer?: any;
    reader?: any;
    mapper?: any;
    actor?: any;
    genericRenderWindow?: any;
  }>({});

  useEffect(() => {
    if (!containerRef.current) return;

    setIsLoading(true);
    setError(null);

    // Create VTK render window
    const genericRenderWindow = vtkGenericRenderWindow.newInstance({
      background: [0, 0, 0]
    });
    
    genericRenderWindow.setContainer(containerRef.current);
    genericRenderWindow.resize();

    const renderWindow = genericRenderWindow.getRenderWindow();
    const renderer = genericRenderWindow.getRenderer();
    const interactor = renderWindow.getInteractor();
    
    interactor.setInteractorStyle(vtkInteractorStyleImage.newInstance());

    // Create VTK components
    const reader = vtkHttpDataSetReader.newInstance({ fetchGzip: true });
    const mapper = vtkImageMapper.newInstance();
    const actor = vtkImageSlice.newInstance();

    mapper.setInputConnection(reader.getOutputPort());
    actor.setMapper(mapper);
    renderer.addActor(actor);

    // Store VTK objects
    vtkObjects.current = {
      renderWindow,
      renderer,
      reader,
      mapper,
      actor,
      genericRenderWindow
    };

    // Load volume data
    reader.setUrl(volumeUrl)
      .then(() => {
        return reader.loadData();
      })
      .then(() => {
        const imageData = reader.getOutputData();
        
        if (!imageData) {
          throw new Error('No image data loaded');
        }
        
        console.log('Image data loaded:', imageData);

        // Get image information
        const dimensions = imageData.getDimensions();
        const spacing = imageData.getSpacing();
        const origin = imageData.getOrigin();
        const scalarRange = imageData.getPointData().getScalars().getRange();

        setImageInfo({
          dimensions,
          spacing,
          origin,
          scalarRange,
          numberOfPoints: imageData.getNumberOfPoints()
        });

        // Set mapper properties for medical imaging
        mapper.setSliceAtFocalPoint(true);
        mapper.setSlicingMode(1); // Z-axis slicing by default
        
        // Set window/level for medical images - CT Angiography
        const windowWidth = 350; // CT Angiography window width
        const windowLevel = 40; // CT Angiography window level

        actor.getProperty().setColorWindow(windowWidth);
        actor.getProperty().setColorLevel(windowLevel);

        // Reset camera to show the image properly
        renderer.resetCamera();
        renderWindow.render();

        // Call callback
        if (onImageLoaded) {
          onImageLoaded(imageData);
        }

        setIsLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load volume:', err);
        setError(`Failed to load volume: ${err.message}`);
        setIsLoading(false);
      });

    // Cleanup
    return () => {
      if (vtkObjects.current.genericRenderWindow) {
        vtkObjects.current.genericRenderWindow.delete();
      }
    };
  }, [volumeUrl, onImageLoaded]);

  const handleSliceChange = (direction: 'up' | 'down') => {
    const { mapper, renderWindow } = vtkObjects.current;
    if (!mapper || !renderWindow) return;

    const currentSlice = mapper.getSlice();
    const sliceRange = mapper.getSliceRange();
    
    let newSlice = currentSlice;
    if (direction === 'up' && currentSlice < sliceRange[1]) {
      newSlice = currentSlice + 1;
    } else if (direction === 'down' && currentSlice > sliceRange[0]) {
      newSlice = currentSlice - 1;
    }
    
    mapper.setSlice(newSlice);
    renderWindow.render();
  };

  const handleWindowLevel = (window: number, level: number) => {
    const { actor, renderWindow } = vtkObjects.current;
    if (!actor || !renderWindow) return;

    actor.getProperty().setColorWindow(window);
    actor.getProperty().setColorLevel(level);
    renderWindow.render();
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
            Dimensions: {imageInfo.dimensions.join(' × ')}
          </span>
          <span className="mr-4">
            Spacing: {imageInfo.spacing.map((s: number) => s.toFixed(2)).join(' × ')} mm
          </span>
          <span>
            Range: {imageInfo.scalarRange[0].toFixed(0)} - {imageInfo.scalarRange[1].toFixed(0)}
          </span>
        </div>
      )}

      {/* Viewport */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
            <div className="flex items-center gap-3 text-white">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <span>Loading medical images...</span>
            </div>
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
            <div className="bg-red-900 border border-red-700 rounded-lg p-6 text-white max-w-md">
              <h3 className="font-semibold mb-2">Failed to Load Images</h3>
              <p className="text-sm">{error}</p>
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

export default MPRViewport;