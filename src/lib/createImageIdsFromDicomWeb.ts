import cornerstoneDICOMImageLoader from "@cornerstonejs/dicom-image-loader";
import { dicomWebService } from '../services/DicomWebService';

/**
 * Enhanced version of createImageIdsAndCacheMetaData that works with DicomWebService
 * and supports the TAVI workflow
 */
export default async function createImageIdsFromDicomWeb({
  StudyInstanceUID,
  SeriesInstanceUID,
  SOPInstanceUID = null,
  wadoRsRoot = "http://192.168.2.52/orthanc/dicom-web",
}: {
  StudyInstanceUID: string;
  SeriesInstanceUID: string;
  SOPInstanceUID?: string | null;
  wadoRsRoot?: string;
}): Promise<string[]> {
  const SOP_INSTANCE_UID = "00080018";
  const SERIES_INSTANCE_UID = "0020000E";

  try {
    // Use the DicomWebService to get series metadata
    const instances = await dicomWebService.getSeriesMetadata(StudyInstanceUID, SeriesInstanceUID);
    
    const imageIds = instances.map((instanceMetaData) => {
      const SeriesInstanceUID = instanceMetaData[SERIES_INSTANCE_UID].Value[0];
      const SOPInstanceUIDToUse =
        SOPInstanceUID || instanceMetaData[SOP_INSTANCE_UID].Value[0];

      const prefix = "wadors:";

      const imageId =
        prefix +
        wadoRsRoot +
        "/studies/" +
        StudyInstanceUID +
        "/series/" +
        SeriesInstanceUID +
        "/instances/" +
        SOPInstanceUIDToUse +
        "/frames/1";

      // Cache the metadata
      cornerstoneDICOMImageLoader.wadors.metaDataManager.add(
        imageId,
        instanceMetaData
      );
      
      return imageId;
    });

    console.log(`Created ${imageIds.length} image IDs for series ${SeriesInstanceUID}`);
    return imageIds;
  } catch (error) {
    console.error("Error creating image IDs from DICOM-web:", error);
    throw new Error(`Failed to create image IDs: ${error.message}`);
  }
}

/**
 * Get all series for a study and their image counts
 */
export async function getStudySeriesInfo(studyInstanceUID: string): Promise<{
  seriesInstanceUID: string;
  seriesDescription?: string;
  modality?: string;
  imageCount: number;
  seriesNumber?: string;
}[]> {
  try {
    const series = await dicomWebService.getSeriesForStudy(studyInstanceUID);
    
    return series.map(s => ({
      seriesInstanceUID: s.SeriesInstanceUID,
      seriesDescription: s.SeriesDescription,
      modality: s.Modality,
      imageCount: s.NumberOfSeriesRelatedInstances || 0,
      seriesNumber: s.SeriesNumber,
    }));
  } catch (error) {
    console.error("Error getting study series info:", error);
    throw new Error(`Failed to get series info: ${error.message}`);
  }
}

/**
 * Filter and prioritize series for TAVI workflow
 */
export function prioritizeSeriesForTAVI(seriesInfo: ReturnType<typeof getStudySeriesInfo> extends Promise<infer U> ? U : never): typeof seriesInfo {
  const prioritized = [...seriesInfo];
  
  // Sort by priority for TAVI planning
  prioritized.sort((a, b) => {
    // Prioritize CT modality
    if (a.modality === 'CT' && b.modality !== 'CT') return -1;
    if (b.modality === 'CT' && a.modality !== 'CT') return 1;
    
    // Prioritize cardiac/coronary series
    const aIsCardiac = isCardiacSeries(a.seriesDescription);
    const bIsCardiac = isCardiacSeries(b.seriesDescription);
    
    if (aIsCardiac && !bIsCardiac) return -1;
    if (bIsCardiac && !aIsCardiac) return 1;
    
    // Prioritize by image count (more images usually better for reconstruction)
    return b.imageCount - a.imageCount;
  });
  
  return prioritized;
}

/**
 * Check if a series is likely cardiac imaging
 */
function isCardiacSeries(description?: string): boolean {
  if (!description) return false;
  
  const cardiacKeywords = [
    'cardiac', 'coronary', 'aorta', 'heart', 'cta', 'angio',
    'valve', 'tavi', 'tavr', 'aortic', 'ecg', 'gated'
  ];
  
  const lowerDescription = description.toLowerCase();
  return cardiacKeywords.some(keyword => lowerDescription.includes(keyword));
}

/**
 * Validate series for TAVI planning
 */
export function validateSeriesForTAVI(seriesInfo: {
  seriesInstanceUID: string;
  seriesDescription?: string;
  modality?: string;
  imageCount: number;
}): {
  isValid: boolean;
  warnings: string[];
  recommendations: string[];
} {
  const warnings: string[] = [];
  const recommendations: string[] = [];
  let isValid = true;
  
  // Check modality
  if (seriesInfo.modality !== 'CT') {
    warnings.push(`Series modality is ${seriesInfo.modality}, CT is preferred for TAVI planning`);
    if (seriesInfo.modality !== 'MR') {
      isValid = false;
    }
  }
  
  // Check image count
  if (seriesInfo.imageCount < 100) {
    warnings.push(`Series has only ${seriesInfo.imageCount} images, which may be insufficient for detailed planning`);
    if (seriesInfo.imageCount < 50) {
      isValid = false;
    }
  }
  
  // Check if it appears to be cardiac imaging
  if (!isCardiacSeries(seriesInfo.seriesDescription)) {
    warnings.push('Series does not appear to be cardiac imaging based on description');
    recommendations.push('Verify this is the correct series for cardiac assessment');
  }
  
  // Recommendations for optimal series
  if (seriesInfo.imageCount > 300) {
    recommendations.push('This series has good image count for detailed reconstruction');
  }
  
  if (isCardiacSeries(seriesInfo.seriesDescription)) {
    recommendations.push('Series appears to be cardiac imaging - good for TAVI planning');
  }
  
  return {
    isValid,
    warnings,
    recommendations,
  };
}