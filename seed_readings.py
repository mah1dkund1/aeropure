import socket
import json
import random
import time

HOST = "localhost"
PORT = 4367
DEVICE_ID = 1
COUNT = 15

# rough baselines, we vary around these
base = {
    "airTemperature": 25.0, "airHumidity": 60.0, "atmosPressure": 1013.0,
    "windDir": 180.0, "windSpeed": 5.0, "rainfall": 0.0,
    "valuePM_2_5": 12, "valuePM_10": 20, "valueCO": 1,
    "valueNO2": 8, "valueSO2": 4, "valueO3": 15, "airQualityIndex": 42,
}

def jitter(val, pct=0.3):
    # wobble a value up or down
    delta = val * pct
    return round(random.uniform(val - delta, val + delta), 1)

for i in range(COUNT):
    payload = {"deviceID": DEVICE_ID, "versionNo": "1.0.0"}
    for k, v in base.items():
        payload[k] = jitter(v) if isinstance(v, float) else int(jitter(v))

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect((HOST, PORT))
    s.sendall(json.dumps(payload).encode("utf-8"))
    resp = s.recv(1024).decode("utf-8").strip()
    s.close()

    print(f"[{i+1}/{COUNT}] sent AQI={payload['airQualityIndex']} -> {resp}")
    time.sleep(0.3)

print("done")