import asyncio
from bleak import BleakClient, discover


class BTClass(object):
    def __init__(self):
        self.currentDevice=None
        self.listDevices=None
        self.sock=None

    # Search Devices and return list
    async def searchDevices(self, service_uuids=None):
        async with BleakScanner() as scanner:
            devices = await scanner.discover(service_uuids=service_uuids)
            if devices:
                self.listDevices = devices
                return devices
            else:
                self.listDevices = None
                return None
    #COnnect Device by Host and Port
    async def connectDevices(self, address):
        try:
            self.sock = await BleakClient(address)
            await self.sock.connect()
            self.currentDevice = self.sock
            return self.currentDevice
        except:
            self.currentDevice = None
            return None

    #get connected Device by sock.recv. if data is nulled nothing is connected so make current Device nulled
    def getConnectedDevice(self):
        if self.sock and self.sock.is_connected:
            self.currentDevice = self.sock
            return self.currentDevice
        else:
            self.currentDevice = None
            return None
    # Get Data in Bytes
    def recvBTdata_raw(self):
        try:
            data = self.sock.read_mtu_size()
            if data:
                return data
            else:
                return None
        except:
            return None

    def recvBTdata_splitted(self):
        try:
            data = self.sock.read_mtu_size()
            if data:
                BTdata = data.decode("utf-8")
                bt_data = BTdata.split('|')
                bt_data = bt_data[1].split(",")
                if len(bt_data) > 2:
                    return bt_data
                else:
                    return None
            else:
                return None
        except:
            return None
# initial BTCLass so can be accessed from all files
myBT = BTClass()