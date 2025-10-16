
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
from matplotlib.backends.backend_qt5agg import FigureCanvasQTAgg as FigureCanvas
from matplotlib.figure import Figure
from matplotlib.ticker import MultipleLocator, AutoMinorLocator

import NAVICath
import BTClass
import BT_list
import DB

from PyQt5 import QtCore, QtGui, QtWidgets

class MyWindow(QtWidgets.QMainWindow):
    def closeEvent(self,event):
        if (BTDSC_ui.ani):
            BTDSC_ui.ani.event_source.stop()
            print("BT DSCurve Plotting Stopped")
        print("DSCurve Show Event")

    def showEvent(self, event):
        if(BTClass.myBT.getConnectedDevice() and BTDSC_ui.ani):
            BTDSC_ui.ani.event_source.start()
            BTDSC_ui.btnGetBTV1.setEnabled(True)
            BTDSC_ui.btnGetBTV2.setEnabled(True)
            print("BT DSCurve  Plotting Started")
        print("DSCurve Close Event")

class Ui_BTDSCurve(object):

    def __init__(self):
        self.bt_data=[0,0,0]
        self.ani=None
        self.CRAN1=None
        self.LAO1=None
        self.RAO2=None
        self.CAUD2=None
        self.pxLR = 0
        self.pxCC = 0

    def goBack(self):
        BTDSCurveWindow.close()

    def runAnimation(self):
        print("BT_DSCURVE runAnimation called")
        self.ani=FuncAnimation(self.figure,self.update_plot,interval=200)
        self.canvas.draw()
        self.btnGetBTV1.setEnabled(True)
        self.btnGetBTV2.setEnabled(True)




    def get_current_pos(self, type):
        self.bt_data = BTClass.myBT.recvBTdata_splitted()

        if type==1:
            self.LAO1,self.CRAN1=round(int(self.bt_data[1])), round( int(self.bt_data[2]))
        if type==2:
            self.RAO2,self.CAUD2=round(int(self.bt_data[1])), round( int(self.bt_data[2]))
        print(self.LAO1,self.CRAN1,self.RAO2,self.CAUD2)

        if(self.LAO1 and self.RAO2 and self.CAUD2 and self.CRAN1):
            self.data2 = NAVICath.get_s_curve_device(self.CRAN1, self.LAO1, self.CAUD2, self.RAO2)
            self.plot_device = self.ax.plot(range(-90, 90), self.data2, label="Evolut")
            planes = [self.CRAN1, self.LAO1, self.CAUD2, self.RAO2]
            planes = ",".join(map(str, planes))

            # save values to System
            values = (DB.patientsDB.myExam, "AV/Device/Planes", planes)
            DB.patientsDB.add_value(values)

            self.LAO1,self.RAO2,self.CAUD2,self.CRAN1=None,None,None,None
            self.ax.legend(loc="upper left")
            self.canvas.draw()

        return round(int(self.bt_data[1])), round( int(self.bt_data[2]))

    def update_plot(self,i):
        self.bt_data = BTClass.myBT.recvBTdata_splitted()
        if(self.bt_data):
            self.scat_bt.remove()

            self.scat_bt_txt.remove()
            self.scat_bt_txt = self.ax.text(round(int(self.bt_data[1])), round(int(self.bt_data[2])), (str(round(int(self.bt_data[1])))+","+str(round(int(self.bt_data[2]))) ))

            self.scat_bt = self.ax.scatter(round(int(self.bt_data[1])), round(int(self.bt_data[2])), c="blue")


            print("BT Returns Valid Data")
            self.canvas.draw_idle()

        else:
            print("BT Returns invalid Data")
            self.canvas.draw_idle()

            return

    def structure_s_cruve(self):
        #check DB for values


        values = DB.patientsDB.get_value_by_ValueType(DB.patientsDB.myExam, "AV/MDCT/Planes")

        if(values):
            AV_MDCT_Planes=values[len(values) - 1]
            xCCV1, xRLV1, xCCV2, xRLV2=AV_MDCT_Planes[3].split(",")
            self.data = NAVICath.get_s_curve_device(int(xCCV1), int(xRLV1), int(xCCV2), int(xRLV2))
            self.plot_structure = self.ax.plot(range(-90, 90), self.data, label="MDCT_Planes")
            self.ax.legend(loc="upper left")
            self.canvas.draw()

        values = DB.patientsDB.get_value_by_ValueType(DB.patientsDB.myExam, "AV/MDCT/Coordinates")
        if (values):
            AV_MDCT_Cordinates=values[len(values) - 1]
            Lx,Ly,Lz,Rx,Ry,Rz,Nx,Ny,Nz=AV_MDCT_Cordinates[3].split(",")
            self.data = NAVICath.SCurve_XYZ(int(Lx),int(Ly),int(Lz),int(Rx),int(Ry),int(Rz),int(Nx),int(Ny),int(Nz))
            self.plot_structure = self.ax.plot(range(-90, 90), self.data, label="MDCT_Cord")
            self.ax.legend(loc="upper left")
            self.canvas.draw()

        values = DB.patientsDB.get_value_by_ValueType(DB.patientsDB.myExam, "AV/MDCT/Enface")
        if (values):
            AV_MDCT_Enface=values[len(values) - 1]
            y,z=AV_MDCT_Enface[3].split(",")
            self.data = NAVICath.make_s_curve_array(int(y), int(z))
            self.plot_structure = self.ax.plot(range(-90, 90), self.data, label="MDCT_Enface")
            self.ax.legend(loc="upper left")
            self.canvas.draw()








        return

    def device_s_cruve_manual(self):
        #self.plot_structure.pop(0).remove()
        xRLV1 = int(self.xRLV1TextEdit.toPlainText())
        xCCV1 = int(self.xCCV1TextEdit.toPlainText())
        xRLV2 = int(self.xRLV2TextEdit.toPlainText())
        xCCV2 = int(self.xCCV2TextEdit.toPlainText())
        self.data = NAVICath.get_s_curve_device(xCCV1, xRLV1, xCCV2, xRLV2)

        planes = [xCCV1, xRLV1, xCCV2, xRLV2]
        planes = ",".join(map(str, planes))

        # save values to System
        values = (DB.patientsDB.myExam, "AV/Device/Planes", planes)
        DB.patientsDB.add_value(values)

        # self.data=NAVICath.make_s_curve_array(111,-37);
        self.plot_structure = self.ax.plot(range(-90, 90), self.data, label="Device Plane")
        self.ax.legend(loc="upper left")
        self.canvas.draw()



    def func_ft(self):
        if not BTClass.myBT.getConnectedDevice():
            #BTlist_ui = BT_list.Ui_BT_devices(BT_SCurve.BTSCurveWindow, BT_SCurve.BSC_ui)
            BTlist_ui = BT_list.Ui_BT_devices(BTDSCurveWindow, self)
            BTlist_ui.setupUi(BT_list.BTlistWindow)
            BT_list.BTlistWindow.show()
        else:
            print("already connected")
            self.runAnimation()
            self.btnGetBTV1.setEnabled(True)
            self.btnGetBTV2.setEnabled(True)
            print("BT DSCurve  Plotting Started")

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
        self.HorizontalLayout_3.addWidget(self.canvas, QtCore.Qt.AlignCenter)
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
        self.scat_bt_txt=self.ax.text(0,0,"0,0")
        self.plot_structure = self.ax.plot(0, 0)
        self.plot_device = self.ax.plot(0, 0)
        # Turn grid on for both major and minor ticks and style minor slightly
        # differently.
        self.ax.grid(which='major', color='#CCCCCC', linestyle='--')
        self.ax.grid(which='minor', color='#CCCCCC', linestyle=':')
        # plt.ylim(-90, 90)
        # plt.xlim(-90, 90)
        # #plt.ion()

        self.ax.set_xlim(-90, 90)
        self.ax.set_ylim(-90, 90)

        self.ax.axhline(y=0, color='k')
        self.ax.axvline(x=0, color='k')
        #plt.legend(loc="upper left")

        # endplot styles

        # ------------------------------copy upto here to add Canvas to above frame-2-------------------------------
        self.verticalLayout_2.addWidget(self.frame_2)
        self.frame = QtWidgets.QFrame(self.centralwidget)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.frame.sizePolicy().hasHeightForWidth())
        self.frame.setSizePolicy(sizePolicy)
        self.frame.setMaximumSize(QtCore.QSize(16777215, 200))
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
        self.horizontalLayout_6 = QtWidgets.QHBoxLayout(self.ValFrame)
        self.horizontalLayout_6.setContentsMargins(0, 0, 0, 0)
        self.horizontalLayout_6.setObjectName("horizontalLayout_6")
        self.val1Box = QtWidgets.QGroupBox(self.ValFrame)
        self.val1Box.setMinimumSize(QtCore.QSize(0, 50))
        self.val1Box.setObjectName("val1Box")
        self.verticalLayout_3 = QtWidgets.QVBoxLayout(self.val1Box)
        self.verticalLayout_3.setObjectName("verticalLayout_3")
        self.lxRLV1 = QtWidgets.QLabel(self.val1Box)
        self.lxRLV1.setObjectName("lxRLV1")
        self.verticalLayout_3.addWidget(self.lxRLV1)
        self.xRLV1TextEdit = QtWidgets.QTextEdit(self.val1Box)
        self.xRLV1TextEdit.setMaximumSize(QtCore.QSize(16777215, 50))
        self.xRLV1TextEdit.setObjectName("xRLV1TextEdit")
        self.verticalLayout_3.addWidget(self.xRLV1TextEdit)
        self.lxCCV1 = QtWidgets.QLabel(self.val1Box)
        self.lxCCV1.setObjectName("lxCCV1")
        self.verticalLayout_3.addWidget(self.lxCCV1)
        self.xCCV1TextEdit = QtWidgets.QTextEdit(self.val1Box)
        self.xCCV1TextEdit.setMaximumSize(QtCore.QSize(16777215, 50))
        self.xCCV1TextEdit.setObjectName("xCCV1TextEdit")
        self.verticalLayout_3.addWidget(self.xCCV1TextEdit)
        self.horizontalLayout_6.addWidget(self.val1Box)
        self.val2Box = QtWidgets.QGroupBox(self.ValFrame)
        self.val2Box.setMinimumSize(QtCore.QSize(0, 50))
        self.val2Box.setObjectName("val2Box")
        self.verticalLayout_5 = QtWidgets.QVBoxLayout(self.val2Box)
        self.verticalLayout_5.setObjectName("verticalLayout_5")
        self.lxRLV2 = QtWidgets.QLabel(self.val2Box)
        self.lxRLV2.setObjectName("lxRLV2")
        self.verticalLayout_5.addWidget(self.lxRLV2)
        self.xRLV2TextEdit = QtWidgets.QTextEdit(self.val2Box)
        self.xRLV2TextEdit.setMaximumSize(QtCore.QSize(16777215, 50))
        self.xRLV2TextEdit.setObjectName("xRLV2TextEdit")
        self.verticalLayout_5.addWidget(self.xRLV2TextEdit)
        self.lxRCC2 = QtWidgets.QLabel(self.val2Box)
        self.lxRCC2.setObjectName("lxRCC2")
        self.verticalLayout_5.addWidget(self.lxRCC2)
        self.xCCV2TextEdit = QtWidgets.QTextEdit(self.val2Box)
        self.xCCV2TextEdit.setMaximumSize(QtCore.QSize(16777215, 50))
        self.xCCV2TextEdit.setObjectName("xCCV2TextEdit")
        self.verticalLayout_5.addWidget(self.xCCV2TextEdit)
        self.horizontalLayout_6.addWidget(self.val2Box)
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
        self.btnAVCurve = QtWidgets.QPushButton(self.btnframe, clicked=lambda: self.structure_s_cruve())
        icon = QtGui.QIcon()
        icon.addPixmap(QtGui.QPixmap("./images/aortic-valve.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.btnAVCurve.setIcon(icon)
        self.btnAVCurve.setIconSize(QtCore.QSize(40, 40))
        self.btnAVCurve.setObjectName("btnAVCurve")

        self.verticalLayout.addWidget(self.btnAVCurve)
        self.btnMakeCatheterSC = QtWidgets.QPushButton(self.btnframe,clicked=lambda: self.device_s_cruve_manual())
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Fixed)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.btnMakeCatheterSC.sizePolicy().hasHeightForWidth())
        self.btnMakeCatheterSC.setSizePolicy(sizePolicy)
        icon1 = QtGui.QIcon()
        icon1.addPixmap(QtGui.QPixmap("./images/replacement.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.btnMakeCatheterSC.setIcon(icon1)
        self.btnMakeCatheterSC.setIconSize(QtCore.QSize(40, 40))
        self.btnMakeCatheterSC.setObjectName("btnMakeCatheterSC")
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
        self.horizontalLayout_6.addWidget(self.btnframe)
        self.horizontalLayout_7.addWidget(self.ValFrame)
        self.horizontalLayout_2.addWidget(self.ManValBox)
        self.autoBox = QtWidgets.QGroupBox(self.frame)
        self.autoBox.setObjectName("autoBox")
        self.verticalLayout_4 = QtWidgets.QVBoxLayout(self.autoBox)
        self.verticalLayout_4.setObjectName("verticalLayout_4")
        self.btnGetBTV1 = QtWidgets.QPushButton(self.autoBox, clicked=lambda: self.get_current_pos(1))
        icon2 = QtGui.QIcon()
        icon2.addPixmap(QtGui.QPixmap("./images/bt.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.btnGetBTV1.setIcon(icon2)
        self.btnGetBTV1.setObjectName("btnGetBTV1")
        self.verticalLayout_4.addWidget(self.btnGetBTV1)
        self.btnGetBTV2 = QtWidgets.QPushButton(self.autoBox, clicked=lambda: self.get_current_pos(2))
        self.btnGetBTV2.setIcon(icon2)
        self.btnGetBTV2.setObjectName("btnGetBTV2")
        self.verticalLayout_4.addWidget(self.btnGetBTV2)
        self.btnft = QtWidgets.QPushButton(self.autoBox,clicked=lambda: self.func_ft())
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
        self.btnft.setIcon(icon2)
        self.btnft.setIconSize(QtCore.QSize(40, 40))
        self.btnft.setObjectName("btnft")
        self.verticalLayout_4.addWidget(self.btnft)
        self.btnHelpAuto = QtWidgets.QPushButton(self.autoBox)
        self.btnHelpAuto.setObjectName("btnHelpAuto")
        self.verticalLayout_4.addWidget(self.btnHelpAuto)
        self.horizontalLayout_2.addWidget(self.autoBox)
        self.verticalLayout_2.addWidget(self.frame)
        MainWindow.setCentralWidget(self.centralwidget)
        self.menubar = QtWidgets.QMenuBar(MainWindow)
        self.menubar.setGeometry(QtCore.QRect(0, 0, 1329, 26))
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

        if not BTClass.myBT.getConnectedDevice():
            self.btnGetBTV1.setEnabled(False)
            self.btnGetBTV2.setEnabled(False)
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

        self.retranslateUi(MainWindow)
        QtCore.QMetaObject.connectSlotsByName(MainWindow)

    def retranslateUi(self, MainWindow):
        _translate = QtCore.QCoreApplication.translate
        MainWindow.setWindowTitle(_translate("MainWindow", "MainWindow"))
        self.ManValBox.setTitle(_translate("MainWindow", "Manual Values Catheter"))
        self.val1Box.setTitle(_translate("MainWindow", "Value 1"))
        self.lxRLV1.setText(_translate("MainWindow", "LAO/RAO"))
        self.lxCCV1.setText(_translate("MainWindow", "CRAN/CAUD"))
        self.val2Box.setTitle(_translate("MainWindow", "Value 2"))
        self.lxRLV2.setText(_translate("MainWindow", "LAO/RAO"))
        self.lxRCC2.setText(_translate("MainWindow", "CRAN/CAUD"))
        self.btnAVCurve.setText(_translate("MainWindow", "Get AV S Curve"))
        self.btnMakeCatheterSC.setText(_translate("MainWindow", "Make S-Curve Catheter"))
        self.btnHelpMan.setText(_translate("MainWindow", "Help"))
        self.autoBox.setTitle(_translate("MainWindow", "Automatic Values Catheter"))
        self.btnGetBTV1.setText(_translate("MainWindow", "Get BT Value 1"))
        self.btnGetBTV2.setText(_translate("MainWindow", "Get BT Value 2"))
        self.btnft.setText(_translate("MainWindow", "FluoroTracker"))
        self.btnHelpAuto.setText(_translate("MainWindow", "Help"))
        self.menuFIle.setTitle(_translate("MainWindow", "File"))
        self.menuHelp.setTitle(_translate("MainWindow", "Help"))


import sys
app = QtWidgets.QApplication(sys.argv)
BTDSCurveWindow = MyWindow()
BTDSC_ui = Ui_BTDSCurve()
BTDSC_ui.setupUi(BTDSCurveWindow)

