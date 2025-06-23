import { getEnabledElements } from '@cornerstonejs/core';
import { PlanarFreehandROITool, Types } from '@cornerstonejs/tools';
import { Vector3 } from '@kitware/vtk.js/types';
import { AnnulusMeasurements } from '../types/WorkflowTypes';

export interface AnnulusCalculationResult extends AnnulusMeasurements {
  isValid: boolean;
  warnings: string[];
}

class AnnulusPolygonTool extends PlanarFreehandROITool {
  static toolName = 'AnnulusPolygon';
  
  private measurementUpdateCallback: ((measurements: AnnulusCalculationResult) => void) | null = null;

  constructor(
    toolProps: Types.PublicToolProps = {},
    defaultToolProps: Types.ToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        shadow: true,
        preventHandleOutsideImage: false,
        measurementUpdateCallback: null,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
    this.measurementUpdateCallback = defaultToolProps.configuration?.measurementUpdateCallback || null;
  }

  getToolName() {
    return AnnulusPolygonTool.toolName;
  }

  /**
   * Set callback for measurement updates
   */
  setMeasurementUpdateCallback(callback: (measurements: AnnulusCalculationResult) => void) {
    this.measurementUpdateCallback = callback;
  }

  /**
   * Calculate measurements for completed annotation
   */
  calculateMeasurementsForAnnotation(annotation: any) {
    if (annotation && annotation.data && annotation.data.handles && annotation.data.handles.points) {
      const measurements = this.calculateAnnulusMeasurements(annotation.data.handles.points);
      
      // Store measurements in the annotation
      annotation.data.measurements = measurements;
      
      // Notify callback
      if (this.measurementUpdateCallback) {
        this.measurementUpdateCallback(measurements);
      }
      
      return measurements;
    }
    return null;
  }

  /**
   * Calculate annulus measurements from polygon points
   */
  calculateAnnulusMeasurements(points: Vector3[]): AnnulusCalculationResult {
    const warnings: string[] = [];
    
    if (points.length < 3) {
      return {
        area: 0,
        perimeter: 0,
        areaDerivedDiameter: 0,
        perimeterDerivedDiameter: 0,
        polygonPoints: points,
        timestamp: Date.now(),
        isValid: false,
        warnings: ['Polygon requires at least 3 points'],
      };
    }

    // Validate polygon points
    if (points.length < 8) {
      warnings.push('Annulus tracing should have at least 8 points for accurate measurement');
    }

    if (points.length > 50) {
      warnings.push('Polygon has many points - consider simplifying for better performance');
    }

    // Calculate area using shoelace formula
    const area = this.calculatePolygonArea(points);
    
    // Calculate perimeter
    const perimeter = this.calculatePolygonPerimeter(points);
    
    // Calculate derived diameters
    const areaDerivedDiameter = 2 * Math.sqrt(area / Math.PI);
    const perimeterDerivedDiameter = perimeter / Math.PI;

    // Validation checks
    const isValid = this.validateMeasurements({
      area,
      perimeter,
      areaDerivedDiameter,
      perimeterDerivedDiameter,
    }, warnings);

    return {
      area,
      perimeter,
      areaDerivedDiameter,
      perimeterDerivedDiameter,
      polygonPoints: [...points],
      timestamp: Date.now(),
      isValid,
      warnings,
    };
  }

  /**
   * Calculate polygon area using the shoelace formula
   */
  private calculatePolygonArea(points: Vector3[]): number {
    if (points.length < 3) return 0;

    let area = 0;
    const n = points.length;

    // Convert 3D points to 2D by using the first two coordinates
    // This assumes we're working in a planar view where z is constant or ignored
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += points[i][0] * points[j][1];
      area -= points[j][0] * points[i][1];
    }

    return Math.abs(area) / 2;
  }

  /**
   * Calculate polygon perimeter
   */
  private calculatePolygonPerimeter(points: Vector3[]): number {
    if (points.length < 2) return 0;

    let perimeter = 0;
    
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const dx = points[j][0] - points[i][0];
      const dy = points[j][1] - points[i][1];
      const dz = points[j][2] - points[i][2];
      
      perimeter += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    return perimeter;
  }

  /**
   * Validate measurements and add warnings
   */
  private validateMeasurements(
    measurements: { area: number; perimeter: number; areaDerivedDiameter: number; perimeterDerivedDiameter: number },
    warnings: string[]
  ): boolean {
    let isValid = true;

    // Check for reasonable annulus dimensions (typical aortic valve annulus)
    if (measurements.areaDerivedDiameter < 15 || measurements.areaDerivedDiameter > 35) {
      warnings.push(`Area-derived diameter (${measurements.areaDerivedDiameter.toFixed(1)}mm) is outside typical range (15-35mm)`);
      if (measurements.areaDerivedDiameter < 10 || measurements.areaDerivedDiameter > 50) {
        isValid = false;
      }
    }

    if (measurements.perimeterDerivedDiameter < 15 || measurements.perimeterDerivedDiameter > 35) {
      warnings.push(`Perimeter-derived diameter (${measurements.perimeterDerivedDiameter.toFixed(1)}mm) is outside typical range (15-35mm)`);
      if (measurements.perimeterDerivedDiameter < 10 || measurements.perimeterDerivedDiameter > 50) {
        isValid = false;
      }
    }

    // Check consistency between area and perimeter derived diameters
    const diameterDifference = Math.abs(measurements.areaDerivedDiameter - measurements.perimeterDerivedDiameter);
    const averageDiameter = (measurements.areaDerivedDiameter + measurements.perimeterDerivedDiameter) / 2;
    const percentDifference = (diameterDifference / averageDiameter) * 100;

    if (percentDifference > 15) {
      warnings.push(`Large difference between area and perimeter diameters (${percentDifference.toFixed(1)}%) - check polygon accuracy`);
    }

    // Check for minimum area
    if (measurements.area < 100) {
      warnings.push('Annulus area appears very small - verify measurement accuracy');
      if (measurements.area < 50) {
        isValid = false;
      }
    }

    // Check for maximum area
    if (measurements.area > 1500) {
      warnings.push('Annulus area appears very large - verify measurement accuracy');
      if (measurements.area > 2000) {
        isValid = false;
      }
    }

    return isValid;
  }

  /**
   * Get measurement statistics for quality assessment
   */
  getMeasurementStatistics(measurements: AnnulusMeasurements): {
    circularity: number;
    elongation: number;
    qualityScore: number;
  } {
    const { area, perimeter } = measurements;
    
    // Circularity: 4π * area / perimeter²
    // Perfect circle = 1, less circular shapes < 1
    const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
    
    // Calculate bounding box for elongation (simplified)
    const areaRadius = Math.sqrt(area / Math.PI);
    const perimeterRadius = perimeter / (2 * Math.PI);
    const elongation = Math.abs(areaRadius - perimeterRadius) / Math.max(areaRadius, perimeterRadius);
    
    // Quality score based on circularity and consistency
    const diameterConsistency = 1 - Math.abs(measurements.areaDerivedDiameter - measurements.perimeterDerivedDiameter) / 
                               Math.max(measurements.areaDerivedDiameter, measurements.perimeterDerivedDiameter);
    
    const qualityScore = (circularity * 0.4 + diameterConsistency * 0.6) * 100;
    
    return {
      circularity: Math.min(circularity, 1), // Cap at 1 for display
      elongation,
      qualityScore: Math.max(0, Math.min(100, qualityScore)),
    };
  }

  /**
   * Format measurements for display
   */
  formatMeasurementsForDisplay(measurements: AnnulusMeasurements): {
    area: string;
    perimeter: string;
    areaDerivedDiameter: string;
    perimeterDerivedDiameter: string;
  } {
    return {
      area: `${measurements.area.toFixed(1)} mm²`,
      perimeter: `${measurements.perimeter.toFixed(1)} mm`,
      areaDerivedDiameter: `${measurements.areaDerivedDiameter.toFixed(1)} mm`,
      perimeterDerivedDiameter: `${measurements.perimeterDerivedDiameter.toFixed(1)} mm`,
    };
  }

  /**
   * Get valve sizing recommendations based on measurements
   */
  getValveSizingRecommendations(measurements: AnnulusMeasurements): {
    recommendedSizes: number[];
    primaryRecommendation: number;
    sizing_method: 'area' | 'perimeter' | 'average';
    confidence: 'high' | 'medium' | 'low';
  } {
    const areaDiameter = measurements.areaDerivedDiameter;
    const perimeterDiameter = measurements.perimeterDerivedDiameter;
    const averageDiameter = (areaDiameter + perimeterDiameter) / 2;
    
    // Typical TAVI valve sizes
    const valveSizes = [20, 23, 26, 29, 32];
    
    // Determine sizing method based on consistency
    const diameterDifference = Math.abs(areaDiameter - perimeterDiameter);
    let sizingDiameter = averageDiameter;
    let sizingMethod: 'area' | 'perimeter' | 'average' = 'average';
    let confidence: 'high' | 'medium' | 'low' = 'high';
    
    if (diameterDifference > 2) {
      confidence = 'medium';
      if (diameterDifference > 4) {
        confidence = 'low';
      }
    }
    
    // Find closest valve size
    const primaryRecommendation = valveSizes.reduce((prev, curr) => 
      Math.abs(curr - sizingDiameter) < Math.abs(prev - sizingDiameter) ? curr : prev
    );
    
    // Recommend adjacent sizes as options
    const primaryIndex = valveSizes.indexOf(primaryRecommendation);
    const recommendedSizes = [
      ...(primaryIndex > 0 ? [valveSizes[primaryIndex - 1]] : []),
      primaryRecommendation,
      ...(primaryIndex < valveSizes.length - 1 ? [valveSizes[primaryIndex + 1]] : []),
    ];
    
    return {
      recommendedSizes,
      primaryRecommendation,
      sizing_method: sizingMethod,
      confidence,
    };
  }
}

export default AnnulusPolygonTool;