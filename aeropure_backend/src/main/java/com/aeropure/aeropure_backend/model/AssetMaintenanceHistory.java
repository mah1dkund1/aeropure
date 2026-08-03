package com.aeropure.aeropure_backend.model;


import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "asset_maintenance_history")
@Getter
@Setter

public class AssetMaintenanceHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name= "asset_id", nullable = false)
    private Asset asset;

    private String action;
    private LocalDateTime date;



}
