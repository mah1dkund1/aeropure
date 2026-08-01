package com.aeropure.aeropure_backend.model;


import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;



import java.time.LocalDateTime;

@Entity
@Table(name="assets")
@Getter
@Setter

public class Asset {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String deviceCode;
    private String name;
    private String type;
    private String location;
    private String stakeholder;
    private String efficiency;
    private Double latitude;
    private Double longitude;
    private String status;

    private LocalDateTime lastActiveAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;







}
