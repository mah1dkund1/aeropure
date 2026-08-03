package com.aeropure.aeropure_backend.model;


import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "asset_documents")
@Getter
@Setter




public class AssetDocument {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "asset_id" , nullable = false)
    private Asset asset;

    private String filename;



}
