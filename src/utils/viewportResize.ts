/**
 * Viewport Resize Utilities
 *
 * Based on Cornerstone.js resize example:
 * https://www.cornerstonejs.org/live-examples/contextpoolrenderingengine
 *
 * These utilities handle viewport resizing with view presentation preservation
 * to ensure proper rendering after layout changes.
 */

import { getRenderingEngine } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';

interface ViewportResizeOptions {
  renderingEngineId: string;
  viewportIds: string[];
  debounceMs?: number;
}

/**
 * Creates a ResizeObserver that handles viewport resize with debouncing
 * and preserves view presentation (zoom, pan, rotation, display area)
 *
 * @param options - Configuration options
 * @returns ResizeObserver instance and cleanup function
 *
 * @example
 * const { observer, cleanup } = createViewportResizeObserver({
 *   renderingEngineId: 'myEngine',
 *   viewportIds: ['axial', 'sagittal', 'coronal'],
 *   debounceMs: 100
 * });
 *
 * // Observe a container element
 * observer.observe(containerElement);
 *
 * // Cleanup when component unmounts
 * cleanup();
 */
export function createViewportResizeObserver(options: ViewportResizeOptions) {
  const { renderingEngineId, viewportIds, debounceMs = 100 } = options;
  let resizeTimeout: NodeJS.Timeout | null = null;

  const resize = () => {
    resizeTimeout = null;
    const renderingEngine = getRenderingEngine(renderingEngineId);

    if (!renderingEngine) {
      return;
    }

    try {
      // Get all viewports
      const viewports = viewportIds
        .map(id => renderingEngine.getViewport(id))
        .filter(Boolean) as Types.IViewport[];

      if (viewports.length === 0) {
        return;
      }

      // Store current view presentations before resize
      const presentations = viewports.map(viewport =>
        viewport.getViewPresentation?.() || null
      );

      // Perform resize (true = immediate, false = don't suppress events)
      renderingEngine.resize(true, false);

      // Restore view presentations after resize
      viewports.forEach((viewport, idx) => {
        const presentation = presentations[idx];
        if (presentation && viewport.setViewPresentation) {
          viewport.setViewPresentation(presentation);
        }
      });

    } catch (error) {
    }
  };

  const resizeObserver = new ResizeObserver(() => {
    // Debounce resize events
    if (resizeTimeout) {
      return;
    }
    resizeTimeout = setTimeout(resize, debounceMs);
  });

  const cleanup = () => {
    if (resizeTimeout) {
      clearTimeout(resizeTimeout);
      resizeTimeout = null;
    }
    resizeObserver.disconnect();
  };

  return { observer: resizeObserver, cleanup };
}

/**
 * Display Area Presets
 *
 * Common display area configurations for viewport initialization.
 * These control how images are positioned and scaled within viewports.
 */
export const DisplayAreaPresets = {
  /** Default display area (auto-fit) */
  Default: {
    storeAsInitialCamera: true,
  },

  /** Center the image with 1:1 pixel mapping */
  Center: {
    storeAsInitialCamera: true,
    imageArea: [1, 1] as [number, number],
    imageCanvasPoint: {
      imagePoint: [0.5, 0.5] as [number, number],
      canvasPoint: [0.5, 0.5] as [number, number],
    },
  },

  /** Align image to top-left corner */
  LeftTop: {
    storeAsInitialCamera: true,
    imageArea: [1.1, 1.1] as [number, number],
    imageCanvasPoint: {
      imagePoint: [0, 0] as [number, number],
      canvasPoint: [0, 0] as [number, number],
    },
  },

  /** Align image to left center */
  Left: {
    storeAsInitialCamera: true,
    imageArea: [1.1, 1.1] as [number, number],
    imageCanvasPoint: {
      imagePoint: [0, 0.5] as [number, number],
      canvasPoint: [0, 0.5] as [number, number],
    },
  },

  /** Align image to bottom-right corner */
  RightBottom: {
    storeAsInitialCamera: true,
    imageArea: [1.1, 1.1] as [number, number],
    imageCanvasPoint: {
      imagePoint: [1, 1] as [number, number],
      canvasPoint: [1, 1] as [number, number],
    },
  },

  /** Center with slight zoom (1.1x) */
  CenterZoomed: {
    storeAsInitialCamera: true,
    imageArea: [1.1, 1.1] as [number, number],
    imageCanvasPoint: {
      imagePoint: [0.5, 0.5] as [number, number],
      canvasPoint: [0.5, 0.5] as [number, number],
    },
  },

  /** Fit to height (preserve aspect ratio) */
  FitHeight: {
    storeAsInitialCamera: true,
    imageArea: [0.1, 1] as [number, number],
    imageCanvasPoint: {
      imagePoint: [0.5, 0.5] as [number, number],
      canvasPoint: [0.5, 0.5] as [number, number],
    },
  },

  /** Fit to width (preserve aspect ratio) */
  FitWidth: {
    storeAsInitialCamera: true,
    imageArea: [1, 0.1] as [number, number],
    imageCanvasPoint: {
      imagePoint: [0.5, 0.5] as [number, number],
      canvasPoint: [0.5, 0.5] as [number, number],
    },
  },

  /** Custom scale with center alignment */
  createScalePreset: (scale: number, imagePoint: [number, number] = [0.5, 0.5]) => ({
    type: 'SCALE' as const,
    storeAsInitialCamera: true,
    scale,
    imageCanvasPoint: {
      imagePoint,
      canvasPoint: [0.5, 0.5] as [number, number],
    },
  }),
};

/**
 * Synchronizer Options for Presentation View Synchronization
 *
 * Controls which viewport properties are synchronized across viewports:
 * - displayArea: Synchronize display area/zoom
 * - zoom: Synchronize zoom level
 * - pan: Synchronize pan position
 * - rotation: Synchronize rotation angle
 */
export interface PresentationSyncOptions {
  displayArea?: boolean;
  zoom?: boolean;
  pan?: boolean;
  rotation?: boolean;
}

/**
 * Default synchronization options (all enabled)
 */
export const DefaultSyncOptions: PresentationSyncOptions = {
  displayArea: true,
  zoom: true,
  pan: true,
  rotation: true,
};

/**
 * Applies a display area preset to a viewport
 *
 * @param viewport - Cornerstone viewport instance
 * @param preset - Display area preset or custom configuration
 *
 * @example
 * import { DisplayAreaPresets, applyDisplayArea } from './viewportResize';
 *
 * // Apply center preset
 * applyDisplayArea(viewport, DisplayAreaPresets.Center);
 *
 * // Apply custom scale
 * applyDisplayArea(viewport, DisplayAreaPresets.createScalePreset(2.0));
 */
export function applyDisplayArea(
  viewport: Types.IViewport,
  preset: any
) {
  try {
    if (viewport.setDisplayArea) {
      viewport.setDisplayArea(preset);
      viewport.render();
    } else {
    }
  } catch (error) {
  }
}

/**
 * Manual resize trigger with presentation preservation
 *
 * Use this when you need to manually trigger a resize (e.g., after layout changes)
 *
 * @param renderingEngineId - ID of the rendering engine
 * @param viewportIds - Array of viewport IDs to resize
 *
 * @example
 * // After changing from grid to single viewport
 * manualResize('myEngine', ['axial', 'sagittal', 'coronal']);
 */
export function manualResize(
  renderingEngineId: string,
  viewportIds: string[]
) {
  const renderingEngine = getRenderingEngine(renderingEngineId);

  if (!renderingEngine) {
    return;
  }

  try {
    const viewports = viewportIds
      .map(id => renderingEngine.getViewport(id))
      .filter(Boolean) as Types.IViewport[];

    // Store presentations
    const presentations = viewports.map(vp => vp.getViewPresentation?.() || null);

    // Resize
    renderingEngine.resize(true, false);

    // Restore presentations
    viewports.forEach((vp, idx) => {
      const presentation = presentations[idx];
      if (presentation && vp.setViewPresentation) {
        vp.setViewPresentation(presentation);
      }
    });

  } catch (error) {
  }
}
