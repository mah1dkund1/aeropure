package com.aeropure.aeropure_backend.repository;

import com.aeropure.aeropure_backend.model.AssetDocument;
import org.springframework.data.jpa.repository.JpaRepository;





public interface AssetMaintenanceHistoryRepository extends JpaRepository<AssetDocument, Long> {
}
