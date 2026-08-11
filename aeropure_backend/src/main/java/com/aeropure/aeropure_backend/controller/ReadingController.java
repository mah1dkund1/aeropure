package com.aeropure.aeropure_backend.controller;

import com.aeropure.aeropure_backend.model.Reading;
import com.aeropure.aeropure_backend.service.ReadingService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@CrossOrigin(origins ="*")

public class ReadingController {
    private final ReadingService readingService;

    public ReadingController(ReadingService readingService) {
        this.readingService = readingService;
    }
    @GetMapping("/data")
    public ResponseEntity<Map<String, Object>> getData(
            @RequestParam(required = false) Integer deviceID,
            @RequestParam(required = false) String start,
            @RequestParam(required = false) String end,
            @RequestParam(defaultValue = "10") int limit) {

        List<Reading> data;

        // if a range is given, filter by it; otherwise newest N
        if (start != null && end != null) {
            LocalDateTime startUtc = parseUtc(start);
            LocalDateTime endUtc = parseUtc(end);
            data = readingService.getReadingsInRange(deviceID, startUtc, endUtc, limit);
        } else {
            data = readingService.getReadings(deviceID, limit);
        }

        long total = readingService.countReadings(deviceID);
        long remaining = Math.max(total - limit, 0);

        Map<String, Object> response = new HashMap<>();
        response.put("total", total);
        response.put("limit", limit);
        response.put("remaining", remaining);
        response.put("data", data);

        return ResponseEntity.ok(response);
    }

    private LocalDateTime parseUtc(String s) {
        return LocalDateTime.parse(s.replace("Z", ""));
    }


    // POST data/ range

    @PostMapping("/data/range")
    public ResponseEntity<Map<String, Object>> getDataByRange(
            @RequestBody Map<String, Object> body){
        List<Map<String, Object>> devices = (List<Map<String, Object>>)
body.get("devices")  ;


        if (devices == null || devices.isEmpty()) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "devices must be a list");
            return ResponseEntity.badRequest().body(error);
        }

        ZoneId pkt = ZoneId.of("Asia/Karachi");
        ZoneId utc = ZoneId.of("UTC");
        List<Map<String, Object>> results = new ArrayList<>();

        for (Map<String, Object> device : devices) {
            Integer deviceId = (Integer) device.get("deviceID");
            if (deviceId == null) continue;

            LocalDateTime startUtc;
            LocalDateTime endUtc;

            String startStr = (String) device.get("start_date");
            String endStr = (String) device.get("end_date");

            if (startStr != null && endStr != null) {
                startUtc = LocalDateTime.parse(startStr)
                        .atZone(pkt).withZoneSameInstant(utc).toLocalDateTime();
                endUtc = LocalDateTime.parse(endStr)
                        .atZone(pkt).withZoneSameInstant(utc).toLocalDateTime();
            } else {
                endUtc = LocalDateTime.now(utc);
                startUtc = endUtc.minusHours(24);
            }

            List<Reading> data = readingService.getReadingsInRange(deviceId, startUtc, endUtc);

            Map<String, Object> result = new HashMap<>();
            result.put("deviceID", deviceId);
            result.put("start_utc", startUtc.toString());
            result.put("end_utc", endUtc.toString());
            result.put("count", data.size());
            result.put("data", data);
            results.add(result);
        }

        Map<String, Object> response = new HashMap<>();
        response.put("results", results);
        return ResponseEntity.ok(response);
    }

    // GET /getDevices
    @GetMapping("/getDevices")
    public ResponseEntity<Map<String, Object>> getDevices() {
        List<Integer> deviceIds = readingService.getDistinctDeviceIds();
        Map<String, Object> response = new HashMap<>();
        response.put("deviceIDs", deviceIds);
        return ResponseEntity.ok(response);
    }

    // DELETE /deleteDataBasedOnDeviceId/{deviceId}
    @DeleteMapping("/deleteDataBasedOnDeviceId/{deviceId}")
    public ResponseEntity<Map<String, Object>> deleteByDeviceId(
            @PathVariable Integer deviceId) {

        readingService.deleteReadingsByDeviceId(deviceId);

        Map<String, Object> response = new HashMap<>();
        response.put("message", "Deleted records for deviceID " + deviceId);
        return ResponseEntity.ok(response);
    }





}
