import math
import numpy as np

def COPV_RCC_A(Lx,Ly,Lz,Rx,Ry,Rz,Nx,Ny,Nz):
    #xLR = (math.degrees((math.atan2(2 * Ry - Ly - Ny, -(2 * Rx - Lx - Nx)))))
    #RCC Anterior
    xLR=(math.degrees(-(math.atan2 ( (2*Ry-Ly-Ny),-(2*Rx-Lx-Nx)))))-90
    xCC = math.degrees(math.atan((2 * Rz - Lz - Nz) / (math.sqrt(((2 * Rx - Lx - Nx) ** 2) + ((2 * Ry - Ly - Ny) ** 2)))))
    return [xLR,xCC]
def COPV_NCC_P(Lx, Ly, Lz, Rx, Ry, Rz, Nx, Ny, Nz):
    # NCC Post
    xLR = (math.degrees((math.atan2(-(2 * Ny - Ry - Ly), -(2 * Nx - Rx - Lx)))))+90
    xCC = math.degrees(math.atan((2 * Nz - Rz - Lz) / (math.sqrt(((2 * Nx - Rx - Lx) ** 2) + ((2 * Ny - Ry - Ly) ** 2)))))*-1
    return [xLR,xCC]
def COPV_LCC_P(Lx, Ly, Lz, Rx, Ry, Rz, Nx, Ny, Nz):
    # LCC Post
    xLR = (math.degrees((math.atan2(-(2 * Ly - Ry - Ny), -(2 * Lx - Rx - Nx))))) + 90
    xCC = math.degrees(
    math.atan((2 * Lz - Rz - Nz) / (math.sqrt(((2 * Lx - Rx - Nx) ** 2) + ((2 * Ly - Ry - Ny) ** 2))))) * -1
    return [xLR,xCC]
def CO_RCC_A(Lx,Ly,Lz,Rx,Ry,Rz,Nx,Ny,Nz):
    #xLR = (math.degrees((math.atan2(2 * Ry - Ly - Ny, -(2 * Rx - Lx - Nx)))))
    #RCC Anterior
    xLR=(math.degrees(-(math.atan2 ( (2*Ry-Ny),-(2*Rx-Nx)))))-90
    xCC = math.degrees(math.atan((2 * Rz - Lz - Nz) / (math.sqrt(((2 * Rx - Lx - Nx) ** 2) + ((2 * Ry - Ly - Ny) ** 2)))))
    return [xLR,xCC]
def SCurve_XYZ(Lx,Ly,Lz,Rx,Ry,Rz,Nx,Ny,Nz):

    ret = np.array([])
    for xLR in range(-90, 90):
        val1=( -math.sin(math.radians(xLR))) *    ((Ry - Ny) * (Lz - Nz) - (Rz - Nz) * (Ly - Ny))
        val2= math.cos(math.radians(xLR)) * (  (Rz - Nz) * (Lx - Nx) -   (Rx - Nx) * (Lz - Nz)  )
        val3=   ((Rx - Nx) * (Ly - Ny)) -   ((Ry - Ny) * (Lx - Nx))
       # print(val1,val2,val3)
        #ret = np.append(ret, math.degrees(math.atan((  ((-1* math.sin (xLR) )*(((Ry-Ny)*(Lz-Nz))-((Rz-Nz)*(Ly-Ny)))  )+ (math.cos(xLR)*(((Rz-Nz)*(Lx-Nx)) - ((Rx-Nx)*(Lz-Nz))  )))/ (((Rx-Nx)*(Ly-Ny))-((Ry-Ny)*(Lx-Nx))) )))

        ret = np.append(ret, math.degrees(math.atan(( val1 + val2) / val3)))
        #print (xLR, math.degrees(math.atan(( val1 + val2) / val3)))

    #print(ret)
    return ret

def SCurve_XYZ_angle(Lx,Ly,Lz,Rx,Ry,Rz,Nx,Ny,Nz,xLR):

    ret = np.array([])
    for xLR in range(xLR, xLR+2):
        val1=( -math.sin(math.radians(xLR))) *    ((Ry - Ny) * (Lz - Nz) - (Rz - Nz) * (Ly - Ny))
        val2= math.cos(math.radians(xLR)) * (  (Rz - Nz) * (Lx - Nx) -   (Rx - Nx) * (Lz - Nz)  )
        val3=   ((Rx - Nx) * (Ly - Ny)) -   ((Ry - Ny) * (Lx - Nx))
       # print(val1,val2,val3)
        #ret = np.append(ret, math.degrees(math.atan((  ((-1* math.sin (xLR) )*(((Ry-Ny)*(Lz-Nz))-((Rz-Nz)*(Ly-Ny)))  )+ (math.cos(xLR)*(((Rz-Nz)*(Lx-Nx)) - ((Rx-Nx)*(Lz-Nz))  )))/ (((Rx-Nx)*(Ly-Ny))-((Ry-Ny)*(Lx-Nx))) )))

        ret = np.append(ret, math.degrees(math.atan(( val1 + val2) / val3)))
    return math.degrees(math.atan(ret[1]-ret[0])/((xLR+1)-xLR))

print(SCurve_XYZ_angle(36.79,-199.311,1416.193,  32.25,-218.025,1404.997, 26.103,-199.937,1391.409,45))


#print(COPV(27,-188 , 1615,   25,-160 ,1620,  16, -101 ,  1624))


#from OSIRIX Softwre
#53.83,73.63,-139.899, 45.39,54.89,-153.56,  38,80.55, -165.519
#RAO 1.8, CAUD 1

#prosizeAV values
#36.79,-199.311,1416.193,  32.25,-218.025,1404.997, 26.103,-199.937,1391.409
# LAO 3, CRAN 4 RCC Anterior
# RAO 38 CAUD 56 LCC post
# NCC Post LAO 44, Cran 58


import numpy as np
import math


def calculate_s_curve_angles(RAO_LAO, CRAN_CAUD, angle_range=(-90, 90)):
  """
  This function calculates an array of S-curve angles for a given craniocaudal angle
  across a specified range of angles.

  Args:
      RAO_LAO (float): The right arm offset angle in degrees.
      CRAN_CAUD (float): The craniocaudal angle in degrees.
      angle_range (tuple, optional): The range of angles for which to calculate
          the S-curve angles. Defaults to (-90, 90).

  Returns:
      numpy.ndarray: An array of S-curve angles in degrees.
  """

  s_curve_angles = np.array([])
  for angle in range(*angle_range):
    # Convert angles to radians for calculation
    rad_angle = math.radians(angle)
    rad_RAO_LAO = math.radians(RAO_LAO)
    rad_CRAN_CAUD = math.radians(CRAN_CAUD)

    # Calculate the S-curve angle
    s_curve_angle = math.degrees(
        -math.atan(math.cos(rad_angle - rad_RAO_LAO) / math.tan(rad_CRAN_CAUD))
    )
    s_curve_angles = np.append(s_curve_angles, s_curve_angle)

  return s_curve_angles


def get_s_curve_device(reference_craniocaudal1, reference_raolao1, reference_craniocaudal2, reference_raolao2):
  """
  This function finds the enface angles (RAO/LAO and Craniocaudal) that best match
  a given set of reference angles based on a brute-force search.

  Args:
      reference_craniocaudal1 (float): Reference craniocaudal angle for the first projection (degrees).
      reference_raolao1 (float): Reference RAO/LAO angle for the first projection (degrees).
      reference_craniocaudal2 (float): Reference craniocaudal angle for the second projection (degrees).
      reference_raolao2 (float): Reference RAO/LAO angle for the second projection (degrees).

  Returns:
      list: A list containing the best matching enface angles (RAO/LAO, Craniocaudal) in degrees.
  """

  # Initialize variables for storing potential enface angles and nearest matches
  potential_enface_angles = []
  closest_craniocaudal_angle = None

  # Loop through possible RAO/LAO enface angles
  for rao_lao_angle in range(-180, 180):
    # Loop through possible craniocaudal enface angles (avoid division by zero)
    for craniocaudal_angle in range(-180, 180):
      if math.tan(math.radians(craniocaudal_angle)) != 0:
        # Calculate the corresponding estimated craniocaudal angle
        estimated_craniocaudal1 = math.degrees(-math.atan(math.cos(math.radians(reference_raolao1) - math.radians(rao_lao_angle)) / math.tan(math.radians(craniocaudal_angle))))

        # Check if estimated craniocaudal angle matches the reference for the first projection
        if math.isclose(estimated_craniocaudal1, reference_craniocaudal1, abs_tol=1):
          # Calculate the estimated craniocaudal angle for the second projection
          estimated_craniocaudal2 = math.degrees(-math.atan(math.cos(math.radians(reference_raolao2) - math.radians(rao_lao_angle)) / math.tan(math.radians(craniocaudal_angle))))

          # Check if estimated craniocaudal angle matches the reference for the second projection
          if math.isclose(estimated_craniocaudal2, reference_craniocaudal2, abs_tol=1):
            # Found a matching pair, store the angles and update closest craniocaudal if needed
            potential_enface_angles.append([estimated_craniocaudal2, rao_lao_angle, craniocaudal_angle])

            if closest_craniocaudal_angle is None or abs(estimated_craniocaudal2 - reference_craniocaudal2) < abs(closest_craniocaudal_angle - reference_craniocaudal2):
              closest_craniocaudal_angle = estimated_craniocaudal2

  # Find the enface angles with the closest matching craniocaudal angle
  # (may not be a perfect match due to brute-force approach)
  if closest_craniocaudal_angle is not None:
    for enface_angles in potential_enface_angles:
      if enface_angles[0] == closest_craniocaudal_angle:
        return calculate_s_curve_angles(enface_angles[1], enface_angles[2])
  else:
    # No matching enface angles found
    return None

# Example usage
s_curve_angles = get_s_curve_device(20, 20, -20, -20)
print(s_curve_angles)


