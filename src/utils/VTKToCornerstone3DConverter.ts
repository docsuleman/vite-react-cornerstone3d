import { imageLoader, cache } from '@cornerstonejs/core';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

interface VTKImageInfo {
  imageData: any; // VTK ImageData
  width: number;
  height: number;
  transformData: any;
}

interface SyntheticImageMetadata {
  imageId: string;
  pixelData: ArrayBuffer;
  width: number;
  height: number;
  spacing: [number, number, number];
  origin: [number, number, number];
  direction: Float32Array;
  transformData: any;
}

/**
 * VTK to Cornerstone3D Converter
 * Converts VTK ImageData to Cornerstone3D compatible format with synthetic imageIds
 */
export class VTKToCornerstone3DConverter {
  private syntheticImages: Map<string, SyntheticImageMetadata> = new Map();
  private static instance: VTKToCornerstone3DConverter;

  constructor() {
    // Register our custom image loader for synthetic CPR images
    this.registerSyntheticImageLoader();
  }

  static getInstance(): VTKToCornerstone3DConverter {
    if (!VTKToCornerstone3DConverter.instance) {
      VTKToCornerstone3DConverter.instance = new VTKToCornerstone3DConverter();
    }
    return VTKToCornerstone3DConverter.instance;
  }

  /**
   * Convert VTK ImageData to Cornerstone3D compatible imageIds
   */
  async convertVTKImageToCornerstoneImageIds(
    vtkImageInfo: VTKImageInfo,
    seriesPrefix: string = 'synthetic_cpr'
  ): Promise<string[]> {
    console.log('🔄 Converting VTK ImageData to Cornerstone3D format...');

    const { imageData, width, height, transformData } = vtkImageInfo;
    
    if (!imageData) {
      throw new Error('VTK ImageData is null or undefined');
    }

    // Get VTK image properties
    const dimensions = imageData.getDimensions();
    const spacing = imageData.getSpacing();
    const origin = imageData.getOrigin();
    const scalars = imageData.getPointData().getScalars();
    
    if (!scalars) {
      throw new Error('VTK ImageData has no scalar data');
    }

    const scalarData = scalars.getData();
    
    console.log('📊 VTK Image properties:', {
      dimensions,
      spacing,
      origin,
      scalarDataLength: scalarData.length,
      scalarDataType: scalarData.constructor.name
    });

    // For 2D CPR images, we'll create a single slice
    // If it's 3D, we'll create multiple slices
    const numSlices = dimensions[2] || 1;
    const imageIds: string[] = [];
    
    for (let sliceIndex = 0; sliceIndex < numSlices; sliceIndex++) {
      const imageId = `${seriesPrefix}://slice_${sliceIndex}_${Date.now()}`;
      
      // Extract slice data
      const slicePixelData = this.extractSliceData(
        scalarData, 
        dimensions, 
        sliceIndex
      );
      
      // Convert to appropriate format for Cornerstone3D
      const pixelDataBuffer = this.convertToCornerstone3DFormat(
        slicePixelData,
        dimensions[0],
        dimensions[1]
      );
      
      // Create metadata
      const metadata: SyntheticImageMetadata = {
        imageId,
        pixelData: pixelDataBuffer,
        width: dimensions[0],
        height: dimensions[1],
        spacing: [spacing[0], spacing[1], spacing[2] || 1],
        origin: [
          origin[0], 
          origin[1], 
          origin[2] + (sliceIndex * (spacing[2] || 1))
        ],
        direction: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), // Identity for now
        transformData
      };
      
      // Store metadata
      this.syntheticImages.set(imageId, metadata);
      imageIds.push(imageId);
      
      console.log(`✅ Created synthetic imageId: ${imageId} (slice ${sliceIndex}/${numSlices})`);
    }
    
    console.log('✅ VTK to Cornerstone3D conversion complete:', {
      totalSlices: numSlices,
      imageIds: imageIds.length
    });
    
    return imageIds;
  }

  /**
   * Extract slice data from VTK scalar array
   */
  private extractSliceData(
    scalarData: any,
    dimensions: number[],
    sliceIndex: number
  ): ArrayLike<number> {
    const [width, height, depth] = dimensions;
    const sliceSize = width * height;
    
    if (depth === 1 || sliceIndex === 0) {
      // 2D image or first slice
      return scalarData;
    }
    
    // Extract specific slice from 3D data
    const startIndex = sliceIndex * sliceSize;
    const endIndex = startIndex + sliceSize;
    
    return scalarData.slice(startIndex, endIndex);
  }

  /**
   * Convert VTK scalar data to Cornerstone3D format
   */
  private convertToCornerstone3DFormat(
    sliceData: ArrayLike<number>,
    width: number,
    height: number
  ): ArrayBuffer {
    // Convert to Uint16Array (common for medical images)
    // Scale values to appropriate range if needed
    const uint16Data = new Uint16Array(sliceData.length);
    
    // Find min/max for scaling
    let min = Number.MAX_VALUE;
    let max = Number.MIN_VALUE;
    for (let i = 0; i < sliceData.length; i++) {
      if (sliceData[i] < min) min = sliceData[i];
      if (sliceData[i] > max) max = sliceData[i];
    }
    
    // Scale to 16-bit range
    const range = max - min;
    const scale = range > 0 ? 65535 / range : 1;
    
    for (let i = 0; i < sliceData.length; i++) {
      uint16Data[i] = Math.round((sliceData[i] - min) * scale);
    }
    
    return uint16Data.buffer;
  }

  /**
   * Register custom image loader for synthetic CPR images
   */
  private registerSyntheticImageLoader(): void {
    // Register loader for our synthetic images
    imageLoader.registerImageLoader('synthetic_cpr', this.syntheticImageLoader.bind(this));
    
    console.log('✅ Registered synthetic CPR image loader');
  }

  /**
   * Custom image loader for synthetic CPR images
   */
  private async syntheticImageLoader(imageId: string): Promise<any> {
    console.log('🔄 Loading synthetic CPR image:', imageId);
    
    const metadata = this.syntheticImages.get(imageId);
    if (!metadata) {
      throw new Error(`Synthetic image not found: ${imageId}`);
    }
    
    // Create Cornerstone3D compatible image object
    const image = {
      imageId,
      minPixelValue: 0,
      maxPixelValue: 65535,
      slope: 1,
      intercept: 0,
      windowCenter: 32767,
      windowWidth: 65535,
      getPixelData: () => new Uint16Array(metadata.pixelData),
      getCanvas: () => {
        // Create canvas for rendering
        const canvas = document.createElement('canvas');
        canvas.width = metadata.width;
        canvas.height = metadata.height;
        return canvas;
      },
      rows: metadata.height,
      columns: metadata.width,
      height: metadata.height,
      width: metadata.width,
      color: false,
      rgba: false,
      columnPixelSpacing: metadata.spacing[0],
      rowPixelSpacing: metadata.spacing[1],
      sliceThickness: metadata.spacing[2],
      sliceLocation: metadata.origin[2],
      imagePositionPatient: metadata.origin,
      imageOrientationPatient: Array.from(metadata.direction),
      photometricInterpretation: 'MONOCHROME2',
      pixelRepresentation: 0,
      bitsAllocated: 16,
      bitsStored: 16,
      highBit: 15,
      samplesPerPixel: 1,
      transformData: metadata.transformData // Custom property for coordinate conversion
    };
    
    console.log('✅ Synthetic CPR image loaded:', {
      imageId,
      dimensions: [metadata.width, metadata.height],
      spacing: metadata.spacing,
      hasTransformData: !!metadata.transformData
    });
    
    return { promise: Promise.resolve(image) };
  }

  /**
   * Get transform data for a specific imageId
   */
  getTransformDataForImageId(imageId: string): any {
    const metadata = this.syntheticImages.get(imageId);
    return metadata?.transformData || null;
  }

  /**
   * Create a volume from multiple CPR slices
   */
  async createVolumeFromCPRSlices(
    vtkImageInfos: VTKImageInfo[],
    volumeId: string
  ): Promise<string[]> {
    console.log('🔄 Creating volume from multiple CPR slices...');
    
    const allImageIds: string[] = [];
    
    for (let i = 0; i < vtkImageInfos.length; i++) {
      const imageIds = await this.convertVTKImageToCornerstoneImageIds(
        vtkImageInfos[i],
        `${volumeId}_view${i}`
      );
      allImageIds.push(...imageIds);
    }
    
    console.log('✅ Volume created from CPR slices:', {
      volumeId,
      totalSlices: allImageIds.length,
      views: vtkImageInfos.length
    });
    
    return allImageIds;
  }

  /**
   * Clean up synthetic images from memory
   */
  cleanup(seriesPrefix?: string): void {
    if (seriesPrefix) {
      // Remove specific series
      for (const [imageId, metadata] of this.syntheticImages.entries()) {
        if (imageId.startsWith(seriesPrefix)) {
          this.syntheticImages.delete(imageId);
          // Also remove from Cornerstone cache if needed
          cache.removeImageLoadObject(imageId);
        }
      }
    } else {
      // Remove all synthetic images
      this.syntheticImages.clear();
    }
    
    console.log('🧹 Cleaned up synthetic images:', seriesPrefix || 'all');
  }

  /**
   * Get all synthetic image IDs
   */
  getSyntheticImageIds(): string[] {
    return Array.from(this.syntheticImages.keys());
  }

  /**
   * Check if an imageId is synthetic
   */
  isSyntheticImageId(imageId: string): boolean {
    return imageId.startsWith('synthetic_cpr://');
  }
}

// Export singleton instance
export default VTKToCornerstone3DConverter.getInstance();