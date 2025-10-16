# -*- coding: utf-8 -*-

# Form implementation generated from reading ui file 'PatientWindow.ui'
#
# Created by: PyQt5 UI code generator 5.6
#
# WARNING! All changes made in this file will be lost!
from datetime import datetime

from PyQt5.QtWidgets import QTableWidgetItem

import DB
from PyQt5 import QtCore, QtGui, QtWidgets

class Ui_PatientWindow(object):
    def __init__(self,Parent=None):
        self.myPatient=None
        self.exams=None
        self.Parent=Parent

    def populate_table(self):
        self.examTable.setRowCount(len(self.exams))
        self.examTable.setColumnCount(3)

        self.examTable.setHorizontalHeaderLabels(["Exam ID", "Patient ID", "DATE"])
        header = self.examTable.horizontalHeader()
        header.setSectionResizeMode(1, QtWidgets.QHeaderView.Stretch)
        header.setSectionResizeMode(0, QtWidgets.QHeaderView.ResizeToContents)
        header.setSectionResizeMode(2, QtWidgets.QHeaderView.Stretch)

        rows = len(self.exams)
        for row in range(rows):
            for column in range(3):
                self.examTable.setItem(row, column, QTableWidgetItem(str(self.exams[row][column])))
        print(self.exams)


    def get_current_patient_exams (self):
        self.myPatient = DB.patientsDB.myPatient
        self.exams=DB.patientsDB.get_patient_exams(self.myPatient)
        patient=DB.patientsDB.get_patient_by_id(DB.patientsDB.myPatient)
        print(patient)
        self.NameTextEdit.setPlainText(str(patient[1]))
        self.AgeTextEdit.setPlainText(str(patient[2]))
        self.GenderTextEdit.setPlainText(str(patient[3]))
        self.MRNoTextEdit.setPlainText(str(patient[4]))
        #(Name, Age, Gender, MRNO, DoA)
        self.populate_table()

    def add_new_exam(self):
        values = (self.myPatient, datetime.now())
        DB.patientsDB.myExam= DB.patientsDB.add_exam(values)
        self.exams = DB.patientsDB.get_patient_exams(self.myPatient)
        self.populate_table()
        self.Parent.run_app()

    def select_row(self, row, column):
        print(row, column)
        self.btnOpenExam.setEnabled(True)
        self.btnDeleteExam.setEnabled(True)

    def select_exam(self):

        # print(self.patientTable.currentRow())

        DB.patientsDB.myExam = self.examTable.item(self.examTable.currentRow(), 0).text()
        print(DB.patientsDB.myExam)
        self.Parent.PatientWindow.close()
        self.Parent.run_app()
    def patient_list(self):
        self.Parent.PatientWindow.close()
        self.Parent.window.show()

    def delete_exam(self):
        DB.patientsDB.delete_exam(self.examTable.item(self.examTable.currentRow(), 0).text())
        DB.patientsDB.myExam=None
        self.exams = DB.patientsDB.get_patient_exams(self.myPatient)
        self.populate_table()

    def goBack(self):
        self.Parent.PatientWindow.close()
        self.Parent.window.show()










        # update below Exams and Last exams

    def setupUi(self, PatientWindow):
        PatientWindow.setObjectName("PatientWindow")
        PatientWindow.resize(1004, 706)
        PatientWindow.setStyleSheet("background-color: rgb(66, 66, 66);")
        self.centralwidget = QtWidgets.QWidget(PatientWindow)
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
        self.groupBox = QtWidgets.QGroupBox(self.topFrame)
        self.groupBox.setObjectName("groupBox")
        self.horizontalLayout = QtWidgets.QHBoxLayout(self.groupBox)
        self.horizontalLayout.setObjectName("horizontalLayout")
        self.label = QtWidgets.QLabel(self.groupBox)
        self.label.setObjectName("label")
        self.horizontalLayout.addWidget(self.label)
        self.NameTextEdit = QtWidgets.QPlainTextEdit(self.groupBox)
        self.NameTextEdit.setMinimumSize(QtCore.QSize(0, 0))
        self.NameTextEdit.setMaximumSize(QtCore.QSize(16777215, 50))
        self.NameTextEdit.setObjectName("NameTextEdit")
        self.horizontalLayout.addWidget(self.NameTextEdit)
        self.label_2 = QtWidgets.QLabel(self.groupBox)
        self.label_2.setObjectName("label_2")
        self.horizontalLayout.addWidget(self.label_2)
        self.AgeTextEdit = QtWidgets.QPlainTextEdit(self.groupBox)
        self.AgeTextEdit.setMaximumSize(QtCore.QSize(50, 50))
        self.AgeTextEdit.setObjectName("AgeTextEdit")
        self.horizontalLayout.addWidget(self.AgeTextEdit)
        self.label_3 = QtWidgets.QLabel(self.groupBox)
        self.label_3.setObjectName("label_3")
        self.horizontalLayout.addWidget(self.label_3)
        self.GenderTextEdit = QtWidgets.QTextEdit(self.groupBox)
        self.GenderTextEdit.setMaximumSize(QtCore.QSize(50, 50))
        self.GenderTextEdit.setObjectName("textEdit")
        self.horizontalLayout.addWidget(self.GenderTextEdit)
        self.label_4 = QtWidgets.QLabel(self.groupBox)
        self.label_4.setObjectName("label_4")
        self.horizontalLayout.addWidget(self.label_4)
        self.MRNoTextEdit = QtWidgets.QPlainTextEdit(self.groupBox)
        self.MRNoTextEdit.setMaximumSize(QtCore.QSize(200, 50))
        self.MRNoTextEdit.setObjectName("MRNoTextEdit")
        self.horizontalLayout.addWidget(self.MRNoTextEdit)
        self.horizontalLayout_3.addWidget(self.groupBox)
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
        self.label_5 = QtWidgets.QLabel(self.midFrame)
        self.label_5.setObjectName("label_5")
        self.verticalLayout_2.addWidget(self.label_5)
        self.examTable = QtWidgets.QTableWidget(self.midFrame)
        self.examTable.setGridStyle(QtCore.Qt.NoPen)
        self.examTable.setObjectName("examTable")
        self.examTable.setColumnCount(0)
        self.examTable.setRowCount(0)
        self.examTable.cellClicked.connect(self.select_row)

        self.verticalLayout_2.addWidget(self.examTable)
        self.buttonTables = QtWidgets.QFrame(self.midFrame)
        self.buttonTables.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.buttonTables.setFrameShadow(QtWidgets.QFrame.Raised)
        self.buttonTables.setObjectName("buttonTables")
        self.horizontalLayout_5 = QtWidgets.QHBoxLayout(self.buttonTables)
        self.horizontalLayout_5.setObjectName("horizontalLayout_5")
        self.verticalLayout_2.addWidget(self.buttonTables)
        self.verticalLayout.addWidget(self.midFrame)
        self.bottom_frame = QtWidgets.QFrame(self.centralwidget)
        self.bottom_frame.setMinimumSize(QtCore.QSize(0, 70))
        self.bottom_frame.setMaximumSize(QtCore.QSize(16777215, 70))
        self.bottom_frame.setFrameShape(QtWidgets.QFrame.StyledPanel)
        self.bottom_frame.setFrameShadow(QtWidgets.QFrame.Raised)
        self.bottom_frame.setObjectName("bottom_frame")
        self.horizontalLayout_4 = QtWidgets.QHBoxLayout(self.bottom_frame)
        self.horizontalLayout_4.setObjectName("horizontalLayout_4")
        self.btnOpenExam = QtWidgets.QPushButton(self.bottom_frame)
        self.btnOpenExam.setEnabled(False)
        self.btnOpenExam.setObjectName("btnOpenExam")
        self.btnOpenExam.clicked.connect(lambda x: self.select_exam())
        self.horizontalLayout_4.addWidget(self.btnOpenExam)
        self.btnDeleteExam = QtWidgets.QPushButton(self.bottom_frame)
        self.btnDeleteExam.setEnabled(False)
        self.btnDeleteExam.clicked.connect(lambda x: self.delete_exam())

        self.btnDeleteExam.setObjectName("btnDeleteExam")
        self.horizontalLayout_4.addWidget(self.btnDeleteExam)
        self.btnNewExam = QtWidgets.QPushButton(self.bottom_frame)
        self.btnNewExam.setObjectName("btnNewExam")
        self.btnNewExam.clicked.connect(lambda x:self.add_new_exam())
        self.horizontalLayout_4.addWidget(self.btnNewExam)
        self.btnPatientList = QtWidgets.QPushButton(self.bottom_frame)
        self.btnPatientList.setEnabled(True)
        self.btnPatientList.clicked.connect(self.patient_list)
        self.btnPatientList.setObjectName("btnPatientList")
        self.horizontalLayout_4.addWidget(self.btnPatientList)
        self.verticalLayout.addWidget(self.bottom_frame)
        PatientWindow.setCentralWidget(self.centralwidget)
        self.menubar = QtWidgets.QMenuBar(PatientWindow)
        self.menubar.setGeometry(QtCore.QRect(0, 0, 1004, 26))
        self.menubar.setObjectName("menubar")
        PatientWindow.setMenuBar(self.menubar)
        self.statusbar = QtWidgets.QStatusBar(PatientWindow)
        self.statusbar.setObjectName("statusbar")
        PatientWindow.setStatusBar(self.statusbar)

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


        self.retranslateUi(PatientWindow)
        QtCore.QMetaObject.connectSlotsByName(PatientWindow)

    def retranslateUi(self, PatientWindow):
        _translate = QtCore.QCoreApplication.translate
        PatientWindow.setWindowTitle(_translate("PatientWindow", "Patient Examinations"))
        self.groupBox.setTitle(_translate("PatientWindow", "Patient Info:"))
        self.label.setText(_translate("PatientWindow", "Name"))
        self.label_2.setText(_translate("PatientWindow", "Age"))
        self.label_3.setText(_translate("PatientWindow", "Gender"))
        self.label_4.setText(_translate("PatientWindow", "MR No:"))
        self.label_5.setText(_translate("PatientWindow", "Exams List:"))
        self.examTable.setSortingEnabled(True)
        self.btnOpenExam.setText(_translate("PatientWindow", "Open Exam"))
        self.btnDeleteExam.setText(_translate("PatientWindow", "Delete Exam"))
        self.btnNewExam.setText(_translate("PatientWindow", "New Exam"))

        self.btnPatientList.setText(_translate("PatientWindow", "<< Patient List"))



# import sys
# app = QtWidgets.QApplication(sys.argv)
# PatientWindow = QtWidgets.QMainWindow()
# PatientWindow_ui = Ui_PatientWindow()
# PatientWindow_ui.setupUi(PatientWindow)
#PatientWindow.show()

