/**
 * Type definitions for TAVI Measurement Workflow System
 * Defines the structure for JSON-driven measurement workflows
 */

export enum MeasurementType {
  POLYGON = 'polygon',
  LINE = 'line',
  SPLINE = 'spline'
}

export enum MeasurementSection {
  AXIAL = 'axial',
  LONGAXIS = 'longaxis'
}

export enum MeasurementLevel {
  ANNULUS = 'annulus',           // Exactly at annulus level
  RELATIVE = 'relative',         // Fixed offset from annulus (use offsetFromAnnulus)
  DYNAMIC = 'dynamic',           // Dynamic offset based on annulus area (use offsetCalculation)
  MANUAL = 'manual',             // User manually navigates to correct level
  CORONARY_LEVEL = 'coronaryLevel' // At the level of coronary arteries
}

export interface MeasurementStep {
  id: string;                    // Unique identifier (e.g., "annulus", "lvot")
  name: string;                  // Display name (e.g., "Annular Measurement")
  type: MeasurementType;         // Tool type: polygon, line, or spline
  section: MeasurementSection;   // axial or longaxis
  level: MeasurementLevel;       // How to determine measurement level
  offsetFromAnnulus?: number;    // Fixed offset in mm (positive = above, negative = below)
  offsetCalculation?: string;    // JavaScript expression for dynamic offset
  required: boolean;             // Is this measurement mandatory?
  autoLabel: string;             // Label to auto-apply to annotation
  completed?: boolean;           // Runtime: Has user completed this step?
  annotationUID?: string;        // Runtime: UID of created annotation
  measuredValue?: any;           // Runtime: Extracted measurement value
}

export interface MeasurementWorkflow {
  workflowVersion: string;       // Version of workflow schema
  measurements: MeasurementStep[]; // Ordered list of measurement steps
}

export interface MeasurementWorkflowState {
  workflow: MeasurementWorkflow | null;
  currentStepIndex: number;
  isWorkflowActive: boolean;
  completedSteps: Set<string>;   // IDs of completed steps
}

/**
 * Result of a completed measurement
 */
export interface MeasurementResult {
  stepId: string;
  annotationUID: string;
  value: any; // Varies by type: {area, perimeter} for polygon, number for line/spline
  timestamp: number;
}
