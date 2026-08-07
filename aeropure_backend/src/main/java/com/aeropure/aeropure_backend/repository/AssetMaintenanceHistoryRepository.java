package com.aeropure.aeropure_backend.repository;
import com.aeropure.aeropure_backend.model.Asset;

import com.aeropure.aeropure_backend.model.AssetMaintenanceHistory;
import org.springframework.data.jpa.repository.JpaRepository;





public interface AssetMaintenanceHistoryRepository extends JpaRepository<AssetMaintenanceHistory, Long> {
    void deleteByAsset(Asset asset);
}
