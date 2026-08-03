package com.aeropure.aeropure_backend.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "readings")
@Getter
@Setter

public class Reading {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)

    private Long id;

    private Double airTemperature;
    private Double airHumidity;
    private Double atmosPressure;
    private Double windDir;
    private Double windSpeed;
    private Double rainfall;

    private Integer valuePm2_5;
    private Integer valuePm10;
    private Integer valueCo;
    private Integer valueNo2;
    private Integer valueSo2;
    private Integer valueO3;
    private Integer airQualityIndex;

    private String versionNo;

    private String supplyStatus;
    private String supplyFault;

    private LocalDateTime receivedAt;

}
