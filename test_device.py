import socket
import json

HOST = 'localhost'
PORT = 4367

payload = {
    "deviceID": 1,
    "airTemperature": 25.30,
    "airHumidity": 60.20,
    "atmosPressure": 1013.2,
    "windDir": 180.0,
    "windSpeed": 5.4,
    "rainfall": 0.0,
    "valuePM_2_5": 12,
    "valuePM_10": 20,
    "valueCO": 0,
    "valueNO2": 0,
    "valueSO2": 0,
    "valueO3": 0,
    "airQualityIndex": 42,
    "versionNo": "1.0.0"
}

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
    s.connect((HOST, PORT))
    message = json.dumps(payload)
    s.sendall(message.encode('utf-8'))
    print(f"Sent: {message}")

    response = s.recv(4096)
    print(f"Received: {response.decode('utf-8')}")