from PyQt5 import QtCore, QtGui, QtWidgets

import BTClass
import BT_SCurve

class MyWindow(QtWidgets.QMainWindow):
    def closeEvent(self,event):
        print("BTList Window Closed")
    def showEvent(self, event):
        print("BTList Window Showed")

class Ui_BT_devices(object):
    #window parameter takes window name to be called after connection
    # ui_class parameter takes CLASS_NAME so it can call runAnimation fucntion
    def __init__(self,window,ui_class):
        self.window=window
        self.ui_class=ui_class


    def Search_Devices(self):

        self.addr=None
        self.uuid = "8ce255c0-223a-11e0-ac64-0803450c9a66"

        #self.service_matches=
        if(BTClass.myBT.searchDevices(self.addr,self.uuid)):
            if len(BTClass.myBT.listDevices)==0:
                Msgbox = QtWidgets.QMessageBox()
                Msgbox.setIcon(QtWidgets.QMessageBox.Information)
                Msgbox.setText("NaviCath BlueTooth Tracker Not Found.")
                x = Msgbox.exec_()
            else:
                print(BTClass.myBT.listDevices)
                for bt in BTClass.myBT.listDevices:
                    self.listWidget.addItem((bt["name"]).decode("utf-8"))




    def MakeItZero(self):
        self.sock.send("MakeitZero");

    def Demo_device(self):
        try:
            host="9C:73:B1:54:FD:38"
            port=11
            self.sock = BTClass.myBT.connectDevices(host)
            #self.sock = BTClass.myBT.connectDevices(host)

            print("connected")
            self.btnMakeZero.setEnabled(True)

            # BT_SCurve.BTSCurveWindow.show()
            self.window.show()
            # t1=threading.Thread(target=self.runBTRecieve)
            # t1.setDaemon(True)
            # t1.start()
            self.ui_class.runAnimation()
            # BT_SCurve.BSC_ui.runAnimation()
            return
        except:
            return None

    def Demo_device_loop(self):
        print("Demo Device LOOP")

        try:
            host = "5C:D0:6E:89:B1:92"
            port = 1  # Start with port 1

            while port <= 30:  # Loop through all possible ports
                self.sock = BTClass.myBT.connectDevices(host, port)
                print(dir(self.sock))

                if self.sock:
                    print(self.sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCLOUDED))
                    if self.sock.fileno()==2136:
                        print("connected",port)
                        self.btnMakeZero.setEnabled(True)

                        self.window.show()

                        self.ui_class.runAnimation()

                        return
                else:
                    port += 1  # Try next port if connection fails
                    print("trying port:",port)


            if port > 30:  # No connection established after loop
                print(f"Failed to connect to device on ports 1-20")
        except Exception as e:
                print(f"Error: {e}")

    def Connect_Device(self):
        self.BT_name=self.listWidget.currentItem().text()

        for bt in BTClass.myBT.listDevices:
            if bt["name"].decode("utf-8")==self.BT_name:
                #self.sock = bluetooth.BluetoothSocket(bluetooth.RFCOMM)
                #self.sock.connect((bt["host"], bt["port"]))
                self.sock=BTClass.myBT.connectDevices(bt["host"],bt["port"])

                print("connected")
                self.btnMakeZero.setEnabled(True)

                #BT_SCurve.BTSCurveWindow.show()
                self.window.show()
                # t1=threading.Thread(target=self.runBTRecieve)
                # t1.setDaemon(True)
                # t1.start()
                self.ui_class.runAnimation()
                #BT_SCurve.BSC_ui.runAnimation()



    def setupUi(self, BTWindow):
        BTWindow.setObjectName("BTWindow")
        BTWindow.setWindowTitle("Find and Pair Devices")
        BTWindow.resize(0, 0)
        BTWindow.setStyleSheet("background-color: rgb(66, 66, 66);")
        self.centralwidget = QtWidgets.QWidget(BTWindow)
        self.centralwidget.setObjectName("centralwidget")
        self.gridLayout = QtWidgets.QGridLayout(self.centralwidget)
        self.gridLayout.setSizeConstraint(QtWidgets.QLayout.SetNoConstraint)
        self.gridLayout.setObjectName("gridLayout")
        self.gridWidget = QtWidgets.QWidget(self.centralwidget)
        self.gridWidget.setObjectName("gridWidget")
        self.AppGrid = QtWidgets.QGridLayout(self.gridWidget)
        self.AppGrid.setSizeConstraint(QtWidgets.QLayout.SetFixedSize)
        self.AppGrid.setContentsMargins(7, 7, 7, 7)
        self.AppGrid.setSpacing(7)
        self.AppGrid.setObjectName("AppGrid")

        self.btnConnect = QtWidgets.QPushButton(self.gridWidget)

        ##will connect all phones
        #self.btnConnect.clicked.connect(lambda: self.Connect_Device())

        ## will only connect my phone
        self.btnConnect.clicked.connect(lambda: self.Demo_device())

        icon = QtGui.QIcon()
        icon.addPixmap(QtGui.QPixmap("./images/bt.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.btnConnect.setIcon(icon)
        self.btnConnect.setObjectName("btnConnect")
        self.AppGrid.addWidget(self.btnConnect, 4, 0, 1, 1)


        self.listWidget = QtWidgets.QListWidget(self.gridWidget)
        self.listWidget.setMinimumSize(QtCore.QSize(200, 200))
        self.listWidget.setObjectName("listWidget")
        self.AppGrid.addWidget(self.listWidget, 2, 0, 1, 1)
        self.BT = QtWidgets.QLabel(self.gridWidget)
        self.BT.setMinimumSize(QtCore.QSize(700, 100))
        self.BT.setMaximumSize(QtCore.QSize(600, 200))
        self.BT.setStyleSheet("image: url(./images/bt-title.png);")
        self.BT.setText("")
        self.BT.setObjectName("BT")
        self.AppGrid.addWidget(self.BT, 1, 0, 1, 1)
        self.btnFindDevices = QtWidgets.QPushButton(self.gridWidget)
        icon1 = QtGui.QIcon()
        icon1.addPixmap(QtGui.QPixmap("./images/search.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.btnFindDevices.setIcon(icon1)
        self.btnFindDevices.setObjectName("btnFindDevices")
        self.btnFindDevices.clicked.connect(lambda: self.Search_Devices())
        self.AppGrid.addWidget(self.btnFindDevices, 3, 0, 1, 1)

        self.btnMakeZero = QtWidgets.QPushButton(self.gridWidget)
        icon1 = QtGui.QIcon()
        icon1.addPixmap(QtGui.QPixmap("./images/search.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        self.btnMakeZero.setIcon(icon1)
        self.btnMakeZero.setObjectName("btnMakeZero")
        self.btnMakeZero.clicked.connect(lambda: self.MakeItZero())
        self.AppGrid.addWidget(self.btnMakeZero, 5, 0, 1, 1)
        self.btnMakeZero.setEnabled(False)

        self.gridLayout.addWidget(self.gridWidget, 2, 1, 1, 1)
        BTWindow.setCentralWidget(self.centralwidget)
        self.menubar = QtWidgets.QMenuBar(BTWindow)
        self.menubar.setGeometry(QtCore.QRect(0, 0, 1329, 26))
        self.menubar.setObjectName("menubar")
        self.menuFIle = QtWidgets.QMenu(self.menubar)
        self.menuFIle.setObjectName("menuFIle")
        self.menuHelp = QtWidgets.QMenu(self.menubar)
        self.menuHelp.setObjectName("menuHelp")
        BTWindow.setMenuBar(self.menubar)
        self.statusbar = QtWidgets.QStatusBar(BTWindow)
        self.statusbar.setObjectName("statusbar")
        BTWindow.setStatusBar(self.statusbar)
        self.menubar.addAction(self.menuFIle.menuAction())
        self.menubar.addAction(self.menuHelp.menuAction())

        self.retranslateUi(BTWindow)
        QtCore.QMetaObject.connectSlotsByName(BTWindow)



    def retranslateUi(self, BTWindow):
        _translate = QtCore.QCoreApplication.translate
        BTWindow.setWindowTitle(_translate("BTWindow", "Find and Pair Bluetooth Fluorotracker"))
        self.btnConnect.setText(_translate("BTWindow", "Connect"))
        self.btnFindDevices.setText(_translate("BTWindow", "Find Devices"))
        self.btnMakeZero.setText(_translate("BTWindow", "Zero All"))

BTlistWindow = MyWindow()

