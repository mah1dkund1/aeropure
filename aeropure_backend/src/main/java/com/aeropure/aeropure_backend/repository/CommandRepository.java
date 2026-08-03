package com.aeropure.aeropure_backend.repository;

import com.aeropure.aeropure_backend.model.Command;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CommandRepository extends JpaRepository<Command, Long> {

    Optional<Command> findFirstByDeviceIdOrderByIdDesc(String deviceId);

    List<Command> findByDeviceId( String DeviceId);





}
