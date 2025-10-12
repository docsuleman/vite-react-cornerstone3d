# Viewport Resize Utilities

This document describes the viewport resize utilities available in `src/utils/viewportResize.ts`, based on the official Cornerstone.js resize example.

## Overview

When viewport layouts change (e.g., switching between grid and maximized views, or changing stage layouts), proper resize handling is crucial to maintain:
- **View Presentation**: Camera position, zoom level, pan offset, rotation
- **Display Area**: How the image is positioned and scaled within the viewport
- **Rendering Quality**: Proper canvas sizing and rendering

## Available Utilities

### 1. ResizeObserver with Debouncing

Automatically handles viewport resize with view presentation preservation.

```typescript
import { createViewportResizeObserver } from '@/utils/viewportResize';

// In your component
useEffect(() => {
  const { observer, cleanup } = createViewportResizeObserver({
    renderingEngineId: 'myRenderingEngine',
    viewportIds: ['axial', 'sagittal', 'coronal'],
    debounceMs: 100 // Optional, default is 100ms
  });

  // Observe the container element
  const container = document.getElementById('viewport-container');
  if (container) {
    observer.observe(container);
  }

  // Cleanup on unmount
  return cleanup;
}, []);
```

**When to use**:
- Window resize events
- Container size changes
- Dynamic layout adjustments

### 2. Manual Resize Trigger

Manually trigger resize when layout changes programmatically.

```typescript
import { manualResize } from '@/utils/viewportResize';

// After changing viewport layout
const handleLayoutChange = () => {
  setMaximizedViewport('axial');

  // Trigger resize to ensure proper rendering
  setTimeout(() => {
    manualResize('myRenderingEngine', ['axial']);
  }, 50);
};
```

**When to use**:
- Switching between grid and maximized layouts
- Changing number of visible viewports
- Stage transitions that affect viewport layout

### 3. Display Area Presets

Pre-configured display area settings for common use cases.

```typescript
import { DisplayAreaPresets, applyDisplayArea } from '@/utils/viewportResize';

// Apply a preset
const viewport = renderingEngine.getViewport('axial');

// Center the image with 1:1 pixel mapping
applyDisplayArea(viewport, DisplayAreaPresets.Center);

// Align to top-left corner
applyDisplayArea(viewport, DisplayAreaPresets.LeftTop);

// Custom scale (2x zoom, centered)
applyDisplayArea(
  viewport,
  DisplayAreaPresets.createScalePreset(2.0, [0.5, 0.5])
);
```

**Available Presets**:
- `Default`: Auto-fit (default Cornerstone behavior)
- `Center`: Center image with 1:1 pixel mapping
- `LeftTop`: Align to top-left corner
- `Left`: Align to left center
- `RightBottom`: Align to bottom-right corner
- `CenterZoomed`: Center with 1.1x zoom
- `FitHeight`: Fit to viewport height
- `FitWidth`: Fit to viewport width
- `createScalePreset(scale, imagePoint)`: Custom scale and position

### 4. Presentation Synchronization Options

Configure what properties to synchronize across viewports.

```typescript
import { PresentationSyncOptions, DefaultSyncOptions } from '@/utils/viewportResize';

// Custom sync options
const customSyncOptions: PresentationSyncOptions = {
  displayArea: true,  // Sync zoom/display area
  zoom: true,         // Sync zoom level
  pan: true,          // Sync pan position
  rotation: false,    // Don't sync rotation
};

// Use with presentation view synchronizer
import { synchronizers } from '@cornerstonejs/tools';

const synchronizer = synchronizers.createPresentationViewSynchronizer(
  'mySynchronizer',
  customSyncOptions
);
```

## Common Use Cases

### Use Case 1: Maximize/Restore Viewport

```typescript
import { manualResize } from '@/utils/viewportResize';

const handleViewportDoubleClick = (viewportId: string) => {
  if (maximizedViewport === viewportId) {
    // Restore to grid
    setMaximizedViewport(null);
    setTimeout(() => {
      manualResize(renderingEngineId, ['axial', 'sagittal', 'coronal']);
    }, 50);
  } else {
    // Maximize
    setMaximizedViewport(viewportId);
    setTimeout(() => {
      manualResize(renderingEngineId, [viewportId]);
    }, 50);
  }
};
```

### Use Case 2: Stage-Based Layout Changes

```typescript
import { manualResize } from '@/utils/viewportResize';

useEffect(() => {
  // When stage changes, trigger resize for all visible viewports
  const viewportIds = currentStage === WorkflowStage.MEASUREMENTS
    ? ['axial', 'sagittal', 'coronal', 'measurement1', 'measurement2']
    : ['axial', 'sagittal', 'coronal'];

  setTimeout(() => {
    manualResize(renderingEngineId, viewportIds);
  }, 100);
}, [currentStage]);
```

### Use Case 3: Responsive Container with ResizeObserver

```typescript
import { createViewportResizeObserver } from '@/utils/viewportResize';

const ProperMPRViewport = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { observer, cleanup } = createViewportResizeObserver({
      renderingEngineId: 'mprEngine',
      viewportIds: ['axial', 'sagittal', 'coronal'],
      debounceMs: 150
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return cleanup;
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full">
      {/* Viewports */}
    </div>
  );
};
```

## How It Works

### View Presentation Preservation

The resize utilities preserve view presentation by:

1. **Capturing** current presentation state before resize:
   ```typescript
   const presentation = viewport.getViewPresentation();
   // Returns: { zoom, pan, rotation, displayArea, ... }
   ```

2. **Performing** the resize operation:
   ```typescript
   renderingEngine.resize(true, false);
   // true = immediate resize
   // false = don't suppress events
   ```

3. **Restoring** the presentation state after resize:
   ```typescript
   viewport.setViewPresentation(presentation);
   ```

### Debouncing Strategy

ResizeObserver uses a timeout-based debounce to prevent excessive resize operations:

```typescript
let resizeTimeout = null;

resizeObserver = new ResizeObserver(() => {
  if (resizeTimeout) return; // Skip if already pending

  resizeTimeout = setTimeout(() => {
    resizeTimeout = null;
    performResize(); // Actual resize logic
  }, debounceMs);
});
```

## Troubleshooting

### Issue: Viewports appear blank after layout change

**Solution**: Trigger manual resize after DOM updates:

```typescript
// Wait for DOM to update
setTimeout(() => {
  manualResize(renderingEngineId, viewportIds);
}, 50);
```

### Issue: Zoom/pan resets when switching layouts

**Solution**: The resize utilities preserve presentation automatically. Ensure you're using `manualResize()` or the ResizeObserver.

### Issue: Performance issues with frequent resizing

**Solution**: Increase debounce delay:

```typescript
createViewportResizeObserver({
  renderingEngineId: 'myEngine',
  viewportIds: ['axial'],
  debounceMs: 200 // Increase from default 100ms
});
```

## Reference

Based on official Cornerstone.js example:
- [Resize Example](https://www.cornerstonejs.org/live-examples/contextpoolrenderingengine)
- [Viewport API Documentation](https://www.cornerstonejs.org/docs/concepts/cornerstone-core/viewports)

## See Also

- `src/utils/viewportResize.ts` - Source implementation
- `src/components/ProperMPRViewport.tsx` - Usage in MPR viewport component
- Cornerstone3D API: `IViewport.setViewPresentation()`, `IViewport.getViewPresentation()`
