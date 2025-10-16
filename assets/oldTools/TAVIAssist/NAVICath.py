import math
import numpy as np


# -------------------------------------------------------
# Pass Enface RAO and LAO and make an Array of S cruve y=RAO_LAO z=CRAN_CAUD
def make_s_curve_array(y, z):
    ret = np.array([])
    for f in range(-90, 90):
        ret = np.append(ret, math.degrees(
            -math.atan(math.cos(math.radians(f) - math.radians(y)) / math.tan(math.radians(z)))))
    return ret


# -------------------------------------------------------


# ----------------------------------------------------
# Pass Two orthogonal LAO RAO values and get Enface Values for RAO and LAO
# w and ww is CRA caudal in both projection
# x and xx is RAO/LAO in both projection
# y RAO/LAO enface--need to calculate
# z CRA/CAUD enface-- need to calculate
# forumula is w =(-math.atan(math.cos(math.radians(x) - math.radians(y)) / math.tan(math.radians(z))))
def get_s_curve_device(w, x, ww, xx):
    oldy, oldz = 0, 0  # will store previous nearest y and z value.
    output_array = []
    w=round(w)
    ww = round(ww)
    x = round(x)
    xx = round(xx)
    CRAN2 = []  # will store nearest w values, finally will loop through it to find best match
    # for y in range(-130, 30): # RAO LAO ENFACE--need these values?
    for y in range(-180, 180):  # RAO LAO ENFACE full range
        # for z in range(-25, 150): # CRAN CAUD ENFACE--need these estimate values??
        for z in range(-180, 180):  # CRAN CAUD ENFACE--full range
            if math.tan(math.radians(z)) != 0:  # avoid divide by zero
                out = (-math.atan(math.cos(math.radians(x) - math.radians(y)) / math.tan(math.radians(z))))
                # if for X the w value matches then will check if ww macthes for xx too, if both matches it means equation y and z are correct
                if math.isclose(round(math.degrees(out)), w, abs_tol=1):
                    out2 = (-math.atan(math.cos(math.radians(xx) - math.radians(y)) / math.tan(math.radians(z))))
                    if math.isclose(round(math.degrees(out2)), ww, abs_tol=1):

                        # will append these values to output array.
                        output_array.append([round(math.degrees(out2)), y, z])
                        # will also append current w value. if real w not found nearest w will be assumed
                        CRAN2.append(round(math.degrees(out2)))

                        if not (math.isclose(y, oldy, abs_tol=2)) and not (math.isclose(z, oldz, abs_tol=2)):
                            # make_plot(y, z)
                            oldy, oldz = y, z

    CRAN2.reverse()  # will reverse it as negative vlaue are in start
    array = np.asarray(CRAN2)
    idx = (np.abs(array - ww)).argmin()  # find nearest match
    output_array.reverse()  # will reverse it too as negative are in start
    # print(output_array[idx])
    return make_s_curve_array(output_array[idx][1], output_array[idx][2])
# --------------------------------------------------------------------------


def SCurve_XYZ(Lx,Ly,Lz,Rx,Ry,Rz,Nx,Ny,Nz):

    ret = np.array([])
    for xLR in range(-90, 90):
        val1=( -math.sin(math.radians(xLR))) *    ((Ry - Ny) * (Lz - Nz) - (Rz - Nz) * (Ly - Ny))
        val2= math.cos(math.radians(xLR)) * (  (Rz - Nz) * (Lx - Nx) -   (Rx - Nx) * (Lz - Nz)  )
        val3=   ((Rx - Nx) * (Ly - Ny)) -   ((Ry - Ny) * (Lx - Nx))
       # print(val1,val2,val3)
        #ret = np.append(ret, math.degrees(math.atan((  ((-1* math.sin (xLR) )*(((Ry-Ny)*(Lz-Nz))-((Rz-Nz)*(Ly-Ny)))  )+ (math.cos(xLR)*(((Rz-Nz)*(Lx-Nx)) - ((Rx-Nx)*(Lz-Nz))  )))/ (((Rx-Nx)*(Ly-Ny))-((Ry-Ny)*(Lx-Nx))) )))

        val1 = 0.1 if val1 == 0 else val1
        val2 = 0.1 if val2 == 0 else val2
        val3 = 0.1 if val3 == 0 else val3
        ret = np.append(ret, math.degrees(math.atan(( val1 + val2) / val3)))
        #print (xLR, math.degrees(math.atan(( val1 + val2) / val3)))

    #print(ret)
    return ret

#Research Article
def COPV(Lx,Ly,Lz,Rx,Ry,Rz,Nx,Ny,Nz):
    xLR=math.degrees(math.atan2 (( 2*Ry-Ly-Ny),-(2*Rx-Lx-Nx)))
    xCC=math.degrees(math.atan(2* Rz - Lz - Nz)/ math.sqrt ((2*Rx-Lx-Nx)**2 +(2*Ry-Ly-Nx)**2))
    return [xLR,xCC]
def COPV_LCC_P(Lx,Ly,Lz,Rx,Ry,Rz,Nx,Ny,Nz):
    #xLR = (math.degrees((math.atan2(2 * Ry - Ly - Ny, -(2 * Rx - Lx - Nx)))))
    #RCC Anterior
    xLR=(math.degrees(-(math.atan2 ( (2*Ry-Ly-Ny),-(2*Rx-Lx-Nx)))))-90
    xCC = math.degrees(math.atan((2 * Rz - Lz - Nz) / (math.sqrt(((2 * Rx - Lx - Nx) ** 2) + ((2 * Ry - Ly - Ny) ** 2)))))
    angle=Valve_Angle(Lx, Ly, Lz, Rx, Ry, Rz, Nx, Ny, Nz, xLR)
    return [xLR,xCC,angle]
def COPV_NCC_P(Lx, Ly, Lz, Rx, Ry, Rz, Nx, Ny, Nz):
    # NCC Post
    xLR = (math.degrees((math.atan2(-(2 * Ny - Ry - Ly), -(2 * Nx - Rx - Lx)))))+90
    xCC = math.degrees(math.atan((2 * Nz - Rz - Lz) / (math.sqrt(((2 * Nx - Rx - Lx) ** 2) + ((2 * Ny - Ry - Ly) ** 2)))))*-1
    angle = Valve_Angle(Lx, Ly, Lz, Rx, Ry, Rz, Nx, Ny, Nz, xLR)
    return [xLR, xCC, angle]
def ThreeD_angle_difference(angle1,angle2):

    # x1=np.sin(angle1[0])*np.cos(angle1[1])
    x1=np.tan(np.radians(angle1[0]))
    x2 = np.tan(np.radians(angle2[0]))
    # x2=np.sin(angle2[0])*np.cos(angle2[1])
    #
    # y1=np.sin(angle1[0])
    # y2=np.sin(angle2[0])

    y1 = np.tan(np.radians(angle1[1]))
    y2 = np.tan(np.radians(angle2[1]))

    #
    # z1=np.cos(angle1[0])*np.cos(angle1[1])
    # z2=np.cos(angle2[0])*np.cos(angle2[1])
    z1=1
    z2=1

    vector1=np.array([x1,y1,z1])
    normalized_vector1 = vector1 / np.linalg.norm(vector1)

    vector2=np.array([x2,y2,z2])
    normalized_vector2 = vector2 / np.linalg.norm(vector2)

    dot_product = np.dot(normalized_vector1,normalized_vector2)

    angle_normalized = np.arccos(dot_product)  # Angle with normalized vectors

    #print(x1,x2,y1,y2,z1,z2)
    #print(dot_product)


    deviation=np.rad2deg(angle_normalized)

    return deviation
def COPV_RCC_A(Lx, Ly, Lz, Rx, Ry, Rz, Nx, Ny, Nz):
    # LCC Post
    xLR = (math.degrees((math.atan2(-(2 * Ly - Ry - Ny), -(2 * Lx - Rx - Nx))))) + 90
    xCC = math.degrees(
    math.atan((2 * Lz - Rz - Nz) / (math.sqrt(((2 * Lx - Rx - Nx) ** 2) + ((2 * Ly - Ry - Ny) ** 2))))) * -1
    angle = Valve_Angle(Lx, Ly, Lz, Rx, Ry, Rz, Nx, Ny, Nz, xLR)
    return [xLR, xCC, angle]

def find_side_view(front_view_LCC, front_view_RCC, cusp):
        if cusp == "Right":
            Scurve = get_s_curve_device(front_view_LCC[1], front_view_LCC[0], front_view_RCC[1], front_view_RCC[0])
            angulations = []
            # print("SCurve",Scurve)
            x = -90
            for anglulation in Scurve:
                deviation = ThreeD_angle_difference([x, anglulation], front_view_RCC)
                # print("Right Deviaiton All", [x, anglulation], front_view_RCC, deviation)

                if 89 <= deviation <= 91:
                    # print("Right Deviaiton", [x,anglulation],front_view_RCC,deviation)
                    angulations.append([x, anglulation, deviation])
                x = x + 1
            closest_to_90 = min(angulations, key=lambda x: abs(x[2] - 90))
            for ang in angulations:
                if ang[2] == closest_to_90[2]:
                    return ang

        if cusp == "Left":
            Scurve = get_s_curve_device(front_view_LCC[1], front_view_LCC[0], front_view_RCC[1], front_view_RCC[0])
            angulations = []
            x = -90
            for anglulation in Scurve:
                deviation = ThreeD_angle_difference([x, anglulation], front_view_LCC)
                # print("Left Deviaiton All", [x, anglulation], front_view_RCC, deviation)

                if 89 <= deviation <= 91:
                    print("Left Deviaiton", [x, anglulation], front_view_LCC, deviation)
                    angulations.append([x, anglulation, deviation])
                x = x + 1
            closest_to_90 = min(angulations, key=lambda x: abs(x[2] - 90))
            for ang in angulations:
                if ang[2] == closest_to_90[2]:
                    return ang


def find_front_view(front_view_RCC,Scurve):

    #Scurve=get_s_curve_device(front_view_LCC[1],front_view_LCC[0],front_view_RCC[1],front_view_RCC[0])
    angulations=[]
    #print("SCurve",Scurve)
    x=-90
    for anglulation in Scurve:
        deviation=ThreeD_angle_difference([x,anglulation],front_view_RCC )
        #print("Right Deviaiton All", [x, anglulation], front_view_RCC, deviation)

        if (59 <= deviation <= 61) and front_view_RCC[0]>x:
            print("Right Deviaiton frontal", [x,anglulation],front_view_RCC,deviation)
            angulations.append([x,anglulation,deviation])
        x = x + 1
    closest_to_60 = min(angulations, key=lambda x: abs(x[2] - 60))
    for ang in angulations:
        if ang[2] == closest_to_60[2]:
            return ang

    #blah blah




def Valve_Angle(Lx,Ly,Lz,Rx,Ry,Rz,Nx,Ny,Nz,xLR):

    ret = np.array([])

    val1=( -math.sin(math.radians(xLR))) *    ((Ry - Ny) * (Lz - Nz) - (Rz - Nz) * (Ly - Ny))
    val2= math.cos(math.radians(xLR)) * (  (Rz - Nz) * (Lx - Nx) -   (Rx - Nx) * (Lz - Nz)  )
    val3=   ((Rx - Nx) * (Ly - Ny)) -   ((Ry - Ny) * (Lx - Nx))
    val1 = 0.1 if val1 == 0 else val1
    val2 = 0.1 if val2 == 0 else val2
    val3 = 0.1 if val3 == 0 else val3
    ret=math.degrees(math.atan((val1 + val2) / val3))

    xLR1=xLR+1.1

    val1 = (-math.sin(math.radians(xLR1))) * ((Ry - Ny) * (Lz - Nz) - (Rz - Nz) * (Ly - Ny))
    val2 = math.cos(math.radians(xLR1)) * ((Rz - Nz) * (Lx - Nx) - (Rx - Nx) * (Lz - Nz))
    val3 = ((Rx - Nx) * (Ly - Ny)) - ((Ry - Ny) * (Lx - Nx))
    val1 = 0.1 if val1 == 0 else val1
    val2 = 0.1 if val2 == 0 else val2
    val3 = 0.1 if val3 == 0 else val3

    ret1 = math.degrees(math.atan(( val1 + val2) / val3))

    return math.degrees(math.atan(ret1-ret)/(xLR1-xLR))

#SCurve_XYZ(26,-175,1615,   16,-188 ,1620,  7.637, -171 ,  1623)
print(COPV(27,-188 , 1615,   25,-160 ,1620,  16, -101 ,  1624))
#print(COPV(27,-188 , 1615,   25,-160 ,1620,  16, -101 ,  1624))


#from OSIRIX Softwre
#53.83,73.63,-139.899, 45.39,54.89,-153.56,  38,80.55, -165.519
#RAO 1.8, CAUD 1

#prosizeAV values
#36.79,-199.311,1416.193,  32.25,-218.025,1404.997, 26.103,-199.937,1391.409
# LAO 3, CRAN 4 RCC Anterior
# RAO 38 CAUD 56 LCC post
# NCC Post LAO 44, Cran 58


