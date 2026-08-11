package com.aeropure.aeropure_backend.service;

import com.aeropure.aeropure_backend.model.Asset;
import com.aeropure.aeropure_backend.model.AssetMaintenanceHistory;
import com.aeropure.aeropure_backend.repository.AssetDocumentRepository;
import com.aeropure.aeropure_backend.repository.AssetImageRepository;
import com.aeropure.aeropure_backend.repository.AssetMaintenanceHistoryRepository;
import com.aeropure.aeropure_backend.repository.AssetRepository;
import org.springframework.stereotype.Service;

import org.springframework.transaction.annotation.Transactional;


import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Service


public class AssetService {

    private final AssetRepository assetRepository;
    private final AssetMaintenanceHistoryRepository maintenanceHistoryRepository;
    // Add these two repositories to AssetService
    private final AssetImageRepository assetImageRepository;
    private final AssetDocumentRepository assetDocumentRepository;

    // Updated constructor
    public AssetService(AssetRepository assetRepository,AssetMaintenanceHistoryRepository maintenanceHistoryRepository, AssetImageRepository assetImageRepository,
                        AssetDocumentRepository assetDocumentRepository) {
        this.assetRepository = assetRepository;
        this.maintenanceHistoryRepository = maintenanceHistoryRepository;
        this.assetImageRepository = assetImageRepository;
        this.assetDocumentRepository = assetDocumentRepository;
    }

    public Asset createAsset(Asset asset){
        asset.setCreatedAt(LocalDateTime.now());
        asset.setUpdatedAt(LocalDateTime.now());
        Asset saved = assetRepository.save(asset);

        AssetMaintenanceHistory initialEntry = new AssetMaintenanceHistory();
        initialEntry.setAsset(saved);
        initialEntry.setAction("Added in the system");
        initialEntry.setDate(LocalDateTime.now());
        maintenanceHistoryRepository.save(initialEntry);

        return saved;
    }



// GET - assets
    public List<Asset> listAssets() {
        return assetRepository.findAll();
    }

// GET assets by id

public Asset getAssetById(Long id) {
        return assetRepository.findById(id).orElse(null);
}

//PUT assets update

public Asset updateAsset(Long id, Asset updatedFields, String maintenanceAction)
{
    Optional<Asset> existingOpt = assetRepository.findById(id);

    if (existingOpt.isEmpty()) {
        return null;
    }

    Asset asset = existingOpt.get();

    if (updatedFields.getName() != null){
        asset.setName(updatedFields.getName());
    }

    if(updatedFields.getType() != null){
        asset.setType(updatedFields.getType());
    }

    if(updatedFields.getLocation() != null) {
        asset.setLocation(updatedFields.getLocation());
    }

    if (updatedFields.getStakeholder() != null) {
        asset.setStakeholder(updatedFields.getStakeholder());
    }


    if (updatedFields.getEfficiency() != null) asset.setEfficiency(updatedFields.getEfficiency());

    if (updatedFields.getLatitude() != null) asset.setLatitude(updatedFields.getLatitude());

    if (updatedFields.getLongitude() != null) asset.setLongitude(updatedFields.getLongitude());

    asset.setUpdatedAt(LocalDateTime.now());

    Asset saved = assetRepository.save (asset);

    if (maintenanceAction != null && !maintenanceAction.isBlank()) {
        AssetMaintenanceHistory entry = new AssetMaintenanceHistory();
        entry.setAsset(saved);
        entry.setAction(maintenanceAction);
        entry.setDate(LocalDateTime.now());
        maintenanceHistoryRepository.save(entry);
    }

    return saved;
}

// Delete
@Transactional
    public boolean deleteAsset(Long id) {
        Optional<Asset> assetOpt = assetRepository.findById(id);
        if (assetOpt.isEmpty()) {
            return false;
        }

        Asset asset = assetOpt.get();

        // Delete child records first — order matters here
        maintenanceHistoryRepository.deleteByAsset(asset);
        assetImageRepository.deleteByAsset(asset);
        assetDocumentRepository.deleteByAsset(asset);

        // Now safe to delete the parent
        assetRepository.deleteById(id);
        return true;
    }

    public void markAssetActive(String deviceCode) {
        assetRepository.findAll().stream().filter(a -> deviceCode.equals(a.getDeviceCode())).findFirst().ifPresent(asset -> {
            asset.setLastActiveAt((LocalDateTime.now()) );
            asset.setStatus("active");
            assetRepository.save(asset);
        });
    }








}
