import vtk
from PyQt5 import QtCore, QtGui, QtWidgets
from vtk import vtkOBJReader,  vtkRenderer, vtkRenderWindow, vtkRenderWindowInteractor, vtkActor, vtkImageData, vtkTexture, vtkPNGReader, vtkPolyDataMapper
import matplotlib.pyplot as plt
from PyQt5.QtWidgets import QFileDialog
from matplotlib.animation import FuncAnimation
from matplotlib.backends.backend_qt5agg import FigureCanvasQTAgg as FigureCanvas
from matplotlib.figure import Figure
from matplotlib.ticker import MultipleLocator, AutoMinorLocator
from vtkmodules.qt.QVTKRenderWindowInteractor import QVTKRenderWindowInteractor

import DB
import NAVICath
import BTClass
import BT_list



class MyWindow(QtWidgets.QMainWindow):
    def closeEvent(self, event):
        if (BasilicaAssist_ui.ani):
            BasilicaAssist_ui.ani.event_source.stop()
            print("BT 3D DSCurve Plotting Stopped")

    def showEvent(self, event):
        if (BTClass.myBT.getConnectedDevice() and BasilicaAssist_ui.ani):
            BasilicaAssist_ui.ani.event_source.start()
            print("BT 3D SCurve  Plotting Started")

class Ui_BasilicaAssist(object):

    def __init__(self):
        self.bt_data = [0, 0, 0]
        self.ani = None
        self.CRAN1 = None
        self.LAO1 = None
        self.RAO2 = None
        self.CAUD2 = None
        self.pxLR = 0
        self.pxCC = 0
        self.angle_BPV_RCC_Front=0


    def runAnimation(self):
        self.ani = FuncAnimation(self.figure, self.update_plot, interval=200)
        self.canvas.draw()

    def get_current_pos(self, type):
        self.bt_data = BTClass.myBT.recvBTdata_splitted()

        if type == 1:
            self.LAO1, self.CRAN1 = round(float(self.bt_data[1])), round( float(self.bt_data[2]))
        if type == 2:
            self.RAO2, self.CAUD2 = round(float(self.bt_data[1])), round( float(self.bt_data[2]))
        print(self.LAO1, self.CRAN1, self.RAO2, self.CAUD2)

        if (self.LAO1 and self.RAO2 and self.CAUD2 and self.CRAN1):
            self.data2 = NAVICath.get_s_curve_device(self.CRAN1, self.LAO1, self.CAUD2, self.RAO2)
            self.plot_device = self.ax.plot(range(-90, 90), self.data2, label="Evolut", color="blue")
            self.ax.legend(loc="upper left")
            self.LAO1 , self.RAO2 , self.CAUD2 , self.CRAN1=None,None,None,None

            self.canvas.draw()

        return round(float(self.bt_data[1])), round( float(self.bt_data[2]))

    def update_plot(self, i):
        self.bt_data = BTClass.myBT.recvBTdata_splitted()
        if (self.bt_data):
            self.scat_bt.remove()
            self.scat_bt_txt.remove()

            self.scat_bt = self.ax.scatter(round(float(self.bt_data[1])), round( float(self.bt_data[2])), c="blue")
            self.scat_bt_txt = self.ax.text(round(float(self.bt_data[1])), round(float(self.bt_data[2])),
                                            (str(round(float(self.bt_data[1]))) + "," + str(round(float(self.bt_data[2])))))
            # print("BT Returns Valid Data")
            self.canvas.draw_idle()

            self.rotation(self.ren, self.renWin, round(float(self.bt_data[1])), round( float(self.bt_data[2])), )
        else:
            # print("BT Returns invalid Data")
            self.canvas.draw_idle()

            return

    def structure_s_cruve(self):
        # self.plot_structure.pop(0).remove()
        # self.data = NAVICath.make_s_curve_array(111, -37);
        # self.plot_structure = self.ax.plot(range(-90, 90), self.data, label="AV Plane", color="red")
        # self.ax.legend(loc="upper left")
        # self.canvas.draw()
        # check DB for values

        values = DB.patientsDB.get_value_by_ValueType(DB.patientsDB.myExam, "BPV/MDCT/Planes")

        if (values):
            AV_MDCT_Planes = values[len(values) - 1]
            xCCV1, xRLV1, xCCV2, xRLV2 = AV_MDCT_Planes[3].split(",")
            self.data = NAVICath.get_s_curve_device(float(xCCV1), float(xRLV1), float(xCCV2), float(xRLV2))
            self.plot_structure = self.ax.plot(range(-90, 90), self.data, label="MDCT_Planes")
            self.ax.legend(loc="upper left")
            self.canvas.draw()

        values = DB.patientsDB.get_value_by_ValueType(DB.patientsDB.myExam, "BPV/MDCT/Coordinates")
        if (values):
            AV_MDCT_Cordinates = values[len(values) - 1]
            Lx, Ly, Lz, Rx, Ry, Rz, Nx, Ny, Nz = AV_MDCT_Cordinates[3].split(",")

            self.vxLCC.setText(Lx)
            self.vyLCC.setText(Ly)
            self.vzLCC.setText(Lz)

            self.vxRCC.setText(Rx)
            self.vyRCC.setText(Ry)
            self.vzRCC.setText(Rz)

            self.vxNCC.setText(Nx)
            self.vyNCC.setText(Ny)
            self.vzNCC.setText(Nz)
            self.Get_Scurve_XYZ()



            # self.data = NAVICath.SCurve_XYZ(float(Lx), float(Ly), float(Lz), float(Rx), float(Ry), float(Rz), float(Nx), float(Ny),
            #                                 float(Nz))
            #
            # self.plot_structure = self.ax.plot(range(-90, 90), self.data, label="MDCT_Cord")
            #
            # self.data_LCC_P = NAVICath.COPV_LCC_P(float(Lx), float(Ly), float(Lz), float(Rx), float(Ry), float(Rz), float(Nx), float(Ny),
            #                                 float(Nz))
            # self.scat_bt_1 = self.ax.scatter(float(self.data_LCC_P[0]), float(self.data_LCC_P[1]), c="green",
            #                                label="COPV LCC Frontal")
            # self.ax.text(round(self.data_LCC_P[0]), round(self.data_LCC_P[1]),
            #              " COPV LCC Frontal: " + (
            #                          str(round(float(self.data_LCC_P[0]))) + "," + str(round(float(self.data_LCC_P[1])))))
            #
            #
            # self.data_rcc_frontal = NAVICath.COPV_RCC_A(float(Lx), float(Ly), float(Lz), float(Rx), float(Ry), float(Rz), float(Nx), float(Ny),
            #                                 float(Nz))
            # self.scat_bt_2 = self.ax.scatter(round(float(self.data_rcc_frontal[0])), round(float(self.data_rcc_frontal[1])), c="red",
            #                                label="COPV RCC Frontal")
            # self.angle_BPV_RCC_Front=self.data_rcc_frontal[2]
            #
            #
            # print("angle:",self.angle_BPV_RCC_Front)
            #
            # self.ax.text(round(self.data_rcc_frontal[0]), round(self.data_rcc_frontal[1]),
            #              " COPV RCC Frontal: " + (
            #                      str(round(float(self.data_rcc_frontal[0]))) + "," + str(round(float(self.data_rcc_frontal[1])))))
            #
            # self.ax.legend(loc="upper left")
            # self.canvas.draw()

        values = DB.patientsDB.get_value_by_ValueType(DB.patientsDB.myExam, "AV/MDCT/Enface")
        if (values):
            AV_MDCT_Enface = values[len(values) - 1]
            y, z = AV_MDCT_Enface[3].split(",")
            self.data = NAVICath.make_s_curve_array(float(y), float(z))
            self.plot_structure = self.ax.plot(range(-90, 90), self.data, label="MDCT_Enface")
            self.ax.legend(loc="upper left")
            self.canvas.draw()

    def device_s_cruve(self):
        self.plot_device.pop(0).remove()
        # self.data2 = NAVICath.make_s_curve_array(30, 25);

        # w and ww is CRA caudal in both projection
        # x and xx is RAO/LAO in both projection
        # y RAO/LAO enface--need to calculate
        # z CRA/CAUD enface-- need to calculate
        # LAO1,CRAN1, RAO2,CAUD2
        # self.LAO1 = 20
        # self.CRAN1 = 20
        # #######################
        # self.RAO2 = -20
        # self.CAUD2 = -30

        #xRL_LCC_Front = float(int(self.xRL_LCC_Front_TextEdit.toPlainText()))
        #xCC_LCC_Front = float(self.xCC_LCC_Front_TextEdit.toPlainText())

        xRL_LCC_Side = float(int(self.xRL_LCC_Side_TextEdit.toPlainText()))
        xCC_LCC_Side = float(self.xCC_LCC_Side_TextEdit.toPlainText())

        #xRL_RCC_Front = float(int(self.xRL_RCC_Front_TextEdit.toPlainText()))
        #xCC_RCC_Front = float(self.xCC_RCC_Front_TextEdit.toPlainText())

        xRL_RCC_Side = float(int(self.xRL_RCC_Side_TextEdit.toPlainText()))
        xCC_RCC_Side = float(int(self.xCC_RCC_Side_TextEdit.toPlainText()))


        #check any 4 available values

        #if  (xRL_LCC_Front & xCC_LCC_Front & xRL_LCC_Side & xCC_LCC_Side):
        #self.data2 = NAVICath.get_s_curve_device(xCC_LCC_Front, xRL_LCC_Front, xCC_LCC_Side, xRL_LCC_Side)

        #self.ax.scatter( round(xRL_LCC_Front),round(xCC_LCC_Front), c="blue", label="Frontal LCC")
        self.ax.scatter(round(xRL_LCC_Side),round(xCC_LCC_Side), c="green", label="Side LCC")

        self.ax.text(round(xRL_LCC_Side), round(xCC_LCC_Side),
                     "LCC Side View: " + (
                             str(round(xRL_LCC_Side)) + "," + str(round(xCC_LCC_Side))))
        #self.ax.scatter(round(xRL_RCC_Front),round(xCC_RCC_Front), c="red", label="Frontal RCC")
        self.ax.scatter( round(xRL_RCC_Side),round(xCC_RCC_Side), c="orange", label="Side RCC")

        self.ax.text(round(xRL_RCC_Side), round(xCC_RCC_Side),
                     " RCC Side View: " + (
                             str(round(xRL_RCC_Side)) + "," + str(round(xCC_RCC_Side))))








        #self.plot_device = self.ax.plot(range(-90, 90), self.data2, label="BPV")
        self.ax.legend(loc="upper left")
        self.canvas.draw()

    def func_ft(self):
        if not BTClass.myBT.getConnectedDevice():
            # BTlist_ui = BT_list.Ui_BT_devices(BT_SCurve.BTSCurveWindow, BT_SCurve.BSC_ui)
            BTlist_ui = BT_list.Ui_BT_devices(BasilicaAssistWindow, BasilicaAssist_ui)
            BTlist_ui.setupUi(BT_list.BTlistWindow)
            BT_list.BTlistWindow.show()
        else:
            print("already connected")
            BasilicaAssistWindow.show()

    def Get_BasilicaViews(self):


        Lx = float(self.vxLCC.toPlainText())
        Ly = float(self.vyLCC.toPlainText())
        Lz = float(self.vzLCC.toPlainText())


        Rx = float(self.vxRCC.toPlainText())
        Ry = float(self.vyRCC.toPlainText())
        Rz = float(self.vzRCC.toPlainText())


        Nx = float(self.vxNCC.toPlainText())
        Ny = float(self.vyNCC.toPlainText())
        Nz = float(self.vzNCC.toPlainText())

        #Lx, Rx, Nx = self.scale_negatives(Lx, Rx, Nx)
        #Ly, Ry, Ny = self.scale_negatives(Ly, Ry, Ny)
        #Lz, Rz, Nz = self.scale_negatives(Lz, Rz, Nz)
        # Lx=5.8
        # Ly=-5.2
        # Lz=1821.1
        #
        # Nx=-12.8
        # Ny=-20.8
        # Nz=1801.6
        #
        # Rx=4.9
        # Ry=- 27.8
        # Rz=1819.3

        cord = [Lx, Ly, Lz, Rx, Ry, Rz, Nx, Ny, Nz]
        cordinates = ",".join(map(str, cord))

        # save values to System
        values = (DB.patientsDB.myExam, "BPV/MDCT/Coordinates", cordinates)
        DB.patientsDB.add_value(values)

        self.RCC_A = NAVICath.COPV_RCC_A(Lx, Ly, Lz, Rx, Ry, Rz, Nx, Ny, Nz)
        self.scat_bt_rf = self.ax.scatter(float(self.RCC_A[0]), float(self.RCC_A[1]), c="green", label="RCC Frontal")
        self.ax.text(round(self.RCC_A[0]), round(self.RCC_A[1]),
                     " RCC Frontal: " + (str(round(float(self.RCC_A[0]))) + "," + str(round(float(self.RCC_A[1])))))

        self.angle_BPV_RCC_Front = self.RCC_A[2]

        print("angle:", self.angle_BPV_RCC_Front)


        #i have changed frontal view to 60 degree difference view
        SCurve = NAVICath.SCurve_XYZ(Lx, Ly, Lz, Rx, Ry, Rz, Nx, Ny, Nz)
        self.LCC_P=NAVICath.find_front_view(self.RCC_A,SCurve)


        self.scat_bt_lf = self.ax.scatter(round(float(self.LCC_P[0])), round(float(self.LCC_P[1])), c="pink", label="LCC Frontal")
        self.ax.text(round(self.LCC_P[0]), round(self.LCC_P[1]),
                     " LCC Frontal: " + (
                                 str(round(float(self.LCC_P[0]))) + "," + str(round(float(self.LCC_P[1])))))

        self.sideview_right=NAVICath.find_side_view(self.LCC_P, self.RCC_A, "Right")
        self.sideview_left=NAVICath.find_side_view(self.LCC_P, self.RCC_A, "Left")

        self.scat_bt_ls = self.ax.scatter(round(float(self.sideview_left[0])), round(float(self.sideview_left[1])), c="red",
                                       label="LCC SIDE View")
        self.ax.text(round(self.sideview_left[0]), round(self.sideview_left[1]),
                     " LCC Side View: " + (
                             str(round(float(self.sideview_left[0]))) + "," + str(round(float(self.sideview_left[1])))))

        self.scat_bt_rs = self.ax.scatter(round(float(self.sideview_right[0])), round(float(self.sideview_right[1])), c="green",label="RCC Side View")
        self.ax.text(round(self.sideview_right[0]), round(self.sideview_right[1]),
                     " RCC Side View: " + (
                             str(round(float(self.sideview_right[0]))) + "," + str(round(float(self.sideview_right[1])))))




        # self.data = NAVICath.COPV_NCC_P(Lx, Ly, Lz, Rx, Ry, Rz, Nx, Ny, Nz)
        # self.scat_bt = self.ax.scatter(round(float(self.data[0])), round(float(self.data[1])), c="yellow", label="COPV NCC Posterior")
        # self.ax.text(round(self.data[0]), round(self.data[1]),
        #              " COPV NCC Posterior: " + (
        #                          str(round(float(self.data[0]))) + "," + str(round(float(self.data[1])))))
        self.canvas.draw()

    def scale_negatives(self,x, y, z):
        print(x,y,z)

        min_value = min(x, y, z)
        if min_value < 0:
            scale_factor = abs(min_value) + 2
            print("CHANGED",x + scale_factor, y + scale_factor, z + scale_factor)
            return x + scale_factor, y + scale_factor, z + scale_factor
        else:
            return x, y, z



    def Get_Scurve_XYZ(self):
        Lx = float(self.vxLCC.toPlainText())
        Ly = float(self.vyLCC.toPlainText())
        Lz = float(self.vzLCC.toPlainText())




        Rx = float(self.vxRCC.toPlainText())
        Ry = float(self.vyRCC.toPlainText())
        Rz = float(self.vzRCC.toPlainText())


        Nx = float(self.vxNCC.toPlainText())
        Ny = float(self.vyNCC.toPlainText())
        Nz = float(self.vzNCC.toPlainText())

        # Lx ,Rx, Nx=self.scale_negatives(Lx ,Rx, Nx)
        # Ly, Ry, Ny = self.scale_negatives(Ly, Ry, Ny)
        # Lz, Rz, Nz = self.scale_negatives(Lz, Rz, Nz)

        # Lx = 5.8
        # Ly = -5.2
        # Lz = 1821.1
        #
        # Nx = -12.8
        # Ny = -20.8
        # Nz = 1801.6
        #
        # Rx = 4.9
        # Ry = - 27.8
        # Rz = 1819.3

        cord = [Lx, Ly, Lz, Rx, Ry, Rz, Nx, Ny, Nz]
        cordinates = ",".join(map(str, cord))

        # save values to System
        values = (DB.patientsDB.myExam, "BPV/MDCT/Coordinates", cordinates)
        DB.patientsDB.add_value(values)

        self.data = NAVICath.SCurve_XYZ(Lx, Ly, Lz, Rx, Ry, Rz, Nx, Ny, Nz)

        self.Scurve_XYZ = self.ax.plot(range(-90, 90), self.data, label="Coordinates", color="red")
        self.ax.legend(loc="upper left")
        # self.canvas.draw()
        self.Get_BasilicaViews()

    def goBack(self):
        BasilicaAssistWindow.close()
    def openfile(self):

        options = QFileDialog.Options()
        options |= QFileDialog.DontUseNativeDialog
        fileName, _ = QFileDialog.getOpenFileName(None, "open 3D Aorta Files", "",
                                                  "Stl Files (*.obj)", options=options)
        if fileName:
            self.loadAorta(fileName)
            #self.pxLR = 0
            #self.pxCC = 0




    def setupUi(self, MainWindow):
        MainWindow.setObjectName("MainWindow")
        MainWindow.resize(1329, 773)
        MainWindow.setStyleSheet("background-color: rgb(66, 66, 66);")
        self.centralwidget = QtWidgets.QWidget(MainWindow)
        self.centralwidget.setObjectName("centralwidget")
        self.verticalLayout_2 = QtWidgets.QVBoxLayout(self.centralwidget)
        self.verticalLayout_2.setSizeConstraint(QtWidgets.QLayout.SetNoConstraint)
        self.verticalLayout_2.setObjectName("verticalLayout_2")
        self.frame_3 = QtWidgets.QFrame(self.centralwidget)
        self.horizontalLayout_middle = QtWidgets.QHBoxLayout(self.frame_3)
        self.frame_3.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.frame_3.setFrameShadow(QtWidgets.QFrame.Raised)
        self.frame_3.setObjectName("frame_3")





        self.horizontalLayout = QtWidgets.QHBoxLayout(self.frame_3)
        self.horizontalLayout.setObjectName("horizontalLayout")
        self.label = QtWidgets.QLabel(self.frame_3)
        self.label.setMinimumSize(QtCore.QSize(200, 100))
        self.label.setMaximumSize(QtCore.QSize(800, 200))
        self.label.setStyleSheet("image: url(:/valve/images/BasilicaCurve.png")
        self.label.setText("")
        self.label.setAlignment(QtCore.Qt.AlignCenter)
        self.label.setObjectName("label")
        self.horizontalLayout.addWidget(self.label)
        self.verticalLayout_2.addWidget(self.frame_3, 0, QtCore.Qt.AlignTop)
        self.frame_2 = QtWidgets.QFrame(self.centralwidget)
        self.horizontalLayout_middle = QtWidgets.QHBoxLayout(self.frame_2)

        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Expanding)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.frame_2.sizePolicy().hasHeightForWidth())
        self.frame_2.setSizePolicy(sizePolicy)
        self.frame_2.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.frame_2.setFrameShadow(QtWidgets.QFrame.Raised)
        self.frame_2.setObjectName("frame_2")

        # ------------------------------copy from here to add Canvas to above frame-2-------------------------------
        # create horizontal layout
        self.HorizontalLayout_3 = QtWidgets.QHBoxLayout(self.frame_2)
        self.HorizontalLayout_3.setObjectName("HorizontalLayout_3")

        # # Canvas Add here
        # self.figure, self.ax = plt.subplots(constrained_layout=True)
        # self.canvas = FigureCanvas(self.figure)
        # # end of canvas

        # Canvas Add here
        self.figure = Figure()
        self.ax = self.figure.subplots()
        self.canvas = FigureCanvas(self.figure)
        # end of canvas
        # add canvas to layout
        self.horizontalLayout_middle.addWidget(self.canvas, QtCore.Qt.AlignCenter)
        # self.HorizontalLayout_3.addWidget(self.canvas, QtCore.Qt.AlignCenter)
        # end canvas

        # plot styles
        self.ax.set_aspect('equal')
        self.ax.xaxis.set_major_locator(MultipleLocator(20))
        self.ax.yaxis.set_major_locator(MultipleLocator(20))

        # Change minor ticks to show every 5. (20/4 = 5)
        self.ax.xaxis.set_minor_locator(AutoMinorLocator(4))
        self.ax.yaxis.set_minor_locator(AutoMinorLocator(4))
        # get empty plots
        self.scat_bt = self.ax.scatter(0, 0, c="blue")
        self.scat_bt_txt = self.ax.text(0, 0, "0,0")

        self.plot_structure = self.ax.plot(0, 0)
        self.plot_device = self.ax.plot(0, 0)
        # Turn grid on for both major and minor ticks and style minor slightly
        # differently.
        self.ax.grid(which='major', color='#CCCCCC', linestyle='--')
        self.ax.grid(which='minor', color='#CCCCCC', linestyle=':')
        # plt.ylim(-90, 90)
        # plt.xlim(-90, 90)
        # plt.ion()
        self.ax.set_xlim(-90, 90)
        self.ax.set_ylim(-90, 90)

        self.ax.axhline(y=0, color='k')
        self.ax.axvline(x=0, color='k')
        # endplot styles

        self.verticalLayout_2.addWidget(self.frame_2)
        self.vtkWidget = QVTKRenderWindowInteractor(self.frame_2)
        # self.verticalLayout_2.addWidget(self.vtkWidget)

        self.horizontalLayout_middle.addWidget(self.vtkWidget, QtCore.Qt.AlignCenter)
        self.loadAorta("")

        # ------------------------------copy upto here to add Canvas to above frame-2-------------------------------

        self.frame = QtWidgets.QFrame(self.centralwidget)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.frame.sizePolicy().hasHeightForWidth())
        self.frame.setSizePolicy(sizePolicy)
        self.frame.setMaximumSize(QtCore.QSize(16777215, 350))


        palette = QtGui.QPalette()
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Window, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Window, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Window, brush)
        self.frame.setPalette(palette)
        self.frame.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.frame.setFrameShadow(QtWidgets.QFrame.Raised)
        self.frame.setObjectName("frame")
        self.horizontalLayout_2 = QtWidgets.QHBoxLayout(self.frame)
        self.horizontalLayout_2.setObjectName("horizontalLayout_2")
        self.ManValBox = QtWidgets.QGroupBox(self.frame)
        self.ManValBox.setMinimumSize(QtCore.QSize(0, 0))
        self.ManValBox.setObjectName("ManValBox")
        self.horizontalLayout_7 = QtWidgets.QHBoxLayout(self.ManValBox)
        self.horizontalLayout_7.setContentsMargins(0, 0, 0, 0)
        self.horizontalLayout_7.setSpacing(0)
        self.horizontalLayout_7.setObjectName("horizontalLayout_7")
        self.ValFrame = QtWidgets.QFrame(self.ManValBox)
        self.ValFrame.setMinimumSize(QtCore.QSize(0, 100))
        self.ValFrame.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.ValFrame.setFrameShadow(QtWidgets.QFrame.Raised)
        self.ValFrame.setObjectName("ValFrame")
        self.horizontalLayout_4 = QtWidgets.QHBoxLayout(self.ValFrame)
        self.horizontalLayout_4.setObjectName("horizontalLayout_4")
        #start here

        self.gbXYZ = QtWidgets.QGroupBox(self.ValFrame)
        self.gbXYZ.setMinimumSize(QtCore.QSize(0, 0))
        palette = QtGui.QPalette()
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.WindowText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Light, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Midlight, brush)
        brush = QtGui.QBrush(QtGui.QColor(127, 127, 127))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Dark, brush)
        brush = QtGui.QBrush(QtGui.QColor(170, 170, 170))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Mid, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Text, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.BrightText, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.ButtonText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Window, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Shadow, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.AlternateBase, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 220))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.ToolTipBase, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.ToolTipText, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.WindowText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Light, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Midlight, brush)
        brush = QtGui.QBrush(QtGui.QColor(127, 127, 127))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Dark, brush)
        brush = QtGui.QBrush(QtGui.QColor(170, 170, 170))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Mid, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Text, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.BrightText, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.ButtonText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Window, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Shadow, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.AlternateBase, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 220))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.ToolTipBase, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.ToolTipText, brush)
        brush = QtGui.QBrush(QtGui.QColor(127, 127, 127))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.WindowText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Light, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Midlight, brush)
        brush = QtGui.QBrush(QtGui.QColor(127, 127, 127))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Dark, brush)
        brush = QtGui.QBrush(QtGui.QColor(170, 170, 170))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Mid, brush)
        brush = QtGui.QBrush(QtGui.QColor(127, 127, 127))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Text, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.BrightText, brush)
        brush = QtGui.QBrush(QtGui.QColor(127, 127, 127))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.ButtonText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Window, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Shadow, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.AlternateBase, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 220))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.ToolTipBase, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.ToolTipText, brush)
        self.gbXYZ.setPalette(palette)
        self.gbXYZ.setAlignment(QtCore.Qt.AlignBottom|QtCore.Qt.AlignLeading|QtCore.Qt.AlignLeft)
        self.gbXYZ.setObjectName("gbXYZ")
        self.verticalLayout_9 = QtWidgets.QVBoxLayout(self.gbXYZ)
        self.verticalLayout_9.setObjectName("verticalLayout_9")
        self.frame_4 = QtWidgets.QFrame(self.gbXYZ)
        self.frame_4.setMinimumSize(QtCore.QSize(0, 50))
        self.frame_4.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.frame_4.setFrameShadow(QtWidgets.QFrame.Raised)
        self.frame_4.setObjectName("frame_4")
        self.horizontalLayout_8 = QtWidgets.QHBoxLayout(self.frame_4)
        self.horizontalLayout_8.setObjectName("horizontalLayout_8")
        self.xlabel = QtWidgets.QLabel(self.frame_4)
        self.xlabel.setObjectName("xlabel")
        self.horizontalLayout_8.addWidget(self.xlabel)
        self.vxLCC = QtWidgets.QTextEdit(self.frame_4)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.vxLCC.sizePolicy().hasHeightForWidth())
        self.vxLCC.setSizePolicy(sizePolicy)
        self.vxLCC.setMinimumSize(QtCore.QSize(0, 0))
        self.vxLCC.setMaximumSize(QtCore.QSize(100, 16777215))
        self.vxLCC.setObjectName("vxLCC")
        self.horizontalLayout_8.addWidget(self.vxLCC)
        self.vyLCC = QtWidgets.QTextEdit(self.frame_4)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.vyLCC.sizePolicy().hasHeightForWidth())
        self.vyLCC.setSizePolicy(sizePolicy)
        self.vyLCC.setMaximumSize(QtCore.QSize(100, 16777215))
        self.vyLCC.setObjectName("vyLCC")
        self.horizontalLayout_8.addWidget(self.vyLCC)
        self.vzLCC = QtWidgets.QTextEdit(self.frame_4)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.vzLCC.sizePolicy().hasHeightForWidth())
        self.vzLCC.setSizePolicy(sizePolicy)
        self.vzLCC.setMaximumSize(QtCore.QSize(100, 16777215))
        self.vzLCC.setObjectName("vzLCC")
        self.horizontalLayout_8.addWidget(self.vzLCC)
        self.verticalLayout_9.addWidget(self.frame_4)
        self.frame_5 = QtWidgets.QFrame(self.gbXYZ)
        self.frame_5.setMinimumSize(QtCore.QSize(0, 50))
        self.frame_5.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.frame_5.setFrameShadow(QtWidgets.QFrame.Raised)
        self.frame_5.setObjectName("frame_5")
        self.horizontalLayout_9 = QtWidgets.QHBoxLayout(self.frame_5)
        self.horizontalLayout_9.setObjectName("horizontalLayout_9")
        self.ylabel = QtWidgets.QLabel(self.frame_5)
        self.ylabel.setMinimumSize(QtCore.QSize(0, 50))
        self.ylabel.setObjectName("ylabel")
        self.horizontalLayout_9.addWidget(self.ylabel)
        self.vxRCC = QtWidgets.QTextEdit(self.frame_5)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.vxRCC.sizePolicy().hasHeightForWidth())
        self.vxRCC.setSizePolicy(sizePolicy)
        self.vxRCC.setMaximumSize(QtCore.QSize(100, 16777215))
        self.vxRCC.setObjectName("vxRCC")
        self.horizontalLayout_9.addWidget(self.vxRCC)
        self.vyRCC = QtWidgets.QTextEdit(self.frame_5)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.vyRCC.sizePolicy().hasHeightForWidth())
        self.vyRCC.setSizePolicy(sizePolicy)
        self.vyRCC.setMaximumSize(QtCore.QSize(100, 16777215))
        self.vyRCC.setObjectName("vyRCC")
        self.horizontalLayout_9.addWidget(self.vyRCC)
        self.vzRCC = QtWidgets.QTextEdit(self.frame_5)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.vzRCC.sizePolicy().hasHeightForWidth())
        self.vzRCC.setSizePolicy(sizePolicy)
        self.vzRCC.setMaximumSize(QtCore.QSize(100, 16777215))
        self.vzRCC.setObjectName("vzRCC")
        self.horizontalLayout_9.addWidget(self.vzRCC)
        self.verticalLayout_9.addWidget(self.frame_5)
        self.frame_6 = QtWidgets.QFrame(self.gbXYZ)
        self.frame_6.setMinimumSize(QtCore.QSize(0, 50))
        self.frame_6.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.frame_6.setFrameShadow(QtWidgets.QFrame.Raised)
        self.frame_6.setObjectName("frame_6")
        self.horizontalLayout_10 = QtWidgets.QHBoxLayout(self.frame_6)
        self.horizontalLayout_10.setObjectName("horizontalLayout_10")
        self.zlabel = QtWidgets.QLabel(self.frame_6)
        self.zlabel.setMinimumSize(QtCore.QSize(0, 50))
        self.zlabel.setObjectName("zlabel")
        self.horizontalLayout_10.addWidget(self.zlabel)
        self.vxNCC = QtWidgets.QTextEdit(self.frame_6)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.vxNCC.sizePolicy().hasHeightForWidth())
        self.vxNCC.setSizePolicy(sizePolicy)
        self.vxNCC.setMaximumSize(QtCore.QSize(100, 16777215))
        self.vxNCC.setObjectName("vxNCC")
        self.horizontalLayout_10.addWidget(self.vxNCC)
        self.vyNCC = QtWidgets.QTextEdit(self.frame_6)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.vyNCC.sizePolicy().hasHeightForWidth())
        self.vyNCC.setSizePolicy(sizePolicy)
        self.vyNCC.setMaximumSize(QtCore.QSize(100, 16777215))
        self.vyNCC.setObjectName("vyNCC")
        self.horizontalLayout_10.addWidget(self.vyNCC)
        self.vzNCC = QtWidgets.QTextEdit(self.frame_6)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.vzNCC.sizePolicy().hasHeightForWidth())
        self.vzNCC.setSizePolicy(sizePolicy)
        self.vzNCC.setMaximumSize(QtCore.QSize(100, 16777215))
        self.vzNCC.setObjectName("vzNCC")
        self.horizontalLayout_10.addWidget(self.vzNCC)
        self.verticalLayout_9.addWidget(self.frame_6)
        self.fbtnXYZ = QtWidgets.QFrame(self.gbXYZ)
        self.fbtnXYZ.setMinimumSize(QtCore.QSize(0, 50))
        palette = QtGui.QPalette()
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.WindowText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Light, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Midlight, brush)
        brush = QtGui.QBrush(QtGui.QColor(127, 127, 127))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Dark, brush)
        brush = QtGui.QBrush(QtGui.QColor(170, 170, 170))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Mid, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Text, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.BrightText, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.ButtonText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Window, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Shadow, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.AlternateBase, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 220))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.ToolTipBase, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.ToolTipText, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.WindowText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Light, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Midlight, brush)
        brush = QtGui.QBrush(QtGui.QColor(127, 127, 127))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Dark, brush)
        brush = QtGui.QBrush(QtGui.QColor(170, 170, 170))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Mid, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Text, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.BrightText, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.ButtonText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Window, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Shadow, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.AlternateBase, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 220))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.ToolTipBase, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.ToolTipText, brush)
        brush = QtGui.QBrush(QtGui.QColor(127, 127, 127))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.WindowText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Light, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Midlight, brush)
        brush = QtGui.QBrush(QtGui.QColor(127, 127, 127))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Dark, brush)
        brush = QtGui.QBrush(QtGui.QColor(170, 170, 170))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Mid, brush)
        brush = QtGui.QBrush(QtGui.QColor(127, 127, 127))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Text, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.BrightText, brush)
        brush = QtGui.QBrush(QtGui.QColor(127, 127, 127))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.ButtonText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Window, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Shadow, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.AlternateBase, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 220))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.ToolTipBase, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.ToolTipText, brush)
        self.fbtnXYZ.setPalette(palette)
        self.fbtnXYZ.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.fbtnXYZ.setFrameShadow(QtWidgets.QFrame.Raised)
        self.fbtnXYZ.setObjectName("fbtnXYZ")
        self.horizontalLayout_33 = QtWidgets.QHBoxLayout(self.fbtnXYZ)
        self.horizontalLayout_33.setObjectName("horizontalLayout_3")
        self.btnXYZ = QtWidgets.QPushButton(self.fbtnXYZ)
        self.btnXYZ.clicked.connect(self.Get_Scurve_XYZ)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.btnXYZ.sizePolicy().hasHeightForWidth())
        self.btnXYZ.setSizePolicy(sizePolicy)
        icon = QtGui.QIcon()
        icon.addPixmap(QtGui.QPixmap(":/valve/D:/NBME/aortic-valve.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.btnXYZ.setIcon(icon)
        self.btnXYZ.setObjectName("btnXYZ")
        self.horizontalLayout_33.addWidget(self.btnXYZ)
        self.btnHelpXYZ = QtWidgets.QPushButton(self.fbtnXYZ)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.btnHelpXYZ.sizePolicy().hasHeightForWidth())
        self.btnHelpXYZ.setSizePolicy(sizePolicy)
        self.btnHelpXYZ.setObjectName("btnHelpXYZ")
        self.horizontalLayout_33.addWidget(self.btnHelpXYZ)
        self.verticalLayout_9.addWidget(self.fbtnXYZ)
        self.horizontalLayout_4.addWidget(self.gbXYZ)

        #end here





        self.val1Box_3 = QtWidgets.QGroupBox(self.ValFrame)
        self.val1Box_3.setMinimumSize(QtCore.QSize(0, 50))
        self.val1Box_3.setObjectName("val1Box_3")
        self.verticalLayout_8 = QtWidgets.QVBoxLayout(self.val1Box_3)
        self.verticalLayout_8.setObjectName("verticalLayout_8")
        self.lxRLV1_3 = QtWidgets.QLabel(self.val1Box_3)
        self.lxRLV1_3.setObjectName("lxRLV1_3")
        self.verticalLayout_8.addWidget(self.lxRLV1_3)
        self.xRL_LCC_Front_TextEdit = QtWidgets.QTextEdit(self.val1Box_3)
        self.xRL_LCC_Front_TextEdit.setMaximumSize(QtCore.QSize(16777215, 50))
        self.xRL_LCC_Front_TextEdit.setObjectName("xRL_LCC_Front_TextEdit")
        self.verticalLayout_8.addWidget(self.xRL_LCC_Front_TextEdit)
        self.lxCCV1_3 = QtWidgets.QLabel(self.val1Box_3)
        self.lxCCV1_3.setObjectName("lxCCV1_3")
        self.verticalLayout_8.addWidget(self.lxCCV1_3)
        self.xCC_LCC_Front_TextEdit = QtWidgets.QTextEdit(self.val1Box_3)
        self.xCC_LCC_Front_TextEdit.setMaximumSize(QtCore.QSize(16777215, 50))
        self.xCC_LCC_Front_TextEdit.setObjectName("xCC_LCC_Front_TextEdit")
        self.verticalLayout_8.addWidget(self.xCC_LCC_Front_TextEdit)
        self.horizontalLayout_4.addWidget(self.val1Box_3)
        self.val1Box_2 = QtWidgets.QGroupBox(self.ValFrame)
        self.val1Box_2.setMinimumSize(QtCore.QSize(0, 50))
        self.val1Box_2.setObjectName("val1Box_2")
        self.verticalLayout_7 = QtWidgets.QVBoxLayout(self.val1Box_2)
        self.verticalLayout_7.setObjectName("verticalLayout_7")
        self.lxRLV1_2 = QtWidgets.QLabel(self.val1Box_2)
        self.lxRLV1_2.setObjectName("lxRLV1_2")
        self.verticalLayout_7.addWidget(self.lxRLV1_2)
        self.xRL_LCC_Side_TextEdit = QtWidgets.QTextEdit(self.val1Box_2)
        self.xRL_LCC_Side_TextEdit.setMaximumSize(QtCore.QSize(16777215, 50))
        self.xRL_LCC_Side_TextEdit.setObjectName("xRL_LCC_Side_TextEdit")
        self.verticalLayout_7.addWidget(self.xRL_LCC_Side_TextEdit)
        self.lxCCV1_2 = QtWidgets.QLabel(self.val1Box_2)
        self.lxCCV1_2.setObjectName("lxCCV1_2")
        self.verticalLayout_7.addWidget(self.lxCCV1_2)
        self.xCC_LCC_Side_TextEdit = QtWidgets.QTextEdit(self.val1Box_2)
        self.xCC_LCC_Side_TextEdit.setMaximumSize(QtCore.QSize(16777215, 50))
        self.xCC_LCC_Side_TextEdit.setObjectName("xCC_LCC_Side_TextEdit")
        self.verticalLayout_7.addWidget(self.xCC_LCC_Side_TextEdit)
        self.horizontalLayout_4.addWidget(self.val1Box_2)
        self.val1Box = QtWidgets.QGroupBox(self.ValFrame)
        self.val1Box.setMinimumSize(QtCore.QSize(0, 50))
        self.val1Box.setObjectName("val1Box")
        self.verticalLayout_3 = QtWidgets.QVBoxLayout(self.val1Box)
        self.verticalLayout_3.setObjectName("verticalLayout_3")
        self.lxRLV1 = QtWidgets.QLabel(self.val1Box)
        self.lxRLV1.setObjectName("lxRLV1")
        self.verticalLayout_3.addWidget(self.lxRLV1)
        self.xRL_RCC_Front_TextEdit = QtWidgets.QTextEdit(self.val1Box)
        self.xRL_RCC_Front_TextEdit.setMaximumSize(QtCore.QSize(16777215, 50))
        self.xRL_RCC_Front_TextEdit.setObjectName("xRL_RCC_Front_TextEdit")
        self.verticalLayout_3.addWidget(self.xRL_RCC_Front_TextEdit)
        self.lxCCV1 = QtWidgets.QLabel(self.val1Box)
        self.lxCCV1.setObjectName("lxCCV1")
        self.verticalLayout_3.addWidget(self.lxCCV1)
        self.xCC_RCC_Front_TextEdit = QtWidgets.QTextEdit(self.val1Box)
        self.xCC_RCC_Front_TextEdit.setMaximumSize(QtCore.QSize(16777215, 50))
        self.xCC_RCC_Front_TextEdit.setObjectName("xCC_RCC_Front_TextEdit")
        self.verticalLayout_3.addWidget(self.xCC_RCC_Front_TextEdit)
        self.horizontalLayout_4.addWidget(self.val1Box)
        self.val2Box = QtWidgets.QGroupBox(self.ValFrame)
        self.val2Box.setMinimumSize(QtCore.QSize(0, 50))
        self.val2Box.setObjectName("val2Box")
        self.verticalLayout_5 = QtWidgets.QVBoxLayout(self.val2Box)
        self.verticalLayout_5.setObjectName("verticalLayout_5")
        self.lxRLV2 = QtWidgets.QLabel(self.val2Box)
        self.lxRLV2.setObjectName("lxRLV2")
        self.verticalLayout_5.addWidget(self.lxRLV2)
        self.xRL_RCC_Side_TextEdit = QtWidgets.QTextEdit(self.val2Box)
        self.xRL_RCC_Side_TextEdit.setMaximumSize(QtCore.QSize(16777215, 50))
        self.xRL_RCC_Side_TextEdit.setObjectName("xRL_RCC_Side_TextEdit")
        self.verticalLayout_5.addWidget(self.xRL_RCC_Side_TextEdit)
        self.lxRCC2 = QtWidgets.QLabel(self.val2Box)
        self.lxRCC2.setObjectName("lxRCC2")
        self.verticalLayout_5.addWidget(self.lxRCC2)
        self.xCC_RCC_Side_TextEdit = QtWidgets.QTextEdit(self.val2Box)
        self.xCC_RCC_Side_TextEdit.setMaximumSize(QtCore.QSize(16777215, 50))
        self.xCC_RCC_Side_TextEdit.setObjectName("xCC_RCC_Side_TextEdit")
        self.verticalLayout_5.addWidget(self.xCC_RCC_Side_TextEdit)
        self.horizontalLayout_4.addWidget(self.val2Box)
        self.btnframe = QtWidgets.QFrame(self.ValFrame)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.btnframe.sizePolicy().hasHeightForWidth())
        self.btnframe.setSizePolicy(sizePolicy)
        self.btnframe.setMinimumSize(QtCore.QSize(0, 0))
        self.btnframe.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.btnframe.setFrameShadow(QtWidgets.QFrame.Raised)
        self.btnframe.setObjectName("btnframe")
        self.verticalLayout = QtWidgets.QVBoxLayout(self.btnframe)
        self.verticalLayout.setContentsMargins(0, 0, 0, 0)
        self.verticalLayout.setSpacing(0)
        self.verticalLayout.setObjectName("verticalLayout")
        self.btnMakeCatheterSC = QtWidgets.QPushButton(self.btnframe)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Fixed)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.btnMakeCatheterSC.sizePolicy().hasHeightForWidth())
        self.btnMakeCatheterSC.setSizePolicy(sizePolicy)
        icon = QtGui.QIcon()
        icon.addPixmap(QtGui.QPixmap("images/replacement.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.btnMakeCatheterSC.setIcon(icon)
        self.btnMakeCatheterSC.setIconSize(QtCore.QSize(40, 40))
        self.btnMakeCatheterSC.setObjectName("btnMakeCatheterSC")
        self.btnMakeCatheterSC.clicked.connect(self.device_s_cruve)

        self.verticalLayout.addWidget(self.btnMakeCatheterSC)
        self.btnHelpMan = QtWidgets.QPushButton(self.btnframe)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Fixed)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.btnHelpMan.sizePolicy().hasHeightForWidth())
        self.btnHelpMan.setSizePolicy(sizePolicy)
        self.btnHelpMan.setIconSize(QtCore.QSize(40, 40))
        self.btnHelpMan.setObjectName("btnHelpMan")
        self.verticalLayout.addWidget(self.btnHelpMan)
        self.horizontalLayout_4.addWidget(self.btnframe)
        self.horizontalLayout_7.addWidget(self.ValFrame)
        self.autoBox = QtWidgets.QGroupBox(self.ManValBox)
        self.autoBox.setObjectName("autoBox")
        self.verticalLayout_4 = QtWidgets.QVBoxLayout(self.autoBox)
        self.verticalLayout_4.setObjectName("verticalLayout_4")
        self.btnGetBTV1 = QtWidgets.QPushButton(self.autoBox, clicked=lambda: self.get_current_pos(1))

        icon1 = QtGui.QIcon()
        icon1.addPixmap(QtGui.QPixmap(":/newPrefix/D:/NBME/bt.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.btnGetBTV1.setIcon(icon1)
        self.btnGetBTV1.setObjectName("btnGetBTV1")
        self.verticalLayout_4.addWidget(self.btnGetBTV1)
        self.btnGetBTV2 = QtWidgets.QPushButton(self.autoBox, clicked=lambda: self.get_current_pos(2))

        self.btnGetBTV2.setIcon(icon1)
        self.btnGetBTV2.setObjectName("btnGetBTV2")
        self.verticalLayout_4.addWidget(self.btnGetBTV2)
        self.btnft = QtWidgets.QPushButton(self.autoBox, clicked=lambda: self.func_ft())

        palette = QtGui.QPalette()
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Window, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Window, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Window, brush)
        self.btnft.setPalette(palette)
        self.btnft.setIcon(icon1)
        self.btnft.setIconSize(QtCore.QSize(40, 40))
        self.btnft.setObjectName("btnft")
        self.verticalLayout_4.addWidget(self.btnft)
        self.btnHelpAuto = QtWidgets.QPushButton(self.autoBox)
        self.btnHelpAuto.setObjectName("btnHelpAuto")
        self.verticalLayout_4.addWidget(self.btnHelpAuto)
        self.horizontalLayout_7.addWidget(self.autoBox)
        self.horizontalLayout_2.addWidget(self.ManValBox)
        self.groupBox = QtWidgets.QGroupBox(self.frame)
        self.groupBox.setObjectName("groupBox")
        self.verticalLayout_6 = QtWidgets.QVBoxLayout(self.groupBox)
        self.verticalLayout_6.setObjectName("verticalLayout_6")
        self.btnAVCurve = QtWidgets.QPushButton(self.groupBox, clicked=lambda: self.structure_s_cruve())
        icon2 = QtGui.QIcon()
        icon2.addPixmap(QtGui.QPixmap(":/valve/D:/NBME/aortic-valve.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.btnAVCurve.setIcon(icon2)
        self.btnAVCurve.setIconSize(QtCore.QSize(40, 40))
        self.btnAVCurve.setObjectName("btnAVCurve")
        self.verticalLayout_6.addWidget(self.btnAVCurve)
        self.LoadAorta = QtWidgets.QPushButton(self.groupBox,clicked=lambda:self.openfile())
        icon3 = QtGui.QIcon()
        icon3.addPixmap(QtGui.QPixmap("images/aorta.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.LoadAorta.setIcon(icon3)
        self.LoadAorta.setIconSize(QtCore.QSize(40, 40))
        self.LoadAorta.setObjectName("LoadAorta")
        self.verticalLayout_6.addWidget(self.LoadAorta)
        #add angle

        self.Valve_Angle_TextEdit = QtWidgets.QTextEdit(self.groupBox)
        self.Valve_Angle_TextEdit.setMaximumSize(QtCore.QSize(16777215, 50))
        self.Valve_Angle_TextEdit.setObjectName("Valve_Angle_TextEdit")
        self.verticalLayout_6.addWidget(self.Valve_Angle_TextEdit)

        #end angle

        self.horizontalLayout_2.addWidget(self.groupBox)
        self.verticalLayout_2.addWidget(self.frame)
        MainWindow.setCentralWidget(self.centralwidget)
        self.menubar = QtWidgets.QMenuBar(MainWindow)
        self.menubar.setGeometry(QtCore.QRect(0, 0, 1329, 18))
        self.menubar.setObjectName("menubar")
        self.menuFIle = QtWidgets.QMenu(self.menubar)
        self.menuFIle.setObjectName("menuFIle")
        self.menuHelp = QtWidgets.QMenu(self.menubar)
        self.menuHelp.setObjectName("menuHelp")
        MainWindow.setMenuBar(self.menubar)
        self.statusbar = QtWidgets.QStatusBar(MainWindow)
        self.statusbar.setObjectName("statusbar")
        MainWindow.setStatusBar(self.statusbar)
        self.menubar.addAction(self.menuFIle.menuAction())
        self.menubar.addAction(self.menuHelp.menuAction())

        self.retranslateUi(MainWindow)
        QtCore.QMetaObject.connectSlotsByName(MainWindow)
    def loadAorta(self,filename):
        self.ren = vtk.vtkRenderer()
        self.renWin = self.vtkWidget.GetRenderWindow()

        self.ren.SetBackground(1, 1, 1)

        self.vtkWidget.GetRenderWindow().AddRenderer(self.ren)
        self.iren = self.vtkWidget.GetRenderWindow().GetInteractor()

        # add actor NEW

        if(filename):

            #self.stlFilename = filename
            #self.polydata = self.loadStl(self.stlFilename)


            # start of OBJ file

            reader = vtk.vtkOBJReader()
            reader.SetFileName(filename)
            #reader.SetMtlFileName("./Valve-texture.obj.mtl")
            reader.Update()

            self.polydata = reader.GetOutput()

            # Get the center of the loaded geometry

            texture_image = vtk.vtkImageData()
            texture_image_reader = vtk.vtkPNGReader()  # or vtkJPEGReader()
            texture_image_reader.SetFileName(filename+".png")  # or .jpg
            texture_image_reader.Update()
            texture_image.ShallowCopy(texture_image_reader.GetOutput())

            # Create a VTK texture object using the vtkTexture class and set the input texture image
            texture = vtk.vtkTexture()
            texture.SetInputData(texture_image)

            mapper = vtk.vtkPolyDataMapper()
            mapper.SetInputConnection(reader.GetOutputPort())
            center = mapper.GetCenter()


            self.actor = vtk.vtkActor()
            self.actor.SetMapper(mapper)
            self.actor.SetTexture(texture)
            #self.actor = self.polyDataToActor(self.polydata)
            self.actor.SetOrigin(self.polydata.GetCenter())
            self.ren.AddActor(self.actor)
            self.actor.SetOrientation(0, -90, 0)
            self.actor.RotateX(self.angle_BPV_RCC_Front)
            #self.actor.RotateX(45)



        self.ren.ResetCamera()

        # self.nxLR = 0
        # self.nxCC = 0
        self.rotation(self.ren, self.renWin, self.pxLR, self.pxCC)
        print("LAO / CRAN 0")

        self.iren.Initialize()

        # end actor

        # ------------------

    def retranslateUi(self, MainWindow):
        _translate = QtCore.QCoreApplication.translate
        MainWindow.setWindowTitle(_translate("MainWindow", "MainWindow"))
        self.ManValBox.setTitle(_translate("MainWindow", "Bioprosthetic S-Curve"))
        self.gbXYZ.setTitle(_translate("MainWindow", "Comissure Coordinates Values"))
        self.xlabel.setText(_translate("MainWindow", "LNC Coordinates"))
        self.vxLCC.setPlaceholderText(_translate("MainWindow", "X Value"))
        self.vyLCC.setPlaceholderText(_translate("MainWindow", "Y Value"))
        self.vzLCC.setPlaceholderText(_translate("MainWindow", "Z Value"))
        self.ylabel.setText(_translate("MainWindow", "RNC Coordinates"))
        self.vxRCC.setPlaceholderText(_translate("MainWindow", "X Value"))
        self.vyRCC.setPlaceholderText(_translate("MainWindow", "Y Value"))
        self.vzRCC.setPlaceholderText(_translate("MainWindow", "Z Value"))
        self.zlabel.setText(_translate("MainWindow", "LRC Coordinates"))
        self.vxNCC.setPlaceholderText(_translate("MainWindow", "X Value"))
        self.vyNCC.setPlaceholderText(_translate("MainWindow", "Y Value"))
        self.vzNCC.setPlaceholderText(_translate("MainWindow", "Z Value"))
        self.btnXYZ.setText(_translate("MainWindow", "Calculate"))
        self.btnHelpXYZ.setText(_translate("MainWindow", "Help"))
        self.val1Box_3.setTitle(_translate("MainWindow", "Frontal View LCC"))
        self.lxRLV1_3.setText(_translate("MainWindow", "LAO/RAO"))
        self.xRL_LCC_Front_TextEdit.setPlaceholderText(_translate("MainWindow", "LAO in Postive, RAO in Negative"))
        self.lxCCV1_3.setText(_translate("MainWindow", "CRAN/CAUD"))
        self.xCC_LCC_Front_TextEdit.setPlaceholderText(_translate("MainWindow", "CRAN in Postive, CAUD in Negative"))
        self.val1Box_2.setTitle(_translate("MainWindow", "Side View LCC"))
        self.lxRLV1_2.setText(_translate("MainWindow", "LAO/RAO"))
        self.xRL_LCC_Side_TextEdit.setPlaceholderText(_translate("MainWindow", "LAO in Postive, RAO in Negative"))
        self.lxCCV1_2.setText(_translate("MainWindow", "CRAN/CAUD"))
        self.xCC_LCC_Side_TextEdit.setPlaceholderText(_translate("MainWindow", "CRAN in Postive, CAUD in Negative"))
        self.val1Box.setTitle(_translate("MainWindow", "Frontal View RCC"))
        self.lxRLV1.setText(_translate("MainWindow", "LAO/RAO"))
        self.xRL_RCC_Front_TextEdit.setPlaceholderText(_translate("MainWindow", "LAO in Postive, RAO in Negative"))
        self.lxCCV1.setText(_translate("MainWindow", "CRAN/CAUD"))
        self.xCC_RCC_Front_TextEdit.setPlaceholderText(_translate("MainWindow", "CRAN in Postive, CAUD in Negative"))
        self.val2Box.setTitle(_translate("MainWindow", "Side View RCC"))
        self.lxRLV2.setText(_translate("MainWindow", "LAO/RAO"))
        self.xRL_RCC_Side_TextEdit.setPlaceholderText(_translate("MainWindow", "LAO in Postive, RAO in Negative"))
        self.lxRCC2.setText(_translate("MainWindow", "CRAN/CAUD"))
        self.xCC_RCC_Side_TextEdit.setPlaceholderText(_translate("MainWindow", "CRAN in Postive, CAUD in Negative"))
        self.Valve_Angle_TextEdit.setPlaceholderText(_translate("MainWindow", "Angle of Valve"))

        self.btnMakeCatheterSC.setText(_translate("MainWindow", "S-Curve Valve"))
        self.btnHelpMan.setText(_translate("MainWindow", "Help"))
        self.autoBox.setTitle(_translate("MainWindow", "Automatic Valve S-Curve"))
        self.btnGetBTV1.setText(_translate("MainWindow", "Get Frontal View"))
        self.btnGetBTV2.setText(_translate("MainWindow", "Get Side View"))
        self.btnft.setText(_translate("MainWindow", "FluoroTracker"))
        self.btnHelpAuto.setText(_translate("MainWindow", "Help"))
        self.groupBox.setTitle(_translate("MainWindow", "Aorta"))
        self.btnAVCurve.setText(_translate("MainWindow", "Get AV S Curve"))
        self.LoadAorta.setText(_translate("MainWindow", "Load Valve"))
        self.menuFIle.setTitle(_translate("MainWindow", "File"))
        self.menuHelp.setTitle(_translate("MainWindow", "Help"))

    def loadStl(self, fname):
        """Load the given STL file, and return a vtkPolyData object for it."""
        reader = vtk.vtkSTLReader()
        reader.SetFileName(fname)
        reader.Update()
        polydata = reader.GetOutput()
        return polydata

    def rotation(self, ren, renWin, nxLR, nxCC):
        #print(nxLR - self.pxLR)
        #print(nxCC - self.pxCC)

        ren.GetActiveCamera().Azimuth(nxLR - self.pxLR)
        ren.GetActiveCamera().Elevation(nxCC - self.pxCC)

        self.pxLR = nxLR
        self.pxCC = nxCC
        renWin.Render()

    def polyDataToActor(self, polydata):
        """Wrap the provided vtkPolyData object in a mapper and an actor, returning
        the actor."""
        mapper = vtk.vtkPolyDataMapper()
        if vtk.VTK_MAJOR_VERSION <= 5:
            # mapper.SetInput(reader.GetOutput())
            mapper.SetInput(polydata)
        else:
            mapper.SetInputData(polydata)
        actor = vtk.vtkActor()
        actor.SetMapper(mapper)
        # actor.GetProperty().SetRepresentationToWireframe()
        actor.GetProperty().SetColor(1, 0, 0)
        actor.GetProperty().SetOpacity(1)
        return actor


import sys

app = QtWidgets.QApplication(sys.argv)
BasilicaAssistWindow = MyWindow()
BasilicaAssist_ui = Ui_BasilicaAssist()
BasilicaAssist_ui.setupUi(BasilicaAssistWindow)

