package com.aeropure.aeropure_backend.dto;

import com.aeropure.aeropure_backend.model.Asset;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.Setter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.HashMap;

import java.time.LocalDateTime;

@Getter
@Setter
public class AssetResponse {

    // frontend keys off _id
    @JsonProperty("_id")
    private String id;

    private String name;
    private String type;
    private String location;
    private String stakeholder;
    private String efficiency;

    private String deviceId;   // was deviceCode
    private String lat;        // was latitude

    @JsonProperty("long")
    private String long_;      // was longitude, see annotation below

    private String status;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private LocalDateTime lastActiveAt;

    private List<Map<String, Object>> maintenanceHistory = new ArrayList<>();
    private List<String> images = new ArrayList<>();



    // build a response from an asset
    public static AssetResponse from(Asset a) {
        AssetResponse r = new AssetResponse();
        r.setId(a.getId() != null ? a.getId().toString() : null);
        r.setName(a.getName());
        r.setType(a.getType());
        r.setLocation(a.getLocation());
        r.setStakeholder(a.getStakeholder());
        r.setEfficiency(a.getEfficiency());
        r.setDeviceId(a.getDeviceCode());
        r.setLat(a.getLatitude() != null ? a.getLatitude().toString() : null);
        r.setLong_(a.getLongitude() != null ? a.getLongitude().toString() : null);
        r.setStatus(a.getStatus());
        r.setCreatedAt(a.getCreatedAt());
        r.setUpdatedAt(a.getUpdatedAt());
        r.setLastActiveAt(a.getLastActiveAt());
        return r;
    }
}