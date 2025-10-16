
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
        if (BT_AV_Fluoro_SCurve_ui.ani):
            BT_AV_Fluoro_SCurve_ui.ani.event_source.stop()
            print("BT DSCurve Plotting Stopped")
        print("DSCurve Show Event")

    def showEvent(self, event):
        if(BTClass.myBT.getConnectedDevice() and BT_AV_Fluoro_SCurve_ui.ani):
            BT_AV_Fluoro_SCurve_ui.ani.event_source.start()
            BT_AV_Fluoro_SCurve_ui.btnGetBTV1.setEnabled(True)
            BT_AV_Fluoro_SCurve_ui.btnGetBTV2.setEnabled(True)
            print("BT DSCurve  Plotting Started")
        print("DSCurve Close Event")

class Ui_MainWindow(object):

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
        MainWindow.close()


    def runAnimation(self):
        print("BT_AVCURVE runAnimation called")
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
            planes = [self.CRAN1, self.LAO1, self.CAUD2, self.RAO2]
            planes = ",".join(map(str, planes))

            # save values to System
            values = (DB.patientsDB.myExam, "AV/Fluoro/Planes", planes)
            DB.patientsDB.add_value(values)

            self.plot_device = self.ax.plot(range(-90, 90), self.data2, label="Evolut", color="blue")
            self.ax.legend(loc="upper left")

            self.LAO1,self.RAO2,self.CAUD2,self.CRAN1=None,None,None,None
            self.canvas.draw()

        return round(int(self.bt_data[1])), round( int(self.bt_data[2]))

    def update_plot(self,i):
        self.bt_data = BTClass.myBT.recvBTdata_splitted()
        if(self.bt_data):
            self.scat_bt.remove()
            self.scat_bt_txt.remove()
            self.scat_bt = self.ax.scatter(round(int(self.bt_data[1])), round( int(self.bt_data[2])), c="blue")
            self.scat_bt_txt = self.ax.text(round(int(self.bt_data[1])), round(int(self.bt_data[2])),
                                            (str(round(int(self.bt_data[1]))) + "," + str(round(int(self.bt_data[2])))))
            print("BT Returns Valid Data")
            self.canvas.draw_idle()

        else:
            print("BT Returns invalid Data")
            self.canvas.draw_idle()

            return

 

    def av_s_cruve_manual(self):
        self.plot_structure.pop(0).remove()
        xRLV1 = int(self.xRLV1TextEdit.toPlainText())
        xCCV1 = int(self.xCCV1TextEdit.toPlainText())
        xRLV2 = int(self.xRLV2TextEdit.toPlainText())
        xCCV2 = int(self.xCCV2TextEdit.toPlainText())
        self.data = NAVICath.get_s_curve_device(xCCV1, xRLV1, xCCV2, xRLV2)

        planes = [xCCV1, xRLV1, xCCV2, xRLV2]
        planes = ",".join(map(str, planes))

        # save values to System
        values = (DB.patientsDB.myExam, "AV/Fluoro/Planes", planes)
        DB.patientsDB.add_value(values)

        # self.data=NAVICath.make_s_curve_array(111,-37);
        self.plot_structure = self.ax.plot(range(-90, 90), self.data, label="AV Plane", color="red")
        self.ax.legend(loc="upper left")
        self.canvas.draw()




    def func_ft(self):
        if not BTClass.myBT.getConnectedDevice():
            #BTlist_ui = BT_list.Ui_BT_devices(BT_SCurve.BTSCurveWindow, BT_SCurve.BSC_ui)
            BTlist_ui = BT_list.Ui_BT_devices(MainWindow, self)
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
        MainWindow.resize(1247, 817)
        MainWindow.setStyleSheet("background-color: rgb(66, 66, 66);")
        self.centralwidget = QtWidgets.QWidget(MainWindow)
        self.centralwidget.setObjectName("centralwidget")
        self.verticalLayout_2 = QtWidgets.QVBoxLayout(self.centralwidget)
        self.verticalLayout_2.setSizeConstraint(QtWidgets.QLayout.SetNoConstraint)
        self.verticalLayout_2.setObjectName("verticalLayout_2")
        self.titleFrame = QtWidgets.QFrame(self.centralwidget)
        self.titleFrame.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.titleFrame.setFrameShadow(QtWidgets.QFrame.Raised)
        self.titleFrame.setObjectName("titleFrame")
        self.horizontalLayout = QtWidgets.QHBoxLayout(self.titleFrame)
        self.horizontalLayout.setObjectName("horizontalLayout")
        self.label = QtWidgets.QLabel(self.titleFrame)
        self.label.setMinimumSize(QtCore.QSize(200, 100))
        self.label.setMaximumSize(QtCore.QSize(800, 200))
        self.label.setStyleSheet("image: url(./images/S-Curve-Fluoro.png);")
        self.label.setText("")
        self.label.setAlignment(QtCore.Qt.AlignCenter)
        self.label.setObjectName("label")
        self.horizontalLayout.addWidget(self.label)
        self.verticalLayout_2.addWidget(self.titleFrame, 0, QtCore.Qt.AlignTop)
        self.GraphFrame = QtWidgets.QFrame(self.centralwidget)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Expanding)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.GraphFrame.sizePolicy().hasHeightForWidth())
        self.GraphFrame.setSizePolicy(sizePolicy)
        self.GraphFrame.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.GraphFrame.setFrameShadow(QtWidgets.QFrame.Raised)
        self.GraphFrame.setObjectName("GraphFrame")

        # ------------------------------copy from here to add Canvas to above frame-2-------------------------------
        # create horizontal layout
        self.HorizontalLayout_middle = QtWidgets.QHBoxLayout(self.GraphFrame)
        self.HorizontalLayout_middle.setObjectName("HorizontalLayout_3")

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
        self.HorizontalLayout_middle.addWidget(self.canvas, QtCore.Qt.AlignCenter)
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
        self.scat_bt_txt = self.ax.text(0,0,"0,0")
        self.plot_structure = self.ax.plot(0, 0)
        self.plot_device = self.ax.plot(0, 0)
        # Turn grid on for both major and minor ticks and style minor slightly
        # differently.
        self.ax.grid(which='major', color='#CCCCCC', linestyle='--')
        self.ax.grid(which='minor', color='#CCCCCC', linestyle=':')
        # plt.ylim(-90, 90)
        # plt.xlim(-90, 90)
        self.ax.set_xlim(-90, 90)
        self.ax.set_ylim(-90, 90)
        # plt.ion()

        self.ax.axhline(y=0, color='k')
        self.ax.axvline(x=0, color='k')
        # endplot styles

        # ------------------------------copy upto here to add Canvas to above frame-2-------------------------------

        self.verticalLayout_2.addWidget(self.GraphFrame)
        self.ButtonsFrame = QtWidgets.QFrame(self.centralwidget)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.ButtonsFrame.sizePolicy().hasHeightForWidth())
        self.ButtonsFrame.setSizePolicy(sizePolicy)
        self.ButtonsFrame.setMaximumSize(QtCore.QSize(16777215, 300))
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
        self.ButtonsFrame.setPalette(palette)
        self.ButtonsFrame.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.ButtonsFrame.setFrameShadow(QtWidgets.QFrame.Raised)
        self.ButtonsFrame.setObjectName("ButtonsFrame")
        self.horizontalLayout_2 = QtWidgets.QHBoxLayout(self.ButtonsFrame)
        self.horizontalLayout_2.setObjectName("horizontalLayout_2")
        self.groupBox_4 = QtWidgets.QGroupBox(self.ButtonsFrame)
        self.groupBox_4.setMinimumSize(QtCore.QSize(0, 0))
        self.groupBox_4.setObjectName("groupBox_4")
        self.verticalLayout_3 = QtWidgets.QVBoxLayout(self.groupBox_4)
        self.verticalLayout_3.setObjectName("verticalLayout_3")
        self.label_2 = QtWidgets.QLabel(self.groupBox_4)
        self.label_2.setObjectName("label_2")
        self.verticalLayout_3.addWidget(self.label_2)
        self.xRLV1TextEdit = QtWidgets.QTextEdit(self.groupBox_4)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.xRLV1TextEdit.sizePolicy().hasHeightForWidth())
        self.xRLV1TextEdit.setSizePolicy(sizePolicy)
        self.xRLV1TextEdit.setObjectName("xRLV1TextEdit")
        self.verticalLayout_3.addWidget(self.xRLV1TextEdit)
        self.xCCV1TextEdit = QtWidgets.QPlainTextEdit(self.groupBox_4)
        self.xCCV1TextEdit.setObjectName("xCCV1TextEdit")
        self.verticalLayout_3.addWidget(self.xCCV1TextEdit)
        self.label_3 = QtWidgets.QLabel(self.groupBox_4)
        self.label_3.setObjectName("label_3")
        self.verticalLayout_3.addWidget(self.label_3)
        self.xRLV2TextEdit = QtWidgets.QTextEdit(self.groupBox_4)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.xRLV2TextEdit.sizePolicy().hasHeightForWidth())
        self.xRLV2TextEdit.setSizePolicy(sizePolicy)
        self.xRLV2TextEdit.setObjectName("xRLV2TextEdit")
        self.verticalLayout_3.addWidget(self.xRLV2TextEdit)
        self.xCCV2TextEdit = QtWidgets.QPlainTextEdit(self.groupBox_4)
        self.xCCV2TextEdit.setObjectName("xCCV2TextEdit")
        self.verticalLayout_3.addWidget(self.xCCV2TextEdit)
        self.btnmframe = QtWidgets.QFrame(self.groupBox_4)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.btnmframe.sizePolicy().hasHeightForWidth())
        self.btnmframe.setSizePolicy(sizePolicy)
        self.btnmframe.setMinimumSize(QtCore.QSize(0, 60))
        self.btnmframe.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.btnmframe.setFrameShadow(QtWidgets.QFrame.Raised)
        self.btnmframe.setObjectName("btnmframe")
        self.horizontalLayout_3 = QtWidgets.QHBoxLayout(self.btnmframe)
        self.horizontalLayout_3.setObjectName("horizontalLayout_3")
        self.btncal = QtWidgets.QPushButton(self.btnmframe)
        self.btncal.clicked.connect(self.av_s_cruve_manual)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.btncal.sizePolicy().hasHeightForWidth())
        self.btncal.setSizePolicy(sizePolicy)
        icon = QtGui.QIcon()
        icon.addPixmap(QtGui.QPixmap("./images/aortic-valve.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.btncal.setIcon(icon)
        self.btncal.setIconSize(QtCore.QSize(40, 40))
        self.btncal.setObjectName("btncal")
        self.horizontalLayout_3.addWidget(self.btncal)
        self.btnMHelp = QtWidgets.QPushButton(self.btnmframe)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Preferred)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.btnMHelp.sizePolicy().hasHeightForWidth())
        self.btnMHelp.setSizePolicy(sizePolicy)
        self.btnMHelp.setObjectName("btnMHelp")
        self.horizontalLayout_3.addWidget(self.btnMHelp)
        self.verticalLayout_3.addWidget(self.btnmframe)
        self.horizontalLayout_2.addWidget(self.groupBox_4)
        self.groupBox_5 = QtWidgets.QGroupBox(self.ButtonsFrame)
        self.groupBox_5.setAlignment(QtCore.Qt.AlignBottom|QtCore.Qt.AlignLeading|QtCore.Qt.AlignLeft)
        self.groupBox_5.setFlat(False)
        self.groupBox_5.setObjectName("groupBox_5")
        self.verticalLayout_4 = QtWidgets.QVBoxLayout(self.groupBox_5)
        self.verticalLayout_4.setObjectName("verticalLayout_4")
        self.btnGetBTV1 = QtWidgets.QPushButton(self.groupBox_5,clicked=lambda: self.get_current_pos(1))
        icon1 = QtGui.QIcon()
        icon1.addPixmap(QtGui.QPixmap("./images/bt.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.btnGetBTV1.setIcon(icon1)
        self.btnGetBTV1.setObjectName("btnGetBTV1")
        self.verticalLayout_4.addWidget(self.btnGetBTV1)
        self.btnGetBTV2 = QtWidgets.QPushButton(self.groupBox_5,clicked=lambda: self.get_current_pos(2))
        self.btnGetBTV2.setIcon(icon1)
        self.btnGetBTV2.setObjectName("btnGetBTV2")
        self.btnGetBTV1.setEnabled(False)
        self.btnGetBTV2.setEnabled(False)
        self.verticalLayout_4.addWidget(self.btnGetBTV2)
        self.frame_4 = QtWidgets.QFrame(self.groupBox_5)
        self.frame_4.setLayoutDirection(QtCore.Qt.LeftToRight)
        self.frame_4.setFrameShape(QtWidgets.QFrame.NoFrame)
        self.frame_4.setObjectName("frame_4")
        self.horizontalLayout_4 = QtWidgets.QHBoxLayout(self.frame_4)
        self.horizontalLayout_4.setSizeConstraint(QtWidgets.QLayout.SetDefaultConstraint)
        self.horizontalLayout_4.setContentsMargins(0, 0, 0, 0)
        self.horizontalLayout_4.setObjectName("horizontalLayout_4")
        self.ft = QtWidgets.QPushButton(self.frame_4, clicked=lambda: self.func_ft())
        self.ft.setIcon(icon1)
        self.ft.setIconSize(QtCore.QSize(19, 20))
        self.ft.setObjectName("ft")
        self.horizontalLayout_4.addWidget(self.ft)
        self.btnAHelp = QtWidgets.QPushButton(self.frame_4)
        self.btnAHelp.setObjectName("btnAHelp")
        self.horizontalLayout_4.addWidget(self.btnAHelp)
        self.verticalLayout_4.addWidget(self.frame_4)
        self.horizontalLayout_2.addWidget(self.groupBox_5)
        self.verticalLayout_2.addWidget(self.ButtonsFrame)
        MainWindow.setCentralWidget(self.centralwidget)
        self.menubar = QtWidgets.QMenuBar(MainWindow)
        self.menubar.setGeometry(QtCore.QRect(0, 0, 1247, 26))
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
        self.groupBox_4.setTitle(_translate("MainWindow", "Manual Values"))
        self.label_2.setText(_translate("MainWindow", "First Value in Plane"))
        self.xRLV1TextEdit.setPlaceholderText(_translate("MainWindow", "LAO in Postive, RAO in Negative"))
        self.xCCV1TextEdit.setPlaceholderText(_translate("MainWindow", "CRAN in positive, CAUD in Negative"))
        self.label_3.setText(_translate("MainWindow", "Second Value in Plane"))
        self.xRLV2TextEdit.setPlaceholderText(_translate("MainWindow", "LAO in Postive, RAO in Negative"))
        self.xCCV2TextEdit.setPlaceholderText(_translate("MainWindow", "CRAN in positive, CAUD in Negative"))
        self.btncal.setText(_translate("MainWindow", "Get S-Curve Valve"))
        self.btnMHelp.setText(_translate("MainWindow", "Help"))
        self.groupBox_5.setTitle(_translate("MainWindow", "Automatic Values"))
        self.btnGetBTV1.setText(_translate("MainWindow", "Get BT Value 1"))
        self.btnGetBTV2.setText(_translate("MainWindow", "Get BT Value 2"))
        self.ft.setText(_translate("MainWindow", "Connect FluoroTracker"))
        self.btnAHelp.setText(_translate("MainWindow", "Help"))
        self.menuFIle.setTitle(_translate("MainWindow", "File"))
        self.menuHelp.setTitle(_translate("MainWindow", "Help"))


MainWindow = QtWidgets.QMainWindow()
BT_AV_Fluoro_SCurve_ui = Ui_MainWindow()
BT_AV_Fluoro_SCurve_ui.setupUi(MainWindow)
