
import logging
import json
import datetime
from werkzeug.utils import secure_filename
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from pymongo import MongoClient
import socket
import threading
import os
from bson.objectid import ObjectId
from bson.errors import InvalidId
import time



# ----------------------------
# 🔧 Basic Flask Setup (for API only)
# ----------------------------
app = Flask(__name__)

# 🌐 Enable CORS for all routes
CORS(app, resources={r"/*": {"origins": "*"}})



# Enable basic logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('aeropure_server.log'),
        logging.StreamHandler()
    ]
)
device_connections = {}  # { deviceID: socket_connection }

# ----------------------------
# 🧠 MongoDB Setup
# ----------------------------
MONGO_URI = "mongodb://localhost:27017/aeropure_db"  # change if needed
client = MongoClient(MONGO_URI)
db = client.get_database()
weather_collection = db["weather_data"]
assets_collection = db["assets"]   # dedicated collection for assets

UPLOAD_FOLDER = './uploads/assets'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Allowed file types for upload
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'pdf', 'docx'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def serialize_asset(doc):
    """Convert MongoDB document to JSON serializable dict."""
    doc["_id"] = str(doc["_id"])
    return doc





@app.route('/assets', methods=['POST'])
def create_asset():
    """
    Add a new asset/device.
    Body JSON:
      - name, type, location, stakeholder, efficiency, maintenanceHistory (list)
    """
    try:
        data = request.form.to_dict() or request.json
        if not data or "name" not in data:
            return jsonify({"error": "Missing required fields"}), 400

        asset = {
            "id": data.get("id"),
            "name": data.get("name"),
            "type": data.get("type"),
            "location": data.get("location"),
            "stakeholder": data.get("stakeholder"),
            "efficiency": data.get("efficiency"),
            
            "createdAt": datetime.datetime.utcnow(),
            "updatedAt": datetime.datetime.utcnow(),
            "lat":data.get("latitude"),
            "long": data.get("longitude"),
            "documents": [],
            "images": [],
            "maintenanceHistory": [
                {
                    "action": "Added in the system",
                    "date": datetime.datetime.utcnow().isoformat()
                }
            ]
        }

        # Handle file uploads
        if 'files' in request.files:
            for file in request.files.getlist('files'):
                if file and allowed_file(file.filename):
                    filename = secure_filename(file.filename)
                    file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
                    ext = filename.rsplit('.', 1)[1].lower()
                    if ext in ['png', 'jpg', 'jpeg', 'gif']:
                        asset["images"].append(filename)
                    else:
                        asset["documents"].append(filename)

        result = assets_collection.insert_one(asset)
        return jsonify({"message": "Asset created", "id": str(result.inserted_id)}), 201

    except Exception as e:
        logging.exception("🔥 Error creating asset")
        return jsonify({"error": str(e)}), 500

# ----------------------------
# 🟡 READ — List Assets with Search, Filter & Pagination
# ----------------------------
@app.route('/assets', methods=['GET'])
def list_assets():
    """
    Query parameters:
      - search: keyword search in name/location/stakeholder
      - type: filter by type
      - page: page number (default 1)
      - pageSize: items per page (default 10)
    """
    try:
        search = request.args.get('search')
        asset_type = request.args.get('type')
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('pageSize', 10))

        query = {}
        if asset_type:
            query["type"] = asset_type

        if search:
            query["$or"] = [
                {"name": {"$regex": search, "$options": "i"}},
                {"location": {"$regex": search, "$options": "i"}},
                {"stakeholder": {"$regex": search, "$options": "i"}}
            ]

        total = assets_collection.count_documents(query)
        cursor = assets_collection.find(query).sort("createdAt", -1).skip((page - 1) * page_size).limit(page_size)

        results = [serialize_asset(doc) for doc in cursor]

        return jsonify({
            "total": total,
            "page": page,
            "pageSize": page_size,
            "items": results
        }), 200

    except Exception as e:
        logging.exception("🔥 Error fetching assets")
        return jsonify({"error": str(e)}), 500

# ----------------------------
# 🟡 READ — Get Asset by ID
# ----------------------------
@app.route('/assets/<asset_id>', methods=['GET'])
def get_asset(asset_id):
    try:
        doc = assets_collection.find_one({"_id": ObjectId(asset_id)})
        if not doc:
            return jsonify({"error": "Asset not found"}), 404
        return jsonify(serialize_asset(doc)), 200
    except Exception as e:
        logging.exception("🔥 Error fetching asset by ID")
        return jsonify({"error": str(e)}), 500

# ----------------------------
# 🔵 UPDATE — Edit Asset
# ----------------------------
@app.route('/assets/<asset_id>', methods=['PUT', 'PATCH'])
def update_asset(asset_id):
    """
    Update asset info (name, type, location, stakeholder, efficiency, etc.)
    Also supports:
      - Appending to maintenanceHistory if 'action' is provided
      - Uploading files (images/documents) via multipart/form-data
    """
    try:
        # ✅ Validate ObjectId
        try:
            oid = ObjectId(asset_id)
        except InvalidId:
            return jsonify({"error": "Invalid asset ID"}), 400

        # ✅ Extract data (form-data or JSON)
        data = request.form.to_dict() or request.json or {}

        # ✅ Prepare $set fields (regular fields only)
        update_fields = {
            k: v for k, v in data.items()
            if k not in ['_id', 'createdAt', 'maintenanceHistory', 'action']
        }

        # ✅ Always update updatedAt
        update_fields["updatedAt"] = datetime.datetime.utcnow()

        # ✅ Prepare $push operations (for arrays)
        push_operations = {}

        # 🧰 If action is provided, append a new maintenance record
        if "action" in data and data["action"].strip():
            push_operations["maintenanceHistory"] = {
                "action": data["action"].strip(),
                "date": datetime.datetime.utcnow().isoformat()
            }

        # 📁 Handle file uploads (optional)
        if 'files' in request.files:
            images, documents = [], []
            for file in request.files.getlist('files'):
                if file and allowed_file(file.filename):
                    filename = secure_filename(file.filename)
                    file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
                    ext = filename.rsplit('.', 1)[1].lower()
                    if ext in ['png', 'jpg', 'jpeg', 'gif']:
                        images.append(filename)
                    else:
                        documents.append(filename)

            if images:
                push_operations["images"] = {"$each": images}
            if documents:
                push_operations["documents"] = {"$each": documents}

        # ✅ Build MongoDB update query
        mongo_update = {"$set": update_fields}
        if push_operations:
            mongo_update["$push"] = push_operations

        # ✅ Perform update
        result = assets_collection.update_one({"_id": oid}, mongo_update)

        if result.matched_count == 0:
            return jsonify({"error": "Asset not found"}), 404

        return jsonify({"message": "Asset updated successfully"}), 200

    except Exception as e:
        logging.exception("🔥 Error updating asset")
        return jsonify({"error": str(e)}), 500


# ----------------------------
# 🔴 DELETE — Remove Asset
# ----------------------------
@app.route('/assets/<asset_id>', methods=['DELETE'])
def delete_asset(asset_id):
    try:
        result = assets_collection.delete_one({"_id": ObjectId(asset_id)})
        if result.deleted_count == 0:
            return jsonify({"error": "Asset not found"}), 404
        return jsonify({"message": "Asset deleted"}), 200
    except Exception as e:
        logging.exception("🔥 Error deleting asset")
        return jsonify({"error": str(e)}), 500

# ----------------------------
# 📤 Serve Uploaded Files
# ----------------------------
@app.route('/assets/files/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)



# ----------------------------
# 🔌 Raw TCP Socket Server for Device Data (Port 4367)
# ----------------------------
from bson import ObjectId
import datetime

def serialize_mongo_fields(doc):
    """Convert all datetime and ObjectId fields in a dict to JSON-serializable formats."""
    if not doc:
        return None
    for key, value in doc.items():
        if isinstance(value, datetime.datetime):
            doc[key] = value.isoformat()
        elif isinstance(value, ObjectId):
            doc[key] = str(value)
        elif isinstance(value, dict):
            doc[key] = serialize_mongo_fields(value)
        elif isinstance(value, list):
            doc[key] = [serialize_mongo_fields(item) if isinstance(item, dict) else item for item in value]
    return doc

def get_aqi_data():
    try:
        # Get most recent data for device 152
        device_152_data = weather_collection.find_one(
            {"deviceID": 152},
            sort=[("receivedAt", -1)]
        )

        five_minutes_ago = datetime.datetime.utcnow() - datetime.timedelta(minutes=5)

        
        
        # Pipeline for latest data per device
        # 
        pipeline = [
            {
                "$addFields": {
                    "receivedAtDate": {
                        "$cond": [
                            { "$eq": [ { "$type": "$receivedAt" }, "string" ] },
                            {
                                "$dateFromString": {
                                    "dateString": "$receivedAt"
                                }
                            },
                            "$receivedAt"  # already a date, use directly
                        ]
                    }
                }
            },
            {"$match": {"receivedAtDate": {"$gte": five_minutes_ago}}},
            {"$sort": {"receivedAtDate": -1}},
            {
                "$group": {
                    "_id": "$deviceID",
                    "latestData": { "$first": "$$ROOT" }
                }
            },
            { "$replaceRoot": { "newRoot": "$latestData" } }
        ]



        all_latest = list(weather_collection.aggregate(pipeline))

        logging.info(f"Total devices with recent data: {len(all_latest)}")

        # Find worst AQI device
        worst_aqi_device = None
        max_aqi = -1

        for device in all_latest:
            device["_id"] = str(device["_id"])
            if device.get("deviceID") == 152 or device.get("deviceID") == "152":
                continue  # skip device 152 for worst AQI calculation
            current_aqi = device.get("airQualityIndex", 0)
            logging.info(f"🔹 Device {device.get('deviceID', 'unknown')} AQI: {current_aqi}")
            if current_aqi > max_aqi:
                max_aqi = current_aqi
                worst_aqi_device = device

        # Serialize datetime fields to ISO strings
        device_152_data = serialize_mongo_fields(device_152_data)
        
        
        worst_aqi_device = serialize_mongo_fields(worst_aqi_device)

        #logging.info(f"Device 152 data fetched {device_152_data}")
        #logging.info(f"Worst AQI device fetched {worst_aqi_device}")

        return device_152_data, worst_aqi_device

    except Exception as e:
        logging.exception("🔥 Error preparing AQI data for device 225")
        return None, None

def handle_device_connection(conn, addr):
    """Handle individual device TCP connection."""
    logging.info(f"🔌 Device connected from {addr}")
    
    try:
        while True:
            # Receive data (up to 4KB per message)
            data = conn.recv(8192)

            
            
            if not data:
                logging.info(f"🔌 Device {addr} disconnected")
            
                break
            logging.info(f"📦 Raw data length: {len(data)} bytes from {addr}")
            data_str = data.decode('utf-8').strip()
            logging.info(f"📦 Received from {addr}: {data_str[:200]}...")

            try:
                payload = json.loads(data_str)
                payload["receivedAt"] = datetime.datetime.utcnow()

                

                if "PacketReceived" in payload:
                    device_id = payload.get("deviceID", "unknown")
                    logging.info(f"🟡 Ignored confirmation packet from device {device_id}: {payload}")
                    continue  # Skip processing 
                    
                if "deviceID" in payload and (payload["deviceID"] == 225 or payload["deviceID"] =="225"):
                    try:
                        logging.exception("In 225")
                        device_152, worst_device= get_aqi_data()
                        #logging.exception(f" device 152 {device_152} worst device {worst_device}")
                        if device_152 is None or worst_device is None:
                            logging.error("either device 152 is None or worst device is None")
                            continue

                        logging.info(f"device 152 data: {device_152}")
                        aqi_152 = device_152.get("airQualityIndex", 0)

                        worst_aqi = worst_device.get("airQualityIndex", 0)

                        logging.info(f"before Device 152 AQI: {aqi_152}, Worst AQI: {worst_aqi}")
                        aqi_152 = int(float(aqi_152) * 0.6)

                        logging.info(f"after Device 152 AQI adjusted: {aqi_152}, Worst AQI: {worst_aqi}")


                        # Format packet as {DDDDDWWWWW} with leading zeros
                        packet = f"{{{int(aqi_152):05d}{int(worst_aqi):05d}}}"

                        logging.info(f"Prepared AQI packet for device 225: {packet}")
                        conn.sendall(packet.encode('utf-8'))
                        logging.info(f"📤 Sent AQI data to device 225")
                        continue
                    except Exception as e:
                        logging.exception(f"🔥 Error preparing AQI data for device 225: {e}")
                        return
                # Insert into MongoDB
                result = weather_collection.insert_one(payload)
                device_id = payload.get('deviceID', 'unknown')
                logging.info(f"✅ Stored payload from device {device_id}")

                update_asset_activity(device_id)

                # Send acknowledgement back to device
                ack = json.dumps({
                    "status": "success",
                    "deviceID": device_id,
                    "recordID": str(result.inserted_id)
                }) + "\n"
                
                conn.sendall(ack.encode('utf-8'))
                
                send_pending_supply_status(conn, device_id, payload)
                #mark_command_completed(device_id, payload.get("supplySTATUS"),payload)
                
                
                logging.info(f"📤 Sent ACK to device {device_id}")

            except json.JSONDecodeError:
                logging.warning(f"❌ Invalid JSON from {addr}: {data_str}")
                conn.sendall(b'{"status":"error","message":"Invalid JSON"}\n')
            except Exception as e:
                logging.exception(f"🔥 Error processing data from {addr}: {e}")
                conn.sendall(f'{{"status":"error","message":"{str(e)}"}}\n'.encode('utf-8'))

    except Exception as e:
        logging.exception(f"🔥 Connection error with {addr}: {e}")
    finally:
        conn.close()
        logging.info(f"🔌 Connection closed with {addr}")


@app.route("/deleteDataBasedOnDeviceId/<int:device_id>", methods=["DELETE"])
def delete_data_based_on_device_id(device_id):
    """
    Delete weather data records based on deviceID.
    """
    try:
        result = weather_collection.delete_many({"deviceID": device_id})
        return jsonify({
            "message": f"Deleted {result.deleted_count} records for deviceID {device_id}"
        }), 200
    except Exception as e:  
        logging.exception(f"🔥 Error deleting data for deviceID {device_id}")
        return jsonify({"error": str(e)}), 500


def update_asset_activity(device_id):
    """Update asset's last active time when device sends data (based on deviceID)."""
    try:
        asset = assets_collection.find_one({"id": str(device_id)})
        now = datetime.datetime.utcnow()

        if asset:
            prev_status = asset.get("status", "unknown")

            assets_collection.update_one(
                {"id": str(device_id)},
                {"$set": {"lastActiveAt": now, "status": "active"}}
            )

            if prev_status == "inactive":
                logging.info(f"🟢 Asset {device_id} reactivated (now active)")
        else:
            logging.warning(f"⚠️ No asset found for DeviceID {device_id}")

    except Exception as e:
        logging.exception(f"🔥 Failed to update asset activity for {device_id}: {e}")


def monitor_assets_status():
    """Continuously check for inactive assets (no data for >10 seconds)."""
    while True:
        try:
            now = datetime.datetime.utcnow()
            threshold_time = now - datetime.timedelta(seconds=120)

            result = assets_collection.update_many(
                {"lastActiveAt": {"$lt": threshold_time}},
                {"$set": {"status": "inactive"}}
            )

            if result.modified_count > 0:
                logging.info(f"🔴 Marked {result.modified_count} assets inactive")

        except Exception as e:
            logging.exception(f"🔥 Error during asset status monitoring: {e}")

        # Sleep before next check
        time.sleep(15)

def run_device_tcp_server(host='0.0.0.0', port=4367):
    """Run TCP server for device connections on port 4367."""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((host, port))
    server.listen(10)
    
    logging.info(f"🚀 Device TCP server listening on {host}:{port}")
    
    while True:
        try:
            conn, addr = server.accept()
            # Handle each device connection in a separate thread
            thread = threading.Thread(target=handle_device_connection, args=(conn, addr))
            thread.daemon = True
            thread.start()
        except Exception as e:
            logging.exception(f"🔥 Error accepting connection: {e}")


# ----------------------------
# 🌐 Health check route (Flask API on different port)
# ----------------------------
@app.route('/')
def index():
    return jsonify({"aeropure": "listening"}), 200


# ----------------------------
# 🌦️ HTTP GET Endpoint for fetching stored device data
# ----------------------------
@app.route('/data', methods=['GET'])
def get_data():
    """
    Fetch stored weather data from MongoDB.
    Optional query parameters:
      - deviceID: filter by specific device ID
      - limit: number of records to return (default 10)
    Response includes:
      - total: total matching records
      - limit: number returned
      - remaining: total - limit
      - data: list of records
    """
    try:
        # Read query params
        device_id = request.args.get("deviceID", type=int)
        limit = request.args.get("limit", default=10, type=int)

        # Build query
        query = {}
        if device_id is not None:
            query["deviceID"] = device_id

        # Total number of records matching query
        total = weather_collection.count_documents(query)

        # Fetch data sorted by most recent
        cursor = weather_collection.find(query).sort("receivedAt", -1).limit(limit)
        data = []
        for doc in cursor:
            doc["_id"] = str(doc["_id"])  # Convert ObjectId for JSON serialization
            data.append(doc)

        # Calculate remaining
        remaining = max(total - limit, 0)

        return jsonify({
            "total": total,
            "limit": limit,
            "remaining": remaining,
            "data": data
        }), 200

    except Exception as e:
        logging.exception("🔥 Error in GET /data")
        return jsonify({"error": str(e)}), 500

@app.route('/data/range', methods=['POST'])
def get_data_per_device_timeframe():
    import pytz
    from datetime import datetime, timedelta
    """
    Each device can send its own start_date & end_date (PKT).
    If missing → last 24 hours for that device.
    """

    try:
        payload = request.get_json(force=True)

        devices = payload.get("devices")
        if not devices or not isinstance(devices, list):
            return jsonify({"error": "devices must be a list"}), 400

        pkt = pytz.timezone("Asia/Karachi")
        utc = pytz.UTC

        response = []

        for device in devices:
            device_id = device.get("deviceID")
            if device_id is None:
                continue

            start_date_str = device.get("start_date")
            end_date_str = device.get("end_date")

            # -------- Date handling per device --------
            if start_date_str and end_date_str:
                start_pkt = pkt.localize(datetime.fromisoformat(start_date_str))
                end_pkt = pkt.localize(datetime.fromisoformat(end_date_str))

                start_utc = start_pkt.astimezone(utc)
                end_utc = end_pkt.astimezone(utc)
            else:
                end_utc = datetime.utcnow().replace(tzinfo=utc)
                start_utc = end_utc - timedelta(hours=24)

            query = {
                "deviceID": int(device_id),
                "receivedAt": {
                    "$gte": start_utc,
                    "$lte": end_utc
                }
            }

            cursor = weather_collection.find(query).sort("receivedAt", -1)

            data = []
            for doc in cursor:
                doc["_id"] = str(doc["_id"])
                data.append(doc)

            response.append({
                "deviceID": device_id,
                "start_utc": start_utc.isoformat(),
                "end_utc": end_utc.isoformat(),
                "count": len(data),
                "data": data
            })

        return jsonify({"results": response}), 200

    except Exception as e:
        logging.exception("🔥 Error in POST /data/range")
        return jsonify({"error": str(e)}), 500

@app.route('/getDevices', methods=['GET'])
def get_devices():
    """
    Fetch list of unique deviceIDs from weather data.
    """
    try:
        device_ids = weather_collection.distinct("deviceID")
        
        
        return jsonify({"deviceIDs": device_ids}), 200
    except Exception as e:
        logging.exception("🔥 Error in GET /getDevices")
        return jsonify({"error": str(e)}), 500

# ----------------------------
# 🚨 Error Handler
# ----------------------------
@app.errorhandler(Exception)
def handle_exception(e):
    """Log unexpected errors."""
    logging.exception("🔥 Unhandled Exception")
    return jsonify({"error": str(e)}), 500

DATA_FILE = "commands.json"

if not os.path.exists(DATA_FILE):
    with open(DATA_FILE, "w") as f:
        json.dump([], f)



DATA_FILE = "commands.json"

# Ensure file exists
if not os.path.exists(DATA_FILE):
    with open(DATA_FILE, "w") as f:
        json.dump([], f, indent=4)


@app.route('/send_command', methods=['POST'])
def send_command():
    """
    Create or update a device command.
    Body: { "deviceID": "152", "supplySTATUS": "ON" }
    """
    try:
        body = request.get_json(force=True)
        device_id = str(body.get('deviceID'))
        supply_status = str(body.get('supplySTATUS')).upper()

        logging.error(f"send command {device_id} {supply_status}")

        if not device_id or not supply_status:
            return jsonify({"error": "deviceID and supplySTATUS are required"}), 400

        # Load JSON
        with open(DATA_FILE, "r") as f:
            commands = json.load(f)

        # Check if there's already a command for this device
        existing = next((cmd for cmd in commands if cmd["deviceID"] == device_id), None)

        if existing:
            if existing["status"] in ["pending", "sent"]:
                # Already being processed
                logging.info(f"⚙️ Command for device {device_id} already in process ({existing['status']})")
                return jsonify({
                    "message": f"Command for device {device_id} already {existing['status']}",
                    "data": existing
                }), 200
            else:
                # Update if completed or errored
                existing["supplySTATUS"] = supply_status
                existing["status"] = "pending"
        else:
            # New command entry
            commands.append({
                "deviceID": device_id,
                "supplySTATUS": supply_status,
                "status": "pending"
            })

        with open(DATA_FILE, "w") as f:
            json.dump(commands, f, indent=4)

        logging.info(f"📝 Command queued for device {device_id}: {supply_status}")
        return jsonify({"message": "Command queued successfully"}), 200

    except Exception as e:
        logging.exception("🔥 Error in /send_command")
        return jsonify({"error": str(e)}), 500




def send_pending_supply_status(conn, device_id, payload):
    
    """
    Sends any pending supplySTATUS command for this device.
    Does NOT wait for acknowledgment.
    """
    try:
        with open(DATA_FILE, "r") as f:
            data = json.load(f)
        
        for record in data:
            if record.get("deviceID") == str(device_id) and record.get("status") == "pending":
                supply_status = record.get("supplySTATUS")
                message = json.dumps({
                    "supplyPOWER": supply_status
                }) + "\n"

                conn.sendall(message.encode('utf-8'))
                record["status"] = "sent"
                
                logging.info(f"📤 Sent command '{supply_status}' to device {device_id}")
                with open(DATA_FILE, "w") as f:
                    json.dump(data, f, indent=4)
                
                
                break
            elif record.get("deviceID") == str(device_id) and record.get("status") == "sent":
                intended_status = record.get("supplySTATUS")  # what we told device to do
                actual_status = payload.get("supplySTATUS")   # what device actually reported

                logging.info(f" intended status {intended_status} {actual_status}")

                if intended_status == actual_status:
                    record["status"] = "completed"
                    logging.info(f"✅ Command for device {device_id} marked completed")
                else:
                    record["status"] = "error"
                    record["supplyFAULT"] = payload.get("supplyFAULT")
                    record["supplySTATUS"] = actual_status
                    logging.info(f"⚠️ Command for device {device_id} failed: expected {intended_status}, got {actual_status}")

                # Always save updates
                with open(DATA_FILE, "w") as f:
                    json.dump(data, f, indent=4)
                break

        


        else:
            logging.info(f"ℹ️ No pending commands for device {device_id}")
        

    except Exception as e:
        logging.error(f"❌ Error sending command to device {device_id}: {e}")

def mark_command_completed(device_id, supply_status, payload):
    
    with open(DATA_FILE, "r") as f:
        data = json.load(f)

    for record in data:
        if record.get("deviceID") == str(device_id):
            if record.get("supplySTATUS") == supply_status:
                record["status"] = "completed"
                record["supplySTATUS"] = payload["supplySTATUS"]
                logging.info(f"✅ Command for device {device_id} marked completed")
                
                break
            # elif record.get("supplySTATUS") != supply_status:
            #    record["status"] = "error"
            #    record["supplySTATUS"] = payload["supplySTATUS"]
            #    record["supplyFAULT"] = payload["supplyFAULT"]
            #    logging.info(f" Command for device {device_id} marked not completed")
            #    check = 0
            #    break

        

    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=4)


@app.route('/poll_command_status', methods=['GET'])
def poll_command_status():
    """
    Polling endpoint for a device to check command status.
    Returns:
      - 'pending'   → command waiting to be sent
      - 'sent'      → command sent to device, awaiting response
      - 'processing'→ command is in process (you can customize this)
      - 'none'      → no command currently for this device
    """
    try:
        device_id = request.args.get('deviceID')

        if not device_id:
            return jsonify({"error": "deviceID is required"}), 400

        # Load command data
        if not os.path.exists(DATA_FILE):
            return jsonify({"status": "none"}), 200

        with open(DATA_FILE, "r") as f:
            commands = json.load(f)

        # Find the latest command for this device
        device_cmds = [cmd for cmd in commands if cmd.get("deviceID") == str(device_id)]

        if not device_cmds:
            return jsonify({"status": "none"}), 200

        # Sort if you ever add timestamps later (optional)
        latest_cmd = device_cmds[-1]
        cmd_status = latest_cmd.get("status", "unknown").lower()
        cmd_fault = latest_cmd.get("supplyFAULT","unknown")

        # Determine friendly status
        if cmd_status == "pending":
            result = {"status": "pending", "message": "Command waiting to be sent"}
        elif cmd_status == "sent":
            result = {"status": "sent", "message": "Command sent, awaiting device response"}
        elif cmd_status == "completed":
            cmd_status = latest_cmd.get("supplySTATUS", "unknown")
            result = {"status": "processed", "message": "Command understood by device", "supplySTATUS": cmd_status}
            
            
        elif cmd_status == "error":
            cmd_status = latest_cmd.get("supplySTATUS", "unknown")
            result = {"status": "error", "message": "Command not understood by device", "supplySTATUS": cmd_status, "supplyFAULT": cmd_fault}
        else:
            result = {"status": "none", "message": "No active commands for this device"}

        result["deviceID"] = device_id
        return jsonify(result), 200

    except Exception as e:
        logging.exception("🔥 Error in /poll_command_status")
        return jsonify({"error": str(e)}), 500

    


# ----------------------------
# 🚀 Run the servers
# ----------------------------
if __name__ == "__main__":
    # Start TCP server for devices on port 4367 in background thread
    tcp_thread = threading.Thread(target=run_device_tcp_server, args=('0.0.0.0', 4367))
    tcp_thread.daemon = True
    tcp_thread.start()
    
    monitor_thread = threading.Thread(target=monitor_assets_status, daemon=True)
    monitor_thread.start()
    
    # Run Flask API on port 8001
    app.run(host="0.0.0.0", port=8001, debug=False)