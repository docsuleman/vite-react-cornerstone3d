# Viewport Resize Utilities - Quick Reference

## 📁 Files Added

### `src/utils/viewportResize.ts`
Utility functions for handling viewport resizing with view presentation preservation.

**Key exports:**
- `createViewportResizeObserver()` - Auto-resize with ResizeObserver
- `manualResize()` - Manual resize trigger
- `DisplayAreaPresets` - Common display area configurations
- `applyDisplayArea()` - Apply display area to viewport
- `PresentationSyncOptions` - Synchronization configuration types

### `docs/VIEWPORT_RESIZE.md`
Comprehensive documentation with examples and troubleshooting guide.

## 🚀 Quick Start

### 1. Auto-resize on container size change

```typescript
import { createViewportResizeObserver } from '@/utils/viewportResize';

useEffect(() => {
  const { observer, cleanup } = createViewportResizeObserver({
    renderingEngineId: 'myEngine',
    viewportIds: ['axial', 'sagittal', 'coronal']
  });

  observer.observe(containerElement);
  return cleanup;
}, []);
```

### 2. Manual resize after layout change

```typescript
import { manualResize } from '@/utils/viewportResize';

// After switching viewport layout
setMaximizedViewport(viewportId);
setTimeout(() => {
  manualResize('myEngine', [viewportId]);
}, 50);
```

### 3. Apply display area preset

```typescript
import { DisplayAreaPresets, applyDisplayArea } from '@/utils/viewportResize';

const viewport = renderingEngine.getViewport('axial');
applyDisplayArea(viewport, DisplayAreaPresets.Center);
```

## 🎯 When to Use

### Use ResizeObserver when:
- Window resize events affect viewport container
- Container has dynamic sizing (flex, grid)
- Responsive layouts

### Use manualResize when:
- Programmatic layout changes (grid ↔ maximized)
- Stage transitions change viewport count
- Double-click viewport swap

### Use DisplayAreaPresets when:
- Initial viewport setup
- Consistent image positioning needed
- Custom zoom/alignment requirements

## 📚 Based On

Official Cornerstone.js resize example demonstrating:
- View presentation preservation during resize
- ResizeObserver with debouncing pattern
- Display area management
- Presentation synchronization

**Source**: https://www.cornerstonejs.org/live-examples/contextpoolrenderingengine

## 🔍 Key Concepts

### View Presentation
Contains viewport state that should be preserved during resize:
- **zoom**: Zoom/scale level
- **pan**: Pan offset (x, y)
- **rotation**: Rotation angle
- **displayArea**: Image positioning and scaling

### Resize Flow
1. **Capture** presentation: `viewport.getViewPresentation()`
2. **Resize** engine: `renderingEngine.resize(true, false)`
3. **Restore** presentation: `viewport.setViewPresentation(presentation)`

### Display Area
Controls how image maps to canvas:
- `imagePoint`: Position in image space [0-1, 0-1]
- `canvasPoint`: Position in canvas space [0-1, 0-1]
- `imageArea`: Visible area size [width, height] (1 = 100%)
- `scale`: Explicit scale factor (alternative to imageArea)

## 🐛 Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Blank viewport after layout change | Use `manualResize()` after DOM updates |
| Zoom/pan resets | Ensure using resize utilities (they auto-preserve) |
| Performance issues | Increase debounce delay in ResizeObserver |
| Image not centered | Use `DisplayAreaPresets.Center` |

## 📝 Notes

- These utilities are **optional** - use only if you encounter resize issues
- Current implementation works without them (Cornerstone auto-resizes)
- Added for future use based on official best practices
- All utilities include error handling and logging

---

For detailed documentation, see: `docs/VIEWPORT_RESIZE.md`
