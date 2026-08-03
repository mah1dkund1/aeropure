package com.aeropure.aeropure_backend.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "commands")
@Getter
@Setter


public class Command {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String deviceId;
    private String supplyStatus;
    private String status;
    private String supplyFault;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
