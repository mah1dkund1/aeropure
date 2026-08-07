package com.aeropure.aeropure_backend.repository;

import com.aeropure.aeropure_backend.model.AssetDocument;
import org.springframework.data.jpa.repository.JpaRepository;
import com.aeropure.aeropure_backend.model.Asset;


public interface AssetDocumentRepository extends JpaRepository<AssetDocument, Long> {

    void deleteByAsset(Asset asset);

}
