/**
 * MeasurementWorkflowManager - Manages the TAVI measurement workflow
 * Handles loading workflow JSON, step navigation, tool activation, and auto-labeling
 */

import {
  MeasurementWorkflow,
  MeasurementStep,
  MeasurementType,
  MeasurementLevel,
  MeasurementResult
} from '../types/MeasurementWorkflowTypes';
import workflowData from '../config/measurementWorkflow.json';

export class MeasurementWorkflowManager {
  private workflow: MeasurementWorkflow;
  private currentStepIndex: number = 0;
  private completedSteps: Set<string> = new Set();

  constructor() {
    this.workflow = workflowData as MeasurementWorkflow;
  }

  /**
   * Load workflow from JSON (already imported statically)
   */
  public loadWorkflow(): MeasurementWorkflow {
    return this.workflow;
  }

  /**
   * Get the current active measurement step
   */
  public getCurrentStep(): MeasurementStep | null {
    if (this.currentStepIndex >= this.workflow.measurements.length) {
      return null; // Workflow complete
    }
    return this.workflow.measurements[this.currentStepIndex];
  }

  /**
   * Get the next step in the workflow
   */
  public getNextStep(): MeasurementStep | null {
    const nextIndex = this.currentStepIndex + 1;
    if (nextIndex >= this.workflow.measurements.length) {
      return null; // No more steps
    }
    return this.workflow.measurements[nextIndex];
  }

  /**
   * Get all workflow steps
   */
  public getAllSteps(): MeasurementStep[] {
    return this.workflow.measurements;
  }

  /**
   * Get step by ID
   */
  public getStepById(stepId: string): MeasurementStep | undefined {
    return this.workflow.measurements.find(step => step.id === stepId);
  }

  /**
   * Mark a step as complete and move to next step
   */
  public completeCurrentStep(annotationUID: string, measuredValue?: any): boolean {
    const currentStep = this.getCurrentStep();
    if (!currentStep) {
      return false;
    }

    this.completedSteps.add(currentStep.id);
    currentStep.completed = true;
    currentStep.annotationUID = annotationUID;
    currentStep.measuredValue = measuredValue;

    this.currentStepIndex++;
    return true;
  }

  /**
   * Calculate slice offset based on step configuration and annulus area
   * @param step - Measurement step
   * @param annulusArea - Annulus area in mm²
   * @param annulusSlicePosition - Z-coordinate of annulus in world space
   * @returns Offset in mm (positive = above, negative = below)
   */
  public calculateSliceOffset(
    step: MeasurementStep,
    annulusArea: number = 400
  ): number {
    switch (step.level) {
      case MeasurementLevel.ANNULUS:
        return 0;

      case MeasurementLevel.RELATIVE:
        return step.offsetFromAnnulus || 0;

      case MeasurementLevel.DYNAMIC:
        if (!step.offsetCalculation) {
          return 0;
        }
        // Safely evaluate the offset calculation expression
        try {
          // eslint-disable-next-line no-new-func
          const calculateOffset = new Function('annulusArea', `return ${step.offsetCalculation}`);
          return calculateOffset(annulusArea);
        } catch (error) {
          console.error('Error calculating dynamic offset:', error);
          return 0;
        }

      case MeasurementLevel.MANUAL:
      case MeasurementLevel.CORONARY_LEVEL:
      default:
        return 0; // User navigates manually
    }
  }

  /**
   * Get Cornerstone tool name for measurement type
   */
  public getToolNameForStep(step: MeasurementStep): string {
    switch (step.type) {
      case MeasurementType.POLYGON:
        return 'SmoothPolygon';
      case MeasurementType.LINE:
        // Use appropriate line tool based on section
        return step.section === 'axial' ? 'AxialLine' : 'MPRLongAxisLine';
      case MeasurementType.SPLINE:
        return 'CurvedLeafletTool';
      default:
        return 'SmoothPolygon';
    }
  }

  /**
   * Auto-apply label to annotation
   */
  public getLabelForStep(step: MeasurementStep): { text: string; color: string } {
    // Different colors for different measurement types
    let color = '#ffff00'; // Yellow default

    if (step.type === MeasurementType.POLYGON) {
      color = '#ff00ff'; // Magenta for polygons
    } else if (step.type === MeasurementType.LINE) {
      color = '#00ffff'; // Cyan for lines
    } else if (step.type === MeasurementType.SPLINE) {
      color = '#00ff00'; // Green for splines
    }

    return {
      text: step.autoLabel,
      color: color
    };
  }

  /**
   * Check if workflow is complete
   */
  public isWorkflowComplete(): boolean {
    // Check if all required steps are completed
    const requiredSteps = this.workflow.measurements.filter(step => step.required);
    return requiredSteps.every(step => this.completedSteps.has(step.id));
  }

  /**
   * Get workflow progress (0-100)
   */
  public getProgress(): number {
    if (this.workflow.measurements.length === 0) {
      return 0;
    }
    return Math.round((this.completedSteps.size / this.workflow.measurements.length) * 100);
  }

  /**
   * Get required steps remaining
   */
  public getRequiredStepsRemaining(): number {
    const requiredSteps = this.workflow.measurements.filter(step => step.required);
    const completedRequired = requiredSteps.filter(step => this.completedSteps.has(step.id));
    return requiredSteps.length - completedRequired.length;
  }

  /**
   * Reset workflow to beginning
   */
  public reset(): void {
    this.currentStepIndex = 0;
    this.completedSteps.clear();
    this.workflow.measurements.forEach(step => {
      step.completed = false;
      step.annotationUID = undefined;
      step.measuredValue = undefined;
    });
  }

  /**
   * Manually set the current step index (used when user selects a step)
   */
  public setCurrentStepIndex(index: number): MeasurementStep | null {
    const totalSteps = this.workflow.measurements.length;

    if (totalSteps === 0) {
      this.currentStepIndex = 0;
      return null;
    }

    if (index <= 0) {
      this.currentStepIndex = 0;
    } else if (index >= totalSteps) {
      this.currentStepIndex = totalSteps - 1;
    } else {
      this.currentStepIndex = index;
    }

    return this.getCurrentStep();
  }

  /**
   * Get the current step index
   */
  public getCurrentStepIndex(): number {
    return this.currentStepIndex;
  }

  /**
   * Get instruction text for current step
   */
  public getInstructionForStep(step: MeasurementStep, annulusArea: number = 400): string {
    const offset = this.calculateSliceOffset(step, annulusArea);

    let instruction = `Draw ${step.type} in ${step.section} view`;

    if (step.level === MeasurementLevel.RELATIVE) {
      if (offset > 0) {
        instruction += ` at +${offset}mm above annulus`;
      } else if (offset < 0) {
        instruction += ` at ${offset}mm below annulus`;
      } else {
        instruction += ` at annulus level`;
      }
    } else if (step.level === MeasurementLevel.DYNAMIC) {
      instruction += ` at +${offset}mm above annulus (calculated from annulus area)`;
    } else if (step.level === MeasurementLevel.ANNULUS) {
      instruction += ` at annulus level`;
    } else if (step.level === MeasurementLevel.MANUAL) {
      instruction += ` (navigate manually to correct level)`;
    } else if (step.level === MeasurementLevel.CORONARY_LEVEL) {
      instruction += ` at coronary level (navigate to coronary artery)`;
    }

    return instruction;
  }

  /**
   * Export completed measurements
   */
  public exportMeasurements(): MeasurementResult[] {
    return this.workflow.measurements
      .filter(step => step.completed && step.annotationUID)
      .map(step => ({
        stepId: step.id,
        annotationUID: step.annotationUID!,
        value: step.measuredValue,
        timestamp: Date.now()
      }));
  }
}

// Singleton instance
let workflowManagerInstance: MeasurementWorkflowManager | null = null;

export function getWorkflowManager(): MeasurementWorkflowManager {
  if (!workflowManagerInstance) {
    workflowManagerInstance = new MeasurementWorkflowManager();
  }
  return workflowManagerInstance;
}
