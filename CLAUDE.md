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
