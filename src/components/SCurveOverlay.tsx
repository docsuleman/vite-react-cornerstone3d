import React, { useRef, useEffect, useState, useCallback } from 'react';
import { SCurveGenerator, SCurveData } from '../utils/SCurveGenerator';
import { AnnulusPoint, AnnulusPointType } from '../types/WorkflowTypes';

interface SCurveOverlayProps {
  annulusPoints: AnnulusPoint[]; // 3 cusp points from workflow state
  currentLaoRao: number; // Current 3D view LAO/RAO angle
  currentCranCaud: number; // Current 3D view CRAN/CAUD angle
  onAngleChange: (laoRao: number, cranCaud: number) => void; // Callback when red dot is dragged
  width?: number;
  height?: number;
}

export const SCurveOverlay: React.FC<SCurveOverlayProps> = React.memo(({
  annulusPoints,
  currentLaoRao,
  currentCranCaud,
  onAngleChange,
  width = 400,
  height = 400,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sCurve, setSCurve] = useState<SCurveData | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [redDotPos, setRedDotPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [threeCuspView, setThreeCuspView] = useState<{ laoRao: number; cranCaud: number } | null>(null);
  const [twoCuspView, setTwoCuspView] = useState<{ laoRao: number; cranCaud: number } | null>(null);

  // Generate S-curve and calculate optimal viewing angles when cusp points change
  useEffect(() => {
    if (annulusPoints.length === 3) {
      const leftCusp = annulusPoints.find(
        (p) => p.type === AnnulusPointType.LEFT_CORONARY_CUSP
      );
      const rightCusp = annulusPoints.find(
        (p) => p.type === AnnulusPointType.RIGHT_CORONARY_CUSP
      );
      const nonCoronaryCusp = annulusPoints.find(
        (p) => p.type === AnnulusPointType.NON_CORONARY_CUSP
      );

      if (leftCusp && rightCusp && nonCoronaryCusp) {
        console.log('🔍 Cusp identification (CORRECT COLOR MAPPING):');
        console.log('  Left (RED):', leftCusp.type, leftCusp.position);
        console.log('  Right (GREEN):', rightCusp.type, rightCusp.position);
        console.log('  Non-coronary (YELLOW):', nonCoronaryCusp.type, nonCoronaryCusp.position);

        const leftCuspPoint = {
          x: leftCusp.position[0],
          y: leftCusp.position[1],
          z: leftCusp.position[2],
        };
        const rightCuspPoint = {
          x: rightCusp.position[0],
          y: rightCusp.position[1],
          z: rightCusp.position[2],
        };
        const nonCoronaryCuspPoint = {
          x: nonCoronaryCusp.position[0],
          y: nonCoronaryCusp.position[1],
          z: nonCoronaryCusp.position[2],
        };

        // Generate S-curve
        const curve = SCurveGenerator.generateFromCusps(
          leftCuspPoint,
          rightCuspPoint,
          nonCoronaryCuspPoint
        );
        setSCurve(curve);

        // Calculate 3-cusp optimal view (COPV_RCC_A - centers RCC)
        const threeCusp = SCurveGenerator.calculate3CuspView(
          leftCuspPoint,
          rightCuspPoint,
          nonCoronaryCuspPoint
        );
        setThreeCuspView(threeCusp);

        // Calculate cusp-overlap view (COPV_NCC_P - centers NCC, overlaps L and R)
        const overlapView = SCurveGenerator.calculateCuspOverlapView(
          leftCuspPoint,
          rightCuspPoint,
          nonCoronaryCuspPoint
        );
        console.log('🔵 Setting overlap view in overlay:', overlapView);
        setTwoCuspView(overlapView);
      }
    }
  }, [annulusPoints]);

  // Convert LAO/RAO, CRAN/CAUD angles to canvas pixel coordinates
  const angleToCanvasCoords = useCallback(
    (laoRao: number, cranCaud: number): { x: number; y: number } => {
      const padding = 40;
      const graphWidth = width - 2 * padding;
      const graphHeight = height - 2 * padding;

      // Map -90 to +90 range to canvas coordinates
      const x = padding + ((laoRao + 90) / 180) * graphWidth;
      const y = padding + ((90 - cranCaud) / 180) * graphHeight; // Invert Y-axis

      return { x, y };
    },
    [width, height]
  );

  // Update red dot position when current angles change
  useEffect(() => {
    if (sCurve && canvasRef.current) {
      // Use default angles (0,0) if not provided
      const laoRao = currentLaoRao ?? 0;
      const cranCaud = currentCranCaud ?? 0;
      const pos = angleToCanvasCoords(laoRao, cranCaud);
      setRedDotPos(pos);
    }
  }, [currentLaoRao, currentCranCaud, sCurve, angleToCanvasCoords]);

  // Convert canvas pixel coordinates to LAO/RAO, CRAN/CAUD angles
  const canvasCoordsToAngle = useCallback(
    (x: number, y: number): { laoRao: number; cranCaud: number } => {
      const padding = 40;
      const graphWidth = width - 2 * padding;
      const graphHeight = height - 2 * padding;

      const laoRao = ((x - padding) / graphWidth) * 180 - 90;
      const cranCaud = 90 - ((y - padding) / graphHeight) * 180; // Invert Y-axis

      return { laoRao, cranCaud };
    },
    [width, height]
  );

  // Draw S-curve on canvas
  const drawSCurve = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sCurve) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Set canvas background
    ctx.fillStyle = '#1e293b'; // slate-800
    ctx.fillRect(0, 0, width, height);

    const padding = 40;
    const graphWidth = width - 2 * padding;
    const graphHeight = height - 2 * padding;

    // Draw grid
    ctx.strokeStyle = '#475569'; // slate-600
    ctx.lineWidth = 0.5;

    // Minor grid lines every 10 degrees
    for (let i = -90; i <= 90; i += 10) {
      const x = padding + ((i + 90) / 180) * graphWidth;
      const y = padding + ((90 - i) / 180) * graphHeight;

      // Vertical lines
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, height - padding);
      ctx.stroke();

      // Horizontal lines
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Major grid lines every 30 degrees (thicker)
    ctx.strokeStyle = '#64748b'; // slate-500
    ctx.lineWidth = 1;

    for (let i = -90; i <= 90; i += 30) {
      const x = padding + ((i + 90) / 180) * graphWidth;
      const y = padding + ((90 - i) / 180) * graphHeight;

      // Vertical lines
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, height - padding);
      ctx.stroke();

      // Horizontal lines
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Draw axes (LAO/RAO = 0 and CRAN/CAUD = 0)
    ctx.strokeStyle = '#94a3b8'; // slate-400
    ctx.lineWidth = 2;

    // Vertical axis (LAO/RAO = 0)
    const zeroX = padding + (90 / 180) * graphWidth;
    ctx.beginPath();
    ctx.moveTo(zeroX, padding);
    ctx.lineTo(zeroX, height - padding);
    ctx.stroke();

    // Horizontal axis (CRAN/CAUD = 0)
    const zeroY = padding + (90 / 180) * graphHeight;
    ctx.beginPath();
    ctx.moveTo(padding, zeroY);
    ctx.lineTo(width - padding, zeroY);
    ctx.stroke();

    // Draw S-curve
    ctx.strokeStyle = '#3b82f6'; // blue-500
    ctx.lineWidth = 3;
    ctx.beginPath();

    for (let i = 0; i < sCurve.laoRaoAngles.length; i++) {
      const pos = angleToCanvasCoords(
        sCurve.laoRaoAngles[i],
        sCurve.cranCaudAngles[i]
      );

      if (i === 0) {
        ctx.moveTo(pos.x, pos.y);
      } else {
        ctx.lineTo(pos.x, pos.y);
      }
    }
    ctx.stroke();

    // Draw 3-cusp view marker (green dot)
    if (threeCuspView) {
      const threeCuspPos = angleToCanvasCoords(
        threeCuspView.laoRao,
        threeCuspView.cranCaud
      );
      ctx.fillStyle = '#10b981'; // green-500
      ctx.beginPath();
      ctx.arc(threeCuspPos.x, threeCuspPos.y, 10, 0, 2 * Math.PI);
      ctx.fill();

      // Draw outline
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(threeCuspPos.x, threeCuspPos.y, 10, 0, 2 * Math.PI);
      ctx.stroke();

      // Add label
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('3-cusp', threeCuspPos.x, threeCuspPos.y - 14);
    }

    // Draw 2-cusp view marker (purple dot)
    if (twoCuspView) {
      const twoCuspPos = angleToCanvasCoords(twoCuspView.laoRao, twoCuspView.cranCaud);
      ctx.fillStyle = '#a855f7'; // purple-500
      ctx.beginPath();
      ctx.arc(twoCuspPos.x, twoCuspPos.y, 10, 0, 2 * Math.PI);
      ctx.fill();

      // Draw outline
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(twoCuspPos.x, twoCuspPos.y, 10, 0, 2 * Math.PI);
      ctx.stroke();

      // Add label
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Overlap', twoCuspPos.x, twoCuspPos.y - 14);
    }

    // Draw red dot at current position (on top of other markers)
    ctx.fillStyle = '#ef4444'; // red-500
    ctx.beginPath();
    ctx.arc(redDotPos.x, redDotPos.y, 8, 0, 2 * Math.PI);
    ctx.fill();

    // Draw outline on red dot
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(redDotPos.x, redDotPos.y, 8, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw axis labels and tick labels
    ctx.fillStyle = '#f1f5f9'; // slate-100
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // X-axis label
    ctx.fillText('LAO / RAO', width / 2, height - 10);

    // Y-axis label
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('CRAN / CAUD', 0, 0);
    ctx.restore();

    // Draw tick labels for major grid lines
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = '#cbd5e1'; // slate-300

    for (let i = -90; i <= 90; i += 30) {
      const x = padding + ((i + 90) / 180) * graphWidth;
      const y = padding + ((90 - i) / 180) * graphHeight;

      // X-axis tick labels
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(i.toString(), x, height - padding + 5);

      // Y-axis tick labels
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(i.toString(), padding - 5, y);
    }
  }, [sCurve, width, height, redDotPos, angleToCanvasCoords, threeCuspView, twoCuspView]);

  // Redraw when dependencies change
  useEffect(() => {
    drawSCurve();
  }, [drawSCurve, threeCuspView, twoCuspView]);

  // Mouse event handlers for dragging red dot
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.stopPropagation(); // Prevent event from bubbling to parent viewports

    const canvas = canvasRef.current;
    if (!canvas || !sCurve) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Check if click is near red dot
    const dx = mouseX - redDotPos.x;
    const dy = mouseY - redDotPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 15) {
      setIsDragging(true);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.stopPropagation(); // Prevent event from bubbling

    if (!isDragging || !sCurve) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Convert to angles
    const { laoRao, cranCaud } = canvasCoordsToAngle(mouseX, mouseY);

    // Find nearest point on S-curve
    const nearestIndex = SCurveGenerator.findNearestPoint(
      sCurve,
      laoRao,
      cranCaud
    );
    const nearestLaoRao = sCurve.laoRaoAngles[nearestIndex];
    const nearestCranCaud = sCurve.cranCaudAngles[nearestIndex];

    // Update red dot position
    const newPos = angleToCanvasCoords(nearestLaoRao, nearestCranCaud);
    setRedDotPos(newPos);

    // Notify parent component of angle change
    onAngleChange(nearestLaoRao, nearestCranCaud);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.stopPropagation(); // Prevent event from bubbling
    setIsDragging(false);
  };

  // Don't render if we don't have enough cusp points
  if (annulusPoints.length < 3 || !sCurve) {
    return null;
  }

  return (
    <div
      className="bg-slate-800 rounded-lg p-4 shadow-lg border border-slate-700"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <h3 className="text-white text-sm font-semibold mb-2">
        S-Curve: Optimal Viewing Angles
      </h3>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="cursor-pointer rounded"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      <div className="mt-2 text-xs text-slate-400 flex justify-between">
        <span>LAO/RAO: {(currentLaoRao ?? 0).toFixed(1)}°</span>
        <span>CRAN/CAUD: {(currentCranCaud ?? 0).toFixed(1)}°</span>
      </div>
      <div className="mt-2 flex gap-4 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-red-500 rounded-full border border-white"></div>
          <span className="text-slate-300">Current</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-green-500 rounded-full border border-white"></div>
          <span className="text-slate-300">3-cusp</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-purple-500 rounded-full border border-white"></div>
          <span className="text-slate-300">Cusp-overlap</span>
        </div>
      </div>
    </div>
  );
});
