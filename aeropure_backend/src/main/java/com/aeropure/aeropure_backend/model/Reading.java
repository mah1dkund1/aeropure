package com.aeropure.aeropure_backend.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import com.fasterxml.jackson.annotation.JsonProperty;


import java.time.LocalDateTime;

@Entity
@Table(name = "readings")
@Getter
@Setter

public class Reading {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)

    private Long id;

    private Integer deviceId;


    private Double airTemperature;
    private Double airHumidity;
    private Double atmosPressure;
    private Double windDir;
    private Double windSpeed;
    private Double rainfall;

    @JsonProperty("valuePM_2_5")
    private Integer valuePm2_5;

    @JsonProperty("valuePM_10")
    private Integer valuePm10;

    @JsonProperty("valueCO")
    private Integer valueCo;

    @JsonProperty("valueNO2")
    private Integer valueNo2;

    @JsonProperty("valueSO2")
    private Integer valueSo2;

    @JsonProperty("valueO3")
    private Integer valueO3;
    
    private Integer airQualityIndex;

    private String versionNo;

    private String supplyStatus;
    private String supplyFault;

    private LocalDateTime receivedAt;

}
