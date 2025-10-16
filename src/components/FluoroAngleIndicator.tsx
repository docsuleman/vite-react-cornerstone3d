import React from 'react';
import headviewImage from '../assets/headview-human.png';
import sideviewImage from '../assets/sideview-human.png';

interface FluoroAngleIndicatorProps {
  laoRao: number; // LAO/RAO angle in degrees
  cranCaud: number; // CRAN/CAUD angle in degrees
}

export const FluoroAngleIndicator: React.FC<FluoroAngleIndicatorProps> = ({
  laoRao,
  cranCaud,
}) => {
  // Convert angles to radians for calculations
  const laoRaoRad = (laoRao * Math.PI) / 180;
  const cranCaudRad = (cranCaud * Math.PI) / 180;

  // Format angle text
  const laoRaoText = laoRao > 0
    ? `LAO ${Math.abs(laoRao).toFixed(0)}°`
    : laoRao < 0
    ? `RAO ${Math.abs(laoRao).toFixed(0)}°`
    : 'AP';

  const cranCaudText = cranCaud > 0
    ? `CRAN ${Math.abs(cranCaud).toFixed(0)}°`
    : cranCaud < 0
    ? `CAUD ${Math.abs(cranCaud).toFixed(0)}°`
    : 'LAT';

  return (
    <>
      {/* LAO/RAO Indicator (Bottom-left) */}
      <div className="absolute bottom-2 left-2 bg-black bg-opacity-70 px-1.5 py-1 rounded pointer-events-none">
        <div className="relative w-10 h-10">
          {/* Head view image */}
          <img
            src={headviewImage}
            alt="Head view"
            className="w-full h-full object-contain opacity-80"
          />

          {/* Camera arrow overlay */}
          <svg
            className="absolute top-0 left-0 w-full h-full"
            viewBox="0 0 80 80"
          >
            {/* Arrow pointing from camera position to center */}
            <g transform={`translate(${40 + Math.sin(laoRaoRad) * 35}, ${40 - Math.cos(laoRaoRad) * 35})`}>
              <line
                x1="0"
                y1="0"
                x2={-Math.sin(laoRaoRad) * 28}
                y2={Math.cos(laoRaoRad) * 28}
                stroke="#3b82f6"
                strokeWidth="2.5"
                markerEnd="url(#arrowhead-lao)"
              />
              {/* Eye/camera icon */}
              <circle cx="0" cy="0" r="5" fill="#3b82f6" stroke="#ffffff" strokeWidth="1.5" />
              <circle cx="0" cy="0" r="2" fill="#ffffff" />
            </g>

            <defs>
              <marker
                id="arrowhead-lao"
                markerWidth="6"
                markerHeight="6"
                refX="3"
                refY="2"
                orient="auto"
              >
                <polygon points="0 0, 4 2, 0 4" fill="#3b82f6" />
              </marker>
            </defs>
          </svg>
        </div>
        <div className="text-white text-xs font-bold text-center mt-0.5">
          {laoRaoText}
        </div>
      </div>

      {/* CRAN/CAUD Indicator (Bottom-right) */}
      <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 px-1.5 py-1 rounded pointer-events-none">
        <div className="relative w-10 h-10">
          {/* Side view image */}
          <img
            src={sideviewImage}
            alt="Side view"
            className="w-full h-full object-contain opacity-80"
          />

          {/* Camera arrow overlay */}
          <svg
            className="absolute top-0 left-0 w-full h-full"
            viewBox="0 0 80 80"
          >
            {/* Arrow pointing from camera position to center */}
            <g transform={`translate(${40 + Math.sin(cranCaudRad) * 35}, ${40 - Math.cos(cranCaudRad) * 35})`}>
              <line
                x1="0"
                y1="0"
                x2={-Math.sin(cranCaudRad) * 28}
                y2={Math.cos(cranCaudRad) * 28}
                stroke="#10b981"
                strokeWidth="2.5"
                markerEnd="url(#arrowhead-cran)"
              />
              {/* Eye/camera icon */}
              <circle cx="0" cy="0" r="5" fill="#10b981" stroke="#ffffff" strokeWidth="1.5" />
              <circle cx="0" cy="0" r="2" fill="#ffffff" />
            </g>

            <defs>
              <marker
                id="arrowhead-cran"
                markerWidth="6"
                markerHeight="6"
                refX="3"
                refY="2"
                orient="auto"
              >
                <polygon points="0 0, 4 2, 0 4" fill="#10b981" />
              </marker>
            </defs>
          </svg>
        </div>
        <div className="text-white text-xs font-bold text-center mt-0.5">
          {cranCaudText}
        </div>
      </div>
    </>
  );
};
