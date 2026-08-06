package com.aeropure.aeropure_backend.controller;

import com.aeropure.aeropure_backend.model.Command;
import com.aeropure.aeropure_backend.service.CommandService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@CrossOrigin(origins = "*")
public class CommandController {

    private final CommandService commandService;

    public CommandController(CommandService commandService) {
        this.commandService = commandService;
    }

    // POST /send_command
    @PostMapping("/send_command")
    public ResponseEntity<Map<String, Object>> sendCommand(
            @RequestBody Map<String, Object> body) {

        String deviceId = String.valueOf(body.get("deviceID"));
        String supplyStatus = String.valueOf(body.get("supplySTATUS")).toUpperCase();

        if (deviceId.equals("null") || supplyStatus.equals("null")) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", true);
            error.put("message", "deviceID and supplySTATUS are required");
            return ResponseEntity.badRequest().body(error);
        }

        if (!supplyStatus.equals("ON") && !supplyStatus.equals("OFF")) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", true);
            error.put("message", "supplySTATUS must be ON or OFF");
            return ResponseEntity.badRequest().body(error);
        }

        Command command = commandService.queueCommand(deviceId, supplyStatus);

        Map<String, Object> response = new HashMap<>();

        if ("pending".equals(command.getStatus()) || "sent".equals(command.getStatus())) {
            response.put("message", "Command for device " + deviceId +
                    " already " + command.getStatus());
            response.put("data", command);
            return ResponseEntity.ok(response);
        }

        response.put("message", "Command queued successfully");
        return ResponseEntity.ok(response);
    }

    // GET /poll_command_status
    @GetMapping("/poll_command_status")
    public ResponseEntity<Map<String, Object>> pollCommandStatus(
            @RequestParam String deviceID) {

        Map<String, Object> response = new HashMap<>();

        Command command = commandService.getLatestCommand(deviceID);

        if (command == null) {
            response.put("status", "none");
            response.put("deviceID", deviceID);
            return ResponseEntity.ok(response);
        }

        String status = command.getStatus();

        switch (status) {
            case "pending" -> {
                response.put("status", "pending");
                response.put("message", "Command waiting to be sent");
            }
            case "sent" -> {
                response.put("status", "sent");
                response.put("message", "Command sent, awaiting device response");
            }
            case "completed" -> {
                response.put("status", "processed");
                response.put("message", "Command understood by device");
                response.put("supplySTATUS", command.getSupplyStatus());
            }
            case "error" -> {
                response.put("status", "error");
                response.put("message", "Command not understood by device");
                response.put("supplySTATUS", command.getSupplyStatus());
                response.put("supplyFAULT", command.getSupplyFault());
            }
            default -> {
                response.put("status", "none");
                response.put("message", "No active commands for this device");
            }
        }

        response.put("deviceID", deviceID);
        return ResponseEntity.ok(response);
    }
}