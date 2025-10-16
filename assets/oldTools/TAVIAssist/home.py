from PyQt5 import QtCore, QtGui, QtWidgets

import BTClass
import BT_list
import TAVIAssist
import DB
import BT_SCurve


class Ui_Home(object):

    def goBack(self):
        return

    def setupUi(self, MainWindow):
        MainWindow.setObjectName("MainWindow")
        MainWindow.resize(1329, 714)
        MainWindow.setWindowTitle("NaviCath Homepage")
        MainWindow.setStyleSheet("background-color: rgb(66, 66, 66);")
        self.centralwidget = QtWidgets.QWidget(MainWindow)
        self.centralwidget.setObjectName("centralwidget")
        self.gridLayout = QtWidgets.QGridLayout(self.centralwidget)
        self.gridLayout.setSizeConstraint(QtWidgets.QLayout.SetNoConstraint)
        self.gridLayout.setObjectName("gridLayout")
        spacerItem = QtWidgets.QSpacerItem(40, 20, QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Minimum)
        self.gridLayout.addItem(spacerItem, 2, 0, 1, 1)
        spacerItem1 = QtWidgets.QSpacerItem(40, 20, QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Minimum)
        self.gridLayout.addItem(spacerItem1, 2, 2, 1, 1)
        self.gridWidget = QtWidgets.QWidget(self.centralwidget)
        self.gridWidget.setObjectName("gridWidget")
        self.AppGrid = QtWidgets.QGridLayout(self.gridWidget)
        self.AppGrid.setSizeConstraint(QtWidgets.QLayout.SetFixedSize)
        self.AppGrid.setContentsMargins(7, 7, 7, 7)
        self.AppGrid.setSpacing(7)
        self.AppGrid.setObjectName("AppGrid")
        self.AV = QtWidgets.QLabel(self.gridWidget)
        self.AV.setMinimumSize(QtCore.QSize(300, 300))
        self.AV.setMaximumSize(QtCore.QSize(300, 300))
        self.AV.setStyleSheet("border: 5px solid;\n"
                              "border-radius:20;\n"
                              "border-color:rgb(108, 108, 108);\n"
                              "image:url(./images/aortic-valve.png);\n"
                              "\n"
                              "\n"
                              "")
        self.AV.setText("")
        self.AV.setObjectName("AV")
        self.AV.mousePressEvent = TAVI_Clicked

        self.AppGrid.addWidget(self.AV, 0, 0, 1, 1)
        self.BT = QtWidgets.QLabel(self.gridWidget)
        self.BT.setMinimumSize(QtCore.QSize(300, 300))
        self.BT.setMaximumSize(QtCore.QSize(300, 300))
        self.BT.setStyleSheet("border: 5px solid;\n"
                              "\n"
                              "border-radius:20;\n"
                              "border-color:rgb(108, 108, 108);\n"
                              "image: url(./images/bt.png);")
        self.BT.setText("")
        self.BT.setObjectName("BT")
        self.BT.mousePressEvent = lambda x: self.openBT()

        self.AppGrid.addWidget(self.BT, 0, 4, 1, 1)
        spacerItem2 = QtWidgets.QSpacerItem(40, 20, QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Minimum)
        self.AppGrid.addItem(spacerItem2, 0, 3, 1, 1)
        spacerItem3 = QtWidgets.QSpacerItem(40, 20, QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Minimum)
        self.AppGrid.addItem(spacerItem3, 0, 1, 1, 1)

        self.MV = QtWidgets.QLabel(self.gridWidget)
        self.MV.setMinimumSize(QtCore.QSize(300, 300))
        self.MV.setMaximumSize(QtCore.QSize(300, 300))
        self.MV.setStyleSheet("border: 5px solid;\n"
                              "border-radius:20;\n"
                              "border-color:rgb(108, 108, 108);\n"
                              "\n"
                              "image: url(./images/MV.png);")
        self.MV.setText("")
        self.MV.setObjectName("MV")

        self.MV.mousePressEvent = MV_Clicked
        self.AppGrid.addWidget(self.MV, 0, 2, 1, 1)
        self.gridLayout.addWidget(self.gridWidget, 2, 1, 1, 1)
        self.label = QtWidgets.QLabel(self.centralwidget)
        self.label.setMaximumSize(QtCore.QSize(1000, 200))
        font = QtGui.QFont()
        font.setFamily("Nirmala UI")
        font.setPointSize(36)
        self.label.setFont(font)
        self.label.setLayoutDirection(QtCore.Qt.LeftToRight)
        self.label.setStyleSheet("color:rgb(149, 149, 149)")
        self.label.setText("")
        self.label.setPixmap(QtGui.QPixmap("./images/Apps.png"))
        self.label.setAlignment(QtCore.Qt.AlignCenter)
        self.label.setObjectName("label")
        self.gridLayout.addWidget(self.label, 0, 1, 1, 1)
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
        print(DB.patientsDB.myPatient, DB.patientsDB.myExam)

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
        self.statusbar.addWidget(self.btnBack)
        self.btnBack.setText("Go Back")

        self.retranslateUi(MainWindow)
        QtCore.QMetaObject.connectSlotsByName(MainWindow)

    def retranslateUi(self, MainWindow):
        _translate = QtCore.QCoreApplication.translate
        MainWindow.setWindowTitle(_translate("MainWindow", "NaviCath™ Home"))
        self.menuFIle.setTitle(_translate("MainWindow", "File"))
        self.menuHelp.setTitle(_translate("MainWindow", "Help"))

    def openBT(self):
        if not BTClass.myBT.getConnectedDevice():
            # START GENERAL TRACKER
            BTlist_ui = BT_list.Ui_BT_devices(BT_SCurve.BTSCurveWindow, BT_SCurve.BSC_ui)

            # START Double S Cruve (for test only)
            #  BTlist_ui = BT_list.Ui_BT_devices(BT_3DSDSCurve.ThreeDSDSCurveWindow, BT_3DSDSCurve.ThreeDSDSC_ui)
            BTlist_ui.setupUi(BT_list.BTlistWindow)
            BT_list.BTlistWindow.show()


        else:
            print("already connected")
            BT_SCurve.BTSCurveWindow.show()


def TAVI_Clicked(event):
    TAVIAssist.TAVIAssist_Win.show()


def MV_Clicked(event):
    print("MV Clicked")


def BT_Clicked(event):
    print("BT Clicked")

# import sys
# app = QtWidgets.QApplication(sys.argv)
# MainWindow = QtWidgets.QMainWindow()
# ui = Ui_Home()
# ui.setupUi(MainWindow)
# MainWindow.show()
# sys.exit(app.exec_())
