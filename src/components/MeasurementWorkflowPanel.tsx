/**
 * MeasurementWorkflowPanel - UI component for guided measurement workflow
 * Displays step-by-step progress through the TAVI measurement protocol
 */

import React from 'react';
import { FaCheck, FaCircle, FaDrawPolygon, FaRuler, FaPen } from 'react-icons/fa';
import { MeasurementStep, MeasurementType } from '../types/MeasurementWorkflowTypes';

interface MeasurementWorkflowPanelProps {
  steps: MeasurementStep[];
  currentStepIndex: number;
  completedStepIds: string[];
  annulusArea?: number;
  onActivateStep: (step: MeasurementStep) => void;
  onCompleteStep: () => void;
}

const MeasurementWorkflowPanel: React.FC<MeasurementWorkflowPanelProps> = ({
  steps,
  currentStepIndex,
  completedStepIds,
  annulusArea = 400,
  onActivateStep,
  onCompleteStep
}) => {
  const currentStep = steps[currentStepIndex];
  const completedCount = completedStepIds.length;
  const totalSteps = steps.length;
  const progress = Math.round((completedCount / totalSteps) * 100);

  // Get icon for measurement type
  const getToolIcon = (type: MeasurementType, size = 16) => {
    switch (type) {
      case MeasurementType.POLYGON:
        return <FaDrawPolygon size={size} />;
      case MeasurementType.LINE:
        return <FaRuler size={size} />;
      case MeasurementType.SPLINE:
        return <FaPen size={size} />;
      default:
        return <FaCircle size={size} />;
    }
  };

  // Get status color for step
  const getStepColor = (step: MeasurementStep, index: number) => {
    if (completedStepIds.includes(step.id)) {
      return 'bg-green-900/20 border-green-500/60 text-green-200';
    } else if (index === currentStepIndex) {
      return 'bg-blue-900/25 border-blue-500/60 text-blue-200';
    } else if (index < currentStepIndex) {
      return 'bg-amber-900/20 border-amber-500/60 text-amber-200'; // Skipped optional
    } else {
      return 'bg-slate-800/80 border-slate-600 text-slate-400';
    }
  };

  const getStepDotClass = (step: MeasurementStep, index: number) => {
    if (completedStepIds.includes(step.id)) {
      return 'bg-green-400 ring-2 ring-green-400/40';
    } else if (index === currentStepIndex) {
      return 'bg-blue-400 ring-2 ring-blue-400/40 animate-pulse';
    } else if (index < currentStepIndex) {
      return 'bg-amber-400 ring-2 ring-amber-400/40';
    } else {
      return 'bg-slate-500';
    }
  };

  // Calculate offset instruction
  const getOffsetText = (step: MeasurementStep): string => {
    if (step.level === 'annulus') {
      return 'At annulus level';
    } else if (step.level === 'relative' && step.offsetFromAnnulus !== undefined) {
      const offset = step.offsetFromAnnulus;
      if (offset > 0) {
        return `+${offset}mm above annulus`;
      } else if (offset < 0) {
        return `${offset}mm below annulus`;
      }
      return 'At annulus level';
    } else if (step.level === 'dynamic' && step.offsetCalculation) {
      try {
        // eslint-disable-next-line no-new-func
        const calculateOffset = new Function('annulusArea', `return ${step.offsetCalculation}`);
        const offset = calculateOffset(annulusArea);
        return `+${offset}mm above annulus (auto-calculated)`;
      } catch {
        return 'Dynamic offset';
      }
    } else if (step.level === 'manual') {
      return 'Navigate manually';
    } else if (step.level === 'coronaryLevel') {
      return 'At coronary level';
    }
    return '';
  };

  const formatMeasurementType = (type: MeasurementType) => {
    const label = type.toString();
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/15 border border-slate-700/40 rounded-lg overflow-hidden">
      {/* Progress Header */}
      <div className="px-3 py-2 bg-slate-900/20">
        <div className="flex items-center justify-between text-xs text-slate-300">
          <div className="flex items-center gap-2 truncate">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Measurement Workflow</span>
            <span className="text-[11px] text-slate-500 whitespace-nowrap">{completedCount}/{totalSteps}</span>
          </div>
          <span className="text-[11px] text-blue-300 font-medium">{progress}%</span>
        </div>
        <div className="w-full bg-slate-800 rounded-full h-1 mt-2">
          <div
            className="bg-blue-500 h-1 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Current Step Card */}
      {currentStep && (
        <div className="px-3 py-3 border-t border-slate-800/40 bg-slate-900/18">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/15 text-blue-300">
              {getToolIcon(currentStep.type, 16)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h5 className="text-sm font-semibold text-white truncate">{currentStep.name}</h5>
                  <div className="mt-1 text-[11px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                    {getOffsetText(currentStep) && <span>{getOffsetText(currentStep)}</span>}
                    {!currentStep.required && <span className="text-amber-300">Optional</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={onCompleteStep}
                    className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors text-[11px] font-medium whitespace-nowrap"
                  >
                    {currentStepIndex < steps.length - 1 ? `Next: ${steps[currentStepIndex + 1]?.name}` : 'Complete'}
                  </button>
                  {!currentStep.required && (
                    <button
                      onClick={onCompleteStep}
                      className="text-[11px] text-slate-400 hover:text-white transition-colors"
                    >
                      Skip
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-300">
                Draw the measurement for this step.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Steps List */}
      <div className="flex-1 overflow-y-auto px-3 py-3 bg-slate-900/25 border-t border-slate-800/40">
        <div className="space-y-1.5">
          {steps.map((step, index) => {
            const isCompleted = completedStepIds.includes(step.id);
            const isCurrent = index === currentStepIndex;
            const isPast = index < currentStepIndex;

            return (
              <div
                key={step.id}
                onClick={() => onActivateStep(step)}
                className={`relative pl-6 pr-3 py-2.5 rounded-md border transition-all cursor-pointer hover:border-blue-400/70 ${getStepColor(step, index)} ${
                  isCurrent ? 'ring-1 ring-blue-400/60' : ''
                }`}
                title={`Click to jump to: ${step.name}`}
              >
                <span
                  aria-hidden="true"
                  className="absolute left-2 top-0 bottom-0 w-px bg-slate-600/60"
                />
                <span
                  aria-hidden="true"
                  className={`absolute left-1.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${getStepDotClass(step, index)}`}
                />
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">
                    {isCompleted ? (
                      <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                        <FaCheck className="text-white text-[10px]" />
                      </div>
                    ) : isCurrent ? (
                      <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                        <span className="text-white text-[10px] font-bold">{index + 1}</span>
                      </div>
                    ) : isPast ? (
                      <div className="w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center">
                        <span className="text-white text-[10px] font-bold">!</span>
                      </div>
                    ) : (
                      <div className="w-5 h-5 bg-slate-600 rounded-full flex items-center justify-center text-slate-400">
                        <span className="flex items-center">
                          {getToolIcon(step.type, 10)}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-100">
                      <span className="truncate">{step.name}</span>
                      {!step.required && (
                        <span className="text-[10px] text-amber-300">(Opt)</span>
                      )}
                    </div>
                  </div>

                  {isCompleted && (
                    <div className="text-[11px] text-green-300 font-medium">✓ Done</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Workflow Complete Message */}
      {completedCount === totalSteps && (
        <div className="p-4 border-t border-slate-700 bg-green-900/20">
          <div className="text-center">
            <FaCheck className="text-green-400 text-3xl mx-auto mb-2" />
            <p className="text-green-300 font-semibold">All measurements complete!</p>
            <p className="text-slate-400 text-sm mt-1">Review results in the measurements panel</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeasurementWorkflowPanel;
