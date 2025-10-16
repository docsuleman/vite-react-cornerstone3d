# All Database Logic Here
#


import sqlite3
from datetime import datetime


class patientsDB(object):

    def __init__(self):
        self.connection = sqlite3.connect('patients.db')
        self.myPatient=None
        self.myExam=None


    # Operation Create and Drop Tables

    def Current_Patient(self):
        return self.myPatient


    #Create Patient Table if not created
    def create_tables(self):

        #Patient tables fot patient data
        #exams tables for exam related data
        #values tables for values data

        cur = self.connection.cursor()
        cur.execute('''CREATE TABLE if not exists tPatients
               (id integer PRIMARY KEY, Name text,Age integer, Gender Text, MRNo Text, DoA Text,UNIQUE(MRNo))''')
        cur.execute('''CREATE TABLE if not exists tExams
                               (id integer PRIMARY KEY, patientID integer, DoExam Text)''')

        #valueType is AV S Curve, Device S Curve etc etc
        cur.execute(''' CREATE TABLE if not exists tValues (id integer PRIMARY KEY, examID integer, ValueType Text, Value Text, Time Text)''')
        return self.connection.commit()

    #-----WARNNING--- Delete All Data
    def delete_all_tables(self):
        cur=self.connection.cursor()
        cur.execute("Drop Table tPatients")
        cur.execute("Drop Table tExams")
        cur.execute("Drop Table tValues")
        return self.connection.commit()



    # Operation Additions


    def add_patient(self,values):
        #values=(Name,Age,Gender,MRNO,DoA)
        cur=self.connection.cursor()
        sql=''' INSERT OR IGNORE INTO tPatients (Name,Age,Gender,MRNO,DoA) VALUES (?,?,?,?,?) '''
        cur.execute(sql,values)
        self.connection.commit()
        self.myPatient=cur.lastrowid
        return cur.lastrowid

    def add_exam(self, values):
        # values=(patientID, DoExam)
        cur = self.connection.cursor()
        sql = ''' INSERT OR IGNORE INTO tExams (patientID,DoExam) VALUES (?,?) '''
        cur.execute(sql, values)
        self.connection.commit()
        return cur.lastrowid
    
    def add_emergency_patient(self):
        values = ("Emergency "+str(datetime.now()), "0", "Other", str(datetime.now()), str(datetime.now()))
        self.myPatient=self.add_patient(values)
        values=(self.myPatient, datetime.now())
        self.myExam=self.add_exam(values)
        return self.myExam



    def add_value(self, values):
        # values=(examID,ValueType,Value)
        cur = self.connection.cursor()
        sql = ''' INSERT OR IGNORE INTO tValues (examID,ValueType,Value) VALUES (?,?,?) '''
        cur.execute(sql, values)
        self.connection.commit()
        return cur.lastrowid



    #Operation UPDATE

    def update_patient(self,patientID,values):
        cur=self.connection.cursor()
        sql='Update tPatients SET Name=?, Age=?, Gender=?,MRNO=? where id=' + patientID
        cur.execute(sql, values)

        return self.connection.commit()

    def update_exams(self,examID,field,value):
        cur=self.connection.cursor()
        sql='Update tExams Set ' + field +'="'+ value +'" where id = ' + examID+ ';'
        cur.execute(sql)
        self.connection.commit()
        return cur.lastrowid

    def update_value(self,examID,ValueType,value):
        cur = self.connection.cursor()
        sql = 'Update tValues Set value="' + value + '" where examID = ' + examID + ' and ValueType="'+ValueType+'"'
        cur.execute(sql)
        self.connection.commit()
        return cur.lastrowid



    # Operation GET
    def get_all_patient(self):
        sql='''select * from tPatients'''
        cur=self.connection.cursor()
        cur.execute(sql)
        return cur.fetchall()

    def get_patient_exams(self,id):
        sql='select * from tExams where patientID=' + id
        cur=self.connection.cursor()
        cur.execute(sql)
        return cur.fetchall()

    def get_exam_values(self,id):
        sql = 'select * from tValues where examID=' + id
        cur = self.connection.cursor()
        cur.execute(sql)
        return cur.fetchall()


    def get_patient_by_id(self,id):
        sql='select * from tPatients where id="' + str(id)+'"'
        cur=self.connection.cursor()
        cur.execute(sql)
        self.myPatient = id
        return cur.fetchone()

    def get_exam_by_id(self,id):
        sql = 'select * from tExams where id=' + id
        cur = self.connection.cursor()
        cur.execute(sql)
        return cur.fetchall()

    def get_last_exam(self,patient_id):
        sql='select TOP 1 from tExams where patientID='+patient_id+" ORDER BY ID DESC"
        cur = self.connection.cursor()
        cur.execute(sql)
        return cur.fetchall()



    def get_value_by_ValueType(self,examID,ValueType):
        sql = 'select * from tValues where examID=' + examID + ' and ValueType="'+ValueType+'"'
        cur = self.connection.cursor()
        cur.execute(sql)
        return cur.fetchall()
    #Delete Exam

    def delete_exam(self,id):
        sql = 'delete  from tExams where id=' + id
        cur = self.connection.cursor()
        cur.execute(sql)
        return self.connection.commit()


    def delete_patient(self,id):
        sql = 'delete  from tPatients where id=' + id
        cur = self.connection.cursor()
        cur.execute(sql)
        return self.connection.commit()

    # Operation SEARCH

    def search_patient(self,value,Type):
        # TYPE NAME,ID,DOA, DOE,

        if Type=='Name':
            sql = 'select * from tPatients where ' + Type + ' Like "%'+ value+'%"'
            print(sql)
        else:
            sql = 'select * from tPatients where ' + Type + '="'+ value+'"'
        cur = self.connection.cursor()
        cur.execute(sql)
        return cur.fetchall()




patientsDB=patientsDB()




