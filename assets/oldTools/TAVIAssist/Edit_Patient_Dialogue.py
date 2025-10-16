from PyQt5 import QtCore, QtGui, QtWidgets
import DB


class Ui_Dialog(object):
    def __init__(self, Parent=None):
        self.Parent = Parent
        self.myPatient = DB.patientsDB.myPatient
        print("current patient", self.myPatient)
        self.Current_Patient_data = DB.patientsDB.get_patient_by_id(self.myPatient)
        print(self.Current_Patient_data)

    def Edit_Patient(self):

        Name, MRNO, Gender, Age = self.NameEditBox.toPlainText(), self.MRNOEditBox.toPlainText(), self.GendercomboBox.currentText(), self.AgeEditBox.toPlainText()
        if Name and MRNO and Gender and Age:
            # (Name, Age, Gender, MRNO, DoA)
            values = (Name, Age, Gender, MRNO)
            DB.patientsDB.update_patient(self.myPatient, values)
            self.Parent.Edit_Dialogue.close()
            self.Parent.get_all_patient()
            self.Parent.populate_table()
            # Should open New Exam window
        else:
            print("Please fill all fields")

    def setupUi(self, Dialog):
        Dialog.setObjectName("Dialog")
        Dialog.resize(503, 486)

        icon = QtGui.QIcon()
        icon.addPixmap(QtGui.QPixmap("images/patient.png"), QtGui.QIcon.Normal, QtGui.QIcon.Off)
        Dialog.setWindowIcon(icon)

        Dialog.setStyleSheet("background-color: rgb(66, 66, 66);")
        self.verticalLayout = QtWidgets.QVBoxLayout(Dialog)
        self.verticalLayout.setObjectName("verticalLayout")
        self.label = QtWidgets.QLabel(Dialog)
        self.label.setObjectName("label")
        self.verticalLayout.addWidget(self.label)
        self.NameEditBox = QtWidgets.QPlainTextEdit(Dialog)
        self.NameEditBox.setMaximumSize(QtCore.QSize(16777215, 50))
        self.NameEditBox.setObjectName("NameEditBox")
        self.verticalLayout.addWidget(self.NameEditBox)
        self.label_2 = QtWidgets.QLabel(Dialog)
        self.label_2.setObjectName("label_2")
        self.verticalLayout.addWidget(self.label_2)
        self.AgeEditBox = QtWidgets.QPlainTextEdit(Dialog)
        self.AgeEditBox.setMaximumSize(QtCore.QSize(16777215, 50))
        self.AgeEditBox.setObjectName("AgeEditBox")
        self.verticalLayout.addWidget(self.AgeEditBox)
        self.label_3 = QtWidgets.QLabel(Dialog)
        self.label_3.setObjectName("label_3")
        self.verticalLayout.addWidget(self.label_3)
        self.MRNOEditBox = QtWidgets.QPlainTextEdit(Dialog)
        self.MRNOEditBox.setMaximumSize(QtCore.QSize(16777215, 50))
        self.MRNOEditBox.setObjectName("MRNOEditBox")
        self.verticalLayout.addWidget(self.MRNOEditBox)
        self.label_4 = QtWidgets.QLabel(Dialog)
        self.label_4.setObjectName("label_4")
        self.verticalLayout.addWidget(self.label_4)
        self.GendercomboBox = QtWidgets.QComboBox(Dialog)
        self.GendercomboBox.setMaximumSize(QtCore.QSize(16777215, 50))
        self.GendercomboBox.setObjectName("GendercomboBox")
        gender_list = ["Male", "Female", "other"]
        self.GendercomboBox.addItems(gender_list)
        self.verticalLayout.addWidget(self.GendercomboBox)
        self.btnEdit = QtWidgets.QPushButton(Dialog)
        self.btnEdit.setMaximumSize(QtCore.QSize(16777215, 50))
        self.btnEdit.setObjectName("btnEdit")
        self.btnEdit.clicked.connect(lambda x: self.Edit_Patient())
        self.verticalLayout.addWidget(self.btnEdit)
        self.btnCancel = QtWidgets.QPushButton(Dialog)
        self.btnCancel.setMaximumSize(QtCore.QSize(16777215, 50))
        self.btnCancel.setObjectName("btnCancel")
        self.verticalLayout.addWidget(self.btnCancel)

        # intiate data
        print(self.Current_Patient_data)
        self.NameEditBox.setPlainText(str(self.Current_Patient_data[1]))
        self.MRNOEditBox.setPlainText(str(self.Current_Patient_data[4]))
        self.AgeEditBox.setPlainText(str(self.Current_Patient_data[2]))
        if (str(self.Current_Patient_data[3]) == "Male"):
            self.GendercomboBox.setCurrentIndex(0)
        else:
            if (str(self.Current_Patient_data[3]) == "Female"):
                self.GendercomboBox.setCurrentIndex(1)
            else:
                self.GendercomboBox.setCurrentIndex(2)

        self.retranslateUi(Dialog)
        QtCore.QMetaObject.connectSlotsByName(Dialog)

    def retranslateUi(self, Dialog):
        _translate = QtCore.QCoreApplication.translate
        Dialog.setWindowTitle(_translate("Dialog", "Add Patient"))
        self.label.setText(_translate("Dialog", "Name"))
        self.NameEditBox.setPlaceholderText(_translate("Dialog", "Name"))
        self.label_2.setText(_translate("Dialog", "Age:"))
        self.AgeEditBox.setPlaceholderText(_translate("Dialog", "Age"))
        self.label_3.setText(_translate("Dialog", "MR No:"))
        self.MRNOEditBox.setPlaceholderText(_translate("Dialog", "MR No"))
        self.label_4.setText(_translate("Dialog", "Gender"))
        self.GendercomboBox.setPlaceholderText(_translate("Dialog", "Gender"))
        self.btnEdit.setText(_translate("Dialog", "Edit"))
        self.btnCancel.setText(_translate("Dialog", "Cancel"))


if __name__ == "__main__":
    import sys

    app = QtWidgets.QApplication(sys.argv)
    Dialog = QtWidgets.QDialog()
    ui = Ui_Dialog()
    ui.setupUi(Dialog)
    Dialog.show()
    sys.exit(app.exec_())
