package com.aeropure.aeropure_backend.repository;

import com.aeropure.aeropure_backend.model.Asset;

import com.aeropure.aeropure_backend.model.AssetImage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;


public interface AssetImageRepository extends JpaRepository<AssetImage,Long> {


    List<AssetImage> findByAsset(Asset asset);

    void deleteByAsset(Asset asset);
}
