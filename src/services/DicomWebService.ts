import { api } from "dicomweb-client";

export interface Patient {
  PatientID: string;
  PatientName: string;
  PatientBirthDate?: string;
  PatientSex?: string;
}

export interface Study {
  StudyInstanceUID: string;
  StudyDate?: string;
  StudyTime?: string;
  StudyDescription?: string;
  AccessionNumber?: string;
  PatientID: string;
  PatientName: string;
}

export interface Series {
  SeriesInstanceUID: string;
  StudyInstanceUID: string;
  SeriesNumber?: string;
  SeriesDescription?: string;
  Modality?: string;
  NumberOfSeriesRelatedInstances?: number;
  SeriesDate?: string;
  SeriesTime?: string;
}

export interface Instance {
  SOPInstanceUID: string;
  SeriesInstanceUID: string;
  StudyInstanceUID: string;
  InstanceNumber?: string;
}

class DicomWebService {
  private client: api.DICOMwebClient;
  private wadoRsRoot: string;

  constructor(wadoRsRoot = "http://192.168.2.52/orthanc/dicom-web") {
    this.wadoRsRoot = wadoRsRoot;
    this.client = new api.DICOMwebClient({ 
      url: wadoRsRoot, 
      singlepart: true 
    });
  }

  /**
   * Search for patients in the DICOM server
   */
  async searchPatients(searchParams?: {
    PatientID?: string;
    PatientName?: string;
  }): Promise<Patient[]> {
    try {
      const searchOptions: any = {};
      
      if (searchParams?.PatientID) {
        searchOptions.PatientID = searchParams.PatientID;
      }
      
      if (searchParams?.PatientName) {
        searchOptions.PatientName = `*${searchParams.PatientName}*`;
      }

      // Use searchForStudies but apply proper filtering
      const studies = await this.client.searchForStudies({ queryParams: searchOptions });
      
      // Group by patient and deduplicate, applying client-side filtering if needed
      const patientMap = new Map<string, Patient>();
      
      studies.forEach((study: any) => {
        const patientID = this.extractValue(study, "00100020"); // Patient ID
        const patientName = this.extractValue(study, "00100010"); // Patient Name
        const patientBirthDate = this.extractValue(study, "00100030"); // Patient Birth Date
        const patientSex = this.extractValue(study, "00100040"); // Patient Sex
        
        // Apply strict client-side filtering 
        let includePatient = true;
        
        if (searchParams?.PatientName) {
          const searchTerm = searchParams.PatientName.toLowerCase().trim();
          const nameToCheck = (patientName || '').toLowerCase().trim();
          
          // More strict matching - search term must be found in patient name
          includePatient = nameToCheck.includes(searchTerm) && searchTerm.length > 0;
          
          // Debug logging
          console.log(`Checking patient: "${nameToCheck}" against search: "${searchTerm}" - Include: ${includePatient}`);
        }
        
        if (searchParams?.PatientID) {
          const searchID = searchParams.PatientID.toLowerCase().trim();
          const idToCheck = (patientID || '').toLowerCase().trim();
          includePatient = includePatient && idToCheck.includes(searchID);
        }
        
        if (patientID && includePatient && !patientMap.has(patientID)) {
          patientMap.set(patientID, {
            PatientID: patientID,
            PatientName: String(patientName || "Unknown Patient"),
            PatientBirthDate: patientBirthDate,
            PatientSex: patientSex,
          });
        }
      });
      
      return Array.from(patientMap.values());
    } catch (error) {
      console.error("Error searching patients:", error);
      throw new Error("Failed to search patients");
    }
  }

  /**
   * Get studies for a specific patient
   */
  async getStudiesForPatient(patientID: string): Promise<Study[]> {
    try {
      const studies = await this.client.searchForStudies({
        queryParams: { PatientID: patientID },
      });

      return studies
        .map((study: any) => ({
          StudyInstanceUID: this.extractValue(study, "0020000D") || "",
          StudyDate: this.extractValue(study, "00080020"),
          StudyTime: this.extractValue(study, "00080030"),
          StudyDescription: this.extractValue(study, "00081030"),
          AccessionNumber: this.extractValue(study, "00080050"),
          PatientID: this.extractValue(study, "00100020") || "",
          PatientName: this.extractValue(study, "00100010") || "Unknown Patient",
        }))
        .filter((study: Study) => {
          // Ensure study belongs to the requested patient
          const belongsToPatient = study.PatientID === patientID;
          if (!belongsToPatient) {
            console.warn(`Study ${study.StudyInstanceUID} does not belong to patient ${patientID}, belongs to ${study.PatientID}`);
          }
          return belongsToPatient;
        });
    } catch (error) {
      console.error("Error getting studies for patient:", error);
      throw new Error("Failed to get studies for patient");
    }
  }

  /**
   * Get series for a specific study
   */
  async getSeriesForStudy(studyInstanceUID: string): Promise<Series[]> {
    try {
      const series = await this.client.searchForSeries({
        queryParams: { StudyInstanceUID: studyInstanceUID },
      });

      return series
        .map((s: any) => ({
          SeriesInstanceUID: this.extractValue(s, "0020000E"),
          StudyInstanceUID: this.extractValue(s, "0020000D"),
          SeriesNumber: this.extractValue(s, "00200011"),
          SeriesDescription: this.extractValue(s, "0008103E"),
          Modality: this.extractValue(s, "00080060"),
          NumberOfSeriesRelatedInstances: parseInt(this.extractValue(s, "00201209") || "0"),
          SeriesDate: this.extractValue(s, "00080021"),
          SeriesTime: this.extractValue(s, "00080031"),
        }))
        .filter((series: Series) => {
          // Ensure series belongs to the requested study
          const belongsToStudy = series.StudyInstanceUID === studyInstanceUID;
          if (!belongsToStudy) {
            console.warn(`Series ${series.SeriesInstanceUID} does not belong to study ${studyInstanceUID}`);
          }
          return belongsToStudy;
        });
    } catch (error) {
      console.error("Error getting series for study:", error);
      throw new Error("Failed to get series for study");
    }
  }

  /**
   * Get instances for a specific series
   */
  async getInstancesForSeries(
    studyInstanceUID: string,
    seriesInstanceUID: string
  ): Promise<Instance[]> {
    try {
      const instances = await this.client.searchForInstances({
        queryParams: { StudyInstanceUID: studyInstanceUID, SeriesInstanceUID: seriesInstanceUID },
      });

      return instances.map((instance: any) => ({
        SOPInstanceUID: this.extractValue(instance, "00080018"),
        SeriesInstanceUID: this.extractValue(instance, "0020000E"),
        StudyInstanceUID: this.extractValue(instance, "0020000D"),
        InstanceNumber: this.extractValue(instance, "00200013"),
      }));
    } catch (error) {
      console.error("Error getting instances for series:", error);
      throw new Error("Failed to get instances for series");
    }
  }

  /**
   * Get instances for a series (simplified method)
   */
  async getInstancesForSeriesOnly(seriesInstanceUID: string): Promise<Instance[]> {
    try {
      const instances = await this.client.searchForInstances({
        queryParams: { SeriesInstanceUID: seriesInstanceUID },
      });

      return instances
        .map((instance: any) => ({
          SOPInstanceUID: this.extractValue(instance, "00080018"),
          SeriesInstanceUID: this.extractValue(instance, "0020000E"),
          StudyInstanceUID: this.extractValue(instance, "0020000D"),
          InstanceNumber: this.extractValue(instance, "00200013"),
        }))
        .filter((instance: Instance) => {
          // Ensure instance belongs to the requested series
          const belongsToSeries = instance.SeriesInstanceUID === seriesInstanceUID;
          if (!belongsToSeries) {
            console.warn(`Instance ${instance.SOPInstanceUID} does not belong to series ${seriesInstanceUID}`);
          }
          return belongsToSeries;
        });
    } catch (error) {
      console.error("Error getting instances for series:", error);
      throw new Error("Failed to get instances for series");
    }
  }

  /**
   * Get series metadata for creating image IDs
   */
  async getSeriesMetadata(
    studyInstanceUID: string,
    seriesInstanceUID: string
  ): Promise<any[]> {
    try {
      const instances = await this.client.retrieveSeriesMetadata({
        studyInstanceUID,
        seriesInstanceUID,
      });

      return instances;
    } catch (error) {
      console.error("Error getting series metadata:", error);
      throw new Error("Failed to get series metadata");
    }
  }

  /**
   * Filter series by modality (e.g., CT for cardiac imaging)
   */
  filterSeriesByModality(series: Series[], modalities: string[]): Series[] {
    return series.filter((s) => 
      s.Modality && modalities.includes(s.Modality.toUpperCase())
    );
  }

  /**
   * Filter series by description patterns (e.g., cardiac, coronary, etc.)
   */
  filterSeriesByDescription(series: Series[], patterns: string[]): Series[] {
    return series.filter((s) => {
      if (!s.SeriesDescription) return false;
      const description = s.SeriesDescription.toLowerCase();
      return patterns.some(pattern => 
        description.includes(pattern.toLowerCase())
      );
    });
  }

  /**
   * Get WADO-RS root URL
   */
  getWadoRsRoot(): string {
    return this.wadoRsRoot;
  }

  /**
   * Get the DICOM client instance
   */
  getClient(): api.DICOMwebClient {
    return this.client;
  }

  /**
   * Extract value from DICOM tag
   */
  private extractValue(dataset: any, tag: string): string | undefined {
    const element = dataset[tag];
    if (!element) return undefined;
    
    if (element.Value && element.Value.length > 0) {
      const value = element.Value[0];
      
      // Handle DICOM Person Name format (has Alphabetic property)
      if (typeof value === 'object' && value.Alphabetic) {
        return value.Alphabetic;
      }
      
      // Handle regular string values
      if (typeof value === 'string') {
        return value;
      }
      
      // Handle other object types by converting to string
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      
      return String(value);
    }
    
    return undefined;
  }
}

// Create singleton instance
export const dicomWebService = new DicomWebService();
export default DicomWebService;