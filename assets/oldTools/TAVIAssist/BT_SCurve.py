from PyQt5 import QtCore, QtGui, QtWidgets
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
from matplotlib.backends.backend_qt5agg import FigureCanvasQTAgg as FigureCanvas
from matplotlib.figure import Figure
from matplotlib.ticker import MultipleLocator, AutoMinorLocator
import NAVICath
import BTClass

class MyWindow(QtWidgets.QMainWindow):
    def closeEvent(self,event):
        if (BSC_ui.ani):
            BSC_ui.ani.event_source.stop()
            print("BT SCurve Plotting Stopped")

    def showEvent(self, event):
        if(BTClass.myBT.getConnectedDevice() and BSC_ui.ani):
            BSC_ui.ani.event_source.start()
            print("BT SCurve  Plotting Started")

class Ui_BTSCurveWindow(object):


    def __init__(self):
        self.bt_data=[0,0,0]
        self.ani=None
    def goBack(self):
        BTSCurveWindow.close()

    def runAnimation(self):
        self.ani=FuncAnimation(self.figure,self.update_plot,interval=200)

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
            self.canvas.draw_idle()
            print("BT Returns invalid Data")
            return



    def structure_s_cruve(self):
        self.plot_structure.pop(0).remove()
        self.data=NAVICath.make_s_curve_array(-30,25);
        self.plot_structure= self.ax.plot(range(-90, 90), self.data, label="Structure",color="red")
        self.ax.legend(loc="upper left")
        self.canvas.draw()

    def device_s_cruve(self):
        self.plot_device.pop(0).remove()
        self.data2 = NAVICath.make_s_curve_array(30, 25);
        self.plot_device=self.ax.plot(range(-90, 90), self.data2, label="Device",color="blue")
        self.ax.legend(loc="upper left")
        self.canvas.draw()

    def setupUi(self, BTSCurveWindow):
        BTSCurveWindow.setObjectName("BTSCurveWindow")
        BTSCurveWindow.resize(1329, 714)
        BTSCurveWindow.setStyleSheet("background-color: rgb(66, 66, 66);")
        self.centralwidget = QtWidgets.QWidget(BTSCurveWindow)
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
        self.label.setText("")
        self.label.setPixmap(QtGui.QPixmap("./images/bt-title.png"))
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
        #------------------------------copy from here to add Canvas to above frame-2-------------------------------
        #create horizontal layout
        self.HorizontalLayout_3=QtWidgets.QHBoxLayout(self.frame_2)
        self.HorizontalLayout_3.setObjectName("HorizontalLayout_3")

        # #Canvas Add here
        # self.figure, self.ax = plt.subplots(constrained_layout=True)
        # self.canvas=FigureCanvas(self.figure)
        # #end of canvas

        # Canvas Add here
        self.figure = Figure()
        self.ax = self.figure.subplots()
        self.canvas = FigureCanvas(self.figure)
        # end of canvas

        #add canvas to layout
        self.HorizontalLayout_3.addWidget(self.canvas,QtCore.Qt.AlignCenter)
        #end canvas

        #plot styles
        self.ax.set_aspect('equal')
        self.ax.xaxis.set_major_locator(MultipleLocator(20))
        self.ax.yaxis.set_major_locator(MultipleLocator(20))

        # Change minor ticks to show every 5. (20/4 = 5)
        self.ax.xaxis.set_minor_locator(AutoMinorLocator(4))
        self.ax.yaxis.set_minor_locator(AutoMinorLocator(4))

        # Turn grid on for both major and minor ticks and style minor slightly
        # differently.
        self.ax.grid(which='major', color='#CCCCCC', linestyle='--')
        self.ax.grid(which='minor', color='#CCCCCC', linestyle=':')
        # plt.ylim(-90, 90)
        # plt.xlim(-90, 90)
        self.ax.set_xlim(-90, 90)
        self.ax.set_ylim(-90, 90)



        self.ax.axhline(y=0, color='k')
        self.ax.axvline(x=0, color='k')
        #endplot styles

        # get empty plots
        self.scat_bt = self.ax.scatter(0, 0, c="blue")
        self.scat_bt_txt=self.ax.text(0,0,"0,0")


        self.plot_structure = self.ax.plot(0, 0)
        self.plot_device = self.ax.plot(0, 0)
        self.verticalLayout_2.addWidget(self.frame_2)
        # ------------------------------copy upto here to add Canvas to above frame-2-------------------------------

        self.frame = QtWidgets.QFrame(self.centralwidget)
        self.frame.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.frame.setFrameShadow(QtWidgets.QFrame.Raised)
        self.frame.setObjectName("frame")
        self.horizontalLayout_2 = QtWidgets.QHBoxLayout(self.frame)
        self.horizontalLayout_2.setObjectName("horizontalLayout_2")
        self.btnStructure = QtWidgets.QPushButton(self.frame, clicked=lambda: self.structure_s_cruve())

        self.btnStructure.setObjectName("btnStructure")
        self.horizontalLayout_2.addWidget(self.btnStructure)
        self.btnDevice = QtWidgets.QPushButton(self.frame, clicked=lambda: self.device_s_cruve())
        self.btnDevice.setObjectName("btnDevice")
        self.horizontalLayout_2.addWidget(self.btnDevice)
        self.verticalLayout_2.addWidget(self.frame)



        BTSCurveWindow.setCentralWidget(self.centralwidget)
        self.menubar = QtWidgets.QMenuBar(BTSCurveWindow)
        self.menubar.setGeometry(QtCore.QRect(0, 0, 1329, 26))
        self.menubar.setObjectName("menubar")
        self.menuFIle = QtWidgets.QMenu(self.menubar)
        self.menuFIle.setObjectName("menuFIle")
        self.menuHelp = QtWidgets.QMenu(self.menubar)
        self.menuHelp.setObjectName("menuHelp")
        BTSCurveWindow.setMenuBar(self.menubar)
        self.statusbar = QtWidgets.QStatusBar(BTSCurveWindow)
        self.statusbar.setObjectName("statusbar")
        BTSCurveWindow.setStatusBar(self.statusbar)
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

        self.retranslateUi(BTSCurveWindow)
        QtCore.QMetaObject.connectSlotsByName(BTSCurveWindow)



    def retranslateUi(self, BTSCurveWindow):
        _translate = QtCore.QCoreApplication.translate
        BTSCurveWindow.setWindowTitle(_translate("BTSCurveWindow", "S Curve Generator"))
        self.btnStructure.setText(_translate("BTSCurveWindow", "S-Curve Structure"))
        self.btnDevice.setText(_translate("BTSCurveWindow", "S-Curve Device"))
        self.menuFIle.setTitle(_translate("BTSCurveWindow", "File"))
        self.menuHelp.setTitle(_translate("BTSCurveWindow", "Help"))



import sys
app = QtWidgets.QApplication(sys.argv)
BTSCurveWindow = MyWindow()
BSC_ui = Ui_BTSCurveWindow()
BSC_ui.setupUi(BTSCurveWindow)



