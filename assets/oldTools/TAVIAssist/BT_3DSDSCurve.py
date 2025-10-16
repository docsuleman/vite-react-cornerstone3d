import time

import vtk
from PyQt5 import QtCore, QtGui, QtWidgets
import matplotlib.pyplot as plt
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
        if (ThreeDSDSC_ui.ani):
            ThreeDSDSC_ui.ani.event_source.stop()
            print("BT 3D DSCurve Plotting Stopped")

    def showEvent(self, event):
        if (BTClass.myBT.getConnectedDevice() and ThreeDSDSC_ui.ani):
            ThreeDSDSC_ui.ani.event_source.start()
            print("BT 3D SCurve  Plotting Started")


class Ui_ThreeDSDSCurve(object):

    def __init__(self):
        self.bt_data = [0, 0, 0]
        self.ani = None
        self.CRAN1 = None
        self.LAO1 = None
        self.RAO2 = None
        self.CAUD2 = None
        self.pxLR = 0
        self.pxCC = 0

    def runAnimation(self):
        self.ani = FuncAnimation(self.figure, self.update_plot, interval=200)
        self.canvas.draw()

    def get_current_pos(self, type):
        self.bt_data = BTClass.myBT.recvBTdata_splitted()

        if type == 1:
            self.LAO1, self.CRAN1 = round(int(self.bt_data[1])), round( int(self.bt_data[2]))
        if type == 2:
            self.RAO2, self.CAUD2 = round(int(self.bt_data[1])), round( int(self.bt_data[2]))
        print(self.LAO1, self.CRAN1, self.RAO2, self.CAUD2)

        if (self.LAO1 and self.RAO2 and self.CAUD2 and self.CRAN1):
            self.data2 = NAVICath.get_s_curve_device(self.CRAN1, self.LAO1, self.CAUD2, self.RAO2)
            self.plot_device = self.ax.plot(range(-90, 90), self.data2, label="Evolut", color="blue")
            self.ax.legend(loc="upper left")
            self.canvas.draw()

        return round(int(self.bt_data[1])), round( int(self.bt_data[2]))

    def update_plot(self, i):
        self.bt_data = BTClass.myBT.recvBTdata_splitted()
        if (self.bt_data):
            self.scat_bt.remove()
            self.scat_bt = self.ax.scatter(round(int(self.bt_data[1])), round( int(self.bt_data[2])), c="blue")
            # print("BT Returns Valid Data")
            self.canvas.draw_idle()

            self.rotation(self.ren, self.renWin, round(int(self.bt_data[1])), round( int(self.bt_data[2])), )
        else:
            # print("BT Returns invalid Data")
            self.canvas.draw_idle()

            return

    def structure_s_cruve(self):
        self.plot_structure.pop(0).remove()
        self.data = NAVICath.make_s_curve_array(111, -37);
        self.plot_structure = self.ax.plot(range(-90, 90), self.data, label="AV Plane", color="red")
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
        self.LAO1 = 20
        self.CRAN1 = 20
        #######################
        self.RAO2 = -20
        self.CAUD2 = -30

        self.data2 = NAVICath.get_s_curve_device(self.CRAN1, self.LAO1, self.CAUD2, self.RAO2)
        planes = [self.CRAN1, self.LAO1, self.CAUD2, self.RAO2]
        planes = ",".join(map(str, planes))

        # save values to System
        values = (DB.patientsDB.myExam, "AV/Device/Planes", planes)
        DB.patientsDB.add_value(values)

        self.plot_device = self.ax.plot(range(-90, 90), self.data2, label="Evolut", color="blue")
        plt.legend(loc="upper left")
        self.canvas.draw()

    def func_ft(self):
        if not BTClass.myBT.getConnectedDevice():
            # BTlist_ui = BT_list.Ui_BT_devices(BT_SCurve.BTSCurveWindow, BT_SCurve.BSC_ui)
            BTlist_ui = BT_list.Ui_BT_devices(ThreeDSDSCurveWindow, ThreeDSDSC_ui)
            BTlist_ui.setupUi(BT_list.BTlistWindow)
            BT_list.BTlistWindow.show()
        else:
            print("already connected")
            ThreeDSDSCurveWindow.show()
    def goBack(self):
        ThreeDSDSCurveWindow.close()

    def setupUi(self, ThreeDSDSCurveWindow):
        ThreeDSDSCurveWindow.setObjectName("ThreeDSDSCurveWindow")
        ThreeDSDSCurveWindow.resize(1329, 760)
        ThreeDSDSCurveWindow.setStyleSheet("background-color: rgb(66, 66, 66);")
        self.centralwidget = QtWidgets.QWidget(ThreeDSDSCurveWindow)
        self.centralwidget.setObjectName("centralwidget")
        self.verticalLayout_2 = QtWidgets.QVBoxLayout(self.centralwidget)
        self.verticalLayout_2.setSizeConstraint(QtWidgets.QLayout.SetNoConstraint)
        self.verticalLayout_2.setObjectName("verticalLayout_2")
        self.frame_3 = QtWidgets.QFrame(self.centralwidget)
        self.frame_3.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.frame_3.setFrameShadow(QtWidgets.QFrame.Raised)
        self.frame_3.setObjectName("frame_3")

        self.horizontalLayout = QtWidgets.QHBoxLayout(self.frame_3)
        self.horizontalLayout.setObjectName("horizontalLayout")
        self.label = QtWidgets.QLabel(self.frame_3)
        self.label.setMinimumSize(QtCore.QSize(200, 100))
        self.label.setMaximumSize(QtCore.QSize(800, 200))
        self.label.setStyleSheet("image: url(./images/AVDSCurve.png);")
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

        # ------------------------------copy upto here to add Canvas to above frame-2-------------------------------
        self.verticalLayout_2.addWidget(self.frame_2)

        self.vtkWidget = QVTKRenderWindowInteractor(self.frame_2)
        # self.verticalLayout_2.addWidget(self.vtkWidget)

        self.horizontalLayout_middle.addWidget(self.vtkWidget, QtCore.Qt.AlignCenter)

        self.ren = vtk.vtkRenderer()
        self.renWin = self.vtkWidget.GetRenderWindow()

        self.ren.SetBackground(1, 1, 1)

        self.vtkWidget.GetRenderWindow().AddRenderer(self.ren)
        self.iren = self.vtkWidget.GetRenderWindow().GetInteractor()

        # add actor NEW

        self.stlFilename = "aorta.stl"
        self.polydata = self.loadStl(self.stlFilename)

        self.actor = self.polyDataToActor(self.polydata)
        self.actor.SetOrigin(self.polydata.GetCenter())
        self.ren.AddActor(self.actor)
        self.actor.SetOrientation(-90, 0, 0)

        self.ren.ResetCamera()

        self.nxLR = 0
        self.nxCC = 0
        self.rotation(self.ren, self.renWin, self.nxLR, self.nxCC)
        print("LAO / CRAN 0")

        self.iren.Initialize()

        # end actor

        # ------------------

        self.frame = QtWidgets.QFrame(self.centralwidget)

        palette = QtGui.QPalette()
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.ButtonText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Window, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.ButtonText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Window, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(120, 120, 120))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.ButtonText, brush)
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
        self.av = QtWidgets.QPushButton(self.frame, clicked=lambda: self.structure_s_cruve())
        icon = QtGui.QIcon()
        icon.addPixmap(QtGui.QPixmap("./images/aortic-valve.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.av.setIcon(icon)
        self.av.setIconSize(QtCore.QSize(40, 40))
        self.av.setObjectName("av")
        self.horizontalLayout_2.addWidget(self.av)

        self.catheter = QtWidgets.QPushButton(self.frame, clicked=lambda: self.device_s_cruve())
        icon1 = QtGui.QIcon()
        icon1.addPixmap(QtGui.QPixmap("./images/replacement.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.catheter.setIcon(icon1)
        self.catheter.setIconSize(QtCore.QSize(40, 40))
        self.catheter.setObjectName("catheter")
        self.horizontalLayout_2.addWidget(self.catheter)

        self.getvalue1 = QtWidgets.QPushButton(self.frame, clicked=lambda: self.get_current_pos(1))
        icon1 = QtGui.QIcon()
        icon1.addPixmap(QtGui.QPixmap("./images/replacement.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.getvalue1.setIcon(icon1)
        self.getvalue1.setIconSize(QtCore.QSize(40, 40))
        self.getvalue1.setObjectName("getvalue1")
        self.horizontalLayout_2.addWidget(self.getvalue1)

        self.getvalue2 = QtWidgets.QPushButton(self.frame, clicked=lambda: self.get_current_pos(2))
        icon1 = QtGui.QIcon()
        icon1.addPixmap(QtGui.QPixmap("./images/replacement.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.getvalue2.setIcon(icon1)
        self.getvalue2.setIconSize(QtCore.QSize(40, 40))
        self.getvalue2.setObjectName("getvalue1")
        self.horizontalLayout_2.addWidget(self.getvalue2)

        self.ft = QtWidgets.QPushButton(self.frame, clicked=lambda: self.func_ft())
        palette = QtGui.QPalette()
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Text, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.ButtonText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.Window, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255, 128))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Active, QtGui.QPalette.PlaceholderText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Text, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.ButtonText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.Window, brush)
        brush = QtGui.QBrush(QtGui.QColor(255, 255, 255, 128))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Inactive, QtGui.QPalette.PlaceholderText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Button, brush)
        brush = QtGui.QBrush(QtGui.QColor(120, 120, 120))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Text, brush)
        brush = QtGui.QBrush(QtGui.QColor(120, 120, 120))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.ButtonText, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Base, brush)
        brush = QtGui.QBrush(QtGui.QColor(66, 66, 66))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.Window, brush)
        brush = QtGui.QBrush(QtGui.QColor(0, 0, 0, 128))
        brush.setStyle(QtCore.Qt.SolidPattern)
        palette.setBrush(QtGui.QPalette.Disabled, QtGui.QPalette.PlaceholderText, brush)
        self.ft.setPalette(palette)
        icon2 = QtGui.QIcon()
        icon2.addPixmap(QtGui.QPixmap("./images/bt.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.ft.setIcon(icon2)
        self.ft.setIconSize(QtCore.QSize(40, 40))
        self.ft.setObjectName("ft")
        self.horizontalLayout_2.addWidget(self.ft)
        self.verticalLayout_2.addWidget(self.frame)
        ThreeDSDSCurveWindow.setCentralWidget(self.centralwidget)
        self.menubar = QtWidgets.QMenuBar(ThreeDSDSCurveWindow)
        self.menubar.setGeometry(QtCore.QRect(0, 0, 1329, 26))
        self.menubar.setObjectName("menubar")
        self.menuFIle = QtWidgets.QMenu(self.menubar)
        self.menuFIle.setObjectName("menuFIle")
        self.menuHelp = QtWidgets.QMenu(self.menubar)
        self.menuHelp.setObjectName("menuHelp")
        ThreeDSDSCurveWindow.setMenuBar(self.menubar)
        self.statusbar = QtWidgets.QStatusBar(ThreeDSDSCurveWindow)
        self.statusbar.setObjectName("statusbar")
        ThreeDSDSCurveWindow.setStatusBar(self.statusbar)
        self.menubar.addAction(self.menuFIle.menuAction())
        self.menubar.addAction(self.menuHelp.menuAction())

        self.btnBack = QtWidgets.QPushButton(self.centralwidget)
        self.btnBack.clicked.connect(self.goBack)
        font = QtGui.QFont()
        font.setPointSize(12)
        self.btnBack.setFont(font)
        icon2 = QtGui.QIcon()
        icon2.addPixmap(QtGui.QPixmap("images/back.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.btnBack.setIcon(icon2)
        self.btnBack.setIconSize(QtCore.QSize(40, 40))
        self.btnBack.setObjectName("btnBack")
        self.verticalLayout_2.addWidget(self.btnBack)
        self.btnBack.setText("Go Back")

        self.retranslateUi(ThreeDSDSCurveWindow)
        QtCore.QMetaObject.connectSlotsByName(ThreeDSDSCurveWindow)

    def retranslateUi(self, ThreeDSDSCurveWindow):
        _translate = QtCore.QCoreApplication.translate
        ThreeDSDSCurveWindow.setWindowTitle(
            _translate("ThreeDSDSCurveWindow", "3D Aorta Fusion - Double S Curve TAVI - NAVICath"))
        self.av.setText(_translate("ThreeDSDSCurveWindow", "S-Curve AV Valve"))
        self.catheter.setText(_translate("ThreeDSDSCurveWindow", "S-Curve Catheter"))
        self.getvalue1.setText(_translate("ThreeDSDSCurveWindow", "Set Value 1"))
        self.getvalue2.setText(_translate("ThreeDSDSCurveWindow", "Set Value 2"))
        self.ft.setText(_translate("ThreeDSDSCurveWindow", "FluoroTracker"))
        self.menuFIle.setTitle(_translate("ThreeDSDSCurveWindow", "File"))
        self.menuHelp.setTitle(_translate("ThreeDSDSCurveWindow", "Help"))

    def loadStl(self, fname):
        """Load the given STL file, and return a vtkPolyData object for it."""
        reader = vtk.vtkSTLReader()
        reader.SetFileName(fname)
        reader.Update()
        polydata = reader.GetOutput()
        return polydata

    def rotation(self, ren, renWin, nxLR, nxCC):
        print(nxLR - self.pxLR)
        print(nxCC - self.pxCC)

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
        actor.GetProperty().SetOpacity(0.5)
        return actor


import sys

app = QtWidgets.QApplication(sys.argv)
ThreeDSDSCurveWindow = MyWindow()
ThreeDSDSC_ui = Ui_ThreeDSDSCurve()
ThreeDSDSC_ui.setupUi(ThreeDSDSCurveWindow)
