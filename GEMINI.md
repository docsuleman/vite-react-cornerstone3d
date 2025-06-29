# GEMINI.md

This file provides guidance to Gemini when working with code in this repository.

## Development Commands

- `npm run dev` - Start development server with Vite
- `npm run build` - Build for production (runs TypeScript compiler then Vite build)
- `npm run lint` - Run ESLint with TypeScript extensions
- `npm run preview` - Preview production build locally

## Architecture Overview

This is a React + Vite application for medical imaging visualization using Cornerstone3D. The app provides a multi-planar reconstruction (MPR) viewer for DICOM medical images, with a focus on TAVI planning workflows.

### Core Technologies

- **Cornerstone3D**: Main medical imaging library providing volume rendering, tools, and DICOM loading
- **React 18** with TypeScript for UI
- **Vite**: Build tool with specific WASM/CommonJS handling
- **Tailwind CSS**: For styling
- **VTK.js**: For 3D visualization components, especially for CPR and MPR viewports

### Key Components

- **App.tsx**: Main application component that initializes Cornerstone3D, sets up orthographic viewports, manages tool groups, connects to the DICOM server, and implements custom tools.
- **CPRViewport.tsx**: A React component integrating VTK.js for Curved Planar Reconstruction (CPR). It handles centerline generation, interactive controls (angle adjustment, animation), and multi-planar rendering.
- **MPRViewport.tsx**: Component for Multi-Planar Reconstruction, integrating VTK.js for DICOM viewing, slice navigation, window/level presets, and real-time image information display.
- **PatientSearch.tsx**: Handles patient selection, displaying patient lists, studies, and series.
- **TAVIApp.tsx**: Manages the overall workflow, conditionally rendering viewports based on the current stage (Patient Selection, Root Definition, Annulus Definition, Measurements, CPR Analysis).

### Custom Tools

- **SphereMarkerTool** (`src/customTools/Spheremarker.ts`): Custom 3D sphere placement tool that allows up to 3 spheres with color coding and drag functionality.
- **TAVISphereMarkerTool** (`src/customTools/TAVISphereMarkerTool.ts`): Specific to TAVI workflow.

### DICOM Integration

- Uses `createImageIdsAndCacheMetaData.ts` to fetch DICOM metadata via `dicomweb-client`.
- Configured for Orthanc DICOM server integration at `http://127.0.0.1/orthanc/dicom-web`.
- Supports WADO-RS protocol for image retrieval.

### Build Configuration Notes

- Vite config excludes Cornerstone CODEC packages from optimization to handle WASM properly.
- Uses `vite-plugin-commonjs` for `dicom-parser` CommonJS compatibility.
- Worker format set to ES modules for proper WASM handling.
- TypeScript strict mode disabled for medical imaging library compatibility.

### Viewport Management

- Grid layout with 4 viewports (axial, sagittal, coronal, plus reserved space).
- Automatic camera fitting and viewport synchronization.
- Tool activation system with primary mouse button binding.
- Progressive viewport initialization with delays to prevent race conditions.

### Data Sources

- Expects DICOM server at `127.0.0.1/orthanc/dicom-web`.
- Sample data includes Study/Series instance UIDs for testing.
- Supports VTK/NIfTI data in `src/data/` directory (e.g., `LIDC2.vti`).

## Key Problem Resolutions & Improvements

This section summarizes significant issues encountered and their implemented solutions, enhancing the application's stability, performance, and user experience.

### 1. WebGL Context & Texture Binding Fixes

**Problem**: Frequent `WebGL context not available` and `INVALID_OPERATION: bindTexture` errors, leading to grey boxes instead of images and application unresponsiveness.
**Root Causes**: Race conditions during viewport initialization, inadequate WebGL context management, improper resource cleanup, and texture binding conflicts.
**Solution**:
- **Progressive Viewport Initialization**: Staggered creation of viewports with delays (0ms, 150ms, 300ms) to prevent race conditions.
- **Enhanced WebGL Context Management**: Comprehensive validation and monitoring of WebGL context health.
- **Three-Phase Cleanup Procedure**: Phased cleanup of WebGL resources with proper delays to prevent memory leaks.
- **Volume Loading with Retry**: Implemented retry mechanism with exponential backoff for volume loading.
- **Context Loss Handling**: Event listeners for `webglcontextlost` and `webglcontextrestored` for resilience.
- **Optimized Volume Properties**: Medical imaging-specific volume rendering settings for better quality and performance.
- **Enhanced Camera Fitting**: Improved bounds checking and conservative scaling for stable camera positioning.
- **Extended Stabilization Periods**: Increased delays throughout initialization for reliable viewport creation.
- **Functionality-Based Validation**: Testing Cornerstone3D viewport functionality rather than direct WebGL context access.
- **Simplified `enableElement` Options**: Using Cornerstone3D defaults instead of custom renderer options to avoid conflicts.
**Expected Results**: Reliable display of DICOM images, graceful handling of WebGL conflicts, improved memory management, and stable performance.

### 2. CPR Viewport Optimization

**Problem**: CPR viewport failing with WebGL texture size errors even with reduced volume dimensions, and black screens instead of straightened vessels.
**Root Causes**: VTK.js `ImageCPRMapper` creating internal textures larger than GPU limits, especially on interaction.
**Solution**:
- **Adaptive GPU-based Optimization**: Adjusts volume parameters based on actual hardware capabilities.
    - **GPU Capability Detection**: Detects `gl.MAX_TEXTURE_SIZE` to adapt volume dimensions (8³, 12³, 16³ voxels).
    - **Adaptive Volume Scaling**: Reduces volume dimensions (e.g., from 64³ to 32³ or even 8³) and increases spacing to maintain physical size, significantly reducing memory usage (~87-99.8% reduction).
    - **Proportional Parameter Scaling**: CPR width, projection thickness, samples, vessel radius, and camera parameters scale proportionally with volume size.
    - **Ultra-Conservative Projection Settings**: Reduced thickness (5 units), samples (3), and width (16-32 units).
- **Simple CPR Fallback (if needed)**: A `SimpleCPRViewport` was implemented to demonstrate CPR concepts without the complex `vtkImageCPRMapper`, bypassing its texture issues by creating a 2D straightened view from synthetic data.
**Expected Results**: Elimination of WebGL texture size errors, improved compatibility with lower-end GPUs, better performance, and graceful error handling.

### 3. UI/UX Improvements

**Problem**: Patient selection modal transparency, poor text contrast, and no CT images visible after patient selection.
**Solution**:
- **Patient Selection Modal**: Increased background opacity (`bg-black bg-opacity-75`), added solid `bg-slate-900` to modal content with borders.
- **Contrast & Color Scheme**: Replaced gray scheme with slate colors for better contrast. Primary text `text-white`, secondary `text-slate-300`, tertiary `text-slate-400`. Blue accents for interactive elements.
- **Medical Image Display**: Integrated `MPRViewport` with VTK.js for automatic loading of volume data, slice navigation, window/level presets, and real-time image info.
- **PatientSearch Modal Enhancements**: Improved layout, input controls, and typography.
- **TAVIApp Integration**: Smart conditional rendering of viewports based on workflow stage.
**Expected Results**: Professional medical imaging interface with proper contrast, non-transparent modals, visible medical images, and interactive controls.

### 4. Revert to App.tsx Pattern

**Problem**: Complex WebGL context management in `ProperMPRViewport.tsx` was conflicting with Cornerstone3D's internal handling, causing various WebGL errors.
**Solution**: Reverted `ProperMPRViewport.tsx` to closely follow the proven, simpler `App.tsx` pattern.
**Removed Conflicting Elements**: Complex WebGL context validation, custom renderer options, progressive delays/retry mechanisms, and complex error recovery.
**Restored Working Pattern**: Simple, direct viewport creation, simple camera fitting, and standard Cornerstone3D tool setup.
**Lesson Learned**: Avoid interfering with Cornerstone3D's internal WebGL context management.
**Expected Results**: Elimination of WebGL texture binding conflicts, proper display of DICOM images, and standard tool functionality.

This `GEMINI.md` provides a comprehensive overview of the project, its core technologies, and the significant engineering efforts undertaken to ensure its stability and functionality.