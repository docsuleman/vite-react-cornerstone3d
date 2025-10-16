import time

from PyQt5 import QtCore, QtGui, QtWidgets
from PyQt5.QtGui import QPalette, QColor
from PyQt5.QtCore import Qt, QTimer

from PyQt5.QtWidgets import QTableWidgetItem
import PatientWindow
import Add_patient_dialogue, Edit_Patient_Dialogue

import DB, home


class Ui_PatientBrowserWindow(object):
    def __init__(self):
        self.window=PatientBrowserWindow

    def populate_table(self):

        self.patientTable.setRowCount(len(self.patients))
        self.patientTable.setColumnCount(6)

        self.patientTable.setHorizontalHeaderLabels(["ID", "NAME", "AGE", "Gender", "MRNO", "Date of Admission"])
        header = self.patientTable.horizontalHeader()
        header.setSectionResizeMode(1, QtWidgets.QHeaderView.Stretch)
        header.setSectionResizeMode(0, QtWidgets.QHeaderView.ResizeToContents)
        header.setSectionResizeMode(5, QtWidgets.QHeaderView.Stretch)

        rows = len(self.patients)
        for row in range(rows):
            for column in range(6):
                self.patientTable.setItem(row, column, QTableWidgetItem(str(self.patients[row][column])))
        print(self.patients)

    def search_patient(self):
        self.patientTable.clear()
        if self.textMrno.toPlainText():
            self.patients = DB.patientsDB.search_patient(self.textMrno.toPlainText(), "MRNo")
            self.populate_table()
            return

        if self.textName.toPlainText():
            self.patients = DB.patientsDB.search_patient(self.textName.toPlainText(), "Name")
            self.populate_table()
            return
        else:
            self.get_all_patient()
        return

    def get_all_patient(self):
        self.patientTable.clear()
        self.patients = DB.patientsDB.get_all_patient()
        self.populate_table()

    def select_row(self, row, column):
        print(row, column)
        DB.patientsDB.myPatient = self.patientTable.item(self.patientTable.currentRow(), 0).text()

        self.btnOpen.setEnabled(True)
        self.btnDeletePatient.setEnabled(True)
        self.btnEditPatient.setEnabled(True)

    def select_patient(self):

        # print(self.patientTable.currentRow())

        DB.patientsDB.myPatient = self.patientTable.item(self.patientTable.currentRow(), 0).text()
        # PatientWindow.PatientWindow.show()

        self.PatientWindow = QtWidgets.QMainWindow()
        self.PatientWindow_ui = PatientWindow.Ui_PatientWindow(self)
        self.PatientWindow_ui.setupUi(self.PatientWindow)
        PatientBrowserWindow.close()
        self.PatientWindow.show()
        self.PatientWindow_ui.get_current_patient_exams()

        print(self.patientTable.item(self.patientTable.currentRow(), 1).text())

    def add_patient(self):
        self.Add_Dialogue = QtWidgets.QDialog()
        Add_ui = Add_patient_dialogue.Ui_Dialog(self)
        Add_ui.setupUi(self.Add_Dialogue)
        self.Add_Dialogue.show()
        # self.Add_Dialogue.exec()

    def edit_patient(self):
        self.Edit_Dialogue = QtWidgets.QDialog()
        Edit_ui = Edit_Patient_Dialogue.Ui_Dialog(self)
        Edit_ui.setupUi(self.Edit_Dialogue)
        self.Edit_Dialogue.show()
        # self.Add_Dialogue.exec()

    def delete_patient(self):
        DB.patientsDB.delete_patient(self.patientTable.item(self.patientTable.currentRow(), 0).text())
        DB.patientsDB.myPatient = None
        self.get_all_patient()
        self.populate_table()

    def emergency(self):
        if (DB.patientsDB.add_emergency_patient()):
            self.get_all_patient()
            self.app = self.run_app()

        # update below Exams and Last exams

    def run_app(self):
        import sys
        self.MainWindowHome = QtWidgets.QMainWindow()
        home_ui = home.Ui_Home()
        home_ui.setupUi(self.MainWindowHome)
        self.MainWindowHome.show()

    def setupUi(self, PatientBrowserWindow):
        PatientBrowserWindow.setObjectName("PatientBrowserWindow")
        PatientBrowserWindow.resize(1004, 706)

        icon = QtGui.QIcon()
        icon.addPixmap(QtGui.QPixmap("images/patient.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        PatientBrowserWindow.setWindowIcon(icon)

        PatientBrowserWindow.setStyleSheet("background-color: rgb(66, 66, 66);")
        self.centralwidget = QtWidgets.QWidget(PatientBrowserWindow)
        self.centralwidget.setObjectName("centralwidget")
        self.verticalLayout = QtWidgets.QVBoxLayout(self.centralwidget)
        self.verticalLayout.setObjectName("verticalLayout")
        self.topFrame = QtWidgets.QFrame(self.centralwidget)
        self.topFrame.setMinimumSize(QtCore.QSize(0, 100))
        self.topFrame.setMaximumSize(QtCore.QSize(16777215, 100))
        self.topFrame.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.topFrame.setFrameShadow(QtWidgets.QFrame.Raised)
        self.topFrame.setObjectName("topFrame")
        self.horizontalLayout_3 = QtWidgets.QHBoxLayout(self.topFrame)
        self.horizontalLayout_3.setObjectName("horizontalLayout_3")
        self.addBox = QtWidgets.QGroupBox(self.topFrame)
        self.addBox.setObjectName("addBox")
        self.horizontalLayout_2 = QtWidgets.QHBoxLayout(self.addBox)
        self.horizontalLayout_2.setObjectName("horizontalLayout_2")
        self.btnAdd = QtWidgets.QPushButton(self.addBox)
        self.btnAdd.setObjectName("btnAdd")
        self.btnAdd.clicked.connect(self.add_patient)
        self.horizontalLayout_2.addWidget(self.btnAdd)
        self.btnEmergency = QtWidgets.QPushButton(self.addBox)
        self.btnEmergency.setObjectName("btnEmergency")
        self.btnEmergency.clicked.connect(self.emergency)
        self.horizontalLayout_2.addWidget(self.btnEmergency)
        self.horizontalLayout_3.addWidget(self.addBox)
        self.searchBox = QtWidgets.QGroupBox(self.topFrame)
        self.searchBox.setObjectName("searchBox")
        self.horizontalLayout = QtWidgets.QHBoxLayout(self.searchBox)
        self.horizontalLayout.setObjectName("horizontalLayout")
        self.textName = QtWidgets.QTextEdit(self.searchBox)
        self.textName.setObjectName("textName")
        self.horizontalLayout.addWidget(self.textName)
        self.textMrno = QtWidgets.QTextEdit(self.searchBox)
        self.textMrno.setObjectName("textMrno")
        self.horizontalLayout.addWidget(self.textMrno)
        self.btnSearch = QtWidgets.QPushButton(self.searchBox)
        self.btnSearch.setObjectName("btnSearch")
        self.btnSearch.clicked.connect(lambda x: self.search_patient())
        self.horizontalLayout.addWidget(self.btnSearch)
        self.horizontalLayout_3.addWidget(self.searchBox)
        self.verticalLayout.addWidget(self.topFrame)
        self.midFrame = QtWidgets.QFrame(self.centralwidget)
        sizePolicy = QtWidgets.QSizePolicy(QtWidgets.QSizePolicy.Preferred, QtWidgets.QSizePolicy.Expanding)
        sizePolicy.setHorizontalStretch(0)
        sizePolicy.setVerticalStretch(0)
        sizePolicy.setHeightForWidth(self.midFrame.sizePolicy().hasHeightForWidth())
        self.midFrame.setSizePolicy(sizePolicy)
        self.midFrame.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.midFrame.setFrameShadow(QtWidgets.QFrame.Raised)
        self.midFrame.setObjectName("midFrame")
        self.verticalLayout_2 = QtWidgets.QVBoxLayout(self.midFrame)
        self.verticalLayout_2.setObjectName("verticalLayout_2")
        self.patientTable = QtWidgets.QTableWidget(self.midFrame)
        self.patientTable.setGridStyle(QtCore.Qt.NoPen)
        self.patientTable.setObjectName("patientTable")

        self.patientTable.cellClicked.connect(self.select_row)
        self.get_all_patient()

        self.verticalLayout_2.addWidget(self.patientTable)
        self.buttonTables = QtWidgets.QFrame(self.midFrame)
        self.buttonTables.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.buttonTables.setFrameShadow(QtWidgets.QFrame.Raised)
        self.buttonTables.setObjectName("buttonTables")
        self.horizontalLayout_5 = QtWidgets.QHBoxLayout(self.buttonTables)
        self.horizontalLayout_5.setObjectName("horizontalLayout_5")

        self.btnOpen = QtWidgets.QPushButton(self.buttonTables)
        self.btnOpen.setEnabled(False)
        self.btnOpen.setObjectName("btnOpen")
        self.btnOpen.clicked.connect(lambda x: self.select_patient())
        self.horizontalLayout_5.addWidget(self.btnOpen)

        self.btnDeletePatient = QtWidgets.QPushButton(self.buttonTables)
        self.btnDeletePatient.setEnabled(False)
        self.btnDeletePatient.setObjectName("btnDeletePatient")
        self.btnDeletePatient.clicked.connect(self.delete_patient)
        self.horizontalLayout_5.addWidget(self.btnDeletePatient)

        self.btnEditPatient = QtWidgets.QPushButton(self.buttonTables)
        self.btnEditPatient.setEnabled(False)
        self.btnEditPatient.setObjectName("btnEditPatient")
        self.btnEditPatient.clicked.connect(self.edit_patient)
        self.horizontalLayout_5.addWidget(self.btnEditPatient)
        self.verticalLayout_2.addWidget(self.buttonTables)
        self.verticalLayout.addWidget(self.midFrame)
        self.bottom_frame = QtWidgets.QFrame(self.centralwidget)
        self.bottom_frame.setMinimumSize(QtCore.QSize(0, 100))
        self.bottom_frame.setMaximumSize(QtCore.QSize(16777215, 100))
        self.bottom_frame.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.bottom_frame.setFrameShadow(QtWidgets.QFrame.Raised)
        self.bottom_frame.setObjectName("bottom_frame")
        self.horizontalLayout_4 = QtWidgets.QHBoxLayout(self.bottom_frame)
        self.horizontalLayout_4.setObjectName("horizontalLayout_4")
        self.lExam = QtWidgets.QLabel(self.bottom_frame)
        font = QtGui.QFont()
        font.setPointSize(12)
        self.lExam.setFont(font)
        self.lExam.setObjectName("lExam")
        self.horizontalLayout_4.addWidget(self.lExam)
        self.vExams = QtWidgets.QLabel(self.bottom_frame)
        font = QtGui.QFont()
        font.setPointSize(12)
        self.vExams.setFont(font)
        self.vExams.setText("")
        self.vExams.setObjectName("vExams")
        self.horizontalLayout_4.addWidget(self.vExams)
        self.llastExam = QtWidgets.QLabel(self.bottom_frame)
        font = QtGui.QFont()
        font.setPointSize(12)
        self.llastExam.setFont(font)
        self.llastExam.setObjectName("llastExam")
        self.horizontalLayout_4.addWidget(self.llastExam)
        self.vlastExam = QtWidgets.QLabel(self.bottom_frame)
        font = QtGui.QFont()
        font.setPointSize(12)
        self.vlastExam.setFont(font)
        self.vlastExam.setText("")
        self.vlastExam.setObjectName("vlastExam")
        self.horizontalLayout_4.addWidget(self.vlastExam)
        self.verticalLayout.addWidget(self.bottom_frame)
        PatientBrowserWindow.setCentralWidget(self.centralwidget)
        self.menubar = QtWidgets.QMenuBar(PatientBrowserWindow)
        self.menubar.setGeometry(QtCore.QRect(0, 0, 1004, 26))
        self.menubar.setObjectName("menubar")
        PatientBrowserWindow.setMenuBar(self.menubar)
        self.statusbar = QtWidgets.QStatusBar(PatientBrowserWindow)
        self.statusbar.setObjectName("statusbar")
        PatientBrowserWindow.setStatusBar(self.statusbar)

        self.retranslateUi(PatientBrowserWindow)
        QtCore.QMetaObject.connectSlotsByName(PatientBrowserWindow)

    def retranslateUi(self, PatientBrowserWindow):
        _translate = QtCore.QCoreApplication.translate
        PatientBrowserWindow.setWindowTitle(_translate("PatientBrowserWindow", "All Patient Browser"))
        self.addBox.setTitle(_translate("PatientBrowserWindow", "Add New Patient"))
        self.btnAdd.setText(_translate("PatientBrowserWindow", "Add"))
        self.btnEmergency.setText(_translate("PatientBrowserWindow", "Emergency"))
        self.searchBox.setTitle(_translate("PatientBrowserWindow", "Search Patient"))
        self.textName.setPlaceholderText(_translate("PatientBrowserWindow", "Name"))
        self.textMrno.setPlaceholderText(_translate("PatientBrowserWindow", "MR No"))
        self.btnSearch.setText(_translate("PatientBrowserWindow", "Search"))
        self.patientTable.setSortingEnabled(True)
        self.btnDeletePatient.setText(_translate("PatientBrowserWindow", "Delete Patient"))
        self.btnOpen.setText(_translate("PatientBrowserWindow", "Open"))
        self.btnEditPatient.setText(_translate("PatientBrowserWindow", "Edit Patient"))
        self.lExam.setText(_translate("PatientBrowserWindow", "Exams:"))
        self.llastExam.setText(_translate("PatientBrowserWindow", "Last Exam:"))


if __name__ == "__main__":
    import sys
    import splash

    app = QtWidgets.QApplication(sys.argv)
    app.setStyle("Fusion")
    palette = QPalette()
    palette.setColor(QPalette.Window, QColor(53, 53, 53))
    palette.setColor(QPalette.WindowText, Qt.white)
    palette.setColor(QPalette.Base, QColor(25, 25, 25))
    palette.setColor(QPalette.AlternateBase, QColor(53, 53, 53))
    palette.setColor(QPalette.ToolTipBase, Qt.black)
    palette.setColor(QPalette.ToolTipText, Qt.white)
    palette.setColor(QPalette.Text, Qt.white)
    palette.setColor(QPalette.Button, QColor(53, 53, 53))
    palette.setColor(QPalette.ButtonText, Qt.white)
    palette.setColor(QPalette.BrightText, Qt.red)
    palette.setColor(QPalette.Link, QColor(42, 130, 218))
    palette.setColor(QPalette.Highlight, QColor(42, 130, 218))
    palette.setColor(QPalette.HighlightedText, Qt.black)
    app.setPalette(palette)
    PatientBrowserWindow = QtWidgets.QMainWindow()
    ui = Ui_PatientBrowserWindow()
    ui.setupUi(PatientBrowserWindow)
    # PatientBrowserWindow.show()



    counter = 0



    def loading():
        global counter
        if counter >= 100:
            timer.stop()
            splash.MainWindow.close()
            time.sleep(1)
            PatientBrowserWindow.show()

        counter+=1




    splash.MainWindow.show()


    timer = QTimer()
    timer.start(30)
    timer.timeout.connect(loading)

    sys.exit(app.exec_())

    # Now use a palette to switch to dark colors:



