import { init as csRenderInit, imageLoader } from '@cornerstonejs/core';
import { init as csToolsInit } from '@cornerstonejs/tools';
import { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

let isInitialized = false;

export const initializeCornerstone = async (): Promise<void> => {
  if (isInitialized) {
    return;
  }

  try {
    // Initialize Cornerstone3D Core
    await csRenderInit();

    // Initialize Cornerstone3D Tools
    await csToolsInit();

    // Initialize DICOM Image Loader with configuration for Orthanc
    dicomImageLoaderInit({
      maxWebWorkers: navigator.hardwareConcurrency || 1,
    });

    // Configure DICOM Image Loader for better metadata handling
    try {
      // Access the configure method if available
      if ((dicomImageLoader as any).configure) {
        (dicomImageLoader as any).configure({
          useWebWorkers: true,
          decodeConfig: {
            convertFloatPixelDataToInt: false,
            use16BitDataType: false,
          },
          maxWebWorkers: navigator.hardwareConcurrency || 1,
        });
      }
    } catch (error) {
    }

    // Register WADO-RS image loader for Orthanc
    imageLoader.registerImageLoader('wadors', dicomImageLoader.wadors.loadImage as any);

    // Register WADO-URI image loader for Orthanc
    imageLoader.registerImageLoader('wadouri', dicomImageLoader.wadouri.loadImage as any);

    // Register web image loader for test images
    imageLoader.registerImageLoader('web', ((imageId: string) => {
      const url = imageId.substring(4); // Remove 'web:' prefix
      const promise = new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d');
          if (context) {
            context.drawImage(image, 0, 0);
            const imageData = context.getImageData(0, 0, image.width, image.height);
            
            resolve({
              imageId,
              width: image.width,
              height: image.height,
              color: true,
              columnPixelSpacing: 1,
              rowPixelSpacing: 1,
              intercept: 0,
              slope: 1,
              windowCenter: 128,
              windowWidth: 256,
              render: () => {},
              getPixelData: () => imageData.data,
              rows: image.height,
              columns: image.width,
              sizeInBytes: imageData.data.length,
            } as any);
          } else {
            reject(new Error('Could not get canvas context'));
          }
        };
        image.onerror = () => reject(new Error('Failed to load image'));
        image.src = url;
      });
      
      return { promise };
    }) as any);

    isInitialized = true;

  } catch (error) {
    throw new Error(`Cornerstone3D initialization failed: ${error}`);
  }
};

export const isCornerStoneInitialized = (): boolean => {
  return isInitialized;
};