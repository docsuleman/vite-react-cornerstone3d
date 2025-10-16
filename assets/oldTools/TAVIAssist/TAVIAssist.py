from PyQt5 import QtCore, QtGui, QtWidgets
import BTClass, BT_list, BT_SCurve, BT_3DAorta_Tracker, BT_DSCurve, BT_AV_Fluoro_SCurve, BT_Device_SCurve, SCurve_MDCT, TAVIViews, BT_Basilica_Assist


class MyWindow(QtWidgets.QMainWindow):
    def closeEvent(self, event):
        print("TAVIAssist Stopped")

    def showEvent(self, event):
        print("TAVI Assist Opened")


class Ui_TAVIAssist(object):

    def goBack(self):
        TAVIAssist_Win.close()

    def setupUi(self, TAVIAssist):
        TAVIAssist.setObjectName("TAVIAssist")
        TAVIAssist.resize(1328, 963)
        icon = QtGui.QIcon()
        icon.addPixmap(QtGui.QPixmap("images/aortic-valve.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        TAVIAssist.setWindowIcon(icon)
        TAVIAssist.setStyleSheet("background-color: rgb(66, 66, 66);")
        self.centralwidget = QtWidgets.QWidget(TAVIAssist)
        self.centralwidget.setObjectName("centralwidget")
        self.verticalLayout = QtWidgets.QVBoxLayout(self.centralwidget)
        self.verticalLayout.setObjectName("verticalLayout")
        self.TopLabel = QtWidgets.QHBoxLayout()
        self.TopLabel.setObjectName("TopLabel")
        spacerItem = QtWidgets.QSpacerItem(40, 20, QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Minimum)
        self.TopLabel.addItem(spacerItem)
        self.label = QtWidgets.QLabel(self.centralwidget)
        self.label.setMaximumSize(QtCore.QSize(1000, 200))
        font = QtGui.QFont()
        font.setFamily("Nirmala UI")
        font.setPointSize(36)
        self.label.setFont(font)
        self.label.setLayoutDirection(QtCore.Qt.LeftToRight)
        self.label.setStyleSheet("color:rgb(149, 149, 149)")
        self.label.setText("")
        self.label.setPixmap(QtGui.QPixmap("images/TAVIAssist-title.png"))
        self.label.setAlignment(QtCore.Qt.AlignCenter)
        self.label.setObjectName("label")
        self.TopLabel.addWidget(self.label)
        spacerItem1 = QtWidgets.QSpacerItem(40, 20, QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Minimum)
        self.TopLabel.addItem(spacerItem1)
        self.verticalLayout.addLayout(self.TopLabel)
        self.TopGrid = QtWidgets.QWidget(self.centralwidget)
        self.TopGrid.setObjectName("TopGrid")
        self.horizontalLayout = QtWidgets.QHBoxLayout(self.TopGrid)
        self.horizontalLayout.setContentsMargins(0, 0, 0, 0)
        self.horizontalLayout.setObjectName("horizontalLayout")
        spacerItem2 = QtWidgets.QSpacerItem(40, 20, QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Minimum)
        self.horizontalLayout.addItem(spacerItem2)
        self.BT_SC_Double = QtWidgets.QLabel(self.TopGrid)
        self.BT_SC_Double.setMinimumSize(QtCore.QSize(300, 300))
        self.BT_SC_Double.setMaximumSize(QtCore.QSize(300, 300))
        self.BT_SC_Double.setStyleSheet("border: 5px solid;\n"
                                        "border-radius:20;\n"
                                        "border-color:rgb(108, 108, 108);\n"
                                        "image: url(./images/dscurve.png)\n"
                                        "\n"
                                        "\n"
                                        "")
        self.BT_SC_Double.setText("")
        self.BT_SC_Double.setObjectName("BT_SC_Double")
        self.BT_SC_Double.mousePressEvent = lambda x: self.open_DSCurve()
        self.horizontalLayout.addWidget(self.BT_SC_Double)
        spacerItem3 = QtWidgets.QSpacerItem(40, 20, QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Minimum)
        self.horizontalLayout.addItem(spacerItem3)
        self.SC_MDCT = QtWidgets.QLabel(self.TopGrid)
        self.SC_MDCT.setMinimumSize(QtCore.QSize(300, 300))
        self.SC_MDCT.setMaximumSize(QtCore.QSize(300, 300))
        self.SC_MDCT.setStyleSheet("border: 5px solid;\n"
                                   "border-radius:20;\n"
                                   "border-color:rgb(108, 108, 108);\n"
                                   "\n"
                                   "image: url(./images/tavi-scurve-mdct.png);")
        self.SC_MDCT.setText("")
        self.SC_MDCT.setObjectName("SC_MDCT")
        self.SC_MDCT.mousePressEvent = lambda x: self.open_SCurve_MDCT()
        self.horizontalLayout.addWidget(self.SC_MDCT)
        spacerItem4 = QtWidgets.QSpacerItem(40, 20, QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Minimum)
        self.horizontalLayout.addItem(spacerItem4)
        self.SC_FLUORO = QtWidgets.QLabel(self.TopGrid)
        self.SC_FLUORO.setMinimumSize(QtCore.QSize(300, 300))
        self.SC_FLUORO.setMaximumSize(QtCore.QSize(300, 300))
        self.SC_FLUORO.setStyleSheet("border: 5px solid;\n"
                                     "\n"
                                     "border-radius:20;\n"
                                     "border-color:rgb(108, 108, 108);\n"
                                     "image: url(./images/tavi-scurve-fluoro.png);")
        self.SC_FLUORO.setText("")
        self.SC_FLUORO.setObjectName("SC_FLUORO")
        self.SC_FLUORO.mousePressEvent = lambda x: self.open_SCurve_Fluoro()

        self.horizontalLayout.addWidget(self.SC_FLUORO)
        spacerItem5 = QtWidgets.QSpacerItem(40, 20, QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Minimum)
        self.horizontalLayout.addItem(spacerItem5)
        self.SC_DEVICE = QtWidgets.QLabel(self.TopGrid)
        self.SC_DEVICE.setMinimumSize(QtCore.QSize(300, 300))
        self.SC_DEVICE.setMaximumSize(QtCore.QSize(300, 300))
        self.SC_DEVICE.setStyleSheet("border: 5px solid;\n"
                                     "\n"
                                     "border-radius:20;\n"
                                     "border-color:rgb(108, 108, 108);\n"
                                     "image: url(./images/device-scurve-fluoro.png);")
        self.SC_DEVICE.setText("")
        self.SC_DEVICE.setObjectName("SC_DEVICE")
        self.SC_DEVICE.mousePressEvent = lambda x: self.open_SCurve_Device()

        self.horizontalLayout.addWidget(self.SC_DEVICE)
        self.verticalLayout.addWidget(self.TopGrid)
        spacerItem6 = QtWidgets.QSpacerItem(40, 20, QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Minimum)
        self.verticalLayout.addItem(spacerItem6)
        self.BottomGrid = QtWidgets.QWidget(self.centralwidget)
        self.BottomGrid.setObjectName("BottomGrid")
        self.horizontalLayout_2 = QtWidgets.QHBoxLayout(self.BottomGrid)
        self.horizontalLayout_2.setContentsMargins(0, 0, 0, 0)
        self.horizontalLayout_2.setObjectName("horizontalLayout_2")
        spacerItem7 = QtWidgets.QSpacerItem(40, 20, QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Minimum)
        self.horizontalLayout_2.addItem(spacerItem7)
        self.BasilicaAssist = QtWidgets.QLabel(self.BottomGrid)
        self.BasilicaAssist.setMinimumSize(QtCore.QSize(300, 300))
        self.BasilicaAssist.setMaximumSize(QtCore.QSize(300, 300))
        self.BasilicaAssist.setStyleSheet("border: 5px solid;\n"
                                  "border-radius:20;\n"
                                  "border-color:rgb(108, 108, 108);\n"
                                  "image: url(./images/BasilicaAssistbtn.png);\n"
                                  "\n"
                                  "")
        self.BasilicaAssist.setText("")
        self.BasilicaAssist.setObjectName("BasilicaAssist")
        self.BasilicaAssist.mousePressEvent = lambda x: self.open_BasilicaAssist()

        self.horizontalLayout_2.addWidget(self.BasilicaAssist)
        spacerItem8 = QtWidgets.QSpacerItem(40, 20, QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Minimum)
        self.horizontalLayout_2.addItem(spacerItem8)
        self.TAVIViews = QtWidgets.QLabel(self.BottomGrid)
        self.TAVIViews.setMinimumSize(QtCore.QSize(300, 300))
        self.TAVIViews.setMaximumSize(QtCore.QSize(300, 300))
        self.TAVIViews.setStyleSheet("border: 5px solid;\n"
                                     "border-radius:20;\n"
                                     "border-color:rgb(108, 108, 108);\n"
                                     "image: url(./images/impanter-views.png);\n"
                                     "\n"
                                     "\n"
                                     "")
        self.TAVIViews.setText("")
        self.TAVIViews.setObjectName("TAVIViews")
        self.TAVIViews.mousePressEvent = lambda x: self.open_TAVIViews()

        self.horizontalLayout_2.addWidget(self.TAVIViews)
        spacerItem9 = QtWidgets.QSpacerItem(40, 20, QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Minimum)
        self.horizontalLayout_2.addItem(spacerItem9)
        self.BT_3DAoTracker = QtWidgets.QLabel(self.BottomGrid)
        self.BT_3DAoTracker.mousePressEvent = lambda x: self.open_3DAorticTracker()
        #self.BT_3DAoTracker.mousePressEvent = lambda x: self.open_BasilicaAssist()

        self.BT_3DAoTracker.setMinimumSize(QtCore.QSize(300, 300))
        self.BT_3DAoTracker.setMaximumSize(QtCore.QSize(300, 300))
        self.BT_3DAoTracker.setStyleSheet("border: 5px solid;\n"
                                          "border-radius:20;\n"
                                          "border-color:rgb(108, 108, 108);\n"
                                          "image: url(./images/Arotic_tracker.png);\n"
                                          "\n"
                                          "")
        self.BT_3DAoTracker.setText("")
        self.BT_3DAoTracker.setObjectName("BT_3DAoTracker")
        self.horizontalLayout_2.addWidget(self.BT_3DAoTracker)
        spacerItem10 = QtWidgets.QSpacerItem(40, 20, QtWidgets.QSizePolicy.Expanding, QtWidgets.QSizePolicy.Minimum)
        self.horizontalLayout_2.addItem(spacerItem10)
        self.verticalLayout.addWidget(self.BottomGrid)
        TAVIAssist.setCentralWidget(self.centralwidget)
        self.menubar = QtWidgets.QMenuBar(TAVIAssist)
        self.menubar.setGeometry(QtCore.QRect(0, 0, 1328, 26))
        self.menubar.setObjectName("menubar")
        self.menuFIle = QtWidgets.QMenu(self.menubar)
        self.menuFIle.setObjectName("menuFIle")
        self.menuHelp = QtWidgets.QMenu(self.menubar)
        self.menuHelp.setObjectName("menuHelp")
        TAVIAssist.setMenuBar(self.menubar)
        self.statusbar = QtWidgets.QStatusBar(TAVIAssist)
        self.statusbar.setObjectName("statusbar")
        TAVIAssist.setStatusBar(self.statusbar)
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
        self.verticalLayout.addWidget(self.btnBack)
        self.btnBack.setText("Go Back")


        self.retranslateUi(TAVIAssist)
        QtCore.QMetaObject.connectSlotsByName(TAVIAssist)

    def retranslateUi(self, TAVIAssist):
        _translate = QtCore.QCoreApplication.translate
        TAVIAssist.setWindowTitle(_translate("TAVIAssist", "TAVIAssist "))
        self.menuFIle.setTitle(_translate("TAVIAssist", "File"))
        self.menuHelp.setTitle(_translate("TAVIAssist", "Help"))

    def open_DSCurve(self):
        #Need SCurve Value
        BT_DSCurve.BTDSCurveWindow.show()
        # if not BTClass.myBT.getConnectedDevice():
        #     # START GENERAL TRACKER
        #     # BTlist_ui = BT_list.Ui_BT_devices(BT_SCurve.BTSCurveWindow, BT_SCurve.BSC_ui)
        #
        #     # START Double S Cruve (for test only)
        #     BTlist_ui = BT_list.Ui_BT_devices(BT_DSCurve.BTDSCurveWindow, BT_DSCurve.BTDSC_ui)
        #     BTlist_ui.setupUi(BT_list.BTlistWindow)
        #     BT_list.BTlistWindow.show()
        # else:
        #     print("already connected")
        #     BT_DSCurve.BTDSCurveWindow.show()
        #     BT_DSCurve.BTDSC_ui.runAnimation()

    def open_SCurve_MDCT(self):
        SCurve_MDCT.MainWindow.show()


    def open_SCurve_Fluoro(self):
        BT_AV_Fluoro_SCurve.MainWindow.show()

    def open_SCurve_Device(self):
        BT_Device_SCurve.MainWindow.show()

    def open_SCurve_TEE(self):
        return


    def open_TAVIViews(self):
        TAVIViews.MainWindow.show()


    def open_3DAorticTracker(self):
        if not BTClass.myBT.getConnectedDevice():
           BTlist_ui = BT_list.Ui_BT_devices(BT_3DAorta_Tracker.ThreeDSDSCurveWindow, BT_3DAorta_Tracker.ThreeDSDSC_ui)
           BTlist_ui.setupUi(BT_list.BTlistWindow)
           BT_list.BTlistWindow.show()
        else:
            print("already connected")
            BT_3DAorta_Tracker.ThreeDSDSCurveWindow.show()
            BT_3DAorta_Tracker.ThreeDSDSC_ui.runAnimation()
        # BT_3DAorta_Tracker.ThreeDSDSCurveWindow.show()
    def open_BasilicaAssist(self):
        if not BTClass.myBT.getConnectedDevice():
           BTlist_ui = BT_list.Ui_BT_devices(BT_Basilica_Assist.BasilicaAssistWindow, BT_Basilica_Assist.BasilicaAssist_ui)
           BTlist_ui.setupUi(BT_list.BTlistWindow)
           BT_list.BTlistWindow.show()
        else:
            print("already connected")
            BT_Basilica_Assist.BasilicaAssistWindow.show()
            BT_Basilica_Assist.BasilicaAssist_ui.runAnimation()
        # BT_3DAorta_Tracker.ThreeDSDSCurveWindow.show()


import sys

app = QtWidgets.QApplication(sys.argv)
TAVIAssist_Win = MyWindow()
TAVIAssist_ui = Ui_TAVIAssist()
TAVIAssist_ui.setupUi(TAVIAssist_Win)
