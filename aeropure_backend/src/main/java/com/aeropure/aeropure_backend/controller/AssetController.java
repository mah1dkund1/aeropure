package com.aeropure.aeropure_backend.controller;

import com.aeropure.aeropure_backend.model.Asset;
import com.aeropure.aeropure_backend.model.AssetDocument;
import com.aeropure.aeropure_backend.model.AssetImage;
import com.aeropure.aeropure_backend.service.AssetService;
import com.aeropure.aeropure_backend.repository.AssetImageRepository;
import com.aeropure.aeropure_backend.repository.AssetDocumentRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@CrossOrigin(origins = "*")
@RequestMapping("/assets")
public class AssetController {

    private final AssetService assetService;
    private final AssetImageRepository assetImageRepository;
    private final AssetDocumentRepository assetDocumentRepository;

    private static final String UPLOAD_FOLDER = "./uploads/assets";
    private static final List<String> IMAGE_EXTENSIONS =
            Arrays.asList("png", "jpg", "jpeg", "gif");
    private static final List<String> ALLOWED_EXTENSIONS =
            Arrays.asList("png", "jpg", "jpeg", "gif", "pdf", "docx");

    public AssetController(AssetService assetService,
                           AssetImageRepository assetImageRepository,
                           AssetDocumentRepository assetDocumentRepository) {
        this.assetService = assetService;
        this.assetImageRepository = assetImageRepository;
        this.assetDocumentRepository = assetDocumentRepository;
    }

    // POST /assets — create asset with optional file uploads
    @PostMapping
    public ResponseEntity<Map<String, Object>> createAsset(
            @RequestParam Map<String, String> params,
            @RequestParam(value = "files", required = false) List<MultipartFile> files) {

        if (!params.containsKey("name")) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "Missing required fields");
            return ResponseEntity.badRequest().body(error);
        }

        Asset asset = new Asset();
        asset.setDeviceCode(params.get("id"));
        asset.setName(params.get("name"));
        asset.setType(params.get("type"));
        asset.setLocation(params.get("location"));
        asset.setStakeholder(params.get("stakeholder"));
        asset.setEfficiency(params.get("efficiency"));

        if (params.get("latitude") != null) {
            asset.setLatitude(Double.parseDouble(params.get("latitude")));
        }
        if (params.get("longitude") != null) {
            asset.setLongitude(Double.parseDouble(params.get("longitude")));
        }

        Asset saved = assetService.createAsset(asset);

        // Handle file uploads
        if (files != null) {
            handleFileUploads(files, saved);
        }

        Map<String, Object> response = new HashMap<>();
        response.put("message", "Asset created");
        response.put("id", saved.getId().toString());
        return ResponseEntity.status(201).body(response);
    }

    // GET /assets — list with optional search, type filter, pagination
    @GetMapping
    public ResponseEntity<Map<String, Object>> listAssets(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String type,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int pageSize) {

        List<Asset> all = assetService.listAssets();

        // Filter by type
        if (type != null && !type.isBlank()) {
            all = all.stream()
                    .filter(a -> type.equals(a.getType()))
                    .toList();
        }

        // Filter by search keyword
        if (search != null && !search.isBlank()) {
            String keyword = search.toLowerCase();
            all = all.stream()
                    .filter(a ->
                            (a.getName() != null && a.getName().toLowerCase().contains(keyword)) ||
                                    (a.getLocation() != null && a.getLocation().toLowerCase().contains(keyword)) ||
                                    (a.getStakeholder() != null && a.getStakeholder().toLowerCase().contains(keyword)))
                    .toList();
        }

        // Pagination
        int total = all.size();
        int fromIndex = Math.min((page - 1) * pageSize, total);
        int toIndex = Math.min(fromIndex + pageSize, total);
        List<Asset> paged = all.subList(fromIndex, toIndex);

        Map<String, Object> response = new HashMap<>();
        response.put("total", total);
        response.put("page", page);
        response.put("pageSize", pageSize);
        response.put("items", paged);
        return ResponseEntity.ok(response);
    }

    // GET /assets/{id} — get one asset
    @GetMapping("/{id}")
    public ResponseEntity<Object> getAsset(@PathVariable Long id) {
        Asset asset = assetService.getAssetById(id);
        if (asset == null) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "Asset not found");
            return ResponseEntity.status(404).body(error);
        }
        return ResponseEntity.ok(asset);
    }

    // PUT/PATCH /assets/{id} — update asset
    @RequestMapping(value = "/{id}", method = {RequestMethod.PUT, RequestMethod.PATCH})
    public ResponseEntity<Map<String, Object>> updateAsset(
            @PathVariable Long id,
            @RequestParam Map<String, String> params,
            @RequestParam(value = "files", required = false) List<MultipartFile> files) {

        Asset updatedFields = new Asset();
        if (params.containsKey("name")) updatedFields.setName(params.get("name"));
        if (params.containsKey("type")) updatedFields.setType(params.get("type"));
        if (params.containsKey("location")) updatedFields.setLocation(params.get("location"));
        if (params.containsKey("stakeholder")) updatedFields.setStakeholder(params.get("stakeholder"));
        if (params.containsKey("efficiency")) updatedFields.setEfficiency(params.get("efficiency"));
        if (params.containsKey("latitude")) updatedFields.setLatitude(Double.parseDouble(params.get("latitude")));
        if (params.containsKey("longitude")) updatedFields.setLongitude(Double.parseDouble(params.get("longitude")));

        String maintenanceAction = params.get("action");

        Asset saved = assetService.updateAsset(id, updatedFields, maintenanceAction);

        if (saved == null) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "Asset not found");
            return ResponseEntity.status(404).body(error);
        }

        // Handle file uploads
        if (files != null) {
            handleFileUploads(files, saved);
        }

        Map<String, Object> response = new HashMap<>();
        response.put("message", "Asset updated successfully");
        return ResponseEntity.ok(response);
    }

    // DELETE /assets/{id}
    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> deleteAsset(@PathVariable Long id) {
        boolean deleted = assetService.deleteAsset(id);
        Map<String, Object> response = new HashMap<>();
        if (!deleted) {
            response.put("error", "Asset not found");
            return ResponseEntity.status(404).body(response);
        }
        response.put("message", "Asset deleted");
        return ResponseEntity.ok(response);
    }

    // GET /assets/files/{filename} — serve uploaded file
    @GetMapping("/files/{filename}")
    public ResponseEntity<byte[]> serveFile(@PathVariable String filename) throws IOException {
        Path baseDir = Paths.get(UPLOAD_FOLDER).toAbsolutePath().normalize();
        Path filePath = baseDir.resolve(filename).normalize();

        // stop anything escaping the uploads folder
        if (!filePath.startsWith(baseDir) || !Files.exists(filePath)) {
            return ResponseEntity.notFound().build();
        }

        byte[] content = Files.readAllBytes(filePath);
        return ResponseEntity.ok()
                .header("Content-Type", Files.probeContentType(filePath))
                .body(content);
    }

    // ---- Private helper: handle file uploads ----
    private void handleFileUploads(List<MultipartFile> files, Asset asset) {
        File uploadDir = new File(UPLOAD_FOLDER);
        if (!uploadDir.exists()) uploadDir.mkdirs();

        for (MultipartFile file : files) {
            if (file.isEmpty()) continue;
            String filename = file.getOriginalFilename();
            if (filename == null) continue;
            filename = Paths.get(filename).getFileName().toString();

            String ext = filename.contains(".")
                    ? filename.substring(filename.lastIndexOf('.') + 1).toLowerCase()
                    : "";

            if (!ALLOWED_EXTENSIONS.contains(ext)) continue;

            try {
                Path dest = Paths.get(UPLOAD_FOLDER, filename);
                Files.write(dest, file.getBytes());

                if (IMAGE_EXTENSIONS.contains(ext)) {
                    AssetImage image = new AssetImage();
                    image.setAsset(asset);
                    image.setFilename(filename);
                    assetImageRepository.save(image);
                } else {
                    AssetDocument doc = new AssetDocument();
                    doc.setAsset(asset);
                    doc.setFilename(filename);
                    assetDocumentRepository.save(doc);
                }
            } catch (IOException e) {
                System.err.println("Failed to save file: " + filename);
            }
        }
    }
}