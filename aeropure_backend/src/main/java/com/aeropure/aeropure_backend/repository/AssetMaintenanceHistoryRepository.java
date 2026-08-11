package com.aeropure.aeropure_backend.repository;
import com.aeropure.aeropure_backend.model.Asset;

import com.aeropure.aeropure_backend.model.AssetMaintenanceHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;




public interface AssetMaintenanceHistoryRepository extends JpaRepository<AssetMaintenanceHistory, Long> {


    List<AssetMaintenanceHistory> findByAsset(Asset asset);



    void deleteByAsset(Asset asset);
}
