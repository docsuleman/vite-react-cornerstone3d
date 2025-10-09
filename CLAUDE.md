# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm run dev` - Start development server with Vite
- `npm run build` - Build for production (runs TypeScript compiler then Vite build)
- `npm run lint` - Run ESLint with TypeScript extensions
- `npm run preview` - Preview production build locally

## Architecture Overview

This is a React + Vite application for medical imaging visualization using Cornerstone3D. The app provides a multi-planar reconstruction (MPR) viewer for DICOM medical images.

### Core Technologies

- **Cornerstone3D**: Main medical imaging library providing volume rendering, tools, and DICOM loading
- **React 18** with TypeScript for UI
- **Vite** as build tool with specific WASM/CommonJS handling
- **Tailwind CSS** for styling
- **VTK.js** for 3D visualization components

### Key Components

**App.tsx** - Main application component that:

- Initializes Cornerstone3D rendering engine and tools
- Sets up orthographic viewports (axial, sagittal, coronal views)
- Manages tool groups and medical imaging tools (crosshairs, zoom, ROI tools, etc.)
- Connects to DICOM server at `http://127.0.0.1/orthanc/dicom-web`
- Implements custom SphereMarker tool for 3D annotations

**Main Architecture Pattern**:

1. Initialize Cornerstone3D core, tools, and DICOM loader
2. Create volume from DICOM series using WADO-RS
3. Set up multiple orthographic viewports with volume rendering
4. Configure tool groups with medical imaging tools
5. Synchronize viewports with slab thickness synchronizer

### Custom Tools

- **SphereMarkerTool** (`src/customTools/Spheremarker.ts`): Custom 3D sphere placement tool that allows up to 3 spheres with color coding and drag functionality

### DICOM Integration

- Uses `createImageIdsAndCacheMetaData.ts` to fetch DICOM metadata via dicomweb-client
- Configured for Orthanc DICOM server integration
- Supports WADO-RS protocol for image retrieval

### Build Configuration Notes

- Vite config excludes Cornerstone CODEC packages from optimization to handle WASM properly
- Uses `vite-plugin-commonjs` for dicom-parser CommonJS compatibility
- Worker format set to ES modules for proper WASM handling
- TypeScript strict mode disabled for medical imaging library compatibility

### Viewport Management

- Grid layout with 4 viewports (axial, sagittal, coronal, plus reserved space)
- Automatic camera fitting and viewport synchronization
- Tool activation system with primary mouse button binding

### Data Sources

- Expects DICOM server at `127.0.0.1/orthanc/dicom-web`
- Sample data includes Study/Series instance UIDs for testing

## TAVI Workflow Application (TAVIApp.tsx)

The application implements a comprehensive 5-stage TAVI (Transcatheter Aortic Valve Implantation) planning workflow using a state machine pattern:

### Workflow Architecture

**State Management**: Uses `useWorkflowState` hook with reducer pattern for centralized state management:
- Patient selection and DICOM series loading
- Aortic root landmark placement (3 points: LV outflow, aortic valve, ascending aorta)
- CPR generation and analysis from centerline
- Annulus definition using cusp nadir points (3 points: left/right/non-coronary)
- Automated measurements and calculations

**Stage Dependencies**: Each stage must be completed before advancing (enforced via `canAdvanceToStage()`)

**Key Components**:
- `TAVIApp.tsx` - Main workflow orchestrator with visual progress tracking
- `useWorkflowState` hook - Reducer-based state management for workflow stages, points, measurements
- `WorkflowTypes.ts` - TypeScript definitions for all workflow entities
- `ProperMPRViewport` - Standard MPR views for root definition and measurements stages
- `TrueCPRViewport` - Specialized CPR views for analysis and annulus definition stages

### Workflow Stages

1. **Patient Selection**: DICOM server connection and series selection
2. **Root Definition**: Place 3 anatomical spheres (LV outflow → valve → ascending aorta)
3. **CPR Analysis**: Automated centerline generation and CPR visualization
4. **Annulus Definition**: Mark 3 cusp nadir points for annular plane calculation
5. **Measurements**: Extract annulus metrics (area, perimeter, diameters)

### Integration Notes

- Spheres placed in ProperMPRViewport map to `RootPoint[]` via `onSpherePositionsUpdate`
- Cusp dots in TrueCPRViewport/ProperMPRViewport map to `AnnulusPoint[]` via `onCuspDotsUpdate`
- Centerline generated from root points using `CenterlineGenerator.generateFromRootPoints()`
- Annular plane calculated from 3 cusp points, used to modify centerline perpendicularity
- All measurements auto-calculated and stored in workflow state

## TAVI CPR Viewport Configuration (TrueCPRViewport.tsx)

### Working CPR Configuration for TAVI Planning

The `TrueCPRViewport` component implements a successful three-view CPR layout for TAVI planning using **Cornerstone3D integration with VTK.js CPR mappers** (not pure VTK.js approach).

#### Architecture Approach

**Hybrid Cornerstone3D + VTK.js CPR Implementation:**
- Uses Cornerstone3D viewports as containers (not pure VTK.js renderwindows)
- Integrates vtkImageCPRMapper within Cornerstone3D viewport system
- Leverages Cornerstone3D volume loading and DICOM handling
- Adds VTK CPR actors to Cornerstone3D viewports using `csViewport.addActor()`

This approach combines:
- **Cornerstone3D**: Volume loading, DICOM handling, viewport management
- **VTK.js**: CPR reconstruction algorithms (vtkImageCPRMapper)
- **Integration**: VTK actors rendered within Cornerstone3D viewports

#### Viewport Setup
```typescript
const viewports = [
  { 
    id: 'cpr-main',
    title: 'Cross Section (Orthographic)',
    type: 'orthographic',  // True cross-section
    orientation: CornerstoneEnums.OrientationAxis.AXIAL,
    cprWidth: 150  // 15cm width for good coverage
  },
  { 
    id: 'cpr-longitudinal', 
    title: 'CPR Longitudinal (Stretched)',
    type: 'cpr',
    mode: 'stretched',  // Longitudinal CPR
    orientation: CornerstoneEnums.OrientationAxis.SAGITTAL,
    cprWidth: 150
  },
  { 
    id: 'cpr-cross',
    title: 'CPR Long Axis (Side View)',
    type: 'cpr',
    mode: 'stretched',  // Same CPR but rotated
    orientation: CornerstoneEnums.OrientationAxis.CORONAL,
    cprWidth: 150,
    cprView: 'side'  // Uses direction matrix rotation
  }
];
```

#### Key Implementation Details

1. **Cross-Section View (Left)**: 
   - Uses orthographic viewport positioned along centerline at 30% point
   - Camera looks down the vessel centerline for true cross-sectional anatomy
   - Uses `setupOrthographicCrossSection()` function

2. **Longitudinal CPR (Middle)**:
   - Uses vtkImageCPRMapper in stretched mode 
   - Standard camera positioning with default direction matrix
   - Shows vessel unrolled along its length

3. **Side View CPR (Right)**:
   - Same CPR mapper as middle but with rotated direction matrix
   - Direction matrix: `[0,1,0, -1,0,0, 0,0,1]` (90° rotation around Z)
   - Same camera as middle view - rotation handled by direction matrix

#### Critical Implementation Notes

**Cornerstone3D Integration Pattern:**
- Create Cornerstone3D orthographic viewports first using `renderingEngine.enableElement()`
- Set volumes on viewports: `csViewport.setVolumes([{ volumeId }])`
- Convert Cornerstone volume to VTK ImageData for CPR mapper
- Create VTK CPR actors and add to Cornerstone viewports: `csViewport.addActor({ uid, actor })`
- Use Cornerstone camera controls: `csViewport.setCamera()`, not VTK camera methods

**Volume Data Access**: 
- Use `volume.voxelManager.getCompleteScalarDataArray()` instead of `volume.getScalarData()` to avoid timeout issues
- Manually set scalars on VTK ImageData: `imageData.getPointData().setScalars(scalarArray)`

**CPR Configuration:**
- **CPR Width**: 150mm provides optimal coverage without cropping
- **Direction Matrix**: Essential for side view - rotates CPR reconstruction, not camera
- **Camera Positioning**: All CPR views use same working camera configuration
- **Centerline Generation**: Uses `CenterlineGenerator.generateFromRootPoints()` with proper normals

**Key Integration Points:**
```typescript
// 1. Create Cornerstone viewport
renderingEngine.enableElement({
  viewportId: 'cpr-longitudinal',
  type: CornerstoneEnums.ViewportType.ORTHOGRAPHIC,
  element: elementRef.current
});

// 2. Add VTK CPR actor to Cornerstone viewport
const csViewport = renderingEngine.getViewport('cpr-longitudinal');
const mapper = vtkImageCPRMapper.newInstance();
const actor = vtkImageSlice.newInstance();
actor.setMapper(mapper);
csViewport.addActor({ uid: 'cprActor', actor });
```

#### Troubleshooting
- **Black screens** = camera looking at edge of 2D CPR plane; use direction matrix instead of camera rotation
- **Grey boxes** = volume data access issues; ensure voxelManager usage 
- **Cropping** = insufficient CPR width; use 150mm minimum
- **API errors** = mixing VTK.js and Cornerstone3D camera methods; use Cornerstone3D APIs only
