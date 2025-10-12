# Cornerstone.js Reference Documentation Index

This document provides an index of all Cornerstone.js reference implementations and utilities saved for future use.

---

## 📚 Reference Materials Overview

We've saved three key Cornerstone.js official examples with comprehensive documentation and utility functions:

1. **Viewport Resize** - Handling layout changes with view preservation
2. **Reference Lines** - Showing viewport intersections in MPR viewers
3. **3D Volume Rendering** - Creating 3D volumetric visualizations

---

## 1. Viewport Resize & View Preservation

### Source Files
- **Utility**: `src/utils/viewportResize.ts`
- **Documentation**: `docs/VIEWPORT_RESIZE.md`
- **Quick Reference**: `VIEWPORT_UTILITIES.md`

### Official Example
https://www.cornerstonejs.org/live-examples/contextpoolrenderingengine

### What It Provides
- **ResizeObserver** with debouncing for automatic resize handling
- **View presentation preservation** (zoom, pan, rotation, display area)
- **Display area presets** (Center, LeftTop, FitWidth, etc.)
- **Manual resize trigger** for programmatic layout changes

### Key Functions
```typescript
// Auto-resize with view preservation
createViewportResizeObserver({ renderingEngineId, viewportIds })

// Manual resize after layout changes
manualResize(renderingEngineId, viewportIds)

// Apply display presets
applyDisplayArea(viewport, DisplayAreaPresets.Center)
```

### When to Use
- Window resize events
- Viewport layout changes (grid ↔ maximized)
- Stage transitions affecting viewport sizes
- Double-click viewport swap

### Quick Example
```typescript
import { manualResize } from '@/utils/viewportResize';

// After changing layout
setMaximizedViewport('axial');
setTimeout(() => {
  manualResize('myEngine', ['axial']);
}, 50);
```

---

## 2. Reference Lines Tool

### Source Files
- **Utility**: `src/utils/referenceLinesExample.ts`
- **Documentation**: `docs/REFERENCE_LINES.md`

### Official Example
https://www.cornerstonejs.org/live-examples/referencelines

### What It Provides
- **Intersection line visualization** between viewports
- **Dynamic source selection** - choose which viewport shows lines on others
- **Full dimension mode** - extend lines across entire viewport
- **Multi-viewport support** - Stack and Volume viewports

### Key Functions
```typescript
// Setup reference lines
setupReferenceLinesTool(toolGroup, {
  sourceViewportId: 'axial',
  showFullDimension: false
})

// Change source viewport
updateReferenceLineSource(toolGroup, 'sagittal')

// Toggle full dimension lines
toggleFullDimensionLines(toolGroup, true)
```

### When to Use
- **MPR viewers** - show how slices intersect
- **Surgical planning** - understand spatial relationships
- **TAVI planning** - show annular plane intersection on MPR views
- **Radiological review** - navigate between orientations

### Visual Example
```
When AXIAL is source:
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   AXIAL     │  │  SAGITTAL   │  │  CORONAL    │
│  [SOURCE]   │  │      │      │  │  ────────   │
│             │  │      │      │  │             │
└─────────────┘  └─────────────┘  └─────────────┘
   No lines        Vertical line    Horizontal line
```

### Quick Example
```typescript
import { setupReferenceLinesTool } from '@/utils/referenceLinesExample';

const toolGroup = ToolGroupManager.createToolGroup('mpr');
setupReferenceLinesTool(toolGroup, {
  sourceViewportId: 'axial',
  showFullDimension: false
});

// Add viewports
['axial', 'sagittal', 'coronal'].forEach(id => {
  toolGroup.addViewport(id, renderingEngineId);
});
```

---

## 3. 3D Volume Rendering

### Source Files
- **Utility**: `src/utils/volume3DExample.ts`
- **Documentation**: `docs/VOLUME_3D_RENDERING.md`

### Official Example
https://www.cornerstonejs.org/live-examples/volumeviewport3d

### What It Provides
- **VOLUME_3D viewport type** for volumetric rendering
- **Rendering presets** (CT-Bone, CT-Cardiac, MIP, etc.)
- **Quality control** via sample distance multiplier
- **Interactive manipulation** (rotation, zoom, pan)

### Key Functions
```typescript
// Setup 3D viewport
setup3DVolumeViewport({
  viewportId: 'volume3D',
  element: element,
  volumeId: volumeId,
  renderingEngineId: 'myEngine',
  preset: 'CT-Cardiac',
  sampleDistanceMultiplier: 4
})

// Change preset
changeVolume3DPreset(viewport, 'CT-Bone')

// Adjust quality (1=best, 16=fastest)
setSampleDistance(viewport, 2)

// Rotate
setRotation(viewport, 45)
```

### When to Use
- **3D anatomical visualization** - see structures in 3D
- **TAVI planning** - 4th viewport in ROOT_DEFINITION stage
- **Surgical planning** - understand 3D relationships
- **Bone analysis** - orthopedic applications
- **Vascular imaging** - MIP for vessels

### Rendering Presets

| Preset | Best For |
|--------|----------|
| **CT-Bone** | Skeletal structures |
| **CT-Cardiac** | Heart and vessels (TAVI) |
| **CT-Chest** | Lungs and thorax |
| **MIP** | Vascular structures |
| **PET** | Nuclear medicine |

### Quality Levels

| Sample Distance | Quality | FPS | Use Case |
|----------------|---------|-----|----------|
| 1-2 | Highest | 10-20 | Static viewing |
| 3-5 | High | 30-50 | Interactive |
| 6-10 | Medium | 50-60 | Fast interaction |
| 11-16 | Low | 60+ | Preview |

### Quick Example
```typescript
import { setup3DVolumeViewport, Volume3DPresets } from '@/utils/volume3DExample';

// For TAVI workflow (ROOT_DEFINITION stage)
const viewport = await setup3DVolumeViewport({
  viewportId: 'volume3D',
  element: elementRefs.volume3D.current,
  volumeId: volumeId,
  renderingEngineId: 'taviEngine',
  preset: Volume3DPresets.CT_CARDIAC,
  sampleDistanceMultiplier: 4 // Balanced
});
```

---

## 🎯 Integration with Our TAVI Application

### Current Implementation Status

#### ✅ Implemented
1. **Viewport Layouts**
   - ROOT_DEFINITION: 2x2 grid (3 MPR + 1 3D)
   - ANNULUS_DEFINITION: 2x2 grid (3 MPR)
   - MEASUREMENTS: 3 top + 2 bottom (5 viewports)
2. **Double-click maximize/restore** - All viewports
3. **Multi-phase detection modal** - Phase selection with CT previews

#### 🔧 Reference Available (Not Yet Implemented)
1. **Viewport Resize** - For handling layout changes smoothly
2. **Reference Lines** - For showing annular plane intersections
3. **3D Volume Rendering** - For volume3D viewport in ROOT_DEFINITION

### Recommended Next Steps

#### 1. Add Reference Lines to MPR Views
```typescript
// In ProperMPRViewport.tsx, after tool setup
import { setupReferenceLinesTool } from '@/utils/referenceLinesExample';

setupReferenceLinesTool(toolGroup, {
  sourceViewportId: 'axial', // Or make dynamic based on user selection
  showFullDimension: false
});
```

**Benefit**: Users can better understand slice positions across viewports

#### 2. Implement Proper 3D Rendering for ROOT_DEFINITION
```typescript
// Replace ORTHOGRAPHIC with VOLUME_3D for volume3D viewport
import { setup3DVolumeViewport, Volume3DPresets } from '@/utils/volume3DExample';

await setup3DVolumeViewport({
  viewportId: 'volume3D',
  element: elementRefs.volume3D.current,
  volumeId: volumeId,
  renderingEngineId: 'mprEngine',
  preset: Volume3DPresets.CT_CARDIAC,
  sampleDistanceMultiplier: 4
});
```

**Benefit**: True 3D visualization instead of just another MPR view

#### 3. Add Resize Handling for Maximized Viewports
```typescript
// In double-click handler
import { manualResize } from '@/utils/viewportResize';

const handleViewportDoubleClick = (viewportId: string) => {
  setMaximizedViewport(viewportId);
  setTimeout(() => {
    manualResize(renderingEngineId, [viewportId]);
  }, 50);
};
```

**Benefit**: Smoother transitions when maximizing/restoring viewports

---

## 📖 Documentation Structure

```
docs/
├── VIEWPORT_RESIZE.md        # Resize utilities documentation
├── REFERENCE_LINES.md         # Reference lines tool documentation
└── VOLUME_3D_RENDERING.md     # 3D volume rendering documentation

src/utils/
├── viewportResize.ts          # Resize utility functions
├── referenceLinesExample.ts   # Reference lines utilities
└── volume3DExample.ts         # 3D volume utilities

Root/
├── VIEWPORT_UTILITIES.md              # Quick reference for resize
└── CORNERSTONE_REFERENCE_INDEX.md     # This file (master index)
```

---

## 🔍 Finding What You Need

### By Problem

| Problem | Solution | Reference |
|---------|----------|-----------|
| Viewport blank after resize | Viewport Resize | `docs/VIEWPORT_RESIZE.md` |
| Show slice intersections | Reference Lines | `docs/REFERENCE_LINES.md` |
| Need 3D visualization | 3D Volume | `docs/VOLUME_3D_RENDERING.md` |
| Zoom/pan resets on resize | Viewport Resize | `docs/VIEWPORT_RESIZE.md` |
| Need to understand MPR positions | Reference Lines | `docs/REFERENCE_LINES.md` |
| Want volumetric rendering | 3D Volume | `docs/VOLUME_3D_RENDERING.md` |

### By Use Case

| Use Case | Tools Needed | Documentation |
|----------|--------------|---------------|
| **MPR Viewer** | Resize + Reference Lines | All 3 docs |
| **TAVI Planning** | All 3 tools | All 3 docs |
| **Surgical Planning** | 3D Volume + Reference Lines | Volumes + Reference |
| **Responsive Layout** | Viewport Resize | Resize doc |
| **Bone Analysis** | 3D Volume (CT-Bone preset) | Volume doc |
| **Vascular Imaging** | 3D Volume (MIP preset) | Volume doc |

### By Cornerstone Concept

| Concept | Related Utilities | Learn More |
|---------|-------------------|------------|
| **Viewport Types** | All | Each doc's intro |
| **View Presentation** | Viewport Resize | Resize doc |
| **Tool Configuration** | Reference Lines | Reference doc |
| **Rendering Presets** | 3D Volume | Volume doc |
| **Camera Control** | Resize + 3D Volume | Both docs |
| **Tool Groups** | Reference Lines | Reference doc |

---

## 🚀 Quick Start Guide

### For New Developers

1. **Read this index first** to understand what's available
2. **Check the use case table** to find relevant tools
3. **Read the specific documentation** for detailed implementation
4. **Reference the utility files** for function signatures
5. **Check official examples** for original context

### For Adding New Features

1. **Check if reference exists** in this index
2. **Read the relevant documentation**
3. **Import utility functions** from `src/utils/`
4. **Follow the integration examples** in docs
5. **Test thoroughly** with different scenarios

### For Debugging

1. **Identify the problem** (viewport, rendering, interaction)
2. **Check "By Problem" table** above
3. **Read troubleshooting section** in relevant doc
4. **Try suggested solutions**
5. **Check official example** if needed

---

## 📝 Notes

### These are Reference Implementations
- **Not required** - current implementation works without them
- **Added for future use** - based on official best practices
- **Use when needed** - if you encounter specific issues
- **Well documented** - each has comprehensive docs

### Official Examples Source
All implementations are based on official Cornerstone.js examples:
- Cornerstone.js website: https://www.cornerstonejs.org
- Live examples: https://www.cornerstonejs.org/live-examples
- Documentation: https://www.cornerstonejs.org/docs

### Maintenance
- Keep utility files in sync with Cornerstone.js updates
- Update documentation if Cornerstone API changes
- Add new examples as they become relevant

---

## 🔗 Related Files

- `src/components/ProperMPRViewport.tsx` - Main MPR viewport component
- `src/components/TAVIApp.tsx` - TAVI workflow application
- `src/utils/createImageIdsAndCacheMetaData.ts` - DICOM loading
- `src/types/WorkflowTypes.ts` - Workflow state definitions

---

## ✅ Status Summary

| Category | Status | Location |
|----------|--------|----------|
| **Viewport Resize** | ✅ Reference saved | `src/utils/viewportResize.ts` |
| **Reference Lines** | ✅ Reference saved | `src/utils/referenceLinesExample.ts` |
| **3D Volume** | ✅ Reference saved | `src/utils/volume3DExample.ts` |
| **Documentation** | ✅ Complete | `docs/*.md` |
| **Integration** | ⏳ Pending | Ready for use when needed |

---

**Last Updated**: 2025-10-12
**Cornerstone Version**: 3.x
**Application**: TAVI Planning Workflow
