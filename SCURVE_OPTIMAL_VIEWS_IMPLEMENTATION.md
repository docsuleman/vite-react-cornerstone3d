# S-Curve Optimal Viewing Angles Implementation

## Overview

This implementation adds 3-cusp and 2-cusp optimal viewing angle indicators to the S-curve graph in the TAVI planning workflow. These markers help clinicians quickly identify the best C-arm angles for valve visualization during procedures.

## What Was Implemented

### 1. Algorithm Translation from Python to TypeScript

**From NAVICath.py (Python) to SCurveGenerator.ts (TypeScript):**

#### 3-Cusp View (COPV_RCC_A)
- **Purpose**: Calculates the optimal "en-face" view looking directly at the center of the RCC (Right Coronary Cusp), perpendicular to the annular plane
- **Mathematical Formula**:
  ```
  LAO/RAO = atan2(-(2*Ly - Ry - Ny), -(2*Lx - Rx - Nx)) + 90°
  CRAN/CAUD = atan((2*Lz - Rz - Nz) / sqrt((2*Lx - Rx - Nx)² + (2*Ly - Ry - Ny)²)) * -1
  ```
- **Implementation**: `SCurveGenerator.calculate3CuspView()`
- **Clinical Significance**: This view provides the best visualization of all three cusps simultaneously, ideal for deployment assessment

#### 2-Cusp View (find_front_view)
- **Purpose**: Finds an angle on the S-curve that is approximately 60° from the 3-cusp view
- **Algorithm**:
  1. Iterate through all points on the S-curve
  2. Calculate 3D angular difference from the 3-cusp view
  3. Find angles between 59-61° that are to the right of the 3-cusp view (LAO/RAO < 3-cusp LAO/RAO)
  4. Select the angle closest to exactly 60°
- **Implementation**: `SCurveGenerator.find2CuspView()`
- **Clinical Significance**: This view typically shows two cusps clearly, providing an orthogonal perspective for sizing and positioning

#### 3D Angular Difference Calculation (ThreeD_angle_difference)
- **Purpose**: Calculates the true 3D angular difference between two fluoroscopy viewing angles
- **Algorithm**:
  1. Convert LAO/RAO and CRAN/CAUD to tangent-based 3D vectors
  2. Normalize the vectors
  3. Calculate dot product
  4. Use arccosine to get the angle
- **Implementation**: `SCurveGenerator.calculate3DAngleDifference()`
- **Mathematical Formula**:
  ```
  x = tan(LAO/RAO), y = tan(CRAN/CAUD), z = 1
  normalized_vector = [x, y, z] / magnitude([x, y, z])
  angle = arccos(dot_product(normalized_vector1, normalized_vector2))
  ```

### 2. Visual Implementation in SCurveOverlay Component

**Added to SCurveOverlay.tsx:**

1. **State Management**:
   - `threeCuspView`: Stores the calculated 3-cusp optimal view angles
   - `twoCuspView`: Stores the calculated 2-cusp optimal view angles

2. **Calculation on Cusp Update**:
   - When annulus points (cusps) change, the component automatically:
     - Generates the S-curve
     - Calculates the 3-cusp view using `calculate3CuspView()`
     - Finds the 2-cusp view using `find2CuspView()`

3. **Visual Markers on Canvas**:
   - **3-Cusp View**: Green dot (10px radius) with white outline and "3-cusp" label
   - **2-Cusp View**: Purple dot (10px radius) with white outline and "2-cusp" label
   - **Current Position**: Red dot (8px radius) with white outline (existing feature)

4. **Legend**:
   - Added a legend below the S-curve graph showing:
     - Red dot = Current view
     - Green dot = 3-cusp view
     - Purple dot = 2-cusp view

## Files Modified

### 1. `src/utils/SCurveGenerator.ts`
**New Functions Added:**
- `calculate3CuspView()`: Calculates COPV 3-cusp optimal viewing angle
- `calculate3DAngleDifference()`: Calculates 3D angular difference between two views
- `find2CuspView()`: Finds 2-cusp view on S-curve (~60° from 3-cusp)

### 2. `src/components/SCurveOverlay.tsx`
**Changes:**
- Added state variables for `threeCuspView` and `twoCuspView`
- Enhanced `useEffect` to calculate optimal views when cusps change
- Updated `drawSCurve()` to render green and purple dots for optimal views
- Added labels above each optimal view marker
- Updated `useEffect` dependencies to redraw when optimal views change
- Added legend component below the graph

## Technical Details

### Coordinate System
The implementation uses the standard fluoroscopy coordinate system:
- **LAO/RAO**: Rotation around Z-axis (-90° to +90°)
  - LAO (positive): Camera to patient's left
  - RAO (negative): Camera to patient's right
- **CRAN/CAUD**: Elevation angle (-90° to +90°)
  - CRAN (positive): Camera tilted toward head
  - CAUD (negative): Camera tilted toward feet

### Canvas Rendering
- Grid range: -90° to +90° for both axes
- Major grid lines every 30°
- Minor grid lines every 10°
- Markers rendered with proper Z-ordering (optimal views first, current position last)

### Color Scheme
- **S-Curve Line**: Blue (#3b82f6)
- **Current Position**: Red (#ef4444)
- **3-Cusp View**: Green (#10b981)
- **2-Cusp View**: Purple (#a855f7)
- **Labels**: White text (#ffffff)

## Clinical Workflow Integration

### When Markers Appear
The optimal view markers are calculated and displayed automatically when:
1. The user completes the Annulus Definition stage
2. All three cusp points (LCC, RCC, NCC) are defined
3. The S-curve is successfully generated

### How Clinicians Use These Markers
1. **Pre-procedure Planning**:
   - Review the 3-cusp and 2-cusp views to plan C-arm positioning
   - Note the specific LAO/RAO and CRAN/CAUD angles

2. **During Procedure**:
   - Click/drag the red dot to the green marker to position to 3-cusp view
   - The 3D viewport camera updates in real-time
   - Alternative: Click/drag to purple marker for 2-cusp view

3. **Valve Deployment**:
   - 3-cusp view (green) is typically preferred for initial valve positioning
   - 2-cusp view (purple) provides orthogonal perspective for depth assessment

## References to Original Python Implementation

### Source Files Analyzed
- `assets/oldTools/TAVIAssist/NAVICath.py`:
  - `COPV_RCC_A()`: Lines 135-141 (3-cusp view calculation)
  - `ThreeD_angle_difference()`: Lines 99-134 (angular difference calculation)
  - `find_front_view()`: Lines 180-197 (2-cusp view search)

- `assets/oldTools/TAVIAssist/TAVIViews.py`:
  - Lines 35-48: Example usage of COPV calculations with scatter plot visualization

- `assets/oldTools/TAVIAssist/BT_Basilica_Assist.py`:
  - Lines 269-281: Integration example showing how frontal view is calculated from S-curve

### Key Python → TypeScript Translations

| Python Function | TypeScript Function | Purpose |
|----------------|---------------------|---------|
| `COPV_RCC_A()` | `calculate3CuspView()` | 3-cusp optimal view |
| `ThreeD_angle_difference()` | `calculate3DAngleDifference()` | 3D angle between views |
| `find_front_view()` | `find2CuspView()` | 2-cusp view search |
| `SCurve_XYZ()` | `generateFromCusps()` | S-curve generation (already existed) |

## Testing Recommendations

1. **Visual Verification**:
   - Load a TAVI case with defined cusp points
   - Verify green and purple dots appear on the S-curve
   - Check that markers are positioned reasonably on the curve

2. **Interactive Testing**:
   - Drag the red dot to the green marker (3-cusp view)
   - Verify the 3D viewport updates to show all three cusps en-face
   - Drag to purple marker (2-cusp view)
   - Verify the view shows approximately two cusps clearly

3. **Mathematical Validation**:
   - Compare calculated angles with Python implementation
   - Use test cusp coordinates from Python comments (e.g., lines 236-242 in NAVICath.py)
   - Expected results for test case:
     ```
     LCC: (36.79, -199.311, 1416.193)
     RCC: (32.25, -218.025, 1404.997)
     NCC: (26.103, -199.937, 1391.409)
     Expected 3-cusp: LAO 3°, CRAN 4° (RCC Anterior)
     Expected 2-cusp: RAO 38°, CAUD 56° (LCC)
     ```

4. **Edge Cases**:
   - Test with unusual cusp geometries (bicuspid valves, etc.)
   - Verify 2-cusp view returns `null` if no suitable angle found
   - Check handling when S-curve has discontinuities

## Future Enhancements

### Potential Additions
1. **Side Views** (90° perpendicular views):
   - Implement `find_side_view()` from NAVICath.py
   - Add two more markers for LCC and RCC side views
   - Colors: Orange and cyan

2. **Interactive Optimal View Selection**:
   - Make optimal view markers clickable
   - One-click jump to 3-cusp or 2-cusp view
   - Highlight selected optimal view

3. **Angle Annotation**:
   - Display angle values next to markers
   - Show angular distance from current position to optimal views

4. **Custom Optimal Views**:
   - Allow users to save custom optimal views
   - Calculate additional views at specific angular separations

5. **Research-Based Optimal Views**:
   - Implement additional optimal views from literature
   - COPV_LCC_P and COPV_NCC_P for other cusp perspectives

## Conclusion

This implementation successfully translates the proven Python algorithms from the legacy NAVICath system into the modern TypeScript/React Quantavi application. The optimal viewing angles are now visually integrated into the S-curve overlay, providing immediate clinical value during TAVI planning and procedures.

The mathematical accuracy is preserved through careful translation of the trigonometric calculations, and the visual design follows modern medical imaging UI patterns with clear color coding and labels.
