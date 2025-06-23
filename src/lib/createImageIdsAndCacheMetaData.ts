import { api } from "dicomweb-client"
import cornerstoneDICOMImageLoader from "@cornerstonejs/dicom-image-loader"

/**
/**
 * Uses dicomweb-client to fetch metadata of a study, cache it in cornerstone,
 * and return a list of imageIds for the frames.
 *
 * Uses the app config to choose which study to fetch, and which
 * dicom-web server to fetch it from.
 *
 * @returns {string[]} An array of imageIds for instances in the study.
 */

export default async function createImageIdsAndCacheMetaData({
  StudyInstanceUID,
  SeriesInstanceUID,
  SOPInstanceUID = null,
  wadoRsRoot,
  client = null,
}) {
  const SOP_INSTANCE_UID = "00080018"
  const SERIES_INSTANCE_UID = "0020000E"

  try {
    const studySearchOptions = {
      studyInstanceUID: StudyInstanceUID,
      seriesInstanceUID: SeriesInstanceUID,
    }

    client =
      client ||
      new api.DICOMwebClient({ url: wadoRsRoot as string, singlepart: true })
    
    console.log('🔍 Fetching DICOM metadata from Orthanc...', { StudyInstanceUID, SeriesInstanceUID });
    const instances = await client.retrieveSeriesMetadata(studySearchOptions)
    
    if (!instances || instances.length === 0) {
      throw new Error('No instances found for the given series');
    }

    console.log(`📋 Found ${instances.length} instances`);

    const imageIds = instances.map((instanceMetaData, index) => {
      try {
        // Validate metadata structure
        if (!instanceMetaData[SERIES_INSTANCE_UID] || !instanceMetaData[SERIES_INSTANCE_UID].Value) {
          console.warn(`Instance ${index}: Missing SeriesInstanceUID in metadata`);
          return null;
        }

        if (!instanceMetaData[SOP_INSTANCE_UID] || !instanceMetaData[SOP_INSTANCE_UID].Value) {
          console.warn(`Instance ${index}: Missing SOPInstanceUID in metadata`);
          return null;
        }

        const SeriesInstanceUID = instanceMetaData[SERIES_INSTANCE_UID].Value[0]
        const SOPInstanceUIDToUse =
          SOPInstanceUID || instanceMetaData[SOP_INSTANCE_UID].Value[0]

        const prefix = "wadors:"

        const imageId =
          prefix +
          wadoRsRoot +
          "/studies/" +
          StudyInstanceUID +
          "/series/" +
          SeriesInstanceUID +
          "/instances/" +
          SOPInstanceUIDToUse +
          "/frames/1"

        // Enhanced metadata validation and enrichment for Cornerstone3D
        const enrichedMetadata = {
          ...instanceMetaData,
          // Ensure essential metadata properties exist
          '00280010': instanceMetaData['00280010'] || { Value: [512] }, // Rows
          '00280011': instanceMetaData['00280011'] || { Value: [512] }, // Columns
          '00280100': instanceMetaData['00280100'] || { Value: [16] }, // BitsAllocated
          '00280101': instanceMetaData['00280101'] || { Value: [16] }, // BitsStored
          '00280102': instanceMetaData['00280102'] || { Value: [15] }, // HighBit
          '00280103': instanceMetaData['00280103'] || { Value: [1] }, // PixelRepresentation
          '00281050': instanceMetaData['00281050'] || { Value: [40] }, // WindowCenter
          '00281051': instanceMetaData['00281051'] || { Value: [400] }, // WindowWidth
          '00281052': instanceMetaData['00281052'] || { Value: [0] }, // RescaleIntercept
          '00281053': instanceMetaData['00281053'] || { Value: [1] }, // RescaleSlope
        };

        // Add metadata to Cornerstone's metadata manager
        cornerstoneDICOMImageLoader.wadors.metaDataManager.add(
          imageId,
          enrichedMetadata
        )

        console.log(`✅ Added metadata for instance ${index + 1}/${instances.length}: ${SOPInstanceUIDToUse}`);
        return imageId
      } catch (error) {
        console.warn(`Failed to process instance ${index}:`, error);
        return null;
      }
    }).filter(Boolean); // Remove null entries

    if (imageIds.length === 0) {
      throw new Error('No valid image IDs could be created from the metadata');
    }

    console.log(`🎯 Successfully created ${imageIds.length} image IDs`);
    return imageIds;

  } catch (error) {
    console.error('❌ Error in createImageIdsAndCacheMetaData:', error);
    throw new Error(`Failed to fetch DICOM metadata: ${error.message || error}`);
  }
}
