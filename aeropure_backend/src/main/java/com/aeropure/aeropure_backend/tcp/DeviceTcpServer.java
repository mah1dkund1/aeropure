package com.aeropure.aeropure_backend.tcp;

import com.aeropure.aeropure_backend.model.Command;
import com.aeropure.aeropure_backend.model.Reading;
import com.aeropure.aeropure_backend.service.AssetService;
import com.aeropure.aeropure_backend.service.CommandService;
import com.aeropure.aeropure_backend.service.ReadingService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@Component
public class DeviceTcpServer implements CommandLineRunner {

    private static final int PORT = 4367;

    private final ReadingService readingService;
    private final CommandService commandService;
    private final AssetService assetService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public DeviceTcpServer(ReadingService readingService,
                           CommandService commandService,
                           AssetService assetService) {
        this.readingService = readingService;
        this.commandService = commandService;
        this.assetService = assetService;
    }

    @Override
    public void run(String... args) {
        Thread serverThread = new Thread(this::startServer);
        serverThread.setDaemon(true);
        serverThread.start();
    }

    private void startServer() {
        try (ServerSocket serverSocket = new ServerSocket(PORT)) {
            System.out.println("🚀 Device TCP server listening on port " + PORT);

            while (true) {
                Socket clientSocket = serverSocket.accept();
                Thread handlerThread = new Thread(() -> handleConnection(clientSocket));
                handlerThread.setDaemon(true);
                handlerThread.start();
            }
        } catch (IOException e) {
            System.err.println("🔥 TCP server failed to start: " + e.getMessage());
        }
    }

    private void handleConnection(Socket socket) {
        System.out.println("🔌 Device connected from " + socket.getRemoteSocketAddress());

        try (InputStream input = socket.getInputStream();
             OutputStream output = socket.getOutputStream()) {

            byte[] buffer = new byte[8192];

            while (true) {
                int bytesRead = input.read(buffer);
                if (bytesRead == -1) {
                    System.out.println("🔌 Device disconnected: " + socket.getRemoteSocketAddress());
                    break;
                }

                String dataStr = new String(buffer, 0, bytesRead, "UTF-8").trim();
                if (dataStr.isEmpty()) continue;

                processMessage(dataStr, output);
            }

        } catch (IOException e) {
            System.err.println("🔥 Connection error: " + e.getMessage());
        } finally {
            try {
                socket.close();
            } catch (IOException ignored) {}
        }
    }

    @SuppressWarnings("unchecked")
    private void processMessage(String dataStr, OutputStream output) {
        try {
            Map<String, Object> payload = objectMapper.readValue(dataStr, Map.class);

            if (payload.containsKey("PacketReceived")) {
                System.out.println("🟡 Ignored confirmation packet: " + payload);
                return;
            }

            Object deviceIdRaw = payload.get("deviceID");
            if (deviceIdRaw == null) {
                System.out.println("⚠️ Missing deviceID in payload, skipping");
                return;
            }

            String deviceId = String.valueOf(deviceIdRaw);
            Integer deviceIdInt = Integer.parseInt(deviceId);

            // Device 225 special AQI relay — deferred for now
            if (deviceId.equals("225")) {
                System.out.println("ℹ️ Device 225 logic not yet implemented — skipping");
                return;
            }

            // Build and save the Reading
            Reading reading = buildReadingFromPayload(payload, deviceIdInt);
            Reading saved = readingService.saveReading(reading);

            assetService.markAssetActive(deviceId);

            // Send ACK back to device
            Map<String, Object> ack = new HashMap<>();
            ack.put("status", "success");
            ack.put("deviceID", deviceId);
            ack.put("recordID", saved.getId());
            String ackJson = objectMapper.writeValueAsString(ack) + "\n";
            output.write(ackJson.getBytes("UTF-8"));
            output.flush();

            System.out.println("✅ Stored payload from device " + deviceId);

            // Check for pending command, send if found
            Optional<Command> pending = commandService.getPendingCommand(deviceId);
            if (pending.isPresent()) {
                Map<String, Object> commandMsg = new HashMap<>();
                commandMsg.put("supplyPOWER", pending.get().getSupplyStatus());
                String commandJson = objectMapper.writeValueAsString(commandMsg) + "\n";
                output.write(commandJson.getBytes("UTF-8"));
                output.flush();

                commandService.markSent(pending.get());
                System.out.println("📤 Sent command to device " + deviceId);
            } else {
                // Check if a previously-sent command needs evaluating
                Object actualStatus = payload.get("supplySTATUS");
                Object fault = payload.get("supplyFAULT");
                if (actualStatus != null) {
                    commandService.evaluateOutcome(deviceId,
                            String.valueOf(actualStatus),
                            fault != null ? String.valueOf(fault) : null);
                }
            }

        } catch (Exception e) {
            System.err.println("🔥 Error processing message: " + e.getMessage());
        }
    }

    private Reading buildReadingFromPayload(Map<String, Object> payload, Integer deviceId) {
        Reading reading = new Reading();
        reading.setDeviceId(deviceId);
        reading.setAirTemperature(getDouble(payload, "airTemperature"));
        reading.setAirHumidity(getDouble(payload, "airHumidity"));
        reading.setAtmosPressure(getDouble(payload, "atmosPressure"));
        reading.setWindDir(getDouble(payload, "windDir"));
        reading.setWindSpeed(getDouble(payload, "windSpeed"));
        reading.setRainfall(getDouble(payload, "rainfall"));
        reading.setValuePm2_5(getInteger(payload, "valuePM_2_5"));
        reading.setValuePm10(getInteger(payload, "valuePM_10"));
        reading.setValueCo(getInteger(payload, "valueCO"));
        reading.setValueNo2(getInteger(payload, "valueNO2"));
        reading.setValueSo2(getInteger(payload, "valueSO2"));
        reading.setValueO3(getInteger(payload, "valueO3"));
        reading.setAirQualityIndex(getInteger(payload, "airQualityIndex"));
        reading.setVersionNo((String) payload.get("versionNo"));
        reading.setSupplyStatus((String) payload.get("supplySTATUS"));
        reading.setSupplyFault((String) payload.get("supplyFAULT"));
        return reading;
    }

    private Double getDouble(Map<String, Object> payload, String key) {
        Object val = payload.get(key);
        if (val == null) return null;
        return Double.valueOf(val.toString());
    }

    private Integer getInteger(Map<String, Object> payload, String key) {
        Object val = payload.get(key);
        if (val == null) return null;
        return (int) Double.parseDouble(val.toString());
    }
}