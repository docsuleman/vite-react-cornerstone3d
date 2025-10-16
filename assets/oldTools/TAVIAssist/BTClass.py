import bluetooth



class BTClass(object):
    def __init__(self):
        self.currentDevice=None
        self.listDevices=None
        self.sock=None

    # Search Devices and return list
    def searchDevices(self,addr,uuid):
        #self.addr = None
        #self.uuid = "8ce255c0-223a-11e0-ac64-0803450c9a66"

        self.listDevices = bluetooth.find_service(uuid=uuid, address=addr)

        if len(self.listDevices) == 0:
            return None;
        else:
            return self.listDevices
    #COnnect Device by Host and Port
    # def connectDevices(self,host,port):
    #     try:
    #         self.sock = bluetooth.BluetoothSocket(bluetooth.RFCOMM)
    #
    #         self.sock.connect((host, port))
    #     except:
    #         return None
    #     self.currentDevice=self.sock
    #     return self.currentDevice
    def connectDevices(self, host, uuid="8CE255C0-223A-11E0-AC64-0803450C9A66"):
        try:
            # Find the service with the given UUID
            service_matches = bluetooth.find_service(uuid=uuid, address=host)

            if len(service_matches) == 0:
                print(f"Couldn't find the specified service with UUID {uuid}")
                return None

            first_match = service_matches[0]
            port = first_match["port"]
            name = first_match["name"]

            print(f"Connecting to \"{name}\" on {host}")

            self.sock = bluetooth.BluetoothSocket(bluetooth.RFCOMM)
            self.sock.connect((host, port))

            print(f"Connected successfully on port {port}")
            self.currentDevice = self.sock
            return self.currentDevice

        except bluetooth.BluetoothError as e:
            print(f"Bluetooth Error: {e}")
            return None
        except Exception as e:
            print(f"Unexpected error: {e}")
            return None

    #get connected Device by sock.recv. if data is nulled nothing is connected so make current Device nulled
    def getConnectedDevice(self):
        try:
            data=self.sock.recv(1024)
            if len(data)==0:
                self.currentDevice=None
                return None
            else:
                self.currentDevice=self.sock
                return self.currentDevice
        except:
            return None
    # Get Data in Bytes
    def recvBTdata_raw(self):
        return self.sock.recv(1024)
    # Get Data in SPlitted Form to plot on graph

    def recvBTdata_splitted(self):
        data=self.sock.recv(1024)
        if data:
            # print("received [%s]" % data)
            BTdata = data.decode("utf-8")
            bt_data = BTdata.split('|')
            bt_data = bt_data[1].split(",")
            if len(bt_data)>2:
                return bt_data;
            else:
                return None
# initial BTCLass so can be accessed from all files
myBT = BTClass()