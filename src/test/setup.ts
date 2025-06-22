// Vitest setup file

// Mock canvas for components that might use it (e.g., Cornerstone)
import 'vitest-canvas-mock';

// Extend Vitest's expect with jest-dom matchers like toBeInTheDocument
import '@testing-library/jest-dom/vitest';
// Alternatively, if the above doesn't work or for older setups:
// import '@testing-library/jest-dom';

// You can add other global setup configurations here

console.log("Vitest setup file loaded: jest-dom and canvas mock configured.");
