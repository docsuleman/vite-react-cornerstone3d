import React, { useEffect, useRef, useState } from 'react';
import { RenderingEngine, Types, Enums, volumeLoader } from '@cornerstonejs/core';
import { VolumeCropInfo } from '../types/WorkflowTypes';
import * as cornerstoneTools from '@cornerstonejs/tools';

interface VolumeRendering3DViewportProps {
  viewportId: string;
  renderingEngineId: string;
  volumeId: string;
  cropInfo?: VolumeCropInfo;
  onDoubleClick?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

const VolumeRendering3DViewport: React.FC<VolumeRendering3DViewportProps> = ({
  viewportId,
  renderingEngineId,
  volumeId,
  cropInfo,
  onDoubleClick,
  style,
  className = ''
}) => {
  const elementRef = useRef<HTMLDivElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (!elementRef.current) return;

    const initializeViewport = async () => {
      try {

        // Get or create rendering engine
        let renderingEngine = RenderingEngine.getRenderingEngine(renderingEngineId);
        if (!renderingEngine) {
          renderingEngine = new RenderingEngine(renderingEngineId);
        }

        // Enable the viewport
        const viewportInput = {
          viewportId: viewportId,
          type: Enums.ViewportType.ORTHOGRAPHIC,
          element: elementRef.current,
          defaultOptions: {
            background: [0, 0, 0] as Types.Point3,
            orientation: Enums.OrientationAxis.AXIAL,
          },
        };

        renderingEngine.enableElement(viewportInput);

        // Get the viewport
        const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;

        // Load volume if not already loaded
        const volume = volumeLoader.getVolume(volumeId);
        if (volume) {
          await viewport.setVolumes([
            {
              volumeId: volumeId,
              callback: ({ volumeActor }) => {
                // Apply default windowing for cardiac CT
                const rgbTransferFunction = volumeActor
                  .getProperty()
                  .getRGBTransferFunction(0);
                rgbTransferFunction.setMappingRange(-180, 220);

                // Apply opacity transfer function for volume rendering effect
                const scalarOpacity = volumeActor
                  .getProperty()
                  .getScalarOpacity(0);

                // Create opacity curve for soft tissue visualization
                scalarOpacity.removeAllPoints();
                scalarOpacity.addPoint(-1000, 0.0);
                scalarOpacity.addPoint(-500, 0.0);
                scalarOpacity.addPoint(-100, 0.1);
                scalarOpacity.addPoint(0, 0.2);
                scalarOpacity.addPoint(100, 0.4);
                scalarOpacity.addPoint(200, 0.6);
                scalarOpacity.addPoint(500, 0.8);
                scalarOpacity.addPoint(1000, 1.0);
              },
            },
          ]);

          // Set initial camera position for 3D view
          const camera = viewport.getCamera();
          const bounds = volume.getBounds();
          const center = [
            (bounds[0] + bounds[1]) / 2,
            (bounds[2] + bounds[3]) / 2,
            (bounds[4] + bounds[5]) / 2,
          ] as Types.Point3;

          // Position camera for isometric 3D view
          const distance = Math.max(
            bounds[1] - bounds[0],
            bounds[3] - bounds[2],
            bounds[5] - bounds[4]
          ) * 1.5;

          viewport.setCamera({
            ...camera,
            position: [
              center[0] + distance * 0.5,
              center[1] - distance * 0.5,
              center[2] + distance * 0.5,
            ] as Types.Point3,
            focalPoint: center,
            viewUp: [0, 0, 1] as Types.Point3,
          });

          // Apply cropping if provided
          if (cropInfo) {
            applyCropping(viewport, cropInfo);
          }

          viewport.render();
          setIsInitialized(true);
        }
      } catch (error) {
      }
    };

    initializeViewport();

    // Cleanup
    return () => {
      try {
        const renderingEngine = RenderingEngine.getRenderingEngine(renderingEngineId);
        if (renderingEngine) {
          renderingEngine.disableElement(viewportId);
        }
      } catch (error) {
      }
    };
  }, [viewportId, renderingEngineId, volumeId]);

  // Update cropping when cropInfo changes
  useEffect(() => {
    if (!isInitialized) return;

    const renderingEngine = RenderingEngine.getRenderingEngine(renderingEngineId);
    if (!renderingEngine) return;

    const viewport = renderingEngine.getViewport(viewportId) as Types.IVolumeViewport;
    if (!viewport) return;

    if (cropInfo) {
      applyCropping(viewport, cropInfo);
    } else {
      clearCropping(viewport);
    }

    viewport.render();
  }, [cropInfo, isInitialized, renderingEngineId, viewportId]);

  const applyCropping = (viewport: Types.IVolumeViewport, cropInfo: VolumeCropInfo) => {
    // TODO: Implement cropping using VTK clipping planes or volume mapper VOI
    // For now, log the crop bounds

    // This would use VTK.js APIs to set clipping planes
    // Example:
    // const volumeActor = viewport.getDefaultActor().actor as vtkVolume;
    // const mapper = volumeActor.getMapper();
    // mapper.setVOI(cropInfo.bounds);
  };

  const clearCropping = (viewport: Types.IVolumeViewport) => {
    // Reset VOI or remove clipping planes
  };

  const handleDoubleClick = () => {
    if (onDoubleClick) {
      onDoubleClick();
    }
  };

  return (
    <div
      ref={elementRef}
      className={`relative ${className}`}
      style={{
        width: '100%',
        height: '100%',
        ...style,
      }}
      onDoubleClick={handleDoubleClick}
    >
      {!isInitialized && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="text-white text-sm">Loading 3D view...</div>
        </div>
      )}
    </div>
  );
};

export default VolumeRendering3DViewport;
