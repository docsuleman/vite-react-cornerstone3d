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

// Helper function to detect cardiac phases
function detectCardiacPhases(instances) {
  // Official DICOM cardiac phase tags (from DICOM standard research)
  const NOMINAL_PERCENTAGE_CARDIAC_PHASE = "00209241"; // Nominal Percentage of Cardiac Phase (primary)
  const NOMINAL_CARDIAC_TRIGGER_DELAY = "00209153"; // Nominal Cardiac Trigger Delay Time (ms from R-peak)
  const ACTUAL_CARDIAC_TRIGGER_DELAY = "00209252"; // Actual Cardiac Trigger Delay Time
  const RR_INTERVAL_TIME_NOMINAL = "00209251"; // R-R Interval Time Nominal (ms)
  const CARDIAC_SYNC_SEQUENCE = "00189118"; // Cardiac Synchronization Sequence (container)
  const TEMPORAL_POSITION_INDEX = "00209128"; // Temporal Position Index

  // Fallback tags
  const TEMPORAL_POSITION_IDENTIFIER = "00200100"; // Temporal Position Identifier (older)
  const TRIGGER_TIME = "00181060"; // Trigger Time (older)
  const ACQUISITION_NUMBER = "00200012"; // Acquisition Number
  const INSTANCE_NUMBER = "00200013"; // Instance Number
  const IMAGE_POSITION_PATIENT = "00200032"; // Image Position Patient
  const SLICE_LOCATION = "00201041"; // Slice Location

  console.log('📊 Detecting phases from', instances.length, 'instances');

  // First, try to group by slice location to identify unique slices
  const sliceGroups = new Map();

  instances.forEach((instance, index) => {
    // Use slice location or image position Z coordinate to group slices
    let sliceKey = null;

    if (instance[SLICE_LOCATION]?.Value?.[0] !== undefined) {
      sliceKey = Math.round(parseFloat(instance[SLICE_LOCATION].Value[0]) * 10) / 10;
    } else if (instance[IMAGE_POSITION_PATIENT]?.Value?.[2] !== undefined) {
      sliceKey = Math.round(parseFloat(instance[IMAGE_POSITION_PATIENT].Value[2]) * 10) / 10;
    } else {
      sliceKey = index; // Fallback to index
    }

    if (!sliceGroups.has(sliceKey)) {
      sliceGroups.set(sliceKey, []);
    }
    sliceGroups.get(sliceKey).push(instance);
  });

  console.log('📊 Found', sliceGroups.size, 'unique slice locations');

  // If each slice location has multiple instances, they are likely phases
  const hasMultiplePhasesPerSlice = Array.from(sliceGroups.values()).some(group => group.length > 1);

  if (hasMultiplePhasesPerSlice) {
    // Multi-phase within same series - first check which tags actually vary
    const phasesPerSlice = Math.round(instances.length / sliceGroups.size);

    // Sample instances to check which cardiac tags are present and vary
    const sampleSize = Math.min(10, instances.length);
    const nominalPercentageValues = new Set();
    const nominalTriggerDelayValues = new Set();
    const actualTriggerDelayValues = new Set();
    const temporalIndexValues = new Set();
    const temporalPositionValues = new Set();
    const acquisitionValues = new Set();
    const triggerTimeValues = new Set();

    for (let i = 0; i < sampleSize; i++) {
      const instance = instances[i];

      // Check official cardiac phase tags
      if (instance[NOMINAL_PERCENTAGE_CARDIAC_PHASE]?.Value?.[0] !== undefined) {
        nominalPercentageValues.add(instance[NOMINAL_PERCENTAGE_CARDIAC_PHASE].Value[0]);
      }
      if (instance[NOMINAL_CARDIAC_TRIGGER_DELAY]?.Value?.[0] !== undefined) {
        nominalTriggerDelayValues.add(instance[NOMINAL_CARDIAC_TRIGGER_DELAY].Value[0]);
      }
      if (instance[ACTUAL_CARDIAC_TRIGGER_DELAY]?.Value?.[0] !== undefined) {
        actualTriggerDelayValues.add(instance[ACTUAL_CARDIAC_TRIGGER_DELAY].Value[0]);
      }
      if (instance[TEMPORAL_POSITION_INDEX]?.Value?.[0] !== undefined) {
        temporalIndexValues.add(instance[TEMPORAL_POSITION_INDEX].Value[0]);
      }

      // Check fallback tags
      if (instance[TEMPORAL_POSITION_IDENTIFIER]?.Value?.[0] !== undefined) {
        temporalPositionValues.add(instance[TEMPORAL_POSITION_IDENTIFIER].Value[0]);
      }
      if (instance[ACQUISITION_NUMBER]?.Value?.[0] !== undefined) {
        acquisitionValues.add(instance[ACQUISITION_NUMBER].Value[0]);
      }
      if (instance[TRIGGER_TIME]?.Value?.[0] !== undefined) {
        triggerTimeValues.add(Math.round(instance[TRIGGER_TIME].Value[0]));
      }
    }

    console.log(`📊 DICOM Cardiac Tags Found:`);
    console.log(`   Nominal %: ${nominalPercentageValues.size}, Nominal Trigger Delay: ${nominalTriggerDelayValues.size}, Actual Trigger Delay: ${actualTriggerDelayValues.size}`);
    console.log(`   Temporal Index: ${temporalIndexValues.size}, Temporal Position: ${temporalPositionValues.size}`);
    console.log(`   Acquisition#: ${acquisitionValues.size}, Trigger Time: ${triggerTimeValues.size}`);

    // Now group instances using a tag that actually varies
    const phaseGroups = new Map();
    const phasePercentages = new Map(); // Store actual percentages from DICOM
    let detectionMethod = 'unknown';

    instances.forEach((instance, index) => {
      let phaseId = null;
      let phasePercent = null;

      // Priority 1: Official DICOM Nominal Percentage of Cardiac Phase tag
      if (nominalPercentageValues.size > 1 && instance[NOMINAL_PERCENTAGE_CARDIAC_PHASE]?.Value?.[0] !== undefined) {
        phaseId = instance[NOMINAL_PERCENTAGE_CARDIAC_PHASE].Value[0];
        phasePercent = phaseId; // This IS the percentage
        if (index === 0) detectionMethod = 'Nominal Percentage of Cardiac Phase (0020,9241)';
      }
      // Priority 2: Nominal Cardiac Trigger Delay Time
      else if (nominalTriggerDelayValues.size > 1 && instance[NOMINAL_CARDIAC_TRIGGER_DELAY]?.Value?.[0] !== undefined) {
        phaseId = instance[NOMINAL_CARDIAC_TRIGGER_DELAY].Value[0];
        if (index === 0) detectionMethod = 'Nominal Cardiac Trigger Delay (0020,9153)';

        // Try to calculate percentage if R-R interval available
        if (instance[RR_INTERVAL_TIME_NOMINAL]?.Value?.[0] !== undefined) {
          const rrInterval = instance[RR_INTERVAL_TIME_NOMINAL].Value[0];
          phasePercent = Math.round((phaseId / rrInterval) * 100);
        }
      }
      // Priority 3: Actual Cardiac Trigger Delay Time
      else if (actualTriggerDelayValues.size > 1 && instance[ACTUAL_CARDIAC_TRIGGER_DELAY]?.Value?.[0] !== undefined) {
        phaseId = instance[ACTUAL_CARDIAC_TRIGGER_DELAY].Value[0];
        if (index === 0) detectionMethod = 'Actual Cardiac Trigger Delay (0020,9252)';

        // Try to calculate percentage if R-R interval available
        if (instance[RR_INTERVAL_TIME_NOMINAL]?.Value?.[0] !== undefined) {
          const rrInterval = instance[RR_INTERVAL_TIME_NOMINAL].Value[0];
          phasePercent = Math.round((phaseId / rrInterval) * 100);
        }
      }
      // Priority 4: Temporal Position Index
      else if (temporalIndexValues.size > 1 && instance[TEMPORAL_POSITION_INDEX]?.Value?.[0] !== undefined) {
        phaseId = instance[TEMPORAL_POSITION_INDEX].Value[0];
        if (index === 0) detectionMethod = 'Temporal Position Index (0020,9128)';
      }
      // Priority 5: Older Temporal Position Identifier
      else if (temporalPositionValues.size > 1 && instance[TEMPORAL_POSITION_IDENTIFIER]?.Value?.[0] !== undefined) {
        phaseId = instance[TEMPORAL_POSITION_IDENTIFIER].Value[0];
        if (index === 0) detectionMethod = 'Temporal Position Identifier (0020,0100)';
      }
      // Priority 6: Trigger Time (older tag)
      else if (triggerTimeValues.size > 1 && instance[TRIGGER_TIME]?.Value?.[0] !== undefined) {
        phaseId = Math.round(instance[TRIGGER_TIME].Value[0]);
        if (index === 0) detectionMethod = 'Trigger Time (0018,1060)';
      }
      // Priority 7: Acquisition Number (only if varies)
      else if (acquisitionValues.size > 1 && instance[ACQUISITION_NUMBER]?.Value?.[0] !== undefined) {
        phaseId = instance[ACQUISITION_NUMBER].Value[0];
        if (index === 0) detectionMethod = 'Acquisition Number (0020,0012)';
      }
      // Last resort: use instance number modulo (with warning)
      else {
        const instanceNum = instance[INSTANCE_NUMBER]?.Value?.[0] || index + 1;
        phaseId = (instanceNum - 1) % phasesPerSlice;
        if (index === 0) {
          detectionMethod = `⚠️ FALLBACK: Instance# modulo (NO DICOM CARDIAC TAGS FOUND)`;
          console.warn(`⚠️ WARNING: No standard DICOM cardiac phase tags found! Using instance number pattern as fallback.`);
        }
      }

      if (phaseId !== null) {
        if (!phaseGroups.has(phaseId)) {
          phaseGroups.set(phaseId, []);
          if (phasePercent !== null) {
            phasePercentages.set(phaseId, phasePercent);
          }
        }
        phaseGroups.get(phaseId).push(instance);
      }
    });

    console.log(`📊 Multi-phase series detected: ${phaseGroups.size} phases using ${detectionMethod}`);

    // Log phase group details with their IDs
    const sortedPhaseIds = Array.from(phaseGroups.keys()).sort((a, b) => {
      const aNum = typeof a === 'number' ? a : parseFloat(a);
      const bNum = typeof b === 'number' ? b : parseFloat(b);
      return aNum - bNum;
    });
    sortedPhaseIds.forEach(phaseId => {
      const instances = phaseGroups.get(phaseId);
      const percentInfo = phasePercentages.has(phaseId) ? ` (${phasePercentages.get(phaseId)}%)` : '';
      console.log(`  Phase ${phaseId}${percentInfo}: ${instances.length} instances`);
    });

    if (phaseGroups.size > 1) {
      const sortedPhases = Array.from(phaseGroups.entries()).sort((a, b) => {
        const aId = typeof a[0] === 'number' ? a[0] : parseInt(a[0]);
        const bId = typeof b[0] === 'number' ? b[0] : parseInt(b[0]);
        return aId - bId;
      });

      return {
        isMultiPhase: true,
        phases: sortedPhases.map(([id, instances], index) => {
          const percent = phasePercentages.has(id) ? phasePercentages.get(id) : null;

          // Determine display name based on what data we have
          let phaseName;
          if (percent !== null) {
            // We have a percentage - use it
            phaseName = `${percent}%`;
          } else if (detectionMethod.includes('Trigger Delay')) {
            // We have trigger delay in milliseconds
            phaseName = `${id}ms`;
          } else if (detectionMethod.includes('Trigger Time')) {
            // We have trigger time in milliseconds
            phaseName = `${id}ms`;
          } else {
            // Generic phase index
            phaseName = `Phase ${index}`;
          }

          return {
            phaseId: id,
            phaseIndex: index,
            phasePercent: percent, // Only set if we have actual DICOM percentage
            phaseName: phaseName,
            instances,
            imageCount: instances.length
          };
        }),
        totalPhases: phaseGroups.size
      };
    }
  }

  // Single phase or can't detect phases
  console.log('📊 Single phase series or phases in separate series');
  return {
    isMultiPhase: false,
    phases: [{
      phaseId: 0,
      phaseIndex: 0,
      phasePercent: 100,
      instances,
      imageCount: instances.length
    }],
    totalPhases: 1
  };
}

// REMOVED - No assumptions in medical software

export default async function createImageIdsAndCacheMetaData({
  StudyInstanceUID,
  SeriesInstanceUID,
  SOPInstanceUID = null,
  wadoRsRoot,
  client = null,
  selectedPhase = null, // New parameter to select specific phase
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
      new api.DICOMwebClient({
        url: wadoRsRoot as string,
        singlepart: true  // Revert to singlepart to avoid CORS issues
      })

    const instances = await client.retrieveSeriesMetadata(studySearchOptions)

    if (!instances || instances.length === 0) {
      throw new Error('No instances found for the given series');
    }

    // Detect cardiac phases
    const phaseInfo = detectCardiacPhases(instances);

    console.log('📊 Phase detection result:', {
      isMultiPhase: phaseInfo.isMultiPhase,
      totalPhases: phaseInfo.totalPhases,
      totalInstances: instances.length,
      selectedPhase
    });

    // If multi-phase and no phase selected, use first phase
    let instancesToUse = instances;
    if (phaseInfo.isMultiPhase) {
      console.log(`📊 Detected ${phaseInfo.totalPhases} cardiac phases`);

      // Log all phases
      phaseInfo.phases.forEach((phase, idx) => {
        console.log(`  ${phase.phaseName}: ${phase.imageCount} images`);
      });

      if (selectedPhase !== null && phaseInfo.phases[selectedPhase]) {
        instancesToUse = phaseInfo.phases[selectedPhase].instances;
        console.log(`✅ Using selected ${phaseInfo.phases[selectedPhase].phaseName} with ${instancesToUse.length} images`);
      } else {
        // Default to first phase
        const firstPhase = phaseInfo.phases[0];
        instancesToUse = firstPhase.instances;
        console.log(`✅ Using default ${firstPhase.phaseName} with ${instancesToUse.length} images`);
      }
    } else {
      console.log(`ℹ️ Single phase detected or phases in separate series - using all ${instancesToUse.length} instances`);
    }


    // Extract spacing values from the first instance to use as reference
    const firstInstance = instancesToUse[0];
    const referencePixelSpacing = firstInstance['00280030']?.Value || ['0.390625', '0.390625'];
    const referenceSliceThickness = firstInstance['00180050']?.Value?.[0] || '0.625';
    const referenceImagePosition = firstInstance['00200032']?.Value || ['-96.7', '-95.1', '1422.9375'];

    const imageIds = instancesToUse.map((instanceMetaData, index) => {
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
          '00281050': instanceMetaData['00281050'] || { Value: [40] }, // WindowCenter - CT Angiography
          '00281051': instanceMetaData['00281051'] || { Value: [350] }, // WindowWidth - CT Angiography
          '00281052': instanceMetaData['00281052'] || { Value: [0] }, // RescaleIntercept
          '00281053': instanceMetaData['00281053'] || { Value: [1] }, // RescaleSlope
          
          // CRITICAL: Use reference values for completely consistent spacing
          '00280030': { Value: [parseFloat(referencePixelSpacing[0]), parseFloat(referencePixelSpacing[1])] }, // PixelSpacing - use reference values
          '00180050': { Value: [parseFloat(referenceSliceThickness)] }, // SliceThickness - use reference values
          '00200032': instanceMetaData['00200032'] ? 
            { Value: instanceMetaData['00200032'].Value.map(v => parseFloat(v)) } :
            { Value: [
              parseFloat(referenceImagePosition[0]), 
              parseFloat(referenceImagePosition[1]), 
              parseFloat(referenceImagePosition[2]) + (index * parseFloat(referenceSliceThickness))
            ] }, // Use actual positions when available, calculated positions as fallback
          '00200037': instanceMetaData['00200037'] || { Value: [1, 0, 0, 0, 1, 0] }, // ImageOrientationPatient - only fallback if missing
        };

        // Add metadata to Cornerstone's metadata manager
        cornerstoneDICOMImageLoader.wadors.metaDataManager.add(
          imageId,
          enrichedMetadata
        )

        return imageId
      } catch (error) {
        console.warn(`Failed to process instance ${index}:`, error);
        return null;
      }
    }).filter(Boolean); // Remove null entries

    if (imageIds.length === 0) {
      throw new Error('No valid image IDs could be created from the metadata');
    }

    return {
      imageIds,
      phaseInfo  // Return phase information for UI
    };

  } catch (error) {
    console.error('❌ Error in createImageIdsAndCacheMetaData:', error);
    throw new Error(`Failed to fetch DICOM metadata: ${error.message || error}`);
  }
}
