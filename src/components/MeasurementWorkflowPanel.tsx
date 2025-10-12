/**
 * MeasurementWorkflowPanel - UI component for guided measurement workflow
 * Displays step-by-step progress through the TAVI measurement protocol
 */

import React from 'react';
import { FaCheck, FaCircle, FaLock, FaDrawPolygon, FaRuler, FaPen, FaPlay } from 'react-icons/fa';
import { MeasurementStep, MeasurementType, MeasurementSection } from '../types/MeasurementWorkflowTypes';

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
  const getToolIcon = (type: MeasurementType) => {
    switch (type) {
      case MeasurementType.POLYGON:
        return <FaDrawPolygon />;
      case MeasurementType.LINE:
        return <FaRuler />;
      case MeasurementType.SPLINE:
        return <FaPen />;
      default:
        return <FaCircle />;
    }
  };

  // Get status color for step
  const getStepColor = (step: MeasurementStep, index: number) => {
    if (completedStepIds.includes(step.id)) {
      return 'bg-green-900/30 border-green-500 text-green-300';
    } else if (index === currentStepIndex) {
      return 'bg-blue-900/30 border-blue-500 text-blue-300';
    } else if (index < currentStepIndex) {
      return 'bg-yellow-900/30 border-yellow-500 text-yellow-300'; // Skipped optional
    } else {
      return 'bg-slate-800 border-slate-600 text-slate-400';
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

  // Get section badge
  const getSectionBadge = (section: MeasurementSection) => {
    if (section === MeasurementSection.AXIAL) {
      return <span className="text-xs bg-purple-600 px-2 py-0.5 rounded">Axial</span>;
    } else {
      return <span className="text-xs bg-cyan-600 px-2 py-0.5 rounded">Long Axis</span>;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Progress Header */}
      <div className="p-4 border-b border-slate-700">
        <h4 className="text-lg font-semibold text-slate-200 mb-2">Measurement Workflow</h4>
        <div className="flex items-center justify-between text-sm text-slate-300 mb-2">
          <span>{completedCount} of {totalSteps} completed</span>
          <span>{progress}%</span>
        </div>
        <div className="w-full bg-slate-700 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Current Step Card */}
      {currentStep && (
        <div className="p-4 border-b border-slate-700 bg-blue-900/20">
          <div className="flex items-start gap-3 mb-3">
            <div className="text-2xl text-blue-400 mt-1">
              {getToolIcon(currentStep.type)}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h5 className="text-lg font-bold text-white">{currentStep.name}</h5>
                {!currentStep.required && (
                  <span className="text-xs bg-yellow-600 px-2 py-0.5 rounded">Optional</span>
                )}
              </div>
              <div className="flex items-center gap-2 mb-2">
                {getSectionBadge(currentStep.section)}
                <span className="text-xs text-slate-400">{getOffsetText(currentStep)}</span>
              </div>
              <p className="text-sm text-slate-300">
                Draw {currentStep.type} measurement in {currentStep.section} view
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onActivateStep(currentStep)}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
            >
              <FaPlay className="text-sm" />
              {completedStepIds.includes(currentStep.id) ? 'Redo Measurement' : 'Start Measurement'}
            </button>
            <button
              onClick={onCompleteStep}
              className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
            >
              <FaCheck className="text-sm" />
              {currentStepIndex < steps.length - 1 ? `Next: ${steps[currentStepIndex + 1]?.name}` : 'Complete'}
            </button>
            {!currentStep.required && (
              <button
                onClick={onCompleteStep}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                Skip
              </button>
            )}
          </div>
        </div>
      )}

      {/* Steps List */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {steps.map((step, index) => {
            const isCompleted = completedStepIds.includes(step.id);
            const isCurrent = index === currentStepIndex;
            const isPast = index < currentStepIndex;

            return (
              <div
                key={step.id}
                onClick={() => onActivateStep(step)}
                className={`p-3 rounded-lg border-2 transition-all cursor-pointer hover:border-blue-400 ${getStepColor(step, index)} ${
                  isCurrent ? 'ring-2 ring-blue-400' : ''
                }`}
                title={`Click to jump to: ${step.name}`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">
                    {isCompleted ? (
                      <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                        <FaCheck className="text-white text-xs" />
                      </div>
                    ) : isCurrent ? (
                      <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                        <span className="text-white text-xs font-bold">{index + 1}</span>
                      </div>
                    ) : isPast ? (
                      <div className="w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center">
                        <span className="text-white text-xs font-bold">!</span>
                      </div>
                    ) : (
                      <div className="w-6 h-6 bg-slate-600 rounded-full flex items-center justify-center">
                        <FaLock className="text-slate-400 text-xs" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{step.name}</span>
                      {!step.required && (
                        <span className="text-xs text-yellow-400">(Opt)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs">{getToolIcon(step.type)}</span>
                      <span className="text-xs opacity-75">{step.section}</span>
                    </div>
                  </div>

                  {isCompleted && (
                    <div className="text-xs text-green-400 font-medium">✓ Done</div>
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
